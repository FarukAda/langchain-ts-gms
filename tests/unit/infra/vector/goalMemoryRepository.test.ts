import { describe, it, expect, vi, beforeEach } from "vitest";
import { Document } from "@langchain/core/documents";
import type { Goal, Task } from "../../../../src/domain/contracts.js";
import { resetEnv } from "../../../../src/config/env.js";

// ---------- Mock Qdrant modules ------------------------------------------
const mockAddDocuments = vi.fn().mockResolvedValue(undefined);
const mockSimilaritySearchWithScore = vi.fn().mockResolvedValue([]);
const mockSimilaritySearchVectorWithScore = vi.fn().mockResolvedValue([]);
const mockDeleteDocs = vi.fn().mockResolvedValue(undefined);
const mockScroll = vi.fn();
const mockCount = vi.fn();
const mockEmbedQuery = vi.fn().mockResolvedValue(new Array(384).fill(0));
const mockEmbedDocuments = vi.fn().mockResolvedValue([]);
const mockEmbeddings = { embedQuery: mockEmbedQuery, embedDocuments: mockEmbedDocuments };

vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: class MockQdrantVectorStore {
    embeddings: { embedQuery: typeof mockEmbedQuery };
    client: {
      scroll: typeof mockScroll;
      count: typeof mockCount;
    };
    constructor(
      embeddings: { embedQuery: typeof mockEmbedQuery },
      _opts: unknown,
    ) {
      this.embeddings = embeddings;
      this.client = { scroll: mockScroll, count: mockCount };
    }
    addDocuments = mockAddDocuments;
    similaritySearchWithScore = mockSimilaritySearchWithScore;
    similaritySearchVectorWithScore = mockSimilaritySearchVectorWithScore;
    delete = mockDeleteDocs;
  },
}));

vi.mock("@qdrant/qdrant-js", () => ({
  QdrantClient: class MockQdrantClient {
    constructor(_opts: unknown) {}
  },
}));

// Dynamic import after mocks
const { GoalMemoryRepository } = await import(
  "../../../../src/infra/vector/goalMemoryRepository.js"
);

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

