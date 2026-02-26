import { Document } from "@langchain/core/documents";
import { ConcurrentModificationError } from "../../domain/errors.js";
import { QdrantVectorStore } from "@langchain/qdrant";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { Goal } from "../../domain/contracts.js";
import { GoalSchema } from "../../domain/contracts.js";
import { migrateTasksToHierarchy } from "../../domain/taskUtils.js";
import type {
  IGoalRepository,
  GoalSearchFilter,
  GoalListOptions,
  GoalListResult,
} from "../../domain/ports.js";
import {
  getSharedQdrantClient,
  bootstrapQdrantCollections,
  GOALS_COLLECTION,
} from "./qdrantClient.js";
import type { QdrantClient } from "@qdrant/qdrant-js";
import { logWarn } from "../observability/tracing.js";

// Re-export port types for backward compatibility
export type { GoalSearchFilter, GoalListOptions, GoalListResult } from "../../domain/ports.js";

/** Configuration for constructing Qdrant repository instances. */
export interface QdrantGoalRepositoryConfig {
  embeddings: EmbeddingsInterface;
  collectionName?: string;
  /** Optional pre-constructed client (defaults to shared singleton). */
  client?: QdrantClient;
}


/**
 * Qdrant-backed implementation of {@link IGoalRepository}.
 * Supports semantic search, filtered retrieval, and deterministic pagination.
 */
export class QdrantGoalRepository implements IGoalRepository {
  private readonly store: QdrantVectorStore;
  private readonly collectionName: string;

  constructor(config: QdrantGoalRepositoryConfig) {
    const client = config.client ?? getSharedQdrantClient();
    this.collectionName = config.collectionName ?? GOALS_COLLECTION;
    this.store = new QdrantVectorStore(config.embeddings, {
      client,
      collectionName: this.collectionName,
      metadataPayloadKey: "metadata",
      contentPayloadKey: "content",
    });
  }

  /**
   * Bootstrap collections and indexes. Call once at startup.
   */
  async bootstrap(): Promise<void> {
    const vectorSize = (await this.store.embeddings.embedQuery("test")).length;
    await bootstrapQdrantCollections(this.store.client, vectorSize);
  }

  /**
   * Upsert a goal into the vector store. Content = description; metadata = filterable payload.
   *
   * When `expectedVersion` is provided, performs a compare-and-set:
   * reads the stored `_version`, verifies it matches, and writes with
   * `_version + 1`. On mismatch throws {@link ConcurrentModificationError}.
   *
   * > **Caveat (TOCTOU):** The compare-and-set is not truly atomic — there
   * > is a window between `getById()` and `addDocuments()` during which
   * > another writer can change the version. Qdrant does not support
   * > conditional writes, so this is an inherent limitation.
   */
  async upsert(goal: Goal, expectedVersion?: number): Promise<void> {
    if (expectedVersion !== undefined) {
      const existing = await this.getById(goal.id);
      const storedVersion = existing?._version ?? 1;
      if (storedVersion !== expectedVersion) {
        throw new ConcurrentModificationError(goal.id, expectedVersion);
      }
      const versionedGoal = { ...goal, _version: expectedVersion + 1 };
      const doc = goalToDocument(versionedGoal);
      await this.store.addDocuments([doc], { ids: [goal.id] });
      return;
    }
    const doc = goalToDocument(goal);
    await this.store.addDocuments([doc], { ids: [goal.id] });
  }

  /**
   * Semantic search with optional payload filters.
   */
  async search(
    query: string,
    options: { k?: number; filter?: GoalSearchFilter } = {},
  ): Promise<Array<{ goal: Goal; score: number }>> {
    const { k = 10, filter } = options;
    const qdrantFilter = filterToQdrantFilter(filter);
    const pairs = await this.store.similaritySearchWithScore(query, k, qdrantFilter);

    const results: Array<{ goal: Goal; score: number }> = [];
    for (const [doc, score] of pairs) {
      const goal = documentToGoal(doc);
      if (goal) results.push({ goal, score });
    }
    return results;
  }

