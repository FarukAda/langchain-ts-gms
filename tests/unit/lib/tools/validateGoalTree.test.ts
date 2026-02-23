import { describe, it, expect } from "vitest";
import type { Task } from "../../../../src/domain/contracts.js";
import { createValidateGoalTreeTool } from "../../../../src/lib/tools/validateGoalTree.js";
import { makeTask, makeGoal, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_A = "550e8400-e29b-41d4-a716-446655440001";
const TASK_B = "550e8400-e29b-41d4-a716-446655440002";

function baseGoal(tasks: Task[]) {
  return makeGoal({ status: "planned", tasks });
}

interface ValidationResult {
  goalId: string;
  valid: boolean;
  issues: string[];
  taskCount: number;
}

describe("createValidateGoalTreeTool", () => {
  it("returns valid for a well-formed task tree", async () => {
    const tasks = [
      makeTask({ id: TASK_A }),
      makeTask({ id: TASK_B, description: "Task B", dependencies: [TASK_A] }),
    ];
    const goal = baseGoal(tasks);
    const tool = createValidateGoalTreeTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ValidationResult;
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.taskCount).toBe(2);
  });

  it("detects dangling dependency", async () => {
    const dangling = "550e8400-e29b-41d4-a716-44665544dead";
    const tasks = [makeTask({ dependencies: [dangling] })];
    const goal = baseGoal(tasks);
    const tool = createValidateGoalTreeTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ValidationResult;
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("detects self-dependency", async () => {
    const tasks = [makeTask({ id: TASK_A, dependencies: [TASK_A] })];
    const goal = baseGoal(tasks);
    const tool = createValidateGoalTreeTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ValidationResult;
    expect(result.valid).toBe(false);
  });

  it("returns valid for empty task list", async () => {
    const goal = baseGoal([]);
    const tool = createValidateGoalTreeTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ValidationResult;
    expect(result.valid).toBe(true);
    expect(result.taskCount).toBe(0);
  });
});
