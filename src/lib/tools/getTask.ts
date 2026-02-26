import { tool } from "@langchain/core/tools";
import { GetTaskInputSchema } from "../schemas/lifecycleSchemas.js";
import { getGoalOrThrow, findTaskById, findParentTaskId, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import { ErrorCodes } from "../../infra/observability/tracing.js";

/** Creates the `gms_get_task` tool for retrieving a single task with parent and dependency context. */
export const createGetTaskTool = (deps: GmsToolDeps) =>
  tool(
    async (input) => {
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      const task = findTaskById(goal.tasks, input.taskId);
      if (!task)
        throw new Error(
          `[${ErrorCodes.TASK_NOT_FOUND}] Task not found in goal ${input.goalId}: ${input.taskId}`,
        );
      return wrapToolResponse({
        goalId: goal.id,
        task,
        parentId: findParentTaskId(goal.tasks, input.taskId),
        dependencies: task.dependencies,
        subTasksCount: task.subTasks.length,
      });
    },
    {
      name: "gms_get_task",
      description:
        "Retrieve a single task with its parent, dependencies, and subtask count. " +
        "Requires both goalId and taskId. " +
        "Returns: { goalId, task, parentId, dependencies[], subTasksCount }. " +
        "Use this to inspect a specific task before updating it. " +
        "Use gms_list_tasks or gms_search_tasks for browsing multiple tasks.",
      schema: GetTaskInputSchema,
    },
  );
