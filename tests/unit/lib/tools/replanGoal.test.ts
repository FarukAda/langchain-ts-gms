import { describe, it, expect } from "vitest";
import type { Task } from "../../../../src/domain/contracts.js";
import { createReplanGoalTool } from "../../../../src/lib/tools/replanGoal.js";
import {
  makeTask,
  makeGoal,
  createToolDeps,
  createStaticGoalRepo,
  createMockRepos,
  mockEmbeddings,
  mockChatModel,
} from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseGoal(tasks: Task[]) {
  return makeGoal({ status: "planned", tasks });
}

interface ReplanResult {
  goalId: string;
  status: string;
  replanStrategy: string;
  replacedTaskIds: string[];
  newTaskIds: string[];
  totalTasks: number;
  tasks: Array<{ id: string; description: string; status: string }>;
}

describe("createReplanGoalTool", () => {
  it("appends new tasks by default", async () => {
    const existing = [makeTask()];
    const goal = baseGoal(existing);
    const tool = createReplanGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ReplanResult;
    expect(result.replanStrategy).toBe("append");
    expect(result.replacedTaskIds).toHaveLength(0);
    // Should have original + new tasks
    expect(result.totalTasks).toBeGreaterThan(existing.length);
  });

  it("accepts custom decomposeOptions from input", async () => {
    const existing = [makeTask({ status: "pending" })];
    const goal = baseGoal(existing);
    const tool = createReplanGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({
      goalId: GOAL_ID,
      strategy: "append",
      decomposeOptions: { topK: 3, maxDepth: 1 },
    });
    const result = JSON.parse(raw) as { replanStrategy: string };
    expect(result.replanStrategy).toBe("append");
  });

  it("replaces all tasks with replace_all strategy", async () => {
    const existingId1 = crypto.randomUUID();
    const existingId2 = crypto.randomUUID();
    const existing = [
      makeTask({ id: existingId1 }),
      makeTask({ id: existingId2 }),
    ];
    const goal = baseGoal(existing);
    const tool = createReplanGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, strategy: "replace_all" });
    const result = JSON.parse(raw) as ReplanResult;
    expect(result.replanStrategy).toBe("replace_all");
    expect(result.replacedTaskIds).toContain(existingId1);
    expect(result.replacedTaskIds).toContain(existingId2);
  });

  it("replaces only failed tasks with replace_failed strategy", async () => {
    const failedId = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    const existing = [
      makeTask({ id: failedId, status: "failed" }),
      makeTask({ id: pendingId, status: "pending" }),
    ];
    const goal = baseGoal(existing);
    const tool = createReplanGoalTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, strategy: "replace_failed" });
    const result = JSON.parse(raw) as ReplanResult;
    expect(result.replanStrategy).toBe("replace_failed");
    expect(result.replacedTaskIds).toContain(failedId);
    expect(result.replacedTaskIds).not.toContain(pendingId);
  });

  it("falls back to goalRepository when capabilityRepository not provided", async () => {
    const goal = baseGoal([makeTask()]);
    const tool = createReplanGoalTool({
      goalRepository: createStaticGoalRepo(GOAL_ID, goal),
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = await tool.invoke({ goalId: GOAL_ID, strategy: "append" });
    const result = JSON.parse(raw) as ReplanResult;
    expect(result.goalId).toBe(GOAL_ID);
    expect(result.replanStrategy).toBe("append");
  });

  it("throws when embeddings not provided", async () => {
    const goal = baseGoal([makeTask()]);
    const tool = createReplanGoalTool({
      goalRepository: createStaticGoalRepo(GOAL_ID, goal),
      capabilityRepository: createMockRepos([]).capRepo,
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    await expect(
      tool.invoke({ goalId: GOAL_ID }),
    ).rejects.toThrow("MISSING_DEPENDENCY");
  });
});
