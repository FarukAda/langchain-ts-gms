import { describe, it, expect } from "vitest";
import type { Goal, Task } from "../../../../src/domain/contracts.js";
import { createGetTaskTool } from "../../../../src/lib/tools/getTask.js";
import { makeTask, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440001";
const CHILD_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("createGetTaskTool", () => {
  it("retrieves a task by goalId and taskId", async () => {
    const task = makeTask({ id: TASK_ID });
    const goal: Goal = {
      id: GOAL_ID,
      description: "Goal",
      status: "pending",
      priority: "medium",
      tasks: [task],
      metadata: {},
    };
    const tool = createGetTaskTool(createToolDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({ goalId: GOAL_ID, taskId: TASK_ID }));
    const result = JSON.parse(raw) as { task: Task; parentId: string | null };
    expect(result.task.id).toBe(TASK_ID);
    expect(result.parentId).toBeNull();
  });

  it("throws when taskId does not exist in goal", async () => {
    const goal: Goal = {
      id: GOAL_ID,
      description: "Goal",
      status: "pending",
      priority: "medium",
      tasks: [makeTask({ id: TASK_ID })],
      metadata: {},
    };
    const tool = createGetTaskTool(createToolDeps(GOAL_ID, goal));
    const missingId = "550e8400-e29b-41d4-a716-44665544ffff";
    await expect(tool.invoke({ goalId: GOAL_ID, taskId: missingId })).rejects.toThrow(
      "TASK_NOT_FOUND",
    );
  });

  it("returns parentId for a nested sub-task", async () => {
    const child = makeTask({ id: CHILD_ID, description: "Child", parentId: TASK_ID });
    const parent = makeTask({ id: TASK_ID, subTasks: [child] });
    const goal: Goal = {
      id: GOAL_ID,
      description: "Goal",
      status: "pending",
      priority: "medium",
      tasks: [parent],
      metadata: {},
    };
    const tool = createGetTaskTool(createToolDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({ goalId: GOAL_ID, taskId: CHILD_ID }));
    const result = JSON.parse(raw) as { task: Task; parentId: string };
    expect(result.task.id).toBe(CHILD_ID);
    expect(result.parentId).toBe(TASK_ID);
  });

  it("includes dependency and subTask count context", async () => {
    const dep = makeTask({ id: CHILD_ID, description: "Dep" });
    const task = makeTask({ id: TASK_ID, dependencies: [CHILD_ID], subTasks: [dep] });
    const goal: Goal = {
      id: GOAL_ID,
      description: "Goal",
      status: "pending",
      priority: "medium",
      tasks: [task],
      metadata: {},
    };
    const tool = createGetTaskTool(createToolDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({ goalId: GOAL_ID, taskId: TASK_ID }));
    const result = JSON.parse(raw) as { dependencies: string[]; subTasksCount: number };
    expect(result.dependencies).toEqual([CHILD_ID]);
    expect(result.subTasksCount).toBe(1);
  });
});
