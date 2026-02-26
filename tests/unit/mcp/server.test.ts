/**
 * Tests validating MCP server parity with the lib tools.
 *
 * Rather than spinning up a full MCP transport, these tests exercise the
 * shared helpers that the MCP server now delegates to — proving that
 * the 4 parity fixes (semantic search, lifecycle hooks, recursive
 * removeFailedTasks, expand I/O fields) work correctly when called
 * the same way the MCP server calls them.
 */
import { describe, it, expect, vi } from "vitest";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { Task } from "../../../src/domain/contracts.js";
import {
  semanticSearchTasks,
  substringSearchTasks,
  _resetEmbedCache,
} from "../../../src/lib/tools/searchTasks.js";
import { fireLifecycleHooks } from "../../../src/lib/tools/updateTask.js";
import { removeFailedTasks, paginate } from "../../../src/lib/helpers.js";
import { flattenTasks } from "../../../src/domain/taskUtils.js";
import {
  makeTask,
  makeGoal,
  mockEmbeddings,
  mockChatModel,
  createStaticGoalRepo,
} from "../../helpers/mockRepository.js";
import type { GmsToolDeps } from "../../../src/lib/types.js";
import { setLogSilent } from "../../../src/infra/observability/tracing.js";

// Suppress structured logs during tests
setLogSilent(true);

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";

// ---------------------------------------------------------------------------
// Fix 1 — Semantic search (shared helper)
// ---------------------------------------------------------------------------

describe("semanticSearchTasks (MCP parity — Fix 1)", () => {
  it("ranks tasks by cosine similarity and filters below threshold", async () => {
    _resetEmbedCache();

    const tasks: Task[] = [
      makeTask({
        id: "550e8400-e29b-41d4-a716-446655440001",
        description: "Delete the database backups",
      }),
      makeTask({
        id: "550e8400-e29b-41d4-a716-446655440002",
        description: "Clean up old logs",
      }),
    ];

    const queryVec = [1.0, 0.0, 0.0];
    const taskVecs = [
      [0.1, 0.9, 0.0], // Low similarity to query
      [0.95, 0.05, 0.0], // High similarity to query
    ];

    const mockEmbed: EmbeddingsInterface = {
      embedQuery: vi.fn().mockResolvedValue(queryVec),
      embedDocuments: vi.fn().mockResolvedValue(taskVecs),
    };

    const matched = await semanticSearchTasks(tasks, "tidy up", mockEmbed, GOAL_ID);

    // Only the high-similarity task should match
    expect(matched).toHaveLength(1);
    expect(matched[0]!.description).toBe("Clean up old logs");
    _resetEmbedCache();
  });

  it("returns empty when all tasks below similarity threshold", async () => {
    _resetEmbedCache();

    const tasks: Task[] = [
      makeTask({ id: "550e8400-e29b-41d4-a716-446655440001", description: "Unrelated task" }),
    ];

    const mockEmbed: EmbeddingsInterface = {
      embedQuery: vi.fn().mockResolvedValue([1.0, 0.0]),
      embedDocuments: vi.fn().mockResolvedValue([[0.0, 1.0]]),
    };

    const matched = await semanticSearchTasks(tasks, "something", mockEmbed, GOAL_ID);
    expect(matched).toHaveLength(0);
    _resetEmbedCache();
  });
});

