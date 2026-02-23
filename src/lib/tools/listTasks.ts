import { tool } from "@langchain/core/tools";
import {
  ListTasksInputSchema,
  coerceLifecycleInput,
  DEFAULT_PAGE_LIMIT,
} from "../schemas/lifecycleSchemas.js";
import {
  getGoalOrThrow,
  matchesFilters,
  filterTaskTree,
  paginate,
  stripNulls,
  wrapToolResponse,
} from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import type { Task } from "../../domain/contracts.js";
import { flattenTasks } from "../../domain/taskUtils.js";

export const createListTasksTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      const input = stripNulls(coerceLifecycleInput(rawInput));
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      const lim = Number(input.limit) || DEFAULT_PAGE_LIMIT;
      const off = Number(input.offset) || 0;
      const predicate = (t: Task) => matchesFilters(t, input.status, input.priority, input.type);
      if (input.flat) {
        const base = input.includeSubTasks ? flattenTasks(goal.tasks) : goal.tasks;
        const filtered = base.filter(predicate);
        const page = paginate(filtered, lim, off);
        return wrapToolResponse({
          goalId: goal.id,
          total: page.total,
          limit: lim,
          offset: off,
          items: page.items,
        });
      } else {
        const filteredTree = filterTaskTree(goal.tasks, predicate);
        const page = paginate(filteredTree, lim, off);
        return wrapToolResponse({
          goalId: goal.id,
          total: page.total,
          limit: lim,
          offset: off,
          items: page.items,
        });
      }
    },
    {
      name: "gms_list_tasks",
      description:
        "List tasks for a specific goal with optional filters. " +
        "Requires goalId. Supports filtering by status, priority, and type. " +
        "Set flat=true (default) to get a flat list; flat=false for nested tree structure. " +
        "Set includeSubTasks=true (default) to include subtasks in flat mode. " +
        "Returns paginated JSON: { goalId, total, limit, offset, items[] }.",
      schema: ListTasksInputSchema,
    },
  );
