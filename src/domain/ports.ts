import type { Goal } from "./contracts.js";

/** Payload filter options for querying goals by metadata. */
export interface GoalSearchFilter {
  status?: Goal["status"];
  priority?: Goal["priority"];
  tenantId?: string;
  goalId?: string;
}

/** Paging and filter options for listing goals from storage. */
export interface GoalListOptions {
  limit?: number;
  offset?: number;
  /** Opaque cursor from a previous `listWithTotal` result. When provided, bypasses the O(n) offset scroll. */
  cursor?: string | number;
  filter?: GoalSearchFilter;
}

/** Deterministic page payload with total count metadata. */
export interface GoalListResult {
  items: Goal[];
  total: number;
  limit: number;
  offset: number;
  /** Cursor for the next page. Pass to `GoalListOptions.cursor` for O(1) pagination. Omitted on last page. */
  nextCursor?: string | number;
}

/**
 * Storage-agnostic repository contract for goal persistence.
 *
 * Implement this interface to plug in any vector store backend
 * (Qdrant, Pinecone, pgvector, in-memory, etc.).
 */
export interface IGoalRepository {
  /** Bootstrap collections/indexes. Call once at startup. */
  bootstrap(): Promise<void>;

  /**
   * Upsert a goal into the store.
   *
   * @param goal - The goal to persist.
   * @param expectedVersion - When provided, the implementation must verify that
   *   the currently stored `_version` matches this value before writing.
   *   On mismatch, throw {@link ConcurrentModificationError}.
   */
  upsert(goal: Goal, expectedVersion?: number): Promise<void>;

  /** Semantic search with optional payload filters. */
  search(
    query: string,
    options?: { k?: number; filter?: GoalSearchFilter },
  ): Promise<Array<{ goal: Goal; score: number }>>;

  /** Search by pre-computed vector (for capability matching without re-embedding). */
  searchByVector(
    queryVector: number[],
    options?: { k?: number; filter?: GoalSearchFilter },
  ): Promise<Array<{ goal: Goal; score: number }>>;

  /** Retrieve a goal by ID (exact match). */
  getById(goalId: string): Promise<Goal | null>;

  /** List goals using metadata filters with offset/limit pagination. */
  list(options?: GoalListOptions): Promise<Goal[]>;

  /** List goals with deterministic ordering and total count. */
  listWithTotal(options?: GoalListOptions): Promise<GoalListResult>;

  /** Delete goals by IDs. */
  deleteByIds(ids: string[]): Promise<void>;
}