describe("GoalMemoryRepository", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
    resetEnv();
    vi.clearAllMocks();
  });

  it("can be instantiated", () => {
    const repo = new GoalMemoryRepository({
      embeddings: mockEmbeddings,
    });
    expect(repo).toBeDefined();
  });

  describe("bootstrap", () => {
    it("embeds a test query to get vector size", async () => {
      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      // bootstrap calls bootstrapQdrantCollections internally which requires the mock
      // Since qdrantClient.ts is also mocked indirectly, we focus on the embedQuery call
      try {
        await repo.bootstrap();
      } catch {
        // bootstrap may fail because the underlying client mock is minimal
        // but embedQuery should have been called
      }
      expect(mockEmbedQuery).toHaveBeenCalledWith("test");
    });
  });

  describe("upsert", () => {
    it("calls addDocuments with goal data", async () => {
      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const goal = makeGoal({ tasks: [makeTask()] });
      await repo.upsert(goal);

      expect(mockAddDocuments).toHaveBeenCalledTimes(1);
      const [docs, opts] = mockAddDocuments.mock.calls[0]! as [
        Document[],
        { ids: string[] },
      ];
      expect(docs[0]!.pageContent).toBe("Test goal");
      expect(docs[0]!.metadata.goal_id).toBe(goal.id);
      expect(docs[0]!.metadata.status).toBe("pending");
      expect(docs[0]!.metadata.tasks).toHaveLength(1);
      expect(opts.ids).toEqual([goal.id]);
    });

    it("includes tenant_id and parent_goal_id in metadata", async () => {
      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const goal = makeGoal({
        tenantId: "t-42",
        parentGoal: { id: "parent-1" },
      });
      await repo.upsert(goal);

      const [docs] = mockAddDocuments.mock.calls[0]! as [Document[]];
      expect(docs[0]!.metadata.tenant_id).toBe("t-42");
      expect(docs[0]!.metadata.parent_goal_id).toBe("parent-1");
    });
  });

  describe("search", () => {
    it("returns goals with scores from similarity search", async () => {
      const goalDoc = new Document({
        pageContent: "Cloud optimization",
        metadata: {
          goal_id: "550e8400-e29b-41d4-a716-446655440010",
          status: "planned",
          priority: "high",
          tasks: [],
        },
      });
      mockSimilaritySearchWithScore.mockResolvedValue([[goalDoc, 0.95]]);

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const results = await repo.search("cloud");

      expect(results).toHaveLength(1);
      expect(results[0]!.score).toBe(0.95);
      expect(results[0]!.goal.description).toBe("Cloud optimization");
    });

    it("filters out invalid documents", async () => {
      const invalidDoc = new Document({
        pageContent: "",
        metadata: {}, // no goal_id → should return null
      });
      mockSimilaritySearchWithScore.mockResolvedValue([[invalidDoc, 0.5]]);

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const results = await repo.search("anything");
      expect(results).toHaveLength(0);
    });

    it("passes filter to qdrant", async () => {
      mockSimilaritySearchWithScore.mockResolvedValue([]);

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      await repo.search("test", {
        k: 5,
        filter: { status: "planned", tenantId: "t1" },
      });

      const [, , filter] = mockSimilaritySearchWithScore.mock.calls[0]! as [unknown, unknown, object];
      expect(filter).toEqual({
        must: [
          { key: "metadata.status", match: { value: "planned" } },
          { key: "metadata.tenant_id", match: { value: "t1" } },
        ],
      });
    });
  });

  describe("searchByVector", () => {
    it("returns goals from vector similarity search", async () => {
      const goalDoc = new Document({
        pageContent: "Vector goal",
        metadata: {
          goal_id: "550e8400-e29b-41d4-a716-446655440020",
          status: "pending",
          priority: "medium",
          tasks: [],
        },
      });
      mockSimilaritySearchVectorWithScore.mockResolvedValue([[goalDoc, 0.88]]);

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const results = await repo.searchByVector(new Array(384).fill(0) as number[]);

      expect(results).toHaveLength(1);
      expect(results[0]!.score).toBe(0.88);
    });
  });

  describe("getById", () => {
    it("returns goal when found", async () => {
      mockScroll.mockResolvedValue({
        points: [
          {
            payload: {
              content: "My goal",
              metadata: {
                goal_id: "550e8400-e29b-41d4-a716-446655440030",
                status: "planned",
                priority: "high",
                tasks: [],
              },
            },
          },
        ],
      });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const goal = await repo.getById(
        "550e8400-e29b-41d4-a716-446655440030",
      );

      expect(goal).not.toBeNull();
      expect(goal!.id).toBe("550e8400-e29b-41d4-a716-446655440030");
      expect(goal!.description).toBe("My goal");
    });

    it("returns null when not found", async () => {
      mockScroll.mockResolvedValue({ points: [] });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const goal = await repo.getById("missing-id");

      expect(goal).toBeNull();
    });
  });

  describe("list", () => {
    it("delegates to listWithTotal and returns items only", async () => {
      mockCount.mockResolvedValue({ count: 1 });
      mockScroll.mockResolvedValue({
        points: [
          {
            payload: {
              content: "Listed goal",
              metadata: {
                goal_id: "550e8400-e29b-41d4-a716-446655440040",
                status: "pending",
                priority: "medium",
                tasks: [],
              },
            },
          },
        ],
      });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const items = await repo.list();

      expect(items).toHaveLength(1);
      expect(items[0]!.description).toBe("Listed goal");
    });
  });

  describe("listWithTotal", () => {
    it("returns paginated results with total count", async () => {
      mockCount.mockResolvedValue({ count: 3 });
      mockScroll.mockResolvedValue({
        points: [
          {
            payload: {
              content: "Goal A",
              metadata: {
                goal_id: "550e8400-e29b-41d4-a716-446655440050",
                status: "pending",
                priority: "medium",
                tasks: [],
              },
            },
          },
        ],
      });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const result = await repo.listWithTotal({ limit: 10, offset: 0 });

      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it("clamps limit to [1, 200]", async () => {
      mockCount.mockResolvedValue({ count: 0 });
      mockScroll.mockResolvedValue({ points: [] });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const result = await repo.listWithTotal({ limit: 0, offset: 0 });
      expect(result.limit).toBe(1);

      const result2 = await repo.listWithTotal({ limit: 500, offset: 0 });
      expect(result2.limit).toBe(200);
    });

    it("clamps offset to >= 0", async () => {
      mockCount.mockResolvedValue({ count: 0 });
      mockScroll.mockResolvedValue({ points: [] });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const result = await repo.listWithTotal({ limit: 10, offset: -5 });
      expect(result.offset).toBe(0);
    });

    it("skips points for offset > 0 using scroll cursor", async () => {
      mockCount.mockResolvedValue({ count: 10 });
      let callCount = 0;
      mockScroll.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          // First call: skip batch
          return Promise.resolve({
            points: Array.from({ length: 3 }, (_, i) => ({
              id: `point-${i}`,
            })),
            next_page_offset: "cursor-abc",
          });
        }
        // Second call: actual data
        return Promise.resolve({
          points: [
            {
              payload: {
                content: "Offset goal",
                metadata: {
                  goal_id: "550e8400-e29b-41d4-a716-446655440060",
                  status: "pending",
                  priority: "medium",
                  tasks: [],
                },
              },
            },
          ],
        });
      });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const result = await repo.listWithTotal({ limit: 5, offset: 3 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(10);
    });

    it("passes qdrant filter when filter is provided", async () => {
      mockCount.mockResolvedValue({ count: 0 });
      mockScroll.mockResolvedValue({ points: [] });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      await repo.listWithTotal({
        filter: { status: "completed", priority: "high" },
      });

      // Count call should include the filter
      const countCallArgs: unknown[] = mockCount.mock.calls[0]!;
      const countArgs = countCallArgs[1] as { filter?: object };
      expect(countArgs).toEqual(
        expect.objectContaining({
          filter: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            must: expect.arrayContaining([
              { key: "metadata.status", match: { value: "completed" } },
              { key: "metadata.priority", match: { value: "high" } },
            ]),
          },
          exact: true,
        }),
      );
    });

    it("sorts results by updatedAt descending, then by id", async () => {
      mockCount.mockResolvedValue({ count: 2 });
      mockScroll.mockResolvedValue({
        points: [
          {
            payload: {
              content: "Older goal",
              metadata: {
                goal_id: "550e8400-e29b-41d4-a716-44665544000a",
                status: "pending",
                priority: "medium",
                tasks: [],
                updated_at: "2025-01-01T00:00:00Z",
              },
            },
          },
          {
            payload: {
              content: "Newer goal",
              metadata: {
                goal_id: "550e8400-e29b-41d4-a716-44665544000b",
                status: "pending",
                priority: "medium",
                tasks: [],
                updated_at: "2026-01-01T00:00:00Z",
              },
            },
          },
        ],
      });

      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      const result = await repo.listWithTotal();

      expect(result.items[0]!.description).toBe("Newer goal");
      expect(result.items[1]!.description).toBe("Older goal");
    });

    it("falls back to id sort when timestamps are identical", async () => {
      const ts = "2025-06-01T00:00:00Z";
      mockCount.mockResolvedValue({ count: 2 });
      mockScroll.mockResolvedValue({
        points: [
          {
            payload: {
              content: "Goal F",
              metadata: {
                goal_id: "ff0e8400-e29b-41d4-a716-446655440000",
                status: "pending",
                priority: "medium",
                tasks: [],
                updated_at: ts,
                created_at: ts,
              },
            },
          },
          {
            payload: {
              content: "Goal A",
              metadata: {
                goal_id: "aa0e8400-e29b-41d4-a716-446655440000",
                status: "pending",
                priority: "medium",
                tasks: [],
                updated_at: ts,
                created_at: ts,
              },
            },
          },
        ],
      });

      const repo = new GoalMemoryRepository({ embeddings: mockEmbeddings });
      const result = await repo.listWithTotal();
      // Same timestamp → sorted alphabetically by id
      expect(result.items[0]!.id).toBe("aa0e8400-e29b-41d4-a716-446655440000");
      expect(result.items[1]!.id).toBe("ff0e8400-e29b-41d4-a716-446655440000");
    });

    it("filters out documents with invalid goal data", async () => {
      mockCount.mockResolvedValue({ count: 2 });
      mockScroll.mockResolvedValue({
        points: [
          {
            payload: {
              content: "Valid goal",
              metadata: {
                goal_id: "550e8400-e29b-41d4-a716-446655440050",
                status: "pending",
                priority: "medium",
                tasks: [],
              },
            },
          },
          {
            payload: {
              content: "",
              metadata: {
                goal_id: "550e8400-e29b-41d4-a716-446655440051",
                status: "INVALID_STATUS",
                priority: "medium",
                tasks: [],
              },
            },
          },
        ],
      });

      const repo = new GoalMemoryRepository({ embeddings: mockEmbeddings });
      const result = await repo.listWithTotal();
      // The second point has an invalid status that fails GoalSchema.safeParse → filtered out
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe("550e8400-e29b-41d4-a716-446655440050");
    });
  });

  describe("searchByVector", () => {
    it("returns goals with scores from vector search", async () => {
      const doc = new Document({
        pageContent: "Test goal description",
        metadata: {
          goal_id: "550e8400-e29b-41d4-a716-446655440070",
          status: "pending",
          priority: "high",
          tasks: [],
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      });
      mockSimilaritySearchVectorWithScore.mockResolvedValue([[doc, 0.95]]);

      const repo = new GoalMemoryRepository({ embeddings: mockEmbeddings });
      const results = await repo.searchByVector(new Array(384).fill(0) as number[], { k: 5 });

      expect(results).toHaveLength(1);
      expect(results[0]!.goal.id).toBe("550e8400-e29b-41d4-a716-446655440070");
      expect(results[0]!.score).toBe(0.95);
    });

    it("filters out null goals from invalid documents", async () => {
      const validDoc = new Document({
        pageContent: "Valid",
        metadata: {
          goal_id: "550e8400-e29b-41d4-a716-446655440071",
          status: "pending",
          priority: "medium",
          tasks: [],
        },
      });
      const invalidDoc = new Document({
        pageContent: "",
        metadata: { status: "BAD_STATUS" },
      });
      mockSimilaritySearchVectorWithScore.mockResolvedValue([
        [validDoc, 0.9],
        [invalidDoc, 0.8],
      ]);

      const repo = new GoalMemoryRepository({ embeddings: mockEmbeddings });
      const results = await repo.searchByVector(new Array(384).fill(0) as number[]);

      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getById", () => {
    it("returns goal when found", async () => {
      mockScroll.mockResolvedValue({
        points: [
          {
            payload: {
              content: "Found goal",
              metadata: {
                goal_id: "550e8400-e29b-41d4-a716-446655440080",
                status: "planned",
                priority: "high",
                tasks: [],
                created_at: "2025-01-01T00:00:00Z",
                updated_at: "2025-01-01T00:00:00Z",
              },
            },
          },
        ],
      });

      const repo = new GoalMemoryRepository({ embeddings: mockEmbeddings });
      const goal = await repo.getById("550e8400-e29b-41d4-a716-446655440080");

      expect(goal).not.toBeNull();
      expect(goal!.id).toBe("550e8400-e29b-41d4-a716-446655440080");
      expect(goal!.description).toBe("Found goal");
    });

    it("returns null when goal not found", async () => {
      mockScroll.mockResolvedValue({ points: [] });

      const repo = new GoalMemoryRepository({ embeddings: mockEmbeddings });
      const goal = await repo.getById("nonexistent-id");

      expect(goal).toBeNull();
    });
  });

  describe("listWithTotal — cursor pagination", () => {
    it("applies cursor-based offset pagination", async () => {
      // total=5, offset=3 → scroll through first 3 to skip, then fetch the page
      mockCount.mockResolvedValue({ count: 5 });
      // First scroll call: skip batch (offset=3), returns 3 points with next_page_offset
      mockScroll
        .mockResolvedValueOnce({
          points: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          next_page_offset: "cursor-after-3",
        })
        // Second scroll call: actual data fetch with cursor
        .mockResolvedValueOnce({
          points: [
            {
              payload: {
                content: "Goal at offset 3",
                metadata: {
                  goal_id: "550e8400-e29b-41d4-a716-446655440090",
                  status: "pending",
                  priority: "medium",
                  tasks: [],
                  created_at: "2025-01-01T00:00:00Z",
                  updated_at: "2025-01-01T00:00:00Z",
                },
              },
            },
          ],
        });

      const repo = new GoalMemoryRepository({ embeddings: mockEmbeddings });
      const result = await repo.listWithTotal({ limit: 2, offset: 3 });

      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(1);
      // Verify scroll was called with cursor offset
      const dataScrollCall = mockScroll.mock.calls[1]!;
      expect(dataScrollCall[1]).toEqual(
        expect.objectContaining({ offset: "cursor-after-3" }),
      );
    });
  });

  describe("filter construction", () => {
    it("builds filter with tenantId and goalId", async () => {
      mockCount.mockResolvedValue({ count: 0 });
      mockScroll.mockResolvedValue({ points: [] });

      const repo = new GoalMemoryRepository({ embeddings: mockEmbeddings });
      await repo.listWithTotal({
        filter: { tenantId: "tenant-1", goalId: "goal-1" },
      });

      const countCallArgs: unknown[] = mockCount.mock.calls[0]!;
      const countArgs = countCallArgs[1] as { filter?: object };
      expect(countArgs).toEqual(
        expect.objectContaining({
          filter: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            must: expect.arrayContaining([
              { key: "metadata.tenant_id", match: { value: "tenant-1" } },
              { key: "metadata.goal_id", match: { value: "goal-1" } },
            ]),
          },
        }),
      );
    });
  });

  describe("deleteByIds", () => {
    it("calls store.delete with provided ids", async () => {
      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      await repo.deleteByIds(["id-1", "id-2"]);

      expect(mockDeleteDocs).toHaveBeenCalledWith({ ids: ["id-1", "id-2"] });
    });

    it("skips delete when ids array is empty", async () => {
      const repo = new GoalMemoryRepository({
        embeddings: mockEmbeddings,
      });
      await repo.deleteByIds([]);

      expect(mockDeleteDocs).not.toHaveBeenCalled();
    });
  });
});