  /**
   * Search by vector (for capability matching without re-embedding).
   */
  async searchByVector(
    queryVector: number[],
    options: { k?: number; filter?: GoalSearchFilter } = {},
  ): Promise<Array<{ goal: Goal; score: number }>> {
    const { k = 10, filter } = options;
    const qdrantFilter = filterToQdrantFilter(filter);
    const pairs = await this.store.similaritySearchVectorWithScore(queryVector, k, qdrantFilter);

    const results: Array<{ goal: Goal; score: number }> = [];
    for (const [doc, score] of pairs) {
      const goal = documentToGoal(doc);
      if (goal) results.push({ goal, score });
    }
    return results;
  }

  /**
   * Retrieve a goal by ID (exact match on metadata.goal_id).
   */
  async getById(goalId: string): Promise<Goal | null> {
    const filter = { must: [{ key: "metadata.goal_id", match: { value: goalId } }] };
    const result = await this.store.client.scroll(this.collectionName, {
      filter,
      limit: 1,
      with_payload: true,
      with_vector: false,
    });
    const points = result.points ?? [];
    if (!points[0]) return null;
    const p = points[0];
    const payload = p.payload as Record<string, unknown>;
    const contentKey = "content";
    const metadataKey = "metadata";
    const content = (payload[contentKey] ?? "") as string;
    const metadata = (payload[metadataKey] ?? {}) as Record<string, unknown>;
    return documentToGoal(
      new Document({ pageContent: content, metadata: { ...metadata, goal_id: goalId } }),
    );
  }

  /**
   * List goals using metadata filters with offset/limit pagination.
   */
  async list(options: GoalListOptions = {}): Promise<Goal[]> {
    const result = await this.listWithTotal(options);
    return result.items;
  }

  /**
   * List goals with deterministic ordering and total count.
   *
   * > **Note:** The sort by `updatedAt` is applied to the current page only
   * > (in-memory), not globally across Qdrant. This means across pages,
   * > ordering is not globally deterministic. For consistent ordering, use
   * > cursor-based pagination via `nextCursor` in the response.
   */
  async listWithTotal(options: GoalListOptions = {}): Promise<GoalListResult> {
    const { limit = 50, offset = 0, filter, cursor } = options;
    const safeLimit = Math.max(1, Math.min(200, limit));
    const safeOffset = Math.max(0, offset);
    const qdrantFilter = filterToQdrantFilter(filter);

    // O(1) count — no data transfer, uses Qdrant count endpoint
    const countResult = await this.store.client.count(this.collectionName, {
      ...(qdrantFilter ? { filter: qdrantFilter } : {}),
      exact: true,
    });
    const total = countResult.count;

    // Determine the scroll cursor for the data fetch.
    //
    // When a cursor is provided (from a previous page's `nextCursor`), we skip
    // the O(n) offset scroll entirely and use the cursor directly — this is the
    // O(1) fast path.
    //
    // When no cursor is provided, we fall back to the legacy offset scroll
    // (O(n) — pages through discarded batches) for backward compatibility.
    let scrollOffset: string | number | null | undefined;
    if (cursor !== undefined) {
      // ── O(1) cursor path ──────────────────────────────────────────────
      scrollOffset = cursor;
    } else if (safeOffset > 0) {
      // ── O(n) legacy offset path ───────────────────────────────────────
      // Qdrant's scroll API has no native numeric offset parameter, so we
      // page through discarded batches.  For typical GMS workloads (≤ hundreds
      // of goals) this is negligible.
      let skipped = 0;
      while (skipped < safeOffset) {
        const batch = Math.min(200, safeOffset - skipped);
        const page = await this.store.client.scroll(this.collectionName, {
          ...(qdrantFilter ? { filter: qdrantFilter } : {}),
          limit: batch,
          ...(scrollOffset !== undefined ? { offset: scrollOffset } : {}),
          with_payload: false,
          with_vector: false,
        });
        const points = page.points ?? [];
        if (points.length === 0) break;
        skipped += points.length;
        const next = (page as { next_page_offset?: string | number | null }).next_page_offset;
        if (next === undefined || next === null) break;
        scrollOffset = next;
      }
    }

    // Fetch the actual page with payload
    const dataPage = await this.store.client.scroll(this.collectionName, {
      ...(qdrantFilter ? { filter: qdrantFilter } : {}),
      limit: safeLimit,
      ...(scrollOffset !== undefined ? { offset: scrollOffset } : {}),
      with_payload: true,
      with_vector: false,
    });

    const nextPageOffset = (dataPage as { next_page_offset?: string | number | null })
      .next_page_offset;

    const goals = (dataPage.points ?? [])
      .map((p) => {
        const payload = p.payload as Record<string, unknown>;
        const content = (payload.content ?? "") as string;
        const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
        return documentToGoal(new Document({ pageContent: content, metadata }));
      })
      .filter((g): g is Goal => g !== null)
      .sort((a, b) => {
        const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
        const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
        if (tb !== ta) return tb - ta;
        return a.id.localeCompare(b.id);
      });

    return {
      items: goals,
      total,
      limit: safeLimit,
      offset: safeOffset,
      ...(nextPageOffset != null ? { nextCursor: nextPageOffset } : {}),
    };
  }

