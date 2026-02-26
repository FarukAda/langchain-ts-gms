import type { GmsToolDeps } from "../types.js";
import type { Task } from "../../domain/contracts.js";
import {
  getGoalOrThrow,
  findTaskById,
  findParentTaskId,
  matchesFilters,
  filterTaskTree,
  paginate,
} from "../helpers.js";
import { flattenTasks } from "../../domain/taskUtils.js";
import { ErrorCodes } from "../../infra/observability/tracing.js";

// ---------------------------------------------------------------------------
// List-Tasks handler
// ---------------------------------------------------------------------------

export interface ListTasksInput {
  goalId: string;
  status?: string[] | undefined;
  priority?: string[] | undefined;
  type?: string[] | undefined;
  flat?: boolean | undefined;
  includeSubTasks?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ListTasksResult {
  goalId: string;
  total: number;
  limit: number;
  offset: number;
  items: Task[];
}

export async function handleListTasks(
  deps: GmsToolDeps,
  input: ListTasksInput,
): Promise<ListTasksResult> {
  const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
  const isFlatMode = input.flat ?? true;
  const predicate = (t: Task): boolean =>
    matchesFilters(
      t,
      input.status as Task["status"][] | undefined,
      input.priority as Task["priority"][] | undefined,
      input.type as NonNullable<Task["type"]>[] | undefined,
    );
  let filtered: Task[];
  if (isFlatMode) {
    const base = (input.includeSubTasks ?? true) ? flattenTasks(goal.tasks) : goal.tasks;
    filtered = base.filter(predicate);
  } else {
    filtered = filterTaskTree(goal.tasks, predicate);
  }
  const lim = input.limit ?? 50;
  const off = input.offset ?? 0;
  const page = paginate(filtered, lim, off);
  return { goalId: input.goalId, ...page, limit: lim, offset: off };
}

// ---------------------------------------------------------------------------
// Get-Task handler
// ---------------------------------------------------------------------------

export interface GetTaskInput {
  goalId: string;
  taskId: string;
}

export interface GetTaskResult {
  task: Task;
  parentId: string | null;
  dependencyCount: number;
  subTaskCount: number;
}

export async function handleGetTask(
  deps: GmsToolDeps,
  input: GetTaskInput,
): Promise<GetTaskResult> {
  const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
  const task = findTaskById(goal.tasks, input.taskId);
  if (!task)
    throw new Error(
      `[${ErrorCodes.TASK_NOT_FOUND}] Task not found in goal ${input.goalId}: ${input.taskId}`,
    );
  const parentId = findParentTaskId(goal.tasks, input.taskId);
  return {
    task,
    parentId,
    dependencyCount: task.dependencies.length,
    subTaskCount: task.subTasks.length,
  };
}
