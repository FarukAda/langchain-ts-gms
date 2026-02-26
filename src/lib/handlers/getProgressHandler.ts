import type { GmsToolDeps } from "../types.js";
import type { Task } from "../../domain/contracts.js";
import { getGoalOrThrow } from "../helpers.js";
import { flattenTasks } from "../../domain/taskUtils.js";

// ---------------------------------------------------------------------------
// Get-Progress handler
// ---------------------------------------------------------------------------

export interface GetProgressResult {
  goalId: string;
  goalStatus: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  cancelledTasks: number;
  plannedTasks: number;
  completionRate: number;
  taskTypeCounts: Record<string, number>;
}

export async function handleGetProgress(
  deps: GmsToolDeps,
  goalId: string,
): Promise<GetProgressResult> {
  const goal = await getGoalOrThrow(deps.goalRepository, goalId);
  const flat = flattenTasks(goal.tasks);
  const total = flat.length;

  const counts: Record<Task["status"], number> = {
    pending: 0,
    planned: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const t of flat) counts[t.status]++;

  const completionRate = total > 0 ? Math.round((counts.completed / total) * 10000) / 10000 : 0;

  const typeCounts: Record<string, number> = {
    research: 0,
    action: 0,
    validation: 0,
    decision: 0,
  };
  for (const t of flat) {
    const taskType = t.type ?? "action";
    if (taskType in typeCounts) typeCounts[taskType] = (typeCounts[taskType] ?? 0) + 1;
  }

  return {
    goalId: goal.id,
    goalStatus: goal.status,
    totalTasks: total,
    completedTasks: counts.completed,
    failedTasks: counts.failed,
    inProgressTasks: counts.in_progress,
    pendingTasks: counts.pending,
    cancelledTasks: counts.cancelled,
    plannedTasks: counts.planned,
    completionRate,
    taskTypeCounts: typeCounts,
  };
}
