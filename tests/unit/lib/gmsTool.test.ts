import { describe, it, expect } from "vitest";
import { createGmsLifecycleTools } from "../../../src/lib/gmsTool.js";
import { createGmsPlanTool } from "../../../src/lib/tools/planGoal.js";
import { mockEmbeddings, createMockRepos, mockChatModel } from "../../helpers/mockRepository.js";

/**
 * Integration-level tests for the composite tool factories.
 *
 * Individual tool behavior (get/update/list/search/replan/validate/progress)
 * is exhaustively tested in tests/unit/lib/tools/*.test.ts.
 * This file only covers:
 *   1. JSON output shape from createGmsPlanTool (StructuredTool wrapping)
 *   2. Alias input key resolution (LLM quirk handling)
 *   3. createGmsLifecycleTools tool name composition
 */
describe("gmsTool", () => {
  it("returns JSON output from the StructuredTool", async () => {
    const { goalRepo, capRepo } = createMockRepos([
      { id: "550e8400-e29b-41d4-a716-446655440003", description: "Only task", priority: "medium" },
    ]);
    const tool = createGmsPlanTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });

    const raw = await tool.invoke({ goalDescription: "Tool goal" });
    const parsed = JSON.parse(raw) as { status: string; tasks: unknown[] };

    expect(parsed.status).toBe("planned");
    expect(Array.isArray(parsed.tasks)).toBe(true);
    expect(parsed.tasks.length).toBeGreaterThan(0);
  });

  it("accepts alias input keys from agent tool-calls", async () => {
    const { goalRepo, capRepo } = createMockRepos([
      { id: "550e8400-e29b-41d4-a716-446655440004", description: "Alias task", priority: "medium" },
    ]);
    const tool = createGmsPlanTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });

    const raw = await tool.invoke({ input: "Plan from alias input key" });
    const parsed = JSON.parse(raw) as { status: string; executionOrder: string[] };

    expect(parsed.status).toBe("planned");
    expect(Array.isArray(parsed.executionOrder)).toBe(true);
    expect(parsed.executionOrder.length).toBeGreaterThan(0);
  });

  it("createGmsLifecycleTools returns all 10 tools in expected order", () => {
    const { goalRepo, capRepo } = createMockRepos([]);
    const tools = createGmsLifecycleTools({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    expect(tools.map((t) => t.name)).toEqual([
      "gms_get_goal",
      "gms_get_task",
      "gms_list_tasks",
      "gms_search_tasks",
      "gms_list_goals",
      "gms_update_goal",
      "gms_update_task",
      "gms_validate_goal_tree",
      "gms_get_progress",
      "gms_replan_goal",
    ]);
  });
});