  /**
   * Delete goals by IDs.
   */
  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.store.delete({ ids });
  }
}

function goalToDocument(goal: Goal): Document {
  return new Document({
    pageContent: goal.description,
    metadata: goalToMetadata(goal),
  });
}

/** Converts a domain goal into Qdrant metadata payload format. */
function goalToMetadata(goal: Goal): Record<string, unknown> {
  return {
    goal_id: goal.id,
    status: goal.status,
    priority: goal.priority,
    tenant_id: goal.tenantId ?? null,
    tasks: goal.tasks,
    parent_goal_id: goal.parentGoal?.id ?? null,
    custom_metadata: goal.metadata ?? {},
    created_at: goal.createdAt ?? new Date().toISOString(),
    updated_at: goal.updatedAt ?? new Date().toISOString(),
    _version: goal._version ?? 1,
  };
}

/** Converts a stored vector document back into a `Goal` domain object. */
function documentToGoal(doc: Document): Goal | null {
  const m = doc.metadata as Record<string, unknown>;
  const id = (m.goal_id ?? doc.id) as string;
  if (!id) return null;
  const rawTasks = m.tasks ?? m.sub_tasks;
  const candidate = {
    id,
    description: doc.pageContent,
    status: (m.status as Goal["status"]) ?? "pending",
    priority: (m.priority as Goal["priority"]) ?? "medium",
    tasks: migrateTasksToHierarchy(rawTasks),
    tenantId: (m.tenant_id as string) ?? undefined,
    parentGoal: m.parent_goal_id ? { id: m.parent_goal_id as string } : undefined,
    metadata: (m.custom_metadata as Record<string, unknown>) ?? {},
    createdAt: m.created_at as string | undefined,
    updatedAt: m.updated_at as string | undefined,
    _version: typeof m._version === "number" ? m._version : 1,
  };
  const result = GoalSchema.safeParse(candidate);
  if (!result.success) {
    logWarn(`documentToGoal: Invalid goal data for id=${id}: ${result.error.message}`);
    return null;
  }
  return result.data;
}

/** Converts repository-level filters to Qdrant filter payload syntax. */
function filterToQdrantFilter(filter?: GoalSearchFilter): object | undefined {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  const must: Array<{ key: string; match: { value: string } }> = [];
  if (filter.status) must.push({ key: "metadata.status", match: { value: filter.status } });
  if (filter.priority) must.push({ key: "metadata.priority", match: { value: filter.priority } });
  if (filter.tenantId) must.push({ key: "metadata.tenant_id", match: { value: filter.tenantId } });
  if (filter.goalId) must.push({ key: "metadata.goal_id", match: { value: filter.goalId } });
  if (must.length === 0) return undefined;
  return { must };
}

