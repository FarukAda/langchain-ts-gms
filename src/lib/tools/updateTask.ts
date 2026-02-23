import { tool } from "@langchain/core/tools";
import { UpdateTaskInputSchema } from "../schemas/lifecycleSchemas.js";
import { getGoalOrThrow, findTaskById, stripNulls, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import type { Goal } from "../../domain/contracts.js";
import { updateTaskById, canTransitionTaskStatus } from "../../domain/taskUtils.js";
import { ErrorCodes } from "../../infra/observability/tracing.js";

export const createUpdateTaskTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      const input = stripNulls(rawInput);
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      const existing = findTaskById(goal.tasks, input.taskId);
      if (!existing)
        throw new Error(
          `[${ErrorCodes.TASK_NOT_FOUND}] Task not found in goal ${input.goalId}: ${input.taskId}`,
        );
      if (input.status !== undefined && !canTransitionTaskStatus(existing.status, input.status)) {
        throw new Error(
          `[${ErrorCodes.INVALID_TRANSITION}] Invalid status transition for ${input.taskId}: ${existing.status} -> ${input.status}`,
        );
      }

      const tasks = updateTaskById(goal.tasks, input.taskId, (t) => ({
        ...t,
        ...(input.status !== undefined && { status: input.status }),
        ...(input.result !== undefined && { result: input.result }),
        ...(input.error !== undefined && { error: input.error }),
      }));
      const updated: Goal = {
        ...goal,
        tasks,
        updatedAt: new Date().toISOString(),
      };
      await deps.goalRepository.upsert(updated);
      const task = findTaskById(tasks, input.taskId);
      return wrapToolResponse({ goalId: updated.id, task });
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
