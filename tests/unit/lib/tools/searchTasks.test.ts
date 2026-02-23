import { describe, it, expect, vi } from "vitest";
import type { Task } from "../../../../src/domain/contracts.js";
import { createSearchTasksTool } from "../../../../src/lib/tools/searchTasks.js";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { makeTask, makeGoal, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";

function goalWith(tasks: Task[]) {
  return makeGoal({ tasks });
}

/** Create deps without embeddings — triggers substring fallback path. */
function createSubstringDeps(goalId: string, goal: ReturnType<typeof makeGoal>) {
  const { embeddings: _, ...rest } = createToolDeps(goalId, goal);
  return rest;
}

describe("createSearchTasksTool", () => {
  // ── Substring fallback tests (no embeddings) ──────────────────────

  it("finds tasks matching query text via substring fallback (case-insensitive)", async () => {
    const goal = goalWith([
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440001", description: "Deploy to production" }),
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440002", description: "Write tests" }),
    ]);
    const tool = createSearchTasksTool(createSubstringDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({ goalId: GOAL_ID, query: "deploy" }));
    const result = JSON.parse(raw) as { items: Task[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0]!.description).toBe("Deploy to production");
  });

  it("filters by status", async () => {
    const goal = goalWith([
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440001", status: "completed" }),
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440002", status: "pending" }),
    ]);
    const tool = createSearchTasksTool(createSubstringDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({
      goalId: GOAL_ID,
      status: ["completed"],
    }));
    const result = JSON.parse(raw) as { items: Task[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0]!.status).toBe("completed");
  });

  it("filters by hasDependencies", async () => {
    const goal = goalWith([
      makeTask({
        id: "550e8400-e29b-41d4-a716-446655440001",
        dependencies: ["550e8400-e29b-41d4-a716-446655440010"],
      }),
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440002", dependencies: [] }),
    ]);
    const tool = createSearchTasksTool(createSubstringDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({
      goalId: GOAL_ID,
      hasDependencies: true,
    }));
    const result = JSON.parse(raw) as { items: Task[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0]!.dependencies.length).toBeGreaterThan(0);
  });

  it("returns empty results when no tasks match", async () => {
    const goal = goalWith([makeTask({ description: "Setup database" })]);
    const tool = createSearchTasksTool(createSubstringDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({ goalId: GOAL_ID, query: "xyz-no-match" }));
    const result = JSON.parse(raw) as { items: Task[]; total: number };
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("includes sub-tasks in flattened search", async () => {
    const child = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440003",
      description: "Deploy step child",
    });
    const parent = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440001",
      description: "Parent task",
      subTasks: [child],
    });
    const goal = goalWith([parent]);
    const tool = createSearchTasksTool(createSubstringDeps(GOAL_ID, goal));
    const raw = (await tool.invoke({ goalId: GOAL_ID, query: "deploy" }));
    const result = JSON.parse(raw) as { items: Task[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0]!.description).toBe("Deploy step child");
  });

  it("returns all matching tasks when no query is provided", async () => {
    const tasks = [
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440001", status: "completed", description: "A" }),
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440002", status: "pending", description: "B" }),
    ];
    const goal = goalWith(tasks);
    const tool = createSearchTasksTool(createSubstringDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, status: ["completed"] });
    const result = JSON.parse(raw) as { items: Task[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0]!.status).toBe("completed");
  });

  // --- Type filter test ---

  it("filters search results by type", async () => {
    const tasks = [
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440001", description: "Investigate API", type: "research" }),
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440002", description: "Deploy API", type: "action" }),
    ];
    const goal = goalWith(tasks);
    const tool = createSearchTasksTool(createSubstringDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, query: "API", type: ["research"] });
    const result = JSON.parse(raw) as { items: Task[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0]!.description).toBe("Investigate API");
  });

  // ── Semantic search tests (with embeddings) ─────────────────────

  it("uses embedding-based semantic search when embeddings are provided", async () => {
    const tasks = [
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440001", description: "Delete the database backups" }),
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440002", description: "Clean up old logs" }),
    ];
    const goal = goalWith(tasks);

    // Mock embeddings that make "clean" semantically close to "Clean up old logs"
    // but not "Delete the database backups"
    const queryVec = [1.0, 0.0, 0.0];
    const taskVecs = [
      [0.1, 0.9, 0.0],  // Low similarity to query (delete backups)
      [0.95, 0.05, 0.0], // High similarity to query (clean up logs)
    ];

    const mockEmbed: EmbeddingsInterface = {
      embedQuery: vi.fn().mockResolvedValue(queryVec),
      embedDocuments: vi.fn().mockResolvedValue(taskVecs),
    };

    const deps = { ...createToolDeps(GOAL_ID, goal), embeddings: mockEmbed };
    const tool = createSearchTasksTool(deps);
    const raw = await tool.invoke({ goalId: GOAL_ID, query: "tidy up" });
    const result = JSON.parse(raw) as { items: Task[]; total: number };

    // Both tasks should match (similarity > 0.3), but "clean up" should be first
    expect(result.total).toBe(1);
    expect(result.items[0]!.description).toBe("Clean up old logs");
  });

  it("filters out low-similarity tasks below threshold", async () => {
    const tasks = [
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440001", description: "Unrelated task" }),
    ];
    const goal = goalWith(tasks);

    // Orthogonal vectors → similarity ≈ 0
    const mockEmbed: EmbeddingsInterface = {
      embedQuery: vi.fn().mockResolvedValue([1.0, 0.0]),
      embedDocuments: vi.fn().mockResolvedValue([[0.0, 1.0]]),
    };

    const deps = { ...createToolDeps(GOAL_ID, goal), embeddings: mockEmbed };
    const tool = createSearchTasksTool(deps);
    const raw = await tool.invoke({ goalId: GOAL_ID, query: "something different" });
    const result = JSON.parse(raw) as { items: Task[]; total: number };

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});
