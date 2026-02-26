import type { GmsToolDeps } from "../types.js";
import type { Goal, Task } from "../../domain/contracts.js";
import { getGoalOrThrow, findTaskById } from "../helpers.js";
import { updateTaskById, flattenTasks, executionOrder } from "../../domain/taskUtils.js";

// ---------------------------------------------------------------------------
// Expand-Task handler
// ---------------------------------------------------------------------------

export interface ExpandSubTaskInput {
  description: string;
  priority?: Task["priority"] | undefined;
  expectedInputs?: string[] | undefined;
  providedOutputs?: string[] | undefined;
}

export interface ExpandTaskInput {
  goalId: string;
  parentTaskId: string;
  subTasks: ExpandSubTaskInput[];
}

export interface ExpandTaskResult {
  status: string;
  parentTaskId: string;
  addedCount: number;
  totalTaskCount: number;
  executionOrder: string[];
}

export async function handleExpandTask(
  deps: GmsToolDeps,
  input: ExpandTaskInput,
): Promise<ExpandTaskResult> {
  const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
  const parent = findTaskById(goal.tasks, input.parentTaskId);
  if (!parent) throw new Error(`Task not found: ${input.parentTaskId}`);

  // Build sub-tasks with sequential dependency chain.
  const newSubTasks: Task[] = [];
  const existingSubs = parent.subTasks;
  const prevIds: string[] =
    existingSubs.length > 0 ? [existingSubs[existingSubs.length - 1]!.id] : [];

  for (const st of input.subTasks) {
    const id = crypto.randomUUID();
    const taskDeps = prevIds.length > 0 ? [prevIds[prevIds.length - 1]!] : [];
    prevIds.length = 0;
    prevIds.push(id);

    newSubTasks.push({
      id,
      description: st.description,
      status: "pending",
      priority: st.priority ?? parent.priority,
      dependencies: taskDeps,
      subTasks: [],
      parentId: input.parentTaskId,
      ...(st.expectedInputs?.length && { expectedInputs: st.expectedInputs }),
      ...(st.providedOutputs?.length && { providedOutputs: st.providedOutputs }),
    });
  }

  const updatedTasks = updateTaskById(goal.tasks, input.parentTaskId, (t) => ({
    ...t,
    subTasks: [...t.subTasks, ...newSubTasks],
  }));
  const updatedGoal: Goal = { ...goal, tasks: updatedTasks, updatedAt: new Date().toISOString() };
  await deps.goalRepository.upsert(updatedGoal, goal._version);

  const flat = flattenTasks(updatedGoal.tasks);
  return {
    status: "expanded",
    parentTaskId: input.parentTaskId,
    addedCount: newSubTasks.length,
    totalTaskCount: flat.length,
    executionOrder: executionOrder(flat).map((t) => t.id),
  };
}
