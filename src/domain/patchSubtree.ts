import type { Goal, Task } from "./contracts.js";
import type { IGoalRepository } from "./ports.js";
import { flattenTasks, updateTaskById, executionOrder } from "./taskUtils.js";
import { logInfo } from "../infra/observability/tracing.js";

/**
 * Options for the surgical patch operation.
 */
export interface PatchSubtreeOptions {
  /** ID of the goal containing the task tree. */
  goalId: string;
  /** ID of the root task of the sub-tree to replace/replan. */
  subtreeRootId: string;
  /** New tasks to replace the sub-tree with. */
  replacementTasks: Task[];
  /** Whether to reset descendants to "pending" status. */
  resetDescendants?: boolean;
}

/** Result of the patch operation. */
export interface PatchSubtreeResult {
  success: boolean;
  patchedGoal: Goal;
  removedTaskIds: string[];
  addedTaskIds: string[];
}

/**
 * Surgically replaces a sub-tree of the task DAG without touching the rest
 * of the plan. This enables CRDT-style partial replanning where only the
 * failed branch is regenerated.
 *
 * Steps:
 * 1. Extract the sub-tree rooted at `subtreeRootId`
 * 2. Collect all descendant IDs for removal tracking
 * 3. Replace the sub-tree's children with `replacementTasks`
 * 4. Optionally reset the root task to "pending"
 * 5. Persist the updated goal
 */
export async function patchPlanSubtree(
  repository: IGoalRepository,
  options: PatchSubtreeOptions,
): Promise<PatchSubtreeResult> {
  const goal = await repository.getById(options.goalId);
  if (!goal) throw new Error(`Goal not found: ${options.goalId}`);

  // Collect existing descendant IDs before replacement
  const flat = flattenTasks(goal.tasks);
  const subtreeRoot = flat.find((t) => t.id === options.subtreeRootId);
  if (!subtreeRoot) throw new Error(`Task not found: ${options.subtreeRootId}`);

  const removedTaskIds = collectDescendantIds(subtreeRoot);

  // Stamp replacement tasks with correct parentId
  const replacementWithParent = options.replacementTasks.map((t) => ({
    ...t,
    parentId: options.subtreeRootId,
  }));
  const addedTaskIds = replacementWithParent.map((t) => t.id);

  // Replace the sub-tree's children (immutable — original goal is not mutated)
  const updated = updateTaskById(goal.tasks, options.subtreeRootId, (t) => ({
    ...t,
    subTasks: replacementWithParent,
    ...(options.resetDescendants && { status: "pending" as const }),
  }));

  const patchedGoal = { ...goal, tasks: updated, updatedAt: new Date().toISOString() };
  await repository.upsert(patchedGoal, goal._version);

  logInfo("Patched plan sub-tree", {
    goalId: options.goalId,
    subtreeRootId: options.subtreeRootId,
    removedCount: removedTaskIds.length,
    addedCount: addedTaskIds.length,
    newExecutionOrder: executionOrder(flattenTasks(patchedGoal.tasks)).map((t) => t.id),
  });

  return {
    success: true,
    patchedGoal,
    removedTaskIds,
    addedTaskIds,
  };
}

/** Recursively collect all descendant task IDs (not including the root). */
function collectDescendantIds(task: Task): string[] {
  const ids: string[] = [];
  for (const child of task.subTasks) {
    ids.push(child.id);
    ids.push(...collectDescendantIds(child));
  }
  return ids;
}
