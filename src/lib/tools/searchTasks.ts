import { tool } from "@langchain/core/tools";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import {
  SearchTasksInputSchema,
  coerceLifecycleInput,
  DEFAULT_PAGE_LIMIT,
} from "../schemas/lifecycleSchemas.js";
import {
  getGoalOrThrow,
  matchesFilters,
  paginate,
  stripNulls,
  wrapToolResponse,
} from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import type { Task } from "../../domain/contracts.js";
import { flattenTasks } from "../../domain/taskUtils.js";
import { logWarn } from "../../infra/observability/tracing.js";

/** Cosine similarity between two numeric vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Minimum cosine similarity score for a task to be considered a match. */
const MIN_SIMILARITY = 0.3;

// ---------------------------------------------------------------------------
// Embedding cache — avoids re-embedding the same task set on rapid successive
// searches within the same goal.  30 s TTL, keyed on (goalId, descriptions).
// ---------------------------------------------------------------------------

/** Cache TTL in milliseconds. */
const EMBED_CACHE_TTL_MS = 30_000;

interface EmbedCacheEntry {
  embeddings: number[][];
  expiry: number;
}

/** Maximum number of cache entries before FIFO eviction. */
const MAX_EMBED_CACHE_ENTRIES = 100;

/** Module-level embedding cache.  Keyed on goalId + sorted-descriptions hash. */
const embedCache = new Map<string, EmbedCacheEntry>();

/**
 * Produces a compact, deterministic cache key for task description embeddings.
 * Uses an FNV-1a-inspired hash instead of raw string concatenation to keep
 * memory usage constant regardless of description length.
 */
function embedCacheKey(goalId: string, descriptions: string[]): string {
  let hash = 2166136261;
  for (const d of descriptions) {
    for (let i = 0; i < d.length; i++) {
      hash ^= d.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    // Separator to avoid "ab","c" colliding with "a","bc"
    hash ^= 10;
    hash = (hash * 16777619) >>> 0;
  }
  return `${goalId}::${descriptions.length}::${hash.toString(36)}`;
}

/**
 * Get or compute task embeddings, using a short TTL cache.
 * Expired entries are lazily evicted on access.
 * Cache is bounded to {@link MAX_EMBED_CACHE_ENTRIES} entries via FIFO eviction.
 */
async function getOrEmbedTasks(
  embeddings: EmbeddingsInterface,
  goalId: string,
  descriptions: string[],
): Promise<number[][]> {
  const key = embedCacheKey(goalId, descriptions);
  const now = Date.now();

  const cached = embedCache.get(key);
  if (cached && cached.expiry > now) {
    return cached.embeddings;
  }

  // Evict expired entry
  if (cached) embedCache.delete(key);

  // FIFO eviction: remove oldest entries when at capacity
  while (embedCache.size >= MAX_EMBED_CACHE_ENTRIES) {
    const oldest = embedCache.keys().next().value;
    if (oldest !== undefined) embedCache.delete(oldest);
    else break;
  }

  const result = await embeddings.embedDocuments(descriptions);
  embedCache.set(key, { embeddings: result, expiry: now + EMBED_CACHE_TTL_MS });
  return result;
}

/** @internal Exported for testing — clear the embedding cache. */
export function _resetEmbedCache(): void {
  embedCache.clear();
}

/**
 * Rank tasks by semantic similarity to a query string using embeddings.
 *
 * Embeds the query and each task's description (with caching), scores via
 * cosine similarity, filters below {@link MIN_SIMILARITY}, and returns tasks
 * sorted by descending relevance.
 *
 * Shared by both the LangChain tool and the MCP server.
 */
export async function semanticSearchTasks(
  tasks: Task[],
  query: string,
  embeddings: EmbeddingsInterface,
  goalId: string,
): Promise<Task[]> {
  const queryEmbedding = await embeddings.embedQuery(query);
  const descriptions = tasks.map((t) => `${t.description} ${t.result ?? ""} ${t.error ?? ""}`);
  const taskEmbeddings = await getOrEmbedTasks(embeddings, goalId, descriptions);

  const scored = tasks
    .map((t, i) => ({
      task: t,
      score: cosineSimilarity(queryEmbedding, taskEmbeddings[i]!),
    }))
    .filter((s) => s.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.task);
}

/**
 * Rank tasks by case-insensitive substring match against a query string.
 *
 * Falls back path when embeddings are not available.
 * Shared by both the LangChain tool and the MCP server.
 */
export function substringSearchTasks(tasks: Task[], query: string): Task[] {
  const qLower = query.toLowerCase();
  return tasks.filter((t) => {
    const hay = `${t.description} ${t.result ?? ""} ${t.error ?? ""}`.toLowerCase();
    return hay.includes(qLower);
  });
}

/**
 * Semantic task search within a goal's task tree.
 *
 * When `deps.embeddings` is available, the query is embedded and scored
 * against each task's description via cosine similarity, producing
 * semantically ranked results.
 *
 * Falls back to case-insensitive substring matching when embeddings
 * are not injected (backward compatibility).
 */
export const createSearchTasksTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      if (deps.rateLimiter) await deps.rateLimiter.acquire();
      const input = stripNulls(coerceLifecycleInput(rawInput));
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      const lim = Number(input.limit) || DEFAULT_PAGE_LIMIT;
      const off = Number(input.offset) || 0;
      const q = input.query?.trim();

      // Apply non-text filters first
      const structFiltered = flattenTasks(goal.tasks).filter((t) => {
        if (!matchesFilters(t, input.status, input.priority, input.type)) return false;
        if (input.hasDependencies !== undefined) {
          const hasDeps = t.dependencies.length > 0;
          if (hasDeps !== input.hasDependencies) return false;
        }
        return true;
      });

      let matched: Task[];

      if (!q) {
        // No query — return all structurally filtered tasks
        matched = structFiltered;
      } else if (deps.embeddings) {
        matched = await semanticSearchTasks(structFiltered, q, deps.embeddings, goal.id);
      } else {
        // Fallback — substring matching (backward compat)
        logWarn("Embeddings not available for semantic search; falling back to substring matching");
        matched = substringSearchTasks(structFiltered, q);
      }

      const page = paginate(matched, lim, off);
      return wrapToolResponse({
        goalId: goal.id,
        total: page.total,
        limit: lim,
        offset: off,
        items: page.items,
      });
    },
    {
      name: "gms_search_tasks",
      description:
        "Semantic search and filter for tasks within a specific goal. " +
        "Requires goalId. Uses embedding-based similarity search when a query is provided, " +
        "ranking tasks by semantic relevance to the query text. " +
        "Also supports filters for status, priority, type, and hasDependencies. " +
        "Use this instead of gms_list_tasks when you need semantic search or dependency filtering. " +
        "Returns paginated JSON: { goalId, total, limit, offset, items[] }.",
      schema: SearchTasksInputSchema,
    },
  );
