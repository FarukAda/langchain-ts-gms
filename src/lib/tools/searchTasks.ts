import { tool } from "@langchain/core/tools";
import { SearchTasksInputSchema, coerceLifecycleInput, DEFAULT_PAGE_LIMIT } from "../schemas/lifecycleSchemas.js";
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
        // Semantic search — embed query and task descriptions, rank by cosine similarity
        const queryEmbedding = await deps.embeddings.embedQuery(q);
        const descriptions = structFiltered.map(
          (t) => `${t.description} ${t.result ?? ""} ${t.error ?? ""}`,
        );
        const taskEmbeddings = await deps.embeddings.embedDocuments(descriptions);

        const scored = structFiltered
          .map((t, i) => ({
            task: t,
            score: cosineSimilarity(queryEmbedding, taskEmbeddings[i]!),
          }))
          .filter((s) => s.score >= MIN_SIMILARITY)
          .sort((a, b) => b.score - a.score);

        matched = scored.map((s) => s.task);
      } else {
        // Fallback — substring matching (backward compat)
        logWarn("Embeddings not available for semantic search; falling back to substring matching");
        const qLower = q.toLowerCase();
        matched = structFiltered.filter((t) => {
          const hay = `${t.description} ${t.result ?? ""} ${t.error ?? ""}`.toLowerCase();
          return hay.includes(qLower);
        });
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
