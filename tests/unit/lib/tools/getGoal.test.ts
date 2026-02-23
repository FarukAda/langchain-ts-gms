import { describe, it, expect } from "vitest";
import type { Goal } from "../../../../src/domain/contracts.js";
import { createGetGoalTool } from "../../../../src/lib/tools/getGoal.js";
import { makeTask, makeGoal, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseGoal(overrides: Partial<Goal> = {}) {
  return makeGoal(overrides);
}

describe("createGetGoalTool", () => {
  it("retrieves a goal by goalId", async () => {
    const goal = baseGoal({ tasks: [makeTask()] });
    const tool = createGetGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as { goal: Goal };
    expect(result.goal.id).toBe(GOAL_ID);
    expect(result.goal.description).toBe("Test goal");
  });

  it("returns goal with its tasks", async () => {
    const goal = baseGoal({ tasks: [makeTask(), makeTask({ id: "550e8400-e29b-41d4-a716-446655440002", description: "Second task" })] });
    const tool = createGetGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as { goal: Goal };
    expect(result.goal.tasks).toHaveLength(2);
  });

  it("returns goal with empty task list", async () => {
    const goal = baseGoal();
    const tool = createGetGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as { goal: Goal };
    expect(result.goal.tasks).toHaveLength(0);
  });
});
