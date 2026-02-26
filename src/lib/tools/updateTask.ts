import { tool } from "@langchain/core/tools";
import { UpdateTaskInputSchema } from "../schemas/lifecycleSchemas.js";
import { stripNulls, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import type { Goal, Task } from "../../domain/contracts.js";
import { flattenTasks } from "../../domain/taskUtils.js";
import { logWarn } from "../../infra/observability/tracing.js";
import { handleUpdateTask } from "../handlers/updateHandlers.js";

/**
 * Check if a task is "ready" — status is pending and all dependencies
 * have been completed (or it has no dependencies).
 *
 * Shared by both the LangChain tool and the MCP server.
 */
export function isTaskReady(task: Task, allTasks: Task[]): boolean {
  if (task.status !== "pending") return false;
  if (task.dependencies.length === 0) return true;
  return task.dependencies.every((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    return dep?.status === "completed";
  });
}

/**
 * Fire lifecycle hooks after a status-changing update.
 * All hook errors are caught and logged — they must never crash the tool.
 *
 * @param prevReadyIds - tasks that were already ready BEFORE the update (excluded from onTaskReady)
 */
export async function fireLifecycleHooks(
  deps: GmsToolDeps,
  updated: Goal,
  prevReadyIds: ReadonlySet<string>,
): Promise<void> {
  const flat = flattenTasks(updated.tasks);

  // onTaskReady: fire only for tasks that became NEWLY ready (not previously ready)
  if (deps.onTaskReady) {
    const readyTasks = flat.filter((t) => isTaskReady(t, flat) && !prevReadyIds.has(t.id));
    for (const ready of readyTasks) {
      try {
        await deps.onTaskReady(ready, updated);
      } catch (err) {
        logWarn("onTaskReady hook error (non-fatal)", {
          taskId: ready.id,
          goalId: updated.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // onGoalCompleted: fire when every task in the tree is completed
  if (deps.onGoalCompleted) {
    const allCompleted = flat.length > 0 && flat.every((t) => t.status === "completed");
    if (allCompleted) {
      try {
        await deps.onGoalCompleted(updated);
      } catch (err) {
        logWarn("onGoalCompleted hook error (non-fatal)", {
          goalId: updated.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/** Creates the `gms_update_task` tool for updating a task's status, result, or error with lifecycle hooks. */
export const createUpdateTaskTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      if (deps.rateLimiter) await deps.rateLimiter.acquire();
      const input = stripNulls(rawInput);
      const result = await handleUpdateTask(deps, input);
      return wrapToolResponse(result);
    },
    {
      name: "gms_update_task",
      description:
        "Update a task's status, result, or error within a goal. " +
        "Requires both goalId and taskId. All other fields are optional. " +
        "Status transitions are validated: pending→in_progress/completed/failed/cancelled, " +
        "in_progress→completed/failed/cancelled, failed→in_progress/cancelled. " +
        "Set status='completed' with result for success; status='failed' with error for failure. " +
        "Invalid transitions return an INVALID_TRANSITION error. " +
        "Returns: { goalId, task }.",
      schema: UpdateTaskInputSchema,
    },
  );
