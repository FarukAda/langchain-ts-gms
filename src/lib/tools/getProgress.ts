import { tool } from "@langchain/core/tools";
import { GetProgressInputSchema } from "../schemas/lifecycleSchemas.js";
import { wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import { handleGetProgress } from "../handlers/getProgressHandler.js";

/** Creates the `gms_get_progress` tool for retrieving completion statistics and progress counters. */
export const createGetProgressTool = (deps: GmsToolDeps) =>
  tool(
    async (input) => {
      const result = await handleGetProgress(deps, input.goalId);
      return wrapToolResponse({
        goalId: result.goalId,
        status: result.goalStatus,
        totalTasks: result.totalTasks,
        completedTasks: result.completedTasks,
        failedTasks: result.failedTasks,
        inProgressTasks: result.inProgressTasks,
        pendingTasks: result.pendingTasks,
        cancelledTasks: result.cancelledTasks,
        plannedTasks: result.plannedTasks,
        completionRate: result.completionRate,
        taskTypeCounts: result.taskTypeCounts,
      });
    },
    {
      name: "gms_get_progress",
      description:
        "Get completion statistics for a goal: counts by status and task type, plus a completion rate (0–1). " +
        "Use this to check how far along a goal is before deciding next actions. " +
        "Returns: { goalId, status, totalTasks, completedTasks, failedTasks, inProgressTasks, " +
        "pendingTasks, cancelledTasks, plannedTasks, completionRate, taskTypeCounts }.",
      schema: GetProgressInputSchema,
    },
  );
