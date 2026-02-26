import type { GmsToolDeps } from "../types.js";
import type { Goal, Task } from "../../domain/contracts.js";
import { getGoalOrThrow, findTaskById } from "../helpers.js";
import { updateTaskById, canTransitionTaskStatus, flattenTasks } from "../../domain/taskUtils.js";
import { ErrorCodes } from "../../infra/observability/tracing.js";
import { isTaskReady, fireLifecycleHooks } from "../tools/updateTask.js";

// ---------------------------------------------------------------------------
// Update-Goal handler
// ---------------------------------------------------------------------------

export interface UpdateGoalInput {
  goalId: string;
  description?: string | undefined;
  status?: Goal["status"] | undefined;
  priority?: Goal["priority"] | undefined;
  tenantId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface UpdateGoalResult {
  goalId: string;
  status: string;
  updatedAt: string;
}

/**
 * Core update-goal logic shared by LangChain tool and MCP handler.
 *
 * @param parsedMeta - Already-parsed metadata (LangChain tool may coerce string→object).
 *                     When `undefined`, metadata is left unchanged.
 */
export async function handleUpdateGoal(
  deps: GmsToolDeps,
  input: UpdateGoalInput,
  parsedMeta?: Record<string, unknown>,
): Promise<UpdateGoalResult> {
  const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);

  if (input.status !== undefined && !canTransitionTaskStatus(goal.status, input.status)) {
    throw new Error(
      `[${ErrorCodes.INVALID_TRANSITION}] Invalid goal status transition: ${goal.status} -> ${input.status}`,
    );
  }
  if (input.description !== undefined && input.description.trim().length === 0) {
    throw new Error(
      `[${ErrorCodes.INVALID_INPUT}] Goal description cannot be empty or whitespace-only`,
    );
  }

  const meta = parsedMeta ?? input.metadata;
  const updated: Goal = {
    ...goal,
    ...(input.description !== undefined && { description: input.description }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.tenantId !== undefined && { tenantId: input.tenantId }),
    ...(meta !== undefined && {
      metadata: { ...(goal.metadata ?? {}), ...meta },
    }),
    updatedAt: new Date().toISOString(),
  };
  await deps.goalRepository.upsert(updated, goal._version);
  return { goalId: updated.id, status: updated.status, updatedAt: updated.updatedAt! };
}

// ---------------------------------------------------------------------------
// Update-Task handler
// ---------------------------------------------------------------------------

export interface UpdateTaskInput {
  goalId: string;
  taskId: string;
  status?: Task["status"] | undefined;
  result?: string | undefined;
  error?: string | undefined;
}

export interface UpdateTaskResult {
  goalId: string;
  task: Task | null;
}

export async function handleUpdateTask(
  deps: GmsToolDeps,
  input: UpdateTaskInput,
): Promise<UpdateTaskResult> {
  const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
  const existing = findTaskById(goal.tasks, input.taskId);
  if (!existing) {
    throw new Error(
      `[${ErrorCodes.TASK_NOT_FOUND}] Task not found in goal ${input.goalId}: ${input.taskId}`,
    );
  }
  if (input.status !== undefined && !canTransitionTaskStatus(existing.status, input.status)) {
    throw new Error(
      `[${ErrorCodes.INVALID_TRANSITION}] Invalid status transition for ${input.taskId}: ${existing.status} -> ${input.status}`,
    );
  }

  // Snapshot ready-set BEFORE applying the update
  const prevFlat = flattenTasks(goal.tasks);
  const prevReadyIds = new Set(prevFlat.filter((t) => isTaskReady(t, prevFlat)).map((t) => t.id));

  const tasks = updateTaskById(goal.tasks, input.taskId, (t) => ({
    ...t,
    ...(input.status !== undefined && { status: input.status }),
    ...(input.status === "completed" && { completedAt: new Date().toISOString() }),
    ...(input.result !== undefined && { result: input.result }),
    ...(input.error !== undefined && { error: input.error }),
  }));
  const updated: Goal = { ...goal, tasks, updatedAt: new Date().toISOString() };
  await deps.goalRepository.upsert(updated, goal._version);

  // Fire lifecycle hooks only when a status transition occurred
  if (input.status !== undefined) {
    await fireLifecycleHooks(deps, updated, prevReadyIds);
  }

  const task = findTaskById(tasks, input.taskId);
  return { goalId: updated.id, task };
}
