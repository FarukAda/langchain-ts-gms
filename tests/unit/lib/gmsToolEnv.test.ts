import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetEnv } from "../../../src/config/env.js";
import type { GoalMemoryRepository } from "../../../src/infra/vector/goalMemoryRepository.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { GmsToolDeps } from "../../../src/lib/types.js";

// Mock all infra modules that env factories depend on
const mockUpsert = vi.fn().mockResolvedValue(undefined);
const mockBootstrap = vi.fn().mockResolvedValue(undefined);

class MockGoalMemoryRepository {
  upsert = mockUpsert;
  bootstrap = mockBootstrap;
  search = vi.fn().mockResolvedValue([]);
  getById = vi.fn().mockResolvedValue(null);
  list = vi.fn().mockResolvedValue([]);
  listWithTotal = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  deleteByIds = vi.fn().mockResolvedValue(undefined);
  searchByVector = vi.fn().mockResolvedValue([]);
  constructor(_opts?: unknown) {}
}

vi.mock("../../../src/infra/vector/goalMemoryRepository.js", () => ({
  GoalMemoryRepository: MockGoalMemoryRepository,
}));

vi.mock("../../../src/infra/embeddings/embeddingProvider.js", () => ({
  createEmbeddingProvider: () => ({
    embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0)),
    embedDocuments: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../../../src/infra/chat/chatModelProvider.js", () => ({
  createChatModelProvider: () => ({
    _type: "mock-chat",
    invoke: vi.fn(),
  }),
}));

vi.mock("../../../src/infra/vector/qdrantClient.js", () => ({
  CAPABILITIES_COLLECTION: "gms_capabilities",
  GOALS_COLLECTION: "gms_goals",
}));

// Mock the workflow module to avoid compiling the real graph
vi.mock("../../../src/app/graph/workflow.js", () => ({
  createGmsWorkflow: () => ({
    invoke: vi.fn().mockResolvedValue({
      goal: { id: "test-goal", status: "planned", description: "test", tasks: [], metadata: {} },
      tasks: [],
      currentPhase: "summarizing",
      humanApprovalPending: false,
    }),
  }),
}));

// Dynamic import after mocks
const {
  createGmsToolFromEnv,
  createGmsLifecycleToolsFromEnv,
  createAllGmsToolsFromEnv,
  createGmsLifecycleTools,
} = await import("../../../src/lib/gmsTool.js");

describe("gmsTool env factories", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
    resetEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnv();
  });

  describe("createGmsToolFromEnv", () => {
    it("creates a plan tool with default bootstrap", async () => {
      const tool = await createGmsToolFromEnv();
      expect(tool).toBeDefined();
      expect(tool.name).toBe("gms_plan_goal");
      expect(mockBootstrap).toHaveBeenCalledTimes(1);
    });

    it("skips bootstrap when bootstrap: false", async () => {
      const tool = await createGmsToolFromEnv({ bootstrap: false });
      expect(tool).toBeDefined();
      expect(mockBootstrap).not.toHaveBeenCalled();
    });

    it("accepts custom toolName and toolDescription", async () => {
      const tool = await createGmsToolFromEnv({
        bootstrap: false,
        toolName: "my_planner",
        toolDescription: "My custom planner",
      });
      expect(tool.name).toBe("my_planner");
      expect(tool.description).toBe("My custom planner");
    });
  });

  describe("createGmsLifecycleToolsFromEnv", () => {
    it("returns 10 lifecycle tools", async () => {
      const tools = await createGmsLifecycleToolsFromEnv({ bootstrap: false });
      expect(tools).toHaveLength(10);
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

  describe("createAllGmsToolsFromEnv", () => {
    it("returns both planning and lifecycle tools", async () => {
      const result = await createAllGmsToolsFromEnv({ bootstrap: false });
      expect(result.planningTool).toBeDefined();
      expect(result.planningTool.name).toBe("gms_plan_goal");
      expect(result.lifecycleTools).toHaveLength(10);
    });

    it("passes decomposeOptions through to tool deps", async () => {
      const result = await createAllGmsToolsFromEnv({
        bootstrap: false,
        decomposeOptions: { topK: 3, maxDepth: 2 },
      });
      expect(result.planningTool).toBeDefined();
    });
  });

  describe("createGmsLifecycleTools (non-env)", () => {
    it("creates tools from provided deps", () => {
      const mockDeps = {
        goalRepository: new MockGoalMemoryRepository() as unknown as GoalMemoryRepository,
        chatModel: { _type: "mock" } as unknown as BaseChatModel,
      };
      const tools = createGmsLifecycleTools(mockDeps as GmsToolDeps);
      expect(tools).toHaveLength(10);
    });
  });
});
