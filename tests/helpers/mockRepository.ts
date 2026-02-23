/**
 * Shared mock factories for GMS tests.
 *
 * Eliminates duplication across gmsTool.test.ts and workflow.test.ts.
 */
import { vi } from "vitest";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { GoalMemoryRepository } from "../../src/infra/vector/goalMemoryRepository.js";
import type { Goal, Task } from "../../src/domain/contracts.js";

/** Default embedding dimension matching the test vector size. */
export const TEST_VEC_DIM = 384;
/** A zero-filled embedding vector for mock returns. */
export const ZERO_VEC: number[] = new Array(TEST_VEC_DIM).fill(0) as number[];

/** Creates a mock EmbeddingsInterface that returns zero vectors. */
export function mockEmbeddings(): EmbeddingsInterface {
  return {
    embedQuery: vi.fn().mockResolvedValue(ZERO_VEC),
    embedDocuments: vi
      .fn()
      .mockImplementation((docs: string[]) => Promise.resolve(docs.map(() => [...ZERO_VEC]))),
  };
}

export interface CapabilityDef {
  id: string;
  description: string;
  priority: string;
}

/**
 * Returns a pair of mock repositories (goal + capability) pre-loaded with
 * the given capabilities as search results.
 *
 * The goal repository uses a simple in-memory Map for upsert/getById/list.
 * The capability repository shares the same base but has its own searchByVector spy.
 *
 * @param capabilities - capability definitions to return from searchByVector
 * @param opts.stored  - optional pre-existing stored Map (otherwise a fresh one is created)
 */
export function createMockRepos(
  capabilities: CapabilityDef[],
  opts?: { stored?: Map<string, Goal> },
) {
  const stored = opts?.stored ?? new Map<string, Goal>();
  const searchResults = capabilities.map((c) => ({
    goal: {
      id: c.id,
      description: c.description,
      status: "pending" as const,
      priority: c.priority as Goal["priority"],
      tasks: [] as Task[],
    },
    score: 0.9,
  }));

  const goalRepo = {
    bootstrap: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockImplementation((g: Goal) => {
      stored.set(g.id, { ...g, updatedAt: new Date().toISOString() });
      return Promise.resolve();
    }),
    search: vi.fn(),
    searchByVector: vi.fn().mockResolvedValue(searchResults),
    getById: vi.fn().mockImplementation((id: string) => Promise.resolve(stored.get(id) ?? null)),
    list: vi.fn().mockImplementation(() => {
      return Promise.resolve(Array.from(stored.values()));
    }),
    listWithTotal: vi.fn().mockImplementation(() => {
      const items = Array.from(stored.values());
      return Promise.resolve({ items, total: items.length, limit: 50, offset: 0 });
    }),
    deleteByIds: vi.fn(),
  } as unknown as GoalMemoryRepository;

  const capRepo = {
    ...goalRepo,
    searchByVector: vi.fn().mockResolvedValue(searchResults),
  } as unknown as GoalMemoryRepository;

  return { goalRepo, capRepo, stored };
}

/**
 * Creates a standalone goal repository mock that stores a single goal by
 * reference (mutations via `upsert` modify the same object).
 *
 * This is the pattern used by the lifecycle tool tests where a pre-built
 * goal is supplied and mutated in place.
 */
export function createStaticGoalRepo(goalId: string, stored: Goal): GoalMemoryRepository {
  return {
    bootstrap: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockImplementation((g: Goal) => {
      Object.assign(stored, g);
      return Promise.resolve();
    }),
    search: vi.fn(),
    searchByVector: vi.fn().mockResolvedValue([]),
    getById: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve(id === goalId ? stored : null)),
    list: vi.fn().mockResolvedValue([stored]),
    listWithTotal: vi.fn().mockResolvedValue({ items: [stored], total: 1, limit: 10, offset: 0 }),
    deleteByIds: vi.fn(),
  } as unknown as GoalMemoryRepository;
}

/**
 * Default decomposition output used by mockChatModel.
 * Produces 3 top-level tasks, one of which has 2 subtasks.
 */
export const DEFAULT_DECOMPOSITION = {
  tasks: [
    {
      description: "Set up project structure and dependencies",
      priority: "high" as const,
      type: "action" as const,
      acceptanceCriteria: "Project builds without errors",
      riskLevel: "low" as const,
      estimatedComplexity: "simple" as const,
      rationale: "Foundation required before implementing features",
      subTasks: [],
    },
    {
      description: "Implement core functionality",
      priority: "high" as const,
      type: "action" as const,
      riskLevel: "medium" as const,
      estimatedComplexity: "complex" as const,
      rationale: "Core business logic is the primary deliverable",
      subTasks: [
        {
          description: "Design data models",
          priority: "high" as const,
          type: "research" as const,
          expectedOutput: "Data model diagram and schema definitions",
          riskLevel: "low" as const,
          estimatedComplexity: "moderate" as const,
          subTasks: [],
        },
        {
          description: "Write business logic",
          priority: "medium" as const,
          type: "action" as const,
          acceptanceCriteria: "All business rules pass unit tests",
          riskLevel: "medium" as const,
          estimatedComplexity: "complex" as const,
          subTasks: [],
        },
      ],
    },
    {
      description: "Add tests and documentation",
      priority: "medium" as const,
      type: "validation" as const,
      acceptanceCriteria: "Test coverage above 80%",
      riskLevel: "low" as const,
      estimatedComplexity: "moderate" as const,
      rationale: "Quality assurance before delivery",
      subTasks: [],
    },
  ],
};

/**
 * Creates a mock BaseChatModel whose `withStructuredOutput().invoke()` returns
 * a pre-defined decomposition result.
 *
 * @param output - custom decomposition output; defaults to DEFAULT_DECOMPOSITION
 */
export function mockChatModel(output?: {
  tasks: Array<{ description: string; priority: string; subTasks: unknown[] }>;
}) {
  const decomposition = output ?? DEFAULT_DECOMPOSITION;
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue(decomposition),
    }),
  } as unknown as BaseChatModel;
}

// ---------------------------------------------------------------------------
// Shared task & goal factories for tool tests
// ---------------------------------------------------------------------------

/**
 * Creates a Task with sensible defaults.  Override any field via `overrides`.
 * Uses `crypto.randomUUID()` for the default id.
 */
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    description: "Test task",
    status: "pending",
    priority: "medium",
    dependencies: [],
    subTasks: [],
    ...overrides,
  };
}

/**
 * Creates a Goal with sensible defaults and optional task list.
 * Uses a fixed UUID so tool tests can reference it via `GOAL_ID`.
 */
export function makeGoal(overrides: Partial<Goal> = {}): Goal {
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

/**
 * Creates the standard `GmsToolDeps` object used by all lifecycle tool tests.
 *
 * @param goalId - the goal id that `createStaticGoalRepo` keys on
 * @param goal   - the pre-built goal stored in the repository
 */
export function createToolDeps(goalId: string, goal: Goal) {
  return {
    goalRepository: createStaticGoalRepo(goalId, goal),
    capabilityRepository: createMockRepos([]).capRepo,
    embeddings: mockEmbeddings(),
    chatModel: mockChatModel(),
    decomposeOptions: { topK: 1, maxDepth: 0 },
  };
}
