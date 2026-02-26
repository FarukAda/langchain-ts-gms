import { describe, it, expect } from "vitest";
import type { Task } from "../../../../src/domain/contracts.js";
import { createExpandTaskTool } from "../../../../src/lib/tools/expandTask.js";
import { makeTask, makeGoal, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";

function baseGoal(tasks: Task[]) {
  return makeGoal({ tasks });
}

interface ExpandResult {
  status: string;
  parentTaskId: string;
  addedCount: number;
  totalTaskCount: number;
  executionOrder: string[];
  error?: string;
}

describe("createExpandTaskTool", () => {
  it("expands a parent task with sub-tasks", async () => {
    const parent = makeTask({ id: PARENT_ID, description: "Parent task" });
    const goal = baseGoal([parent]);
    const tool = createExpandTaskTool(createToolDeps(GOAL_ID, goal));
    const raw: string = await tool.invoke({
      goalId: GOAL_ID,
      parentTaskId: PARENT_ID,
      subTasks: [
        { description: "Sub-task A" },
        { description: "Sub-task B" },
      ],
    });
    const result = JSON.parse(raw) as ExpandResult;
    expect(result.status).toBe("expanded");
    expect(result.parentTaskId).toBe(PARENT_ID);
    expect(result.addedCount).toBe(2);
    expect(result.totalTaskCount).toBe(3); // parent + 2 sub-tasks
  });

  it("throws when parent task not found", async () => {
    const goal = baseGoal([makeTask()]);
    const tool = createExpandTaskTool(createToolDeps(GOAL_ID, goal));
    await expect(
      tool.invoke({
        goalId: GOAL_ID,
        parentTaskId: "550e8400-e29b-41d4-a716-44665544ffff",
        subTasks: [{ description: "orphan" }],
      }),
    ).rejects.toThrow("Task not found");
  });

  it("creates sequential dependency chain among sub-tasks", async () => {
    const parent = makeTask({ id: PARENT_ID });
    const goal = baseGoal([parent]);
    const tool = createExpandTaskTool(createToolDeps(GOAL_ID, goal));
    await tool.invoke({
      goalId: GOAL_ID,
      parentTaskId: PARENT_ID,
      subTasks: [
        { description: "First" },
        { description: "Second" },
        { description: "Third" },
      ],
    });
    // After expansion, parent should have 3 sub-tasks with sequential deps
    const expanded = goal.tasks[0]!.subTasks;
    expect(expanded).toHaveLength(3);
    // First sub-task has no dependencies
    expect(expanded[0]!.dependencies).toEqual([]);
    // Second depends on first
    expect(expanded[1]!.dependencies).toEqual([expanded[0]!.id]);
    // Third depends on second
    expect(expanded[2]!.dependencies).toEqual([expanded[1]!.id]);
  });

  it("inherits parent priority when sub-task priority not specified", async () => {
    const parent = makeTask({ id: PARENT_ID, priority: "critical" });
    const goal = baseGoal([parent]);
    const tool = createExpandTaskTool(createToolDeps(GOAL_ID, goal));
    await tool.invoke({
      goalId: GOAL_ID,
      parentTaskId: PARENT_ID,
      subTasks: [{ description: "Inherits priority" }],
    });
    const child = goal.tasks[0]!.subTasks[0]!;
    expect(child.priority).toBe("critical");
  });

  it("uses explicit priority when provided", async () => {
    const parent = makeTask({ id: PARENT_ID, priority: "critical" });
    const goal = baseGoal([parent]);
    const tool = createExpandTaskTool(createToolDeps(GOAL_ID, goal));
    await tool.invoke({
      goalId: GOAL_ID,
      parentTaskId: PARENT_ID,
      subTasks: [{ description: "Low priority", priority: "low" }],
    });
    const child = goal.tasks[0]!.subTasks[0]!;
    expect(child.priority).toBe("low");
  });

  it("returns executionOrder as string[] IDs (not Task objects)", async () => {
    const parent = makeTask({ id: PARENT_ID });
    const goal = baseGoal([parent]);
    const tool = createExpandTaskTool(createToolDeps(GOAL_ID, goal));
    const raw: string = await tool.invoke({
      goalId: GOAL_ID,
      parentTaskId: PARENT_ID,
      subTasks: [{ description: "Check type" }],
    });
    const result = JSON.parse(raw) as ExpandResult;
    expect(Array.isArray(result.executionOrder)).toBe(true);
    for (const item of result.executionOrder) {
      expect(typeof item).toBe("string");
    }
  });
});
