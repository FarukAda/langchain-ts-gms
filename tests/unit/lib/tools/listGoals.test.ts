import { describe, it, expect } from "vitest";
import type { vi } from "vitest";
import type { Goal } from "../../../../src/domain/contracts.js";
import { createListGoalsTool } from "../../../../src/lib/tools/listGoals.js";
import { mockEmbeddings, createMockRepos, mockChatModel } from "../../../helpers/mockRepository.js";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    description: "Test goal",
    status: "pending",
    priority: "medium",
    tasks: [],
    metadata: {},
    ...overrides,
  };
}

describe("createListGoalsTool", () => {
  it("returns goals from listWithTotal", async () => {
    const goal1 = makeGoal({ id: "550e8400-e29b-41d4-a716-446655440001" });
    const goal2 = makeGoal({ id: "550e8400-e29b-41d4-a716-446655440002" });
    const { goalRepo, capRepo } = createMockRepos([]);
    (goalRepo.listWithTotal as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [goal1, goal2],
      total: 2,
      limit: 50,
      offset: 0,
    });
    const tool = createListGoalsTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = (await tool.invoke({}));
    const result = JSON.parse(raw) as { items: unknown[]; total: number };
    expect(result.total).toBe(2);
    expect(result.items.length).toBe(2);
  });

  it("returns empty list when no goals exist", async () => {
    const { goalRepo, capRepo } = createMockRepos([]);
    (goalRepo.listWithTotal as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    const tool = createListGoalsTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = (await tool.invoke({}));
    const result = JSON.parse(raw) as { items: unknown[]; total: number };
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("passes status filter to repository", async () => {
    const goal = makeGoal({ status: "completed" });
    const { goalRepo, capRepo } = createMockRepos([]);
    (goalRepo.listWithTotal as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [goal],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const tool = createListGoalsTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = (await tool.invoke({ status: "completed" }));
    const result = JSON.parse(raw) as { items: Array<{ status: string }>; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0]!.status).toBe("completed");
  });

  it("uses search when query is provided", async () => {
    const goal = makeGoal({ id: "550e8400-e29b-41d4-a716-446655440001" });
    const { goalRepo, capRepo } = createMockRepos([]);
    (goalRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { goal, score: 0.9 },
    ]);
    const tool = createListGoalsTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = (await tool.invoke({ query: "test" }));
    const result = JSON.parse(raw) as { items: Array<{ id: string }>; total: number };
    expect(result.total).toBe(1);
    const searchFn = (goalRepo as unknown as { search: ReturnType<typeof vi.fn> }).search;
    expect(searchFn).toHaveBeenCalled();
  });

  it("respects limit and offset", async () => {
    const goals = Array.from({ length: 5 }, (_, i) =>
      makeGoal({ id: `550e8400-e29b-41d4-a716-44665544000${i}` }),
    );
    const { goalRepo, capRepo } = createMockRepos([]);
    (goalRepo.listWithTotal as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: goals.slice(2, 4),
      total: 5,
      limit: 2,
      offset: 2,
    });
    const tool = createListGoalsTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = (await tool.invoke({ limit: 2, offset: 2 }));
    const result = JSON.parse(raw) as { items: unknown[]; total: number; limit: number; offset: number };
    expect(result.items.length).toBe(2);
    expect(result.limit).toBe(2);
    expect(result.offset).toBe(2);
  });

  it("filters by priority", async () => {
    const goal = makeGoal({ priority: "high" });
    const { goalRepo, capRepo } = createMockRepos([]);
    (goalRepo.listWithTotal as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [goal],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const tool = createListGoalsTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = await tool.invoke({ priority: "high" });
    const result = JSON.parse(raw) as { items: Array<{ priority: string }>; total: number };
    expect(result.items[0]!.priority).toBe("high");
  });

  it("filters by tenantId", async () => {
    const goal = makeGoal({ tenantId: "t-99" });
    const { goalRepo, capRepo } = createMockRepos([]);
    (goalRepo.listWithTotal as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [goal],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const tool = createListGoalsTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = await tool.invoke({ tenantId: "t-99" });
    const result = JSON.parse(raw) as { total: number };
    expect(result.total).toBe(1);
  });

  it("passes combined filter when query and filter are present", async () => {
    const goal = makeGoal({ id: "550e8400-e29b-41d4-a716-446655440003", status: "completed" });
    const { goalRepo, capRepo } = createMockRepos([]);
    (goalRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue([{ goal, score: 0.8 }]);
    const tool = createListGoalsTool({
      goalRepository: goalRepo,
      capabilityRepository: capRepo,
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      decomposeOptions: { topK: 1, maxDepth: 0 },
    });
    const raw = await tool.invoke({ query: "test", status: "completed" });
    const result = JSON.parse(raw) as { total: number };
    expect(result.total).toBe(1);
    const searchFn = (goalRepo as unknown as { search: ReturnType<typeof vi.fn> }).search;
    expect(searchFn).toHaveBeenCalled();
  });
});