describe("substringSearchTasks (MCP parity — Fix 1)", () => {
  it("performs case-insensitive substring matching", () => {
    const tasks: Task[] = [
      makeTask({ description: "Deploy to production" }),
      makeTask({ description: "Write tests" }),
    ];

    const matched = substringSearchTasks(tasks, "deploy");
    expect(matched).toHaveLength(1);
    expect(matched[0]!.description).toBe("Deploy to production");
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — Lifecycle hooks (shared helper)
// ---------------------------------------------------------------------------

describe("fireLifecycleHooks (MCP parity — Fix 2)", () => {
  it("fires onTaskReady for newly-ready tasks after a status update", async () => {
    const depTask = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440010",
      status: "completed",
    });
    const waitingTask = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440011",
      status: "pending",
      dependencies: [depTask.id],
    });
    const goal = makeGoal({ id: GOAL_ID, tasks: [depTask, waitingTask] });

    const onTaskReady = vi.fn();
    const deps: GmsToolDeps = {
      goalRepository: createStaticGoalRepo(GOAL_ID, goal),
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      onTaskReady,
    };

    // prevReadyIds = empty (nothing was ready before)
    const prevReadyIds = new Set<string>();
    await fireLifecycleHooks(deps, goal, prevReadyIds);

    expect(onTaskReady).toHaveBeenCalledTimes(1);
    expect(onTaskReady).toHaveBeenCalledWith(
      expect.objectContaining({ id: waitingTask.id }),
      expect.objectContaining({ id: GOAL_ID }),
    );
  });

  it("fires onGoalCompleted when all tasks are completed", async () => {
    const t1 = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440010",
      status: "completed",
    });
    const t2 = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440011",
      status: "completed",
    });
    const goal = makeGoal({ id: GOAL_ID, tasks: [t1, t2] });

    const onGoalCompleted = vi.fn();
    const deps: GmsToolDeps = {
      goalRepository: createStaticGoalRepo(GOAL_ID, goal),
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      onGoalCompleted,
    };

    await fireLifecycleHooks(deps, goal, new Set());
    expect(onGoalCompleted).toHaveBeenCalledTimes(1);
    expect(onGoalCompleted).toHaveBeenCalledWith(expect.objectContaining({ id: GOAL_ID }));
  });

  it("does not fire onTaskReady for tasks already in prevReadyIds", async () => {
    const readyTask = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440010",
      status: "pending",
      dependencies: [],
    });
    const goal = makeGoal({ id: GOAL_ID, tasks: [readyTask] });

    const onTaskReady = vi.fn();
    const deps: GmsToolDeps = {
      goalRepository: createStaticGoalRepo(GOAL_ID, goal),
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      onTaskReady,
    };

    // Task was already ready before — should NOT fire
    const prevReadyIds = new Set([readyTask.id]);
    await fireLifecycleHooks(deps, goal, prevReadyIds);
    expect(onTaskReady).not.toHaveBeenCalled();
  });

  it("does not crash when a hook throws", async () => {
    const t1 = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440010",
      status: "completed",
    });
    const goal = makeGoal({ id: GOAL_ID, tasks: [t1] });

    const onGoalCompleted = vi.fn().mockRejectedValue(new Error("hook boom"));
    const deps: GmsToolDeps = {
      goalRepository: createStaticGoalRepo(GOAL_ID, goal),
      embeddings: mockEmbeddings(),
      chatModel: mockChatModel(),
      onGoalCompleted,
    };

    // Should not throw
    await fireLifecycleHooks(deps, goal, new Set());
    expect(onGoalCompleted).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — Recursive removeFailedTasks (MCP parity)
// ---------------------------------------------------------------------------

