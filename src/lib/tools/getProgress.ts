import { tool } from "@langchain/core/tools";
import { GetProgressInputSchema } from "../schemas/lifecycleSchemas.js";
import { getGoalOrThrow, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import { flattenTasks } from "../../domain/taskUtils.js";

export const createGetProgressTool = (deps: GmsToolDeps) =>
  tool(
    async (input) => {
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      const flat = flattenTasks(goal.tasks);
      const total = flat.length;
      const counts = {
        completed: 0,
        failed: 0,
        in_progress: 0,
        pending: 0,
        cancelled: 0,
        planned: 0,
      };
      for (const t of flat) counts[t.status]++;
      const { completed, failed, in_progress: inProgress, pending, cancelled, planned } = counts;
      const completionRate = total === 0 ? 0 : Math.round((completed / total) * 10000) / 10000;
      const typeCounts = { research: 0, action: 0, validation: 0, decision: 0 };
      for (const t of flat) {
        const taskType = t.type ?? "action";
        if (taskType in typeCounts) typeCounts[taskType]++;
      }
      return wrapToolResponse({
        goalId: goal.id,
        status: goal.status,
        totalTasks: total,
        completedTasks: completed,
        failedTasks: failed,
        inProgressTasks: inProgress,
        pendingTasks: pending,
        cancelledTasks: cancelled,
        plannedTasks: planned,
        completionRate,
        taskTypeCounts: typeCounts,
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
