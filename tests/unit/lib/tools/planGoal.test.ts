import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Goal, Task } from "../../../../src/domain/contracts.js";
import {
  mockEmbeddings,
  createMockRepos,
  mockChatModel,
} from "../../../helpers/mockRepository.js";

// Mock the workflow module to avoid compiling the real graph
const mockWorkflowInvoke = vi.fn();
vi.mock("../../../../src/app/graph/workflow.js", () => ({
  createGmsWorkflow: () => ({
    invoke: mockWorkflowInvoke,
  }),
}));

// Mock isGraphInterrupt
vi.mock("@langchain/langgraph", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    isGraphInterrupt: (err: unknown) =>
      err instanceof Error && err.message === "GRAPH_INTERRUPT",
  };
});

const { createGmsPlanTool, createPlan } = await import(
  "../../../../src/lib/tools/planGoal.js"
);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    description: "Test task",
    status: "pending",
    priority: "medium",
    dependencies: [],
    subTasks: [],
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    description: "Test goal",
    status: "planned",
    priority: "medium",
    tasks: [],
    metadata: {},
    ...overrides,
  };
}

describe("planGoal", () => {
  const { goalRepo, capRepo } = createMockRepos([]);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseDeps = {
    goalRepository: goalRepo,
    capabilityRepository: capRepo,
    embeddings: mockEmbeddings(),
    chatModel: mockChatModel(),
    decomposeOptions: { topK: 1, maxDepth: 0 },
  };

  describe("createGmsPlanTool", () => {
    it("returns a tool with default name and description", () => {
      const tool = createGmsPlanTool(baseDeps);
      expect(tool.name).toBe("gms_plan_goal");
      expect(tool.description).toContain("plan");
    });

    it("uses custom toolName and toolDescription", () => {
      const tool = createGmsPlanTool({
        ...baseDeps,
        toolName: "custom_planner",
        toolDescription: "My custom planner",
      });
      expect(tool.name).toBe("custom_planner");
      expect(tool.description).toBe("My custom planner");
    });

    it("returns planned result on successful workflow", async () => {
      const goal = makeGoal();
      const tasks = [makeTask()];
      mockWorkflowInvoke.mockResolvedValue({
        goal,
        tasks,
        currentPhase: "summarizing",
        humanApprovalPending: false,
      });

      const tool = createGmsPlanTool(baseDeps);
      const raw = await tool.invoke({ goalDescription: "Test goal" });
      const result = JSON.parse(raw) as { goalId: string; status: string; tasks: Task[] };
      expect(result.goalId).toBeDefined();
      expect(result.status).toBe("planned");
      expect(result.tasks).toHaveLength(1);
    });

    it("returns human_approval_required when humanApprovalPending is true", async () => {
      const goal = makeGoal();
      const tasks = Array.from({ length: 12 }, (_, i) =>
        makeTask({ id: `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, "0")}` }),
      );
      mockWorkflowInvoke.mockResolvedValue({
        goal,
        tasks,
        currentPhase: "summarizing",
        humanApprovalPending: true,
      });

      const tool = createGmsPlanTool(baseDeps);
      const raw = await tool.invoke({ goalDescription: "Big plan" });
      const result = JSON.parse(raw) as { status: string };
      expect(result.status).toBe("human_approval_required");
    });

    it("returns failed status when workflow throws generic error", async () => {
      mockWorkflowInvoke.mockRejectedValue(new Error("Workflow failed"));

      const tool = createGmsPlanTool(baseDeps);
      const raw = await tool.invoke({ goalDescription: "Failing goal" });
      const result = JSON.parse(raw) as { status: string; error: string };
      expect(result.status).toBe("failed");
      expect(result.error).toBe("Workflow failed");
    });

    it("returns human_approval_required on graph interrupt", async () => {
      mockWorkflowInvoke.mockRejectedValue(
        Object.assign(new Error("GRAPH_INTERRUPT"), {
          interrupts: [{ type: "human_review", data: {} }],
        }),
      );

      const tool = createGmsPlanTool(baseDeps);
      const raw = await tool.invoke({ goalDescription: "Interrupted goal" });
      const result = JSON.parse(raw) as { status: string; interrupt: unknown };
      expect(result.status).toBe("human_approval_required");
    });

    it("includes traceId in result when provided", async () => {
      mockWorkflowInvoke.mockResolvedValue({
        goal: makeGoal(),
        tasks: [makeTask()],
        currentPhase: "summarizing",
        humanApprovalPending: false,
      });

      const tool = createGmsPlanTool(baseDeps);
      const raw = await tool.invoke({
        goalDescription: "Traced goal",
        traceId: "trace-abc",
      });
      const result = JSON.parse(raw) as { traceId: string };
      expect(result.traceId).toBe("trace-abc");
    });

    it("includes traceId in human_approval_required result", async () => {
      mockWorkflowInvoke.mockResolvedValue({
        goal: makeGoal(),
        tasks: [makeTask()],
        currentPhase: "summarizing",
        humanApprovalPending: true,
      });

      const tool = createGmsPlanTool(baseDeps);
      const raw = await tool.invoke({
        goalDescription: "HITL with trace",
        traceId: "trace-hitl",
      });
      const result = JSON.parse(raw) as { status: string; traceId: string };
      expect(result.status).toBe("human_approval_required");
      expect(result.traceId).toBe("trace-hitl");
    });

    it("includes traceId in graph interrupt result", async () => {
      mockWorkflowInvoke.mockRejectedValue(
        Object.assign(new Error("GRAPH_INTERRUPT"), {
          interrupts: [{ type: "human_review", data: {} }],
        }),
      );

      const tool = createGmsPlanTool(baseDeps);
      const raw = await tool.invoke({
        goalDescription: "Interrupted with trace",
        traceId: "trace-int",
      });
      const result = JSON.parse(raw) as { status: string; traceId: string };
      expect(result.status).toBe("human_approval_required");
      expect(result.traceId).toBe("trace-int");
    });

    it("includes traceId in failed result", async () => {
      mockWorkflowInvoke.mockRejectedValue(new Error("Boom"));

      const tool = createGmsPlanTool(baseDeps);
      const raw = await tool.invoke({
        goalDescription: "Failing with trace",
        traceId: "trace-fail",
      });
      const result = JSON.parse(raw) as { status: string; traceId: string; error: string };
      expect(result.status).toBe("failed");
      expect(result.traceId).toBe("trace-fail");
      expect(result.error).toBe("Boom");
    });
  });

  describe("createPlan", () => {
    it("returns GmsPlanResult directly (non-stringified)", async () => {
      mockWorkflowInvoke.mockResolvedValue({
        goal: makeGoal(),
        tasks: [makeTask()],
        currentPhase: "summarizing",
        humanApprovalPending: false,
      });

      const result = await createPlan(
        { goalDescription: "Direct plan" },
        baseDeps,
      );
      expect(result.goalId).toBeDefined();
      expect(result.status).toBe("planned");
    });

    it("handles errors gracefully", async () => {
      mockWorkflowInvoke.mockRejectedValue(new Error("Direct error"));

      const result = await createPlan(
        { goalDescription: "Failing direct plan" },
        baseDeps,
      );
      expect(result.status).toBe("failed");
      expect(result.error).toBe("Direct error");
    });

    it("handles non-Error throws", async () => {
      mockWorkflowInvoke.mockRejectedValue("string-error");

      const result = await createPlan(
        { goalDescription: "String throw" },
        baseDeps,
      );
      expect(result.status).toBe("failed");
      expect(result.error).toBe("string-error");
    });
  });
});