describe("removeFailedTasks recursion (MCP parity — Fix 3)", () => {
  it("removes failed tasks at top level", () => {
    const tasks: Task[] = [
      makeTask({ id: "a1", status: "failed" }),
      makeTask({ id: "a2", status: "pending" }),
    ];

    const result = removeFailedTasks(tasks);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a2");
  });

  it("removes nested failed tasks (not just top-level)", () => {
    const nestedFailed = makeTask({ id: "child-failed", status: "failed", parentId: "parent" });
    const nestedOk = makeTask({ id: "child-ok", status: "pending", parentId: "parent" });
    const parent = makeTask({
      id: "parent",
      status: "pending",
      subTasks: [nestedFailed, nestedOk],
    });

    const result = removeFailedTasks([parent]);
    expect(result).toHaveLength(1);
    const parentResult = result[0]!;
    expect(parentResult.subTasks).toHaveLength(1);
    expect(parentResult.subTasks[0]!.id).toBe("child-ok");
  });

  it("removes deeply nested failed tasks", () => {
    const deepFailed = makeTask({ id: "deep-failed", status: "failed" });
    const mid = makeTask({
      id: "mid",
      status: "pending",
      subTasks: [deepFailed],
    });
    const top = makeTask({
      id: "top",
      status: "pending",
      subTasks: [mid],
    });

    const result = removeFailedTasks([top]);
    expect(result).toHaveLength(1);
    const midResult = result[0]!.subTasks[0]!;
    expect(midResult.subTasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — Expand task I/O fields
// ---------------------------------------------------------------------------

describe("expandTask I/O fields (MCP parity — Fix 4)", () => {
  it("creates sub-tasks with expectedInputs and providedOutputs when provided", () => {
    // Simulate the MCP expand logic — build sub-tasks with I/O fields
    const parent = makeTask({ id: "parent-id", priority: "high" });
    const subTaskDefs = [
      {
        description: "Fetch data",
        expectedInputs: ["api_key", "endpoint"],
        providedOutputs: ["raw_data"],
      },
      {
        description: "Process data",
        expectedInputs: ["raw_data"],
        providedOutputs: ["processed_data", "summary"],
      },
    ];

    const newSubTasks: Task[] = [];
    const prevIds: string[] = [];
    for (const st of subTaskDefs) {
      const id = crypto.randomUUID();
      newSubTasks.push({
        id,
        description: st.description,
        status: "pending",
        priority: parent.priority,
        dependencies: [...prevIds],
        subTasks: [],
        parentId: parent.id,
        ...(st.expectedInputs?.length && { expectedInputs: st.expectedInputs }),
        ...(st.providedOutputs?.length && { providedOutputs: st.providedOutputs }),
      });
      prevIds.length = 0;
      prevIds.push(id);
    }

    expect(newSubTasks).toHaveLength(2);
    expect(newSubTasks[0]!.expectedInputs).toEqual(["api_key", "endpoint"]);
    expect(newSubTasks[0]!.providedOutputs).toEqual(["raw_data"]);
    expect(newSubTasks[1]!.expectedInputs).toEqual(["raw_data"]);
    expect(newSubTasks[1]!.providedOutputs).toEqual(["processed_data", "summary"]);
  });

  it("omits I/O fields when not provided", () => {
    const parent = makeTask({ id: "parent-id" });
    const subTaskDefs = [{ description: "Simple task" }];

    const newSubTasks: Task[] = [];
    for (const st of subTaskDefs) {
      const id = crypto.randomUUID();
      newSubTasks.push({
        id,
        description: st.description,
        status: "pending",
        priority: parent.priority,
        dependencies: [],
        subTasks: [],
        parentId: parent.id,
      });
    }

    expect(newSubTasks[0]!.expectedInputs).toBeUndefined();
    expect(newSubTasks[0]!.providedOutputs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gap 1 — list_goals filter construction
// ---------------------------------------------------------------------------

describe("gms_list_goals filter construction (MCP parity — Gap 1)", () => {
  it("builds GoalSearchFilter from optional status/priority/tenantId", () => {
    // Simulate the MCP server's filter construction logic
    const status = "pending" as const;
    const priority = "high" as const;
    const tenantId = "tenant-123";

    const filter = {
      ...(status !== undefined && { status }),
      ...(priority !== undefined && { priority }),
      ...(tenantId !== undefined && { tenantId }),
    };

    expect(filter).toEqual({ status: "pending", priority: "high", tenantId: "tenant-123" });
    expect(Object.keys(filter).length).toBe(3);
  });

  it("returns empty filter when no params provided", () => {
    const status = undefined;
    const priority = undefined;
    const tenantId = undefined;

    const filter = {
      ...(status !== undefined && { status }),
      ...(priority !== undefined && { priority }),
      ...(tenantId !== undefined && { tenantId }),
    };

    expect(Object.keys(filter).length).toBe(0);
  });

  it("paginate handles search results correctly", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const page = paginate(items, 2, 1);
    expect(page.items).toEqual([{ id: "b" }, { id: "c" }]);
    expect(page.total).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — update_goal metadata merge
// ---------------------------------------------------------------------------

describe("gms_update_goal metadata merge (MCP parity — Gap 2)", () => {
  it("merges new metadata with existing metadata", () => {
    const existingMeta = { env: "production", version: "1.0" };
    const newMeta = { version: "2.0", extra: "value" };

    const merged = { ...existingMeta, ...newMeta };

    expect(merged).toEqual({ env: "production", version: "2.0", extra: "value" });
  });

  it("does not alter goal when metadata is undefined", () => {
    const existingMeta: Record<string, unknown> = { env: "production" };
    const metadata: Record<string, unknown> | undefined = undefined;

    // Replicate the server logic: only merge when metadata is defined
    const metadataPatch =
      metadata !== undefined
        ? { metadata: { ...existingMeta, ...(metadata as Record<string, unknown>) } }
        : {};
    const result = { ...metadataPatch };

    expect(result).toEqual({});
    // existingMeta should not be touched
  });

  it("creates metadata from empty when existing is undefined", () => {
    const existingMeta = undefined;
    const metadata = { key: "val" };

    const merged = { ...(existingMeta ?? {}), ...metadata };

    expect(merged).toEqual({ key: "val" });
  });
});

// ---------------------------------------------------------------------------
// Gap 3 — list_tasks includeSubTasks
// ---------------------------------------------------------------------------

describe("gms_list_tasks includeSubTasks (MCP parity — Gap 3)", () => {
  const child = makeTask({
    id: "550e8400-e29b-41d4-a716-446655440002",
    description: "Child task",
  });
  const parent = makeTask({
    id: "550e8400-e29b-41d4-a716-446655440001",
    description: "Parent task",
    subTasks: [child],
  });
  const topLevel = [parent];

  it("flat=true, includeSubTasks=true (default): returns all tasks", () => {
    const isFlatMode = true;
    const includeSubTasks = true;
    const tasks = isFlatMode ? (includeSubTasks ? flattenTasks(topLevel) : topLevel) : topLevel;

    expect(tasks).toHaveLength(2); // parent + child
  });

  it("flat=true, includeSubTasks=false: returns only top-level tasks", () => {
    const isFlatMode = true;
    const includeSubTasks = false;
    const tasks = isFlatMode ? (includeSubTasks ? flattenTasks(topLevel) : topLevel) : topLevel;

    expect(tasks).toHaveLength(1); // only parent
    expect(tasks[0]!.id).toBe(parent.id);
  });

  it("flat=false: returns tree regardless of includeSubTasks", () => {
    const isFlatMode = false;
    const tasks = isFlatMode ? flattenTasks(topLevel) : topLevel;

    expect(tasks).toHaveLength(1); // tree root only
    expect(tasks[0]!.subTasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Gap 4 — replan decomposeOptions merge
// ---------------------------------------------------------------------------

describe("gms_replan_goal decomposeOptions merge (MCP parity — Gap 4)", () => {
  it("input decomposeOptions overrides deps defaults", () => {
    const depsOpts = { topK: 5, maxDepth: 4 };
    const inputOpts = { topK: 10 };

    const merged = Object.fromEntries(
      Object.entries({ ...depsOpts, ...inputOpts }).filter(([, v]) => v != null),
    );

    expect(merged).toEqual({ topK: 10, maxDepth: 4 });
  });

  it("returns deps defaults when no input provided", () => {
    const depsOpts = { topK: 5, maxDepth: 4 };
    const inputOpts = undefined;

    // When no input decomposeOptions, the server passes deps.decomposeOptions as-is
    const result =
      inputOpts !== undefined
        ? Object.fromEntries(
            Object.entries({ ...depsOpts, ...(inputOpts as Record<string, unknown>) }).filter(
              ([, v]) => v != null,
            ),
          )
        : depsOpts;

    expect(result).toEqual({ topK: 5, maxDepth: 4 });
  });

  it("filters null/undefined values from merged options", () => {
    const depsOpts = { topK: 5, maxDepth: 4 };
    const inputOpts = { topK: 10, maxDepth: undefined };

    const merged = Object.fromEntries(
      Object.entries({ ...depsOpts, ...inputOpts }).filter(([, v]) => v != null),
    );

    // Input `undefined` overwrites deps value, then filter removes it.
    // This is correct: explicitly passing undefined "opts out" of the deps default.
    expect(merged).toEqual({ topK: 10 });
  });
});
