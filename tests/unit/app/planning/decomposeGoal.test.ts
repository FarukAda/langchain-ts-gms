import { describe, it, expect, vi } from "vitest";
import { decomposeGoal } from "../../../../src/app/planning/decomposeGoal.js";
import type { GoalMemoryRepository } from "../../../../src/infra/vector/goalMemoryRepository.js";
import { flattenTasks } from "../../../../src/domain/taskUtils.js";
import { mockChatModel, mockEmbeddings } from "../../../helpers/mockRepository.js";

function mockRepo(
  searchResults: Array<{
    goal: { id: string; description: string; status: string; priority: string; tasks: unknown[] };
    score: number;
  }>,
): GoalMemoryRepository {
  return {
    searchByVector: vi.fn().mockResolvedValue(searchResults),
  } as unknown as GoalMemoryRepository;
}

describe("decomposeGoal", () => {
  it("decomposes a goal into multiple tasks using the LLM", async () => {
    const repo = mockRepo([]);
    const chat = mockChatModel();
    const result = await decomposeGoal(
      {
        id: "g1",
        description: "Build a web application",
        status: "pending",
        priority: "high",
        tasks: [],
        metadata: {},
      },
      repo,
      mockEmbeddings(),
      chat,
      { topK: 5, maxDepth: 4 },
    );

    // DEFAULT_DECOMPOSITION has 3 top-level tasks, one with 2 subtasks = 5 total
    expect(result.tasks.length).toBe(3);
    const flat = flattenTasks(result.tasks);
    expect(flat.length).toBe(5);
  });

  it("assigns sequential dependencies between sibling tasks", async () => {
    const repo = mockRepo([]);
    const chat = mockChatModel();
    const result = await decomposeGoal(
      {
        id: "g1",
        description: "Build a web application",
        status: "pending",
        priority: "high",
        tasks: [],
        metadata: {},
      },
      repo,
      mockEmbeddings(),
      chat,
      { topK: 5 },
    );

    // First top-level task has no dependencies
    expect(result.tasks[0]!.dependencies).toEqual([]);
    // Second depends on first
    expect(result.tasks[1]!.dependencies).toContain(result.tasks[0]!.id);
    // Third depends on second
    expect(result.tasks[2]!.dependencies).toContain(result.tasks[1]!.id);
  });

  it("assigns parentId to subtasks", async () => {
    const repo = mockRepo([]);
    const chat = mockChatModel();
    const result = await decomposeGoal(
      {
        id: "g1",
        description: "Build something",
        status: "pending",
        priority: "high",
        tasks: [],
        metadata: {},
      },
      repo,
      mockEmbeddings(),
      chat,
      { topK: 5 },
    );

    // DEFAULT_DECOMPOSITION: tasks[1] has 2 subtasks
    const parent = result.tasks[1]!;
    expect(parent.subTasks.length).toBe(2);
    expect(parent.subTasks[0]!.parentId).toBe(parent.id);
    expect(parent.subTasks[1]!.parentId).toBe(parent.id);
  });

  it("calls withStructuredOutput to enforce the schema", async () => {
    const repo = mockRepo([]);
    const chat = mockChatModel();
    await decomposeGoal(
      {
        id: "g1",
        description: "Test structured output",
        status: "pending",
        priority: "medium",
        tasks: [],
        metadata: {},
      },
      repo,
      mockEmbeddings(),
      chat,
      { topK: 5 },
    );

    // Verify the model's structured output was used (access via the mock object, not the method)
    const chatObj = chat as unknown as { withStructuredOutput: ReturnType<typeof vi.fn> };
    expect(chatObj.withStructuredOutput).toHaveBeenCalledTimes(1);
  });

  it("includes capability context in prompt when matches exist", async () => {
    const repo = mockRepo([
      {
        goal: {
          id: "cap-1",
          description: "Database migration",
          status: "pending",
          priority: "medium",
          tasks: [],
        },
        score: 0.92,
      },
    ]);
    const chat = mockChatModel();

    // Extract the invoke mock via safe cast (avoids unbound-method and unsafe-member-access)
    type MockStructured = { invoke: ReturnType<typeof vi.fn> };
    const chatObj = chat as unknown as {
      withStructuredOutput: ReturnType<typeof vi.fn> & (() => MockStructured);
    };
    const invokeMock = (chatObj.withStructuredOutput() as MockStructured).invoke;

    await decomposeGoal(
      {
        id: "g1",
        description: "Upgrade the database",
        status: "pending",
        priority: "high",
        tasks: [],
        metadata: {},
      },
      repo,
      mockEmbeddings(),
      chat,
      { topK: 5 },
    );

    // The prompt passed to invoke should mention the capability
    const promptArg = invokeMock.mock.calls[0]![0] as string;
    expect(promptArg).toContain("Database migration");
    expect(promptArg).toContain("92%");
  });

  it("still returns capabilityMatches alongside LLM tasks", async () => {
    const repo = mockRepo([
      {
        goal: { id: "cap-y", description: "Do Y", status: "pending", priority: "high", tasks: [] },
        score: 0.75,
      },
    ]);
    const chat = mockChatModel();
    const result = await decomposeGoal(
      {
        id: "g1",
        description: "Y-related goal",
        status: "pending",
        priority: "medium",
        tasks: [],
        metadata: {},
      },
      repo,
      mockEmbeddings(),
      chat,
      { topK: 5 },
    );

    expect(result.capabilityMatches).toHaveLength(1);
    expect(result.capabilityMatches[0]!.capability.id).toBe("cap-y");
    expect(result.tasks.length).toBe(3); // From mock chat model
  });

  it("applies tenantId filter when goal has tenantId", async () => {
    const repo = mockRepo([]);
    const embeddings = mockEmbeddings();
    const chat = mockChatModel();
    const result = await decomposeGoal(
      {
        id: "g1",
        description: "Tenant-scoped plan",
        status: "pending",
        priority: "high",
        tasks: [],
        metadata: {},
        tenantId: "t-42",
      },
      repo,
      embeddings,
      chat,
      { topK: 5 },
    );

    // searchByVector should have been called with a filter containing tenantId
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const searchFn = vi.mocked(repo).searchByVector;
    const callArgs = searchFn.mock.calls[0]!;
    expect(callArgs[1]).toEqual(
      expect.objectContaining({
        filter: { tenantId: "t-42" },
      }),
    );
    expect(result.tasks.length).toBe(3);
  });

  it("uses goal priority when decomposed task has no explicit priority", async () => {
    const noPriorityDecomposition = {
      tasks: [
        { description: "No-priority task", priority: undefined as unknown as string, subTasks: [] },
        { description: "Another task", priority: "low" as const, subTasks: [] },
      ],
    };
    const repo = mockRepo([]);
    const chat = mockChatModel(noPriorityDecomposition);
    const result = await decomposeGoal(
      {
        id: "g1",
        description: "Priority test",
        status: "pending",
        priority: "high",
        tasks: [],
        metadata: {},
      },
      repo,
      mockEmbeddings(),
      chat,
      { topK: 5 },
    );

    // First task has no explicit priority → should inherit goal's "high"
    expect(result.tasks[0]!.priority).toBe("high");
    // Second task has explicit "low"
    expect(result.tasks[1]!.priority).toBe("low");
  });

  it("propagates parent task priority to subtasks when subtask has no priority", async () => {
    const decompositionWithSubtasks = {
      tasks: [
        {
          description: "Parent with critical priority",
          priority: "critical" as const,
          subTasks: [
            {
              description: "SubTask inherits parent priority",
              priority: undefined as unknown as string,
              subTasks: [],
            },
            { description: "SubTask with own priority", priority: "low" as const, subTasks: [] },
          ],
        },
      ],
    };
    const repo = mockRepo([]);
    const chat = mockChatModel(decompositionWithSubtasks);
    const result = await decomposeGoal(
      {
        id: "g2",
        description: "Subtask priority test",
        status: "pending",
        priority: "medium",
        tasks: [],
        metadata: {},
      },
      repo,
      mockEmbeddings(),
      chat,
      { topK: 5 },
    );

    const parentTask = result.tasks[0]!;
    expect(parentTask.priority).toBe("critical");
    // First subtask inherits parent "critical" (L132 truthy → defaultPriority = "critical")
    expect(parentTask.subTasks[0]!.priority).toBe("critical");
    // Second subtask keeps own "low"
    expect(parentTask.subTasks[1]!.priority).toBe("low");
  });

  // --- Phased planning & hydration tests ---

  it("generates prompt with phased planning instructions", async () => {
    const repo = mockRepo([]);
    const embeddings = mockEmbeddings();
    const chat = mockChatModel();

    // Extract the invoke mock via safe cast
    type MockStructured = { invoke: ReturnType<typeof vi.fn> };
    const chatObj = chat as unknown as {
      withStructuredOutput: ReturnType<typeof vi.fn> & (() => MockStructured);
    };
    const invokeMock = (chatObj.withStructuredOutput() as MockStructured).invoke;

    await decomposeGoal(
      {
        id: "g-prompt",
        description: "Build an API",
        status: "pending",
        priority: "high",
        tasks: [],
        metadata: {},
      },
      repo,
      embeddings,
      chat,
      { topK: 1 },
    );

    const promptArg = invokeMock.mock.calls[0]![0] as string;
    expect(promptArg).toContain("research");
    expect(promptArg).toContain("action");
    expect(promptArg).toContain("validation");
    expect(promptArg).toContain("decision");
    expect(promptArg).toContain("Planning Phases");
  });

  it("hydrates new metadata fields from decomposition output", async () => {
    const enrichedDecomposition = {
      tasks: [
        {
          description: "Research options",
          priority: "high" as const,
          type: "research" as const,
          acceptanceCriteria: "3+ options found",
          expectedOutput: "Comparison doc",
          riskLevel: "medium" as const,
          estimatedComplexity: "moderate" as const,
          rationale: "Need info first",
          subTasks: [],
        },
        {
          description: "Implement choice",
          priority: "high" as const,
          type: "action" as const,
          riskLevel: "high" as const,
          estimatedComplexity: "complex" as const,
          subTasks: [],
        },
      ],
    };
    const chat = mockChatModel(enrichedDecomposition as never);
    const result = await decomposeGoal(
      {
        id: "g-hydrate",
        description: "Build feature",
        status: "pending",
        priority: "high",
        tasks: [],
        metadata: {},
      },
      mockRepo([]),
      mockEmbeddings(),
      chat,
      { topK: 1 },
    );

    expect(result.tasks[0]!.type).toBe("research");
    expect(result.tasks[0]!.acceptanceCriteria).toBe("3+ options found");
    expect(result.tasks[0]!.rationale).toBe("Need info first");
    expect(result.tasks[1]!.type).toBe("action");
    expect(result.tasks[1]!.riskLevel).toBe("high");
  });

  it("uses promptTemplate override when provided in options", async () => {
    const repo = mockRepo([]);
    const embeddings = mockEmbeddings();
    const chat = mockChatModel();

    type MockStructured2 = { invoke: ReturnType<typeof vi.fn> };
    const chatObj = chat as unknown as {
      withStructuredOutput: ReturnType<typeof vi.fn> & (() => MockStructured2);
    };
    const invokeMock = (chatObj.withStructuredOutput() as MockStructured2).invoke;

    await decomposeGoal(
      {
        id: "g-tmpl",
        description: "Custom goal",
        status: "pending",
        priority: "medium",
        tasks: [],
        metadata: {},
      },
      repo,
      embeddings,
      chat,
      { topK: 1, promptTemplate: () => "CUSTOM_PROMPT: Decompose goal" },
    );

    const promptArg = invokeMock.mock.calls[0]![0] as string;
    expect(promptArg).toBe("CUSTOM_PROMPT: Decompose goal");
  });
});
