import { describe, it, expect } from "vitest";
import type { Goal } from "../../../../src/domain/contracts.js";
import { createUpdateGoalTool } from "../../../../src/lib/tools/updateGoal.js";
import { makeGoal, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseGoal(overrides: Partial<Goal> = {}) {
  return makeGoal(overrides);
}

describe("createUpdateGoalTool", () => {
  it("succeeds with a valid status transition (pending → in_progress)", async () => {
    const goal = baseGoal();
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({ goalId: GOAL_ID, status: "in_progress" }));
    const result = JSON.parse(raw) as { status: string };
    expect(result.status).toBe("in_progress");
  });

  it("updates description", async () => {
    const goal = baseGoal();
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, description: "New description" });
    const result = JSON.parse(raw) as { goalId: string; status: string };
    expect(result.status).toBe("pending");
    expect(goal.description).toBe("New description");
  });

  it("sets tenantId on goal", async () => {
    const goal = baseGoal();
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    await tool.invoke({ goalId: GOAL_ID, tenantId: "t-42" });
    expect(goal.tenantId).toBe("t-42");
  });

  it("throws on invalid status transition (completed → pending)", async () => {
    const goal = baseGoal({ status: "completed" });
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    await expect(tool.invoke({ goalId: GOAL_ID, status: "pending" })).rejects.toThrow(
      "INVALID_TRANSITION",
    );
  });

  it("throws on invalid status transition (cancelled → in_progress)", async () => {
    const goal = baseGoal({ status: "cancelled" });
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    await expect(tool.invoke({ goalId: GOAL_ID, status: "in_progress" })).rejects.toThrow(
      "INVALID_TRANSITION",
    );
  });

  it("throws when description is empty string (caught by schema)", async () => {
    const goal = baseGoal();
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    await expect(tool.invoke({ goalId: GOAL_ID, description: "" })).rejects.toThrow();
  });

  it("throws when description is whitespace-only", async () => {
    const goal = baseGoal();
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    await expect(tool.invoke({ goalId: GOAL_ID, description: "   " })).rejects.toThrow(
      "INVALID_INPUT",
    );
  });

  it("updates priority without changing status", async () => {
    const goal = baseGoal();
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({ goalId: GOAL_ID, priority: "critical" }));
    const result = JSON.parse(raw) as { status: string };
    expect(result.status).toBe("pending");
    expect(goal.priority).toBe("critical");
  });

  it("merges metadata with existing values", async () => {
    const goal = baseGoal({ metadata: { existing: "value" } });
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    await tool.invoke({ goalId: GOAL_ID, metadata: { newKey: "newValue" } });
    expect(goal.metadata).toEqual({ existing: "value", newKey: "newValue" });
  });

  it("merges metadata when goal has no prior metadata", async () => {
    const goal = baseGoal({ metadata: undefined as unknown as Record<string, unknown> });
    const tool = createUpdateGoalTool(createToolDeps(GOAL_ID, goal));
    await tool.invoke({ goalId: GOAL_ID, metadata: { fresh: "data" } });
    expect(goal.metadata).toEqual({ fresh: "data" });
  });
});
