import type { GmsToolDeps } from "../types.js";
import type { Task } from "../../domain/contracts.js";
import { getGoalOrThrow, matchesFilters, paginate } from "../helpers.js";
import { flattenTasks } from "../../domain/taskUtils.js";
import { semanticSearchTasks, substringSearchTasks } from "../tools/searchTasks.js";
import { logWarn } from "../../infra/observability/tracing.js";

// ---------------------------------------------------------------------------
// Search-Tasks handler
// ---------------------------------------------------------------------------

export interface SearchTasksInput {
  goalId: string;
  query?: string | undefined;
  status?: string[] | undefined;
  priority?: string[] | undefined;
  type?: string[] | undefined;
  hasDependencies?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SearchTasksResult {
  goalId: string;
  total: number;
  limit: number;
  offset: number;
  items: Task[];
}

export async function handleSearchTasks(
  deps: GmsToolDeps,
  input: SearchTasksInput,
): Promise<SearchTasksResult> {
  const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
  const flat = flattenTasks(goal.tasks);
  const structFiltered = flat.filter((t) => {
    if (
      !matchesFilters(
        t,
        input.status as Task["status"][] | undefined,
        input.priority as Task["priority"][] | undefined,
        input.type as NonNullable<Task["type"]>[] | undefined,
      )
    )
      return false;
    if (input.hasDependencies !== undefined) {
      if ((t.dependencies.length > 0) !== input.hasDependencies) return false;
    }
    return true;
  });
  const q = input.query?.trim();
  let matched: Task[];
  if (!q) {
    matched = structFiltered;
  } else if (deps.embeddings) {
    matched = await semanticSearchTasks(structFiltered, q, deps.embeddings, input.goalId);
  } else {
    logWarn("Embeddings not available for semantic search; falling back to substring");
    matched = substringSearchTasks(structFiltered, q);
  }
  const lim = input.limit ?? 50;
  const off = input.offset ?? 0;
  const page = paginate(matched, lim, off);
  return { goalId: input.goalId, ...page, limit: lim, offset: off };
}
