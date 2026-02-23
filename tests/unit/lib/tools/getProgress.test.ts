import { describe, it, expect } from "vitest";
import type { Task } from "../../../../src/domain/contracts.js";
import { createGetProgressTool } from "../../../../src/lib/tools/getProgress.js";
import { makeTask, makeGoal, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseGoal(tasks: Task[]) {
  return makeGoal({ status: "planned", tasks });
}

interface ProgressResult {
  goalId: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  cancelledTasks: number;
  plannedTasks: number;
  completionRate: number;
}

describe("createGetProgressTool", () => {
  it("returns correct counts for mixed task statuses", async () => {
    const tasks = [
      makeTask({ status: "completed" }),
      makeTask({ status: "completed" }),
      makeTask({ status: "failed" }),
      makeTask({ status: "in_progress" }),
      makeTask({ status: "pending" }),
    ];
    const goal = baseGoal(tasks);
    const tool = createGetProgressTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ProgressResult;
    expect(result.totalTasks).toBe(5);
    expect(result.completedTasks).toBe(2);
    expect(result.failedTasks).toBe(1);
    expect(result.inProgressTasks).toBe(1);
    expect(result.pendingTasks).toBe(1);
    expect(result.completionRate).toBe(0.4);
  });

  it("returns zero completion for empty task list", async () => {
    const goal = baseGoal([]);
    const tool = createGetProgressTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ProgressResult;
    expect(result.totalTasks).toBe(0);
    expect(result.completionRate).toBe(0);
  });

  it("counts sub-tasks (flattened)", async () => {
    const child = makeTask({ status: "completed" });
    const parent = makeTask({ status: "in_progress", subTasks: [child] });
    const goal = baseGoal([parent]);
    const tool = createGetProgressTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ProgressResult;
    expect(result.totalTasks).toBe(2);
    expect(result.completedTasks).toBe(1);
    expect(result.inProgressTasks).toBe(1);
  });

  it("returns 1.0 completion when all tasks completed", async () => {
    const tasks = [makeTask({ status: "completed" }), makeTask({ status: "completed" })];
    const goal = baseGoal(tasks);
    const tool = createGetProgressTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ProgressResult;
    expect(result.completionRate).toBe(1);
  });

  // --- taskTypeCounts tests ---

  it("includes taskTypeCounts in response", async () => {
    const tasks = [
      makeTask({ type: "research" }),
      makeTask({ type: "action" }),
      makeTask({ type: "action" }),
      makeTask({ type: "validation" }),
    ];
    const goal = baseGoal(tasks);
    const tool = createGetProgressTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ProgressResult & { taskTypeCounts: Record<string, number> };
    expect(result.taskTypeCounts).toEqual({ research: 1, action: 2, validation: 1, decision: 0 });
  });

  it("defaults tasks without type to action in taskTypeCounts", async () => {
    const tasks = [makeTask(), makeTask()]; // no type set
    const goal = baseGoal(tasks);
    const tool = createGetProgressTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ProgressResult & { taskTypeCounts: Record<string, number> };
    expect(result.taskTypeCounts.action).toBe(2);
    expect(result.taskTypeCounts.research).toBe(0);
  });
});
