import { describe, it, expect } from "vitest";
import {
  stripNulls,
  normalizeInput,
  getGoalOrThrow,
  wrapToolResponse,
  buildGoal,
  findTaskById,
  findParentTaskId,
  paginate,
  matchesFilters,
  removeFailedTasks,
  filterTaskTree,
} from "../../../src/lib/helpers.js";
import type { Goal, Task } from "../../../src/domain/contracts.js";
import { createStaticGoalRepo } from "../../helpers/mockRepository.js";

function makeTask(id: string, desc: string, opts: Partial<Task> = {}): Task {
  return {
    id,
    description: desc,
    status: opts.status ?? "pending",
    priority: opts.priority ?? "medium",
    dependencies: opts.dependencies ?? [],
    subTasks: opts.subTasks ?? [],
    ...(opts.parentId !== undefined && { parentId: opts.parentId }),
    ...(opts.type !== undefined && { type: opts.type }),
    ...(opts.acceptanceCriteria !== undefined && { acceptanceCriteria: opts.acceptanceCriteria }),
    ...(opts.expectedOutput !== undefined && { expectedOutput: opts.expectedOutput }),
    ...(opts.riskLevel !== undefined && { riskLevel: opts.riskLevel }),
    ...(opts.estimatedComplexity !== undefined && {
      estimatedComplexity: opts.estimatedComplexity,
    }),
    ...(opts.rationale !== undefined && { rationale: opts.rationale }),
  };
}

describe("helpers", () => {
  describe("stripNulls", () => {
    it("converts null values to undefined", () => {
      const result = stripNulls({ a: null, b: "hello" });
      expect(result.a).toBeUndefined();
      expect(result.b).toBe("hello");
    });

    it("passes string booleans through unchanged (coercion handled by coerceLifecycleInput)", () => {
      const result = stripNulls({ yes: "true", no: "false" });
      expect(result.yes).toBe("true");
      expect(result.no).toBe("false");
    });

    it("passes numeric strings through unchanged", () => {
      const result = stripNulls({ limit: "100", score: "3.14" });
      expect(result.limit).toBe("100");
      expect(result.score).toBe("3.14");
    });

    it("does NOT coerce UUID-like strings", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = stripNulls({ goalId: uuid });
      expect(result.goalId).toBe(uuid);
    });

    it("preserves non-string, non-null values unchanged", () => {
      const result = stripNulls({ count: 42, flag: true, items: [1, 2] });
      expect(result.count).toBe(42);
      expect(result.flag).toBe(true);
      expect(result.items).toEqual([1, 2]);
    });
  });

  describe("normalizeInput", () => {
    it("resolves goalDescription directly", () => {
      const out = normalizeInput({ goalDescription: "Build a thing" });
      expect(out.goalDescription).toBe("Build a thing");
    });

    it("resolves description alias", () => {
      const out = normalizeInput({ description: "From description" });
      expect(out.goalDescription).toBe("From description");
    });

    it("resolves goal alias", () => {
      const out = normalizeInput({ goal: "From goal" });
      expect(out.goalDescription).toBe("From goal");
    });

    it("resolves goal_description alias", () => {
      const out = normalizeInput({ goal_description: "From snake_case" });
      expect(out.goalDescription).toBe("From snake_case");
    });

    it("resolves input alias", () => {
      const out = normalizeInput({ input: "From input" });
      expect(out.goalDescription).toBe("From input");
    });

    it("resolves query alias", () => {
      const out = normalizeInput({ query: "From query" });
      expect(out.goalDescription).toBe("From query");
    });

    it("prioritises goalDescription when multiple aliases present", () => {
      const out = normalizeInput({
        goalDescription: "Primary",
        description: "Secondary",
        input: "Tertiary",
      });
      expect(out.goalDescription).toBe("Primary");
    });

    it("preserves priority and traceId", () => {
      const out = normalizeInput({
        goalDescription: "Test",
        priority: "high",
        traceId: "abc-123",
      });
      expect(out.priority).toBe("high");
      expect(out.traceId).toBe("abc-123");
    });

    it("throws when no alias resolves to a description", () => {
      expect(() => normalizeInput({ priority: "high" } as never)).toThrow(
        "Missing goal description",
      );
    });
  });

  describe("buildGoal", () => {
    it("creates goal with UUID and defaults", () => {
      const goal = buildGoal({ goalDescription: "Test goal" });
      expect(goal.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(goal.description).toBe("Test goal");
      expect(goal.status).toBe("pending");
      expect(goal.priority).toBe("medium");
      expect(goal.tasks).toEqual([]);
    });

    it("uses provided priority", () => {
      const goal = buildGoal({ goalDescription: "High prio", priority: "critical" });
      expect(goal.priority).toBe("critical");
    });

    it("passes through metadata", () => {
      const goal = buildGoal({ goalDescription: "Meta", metadata: { team: "eng" } });
      expect(goal.metadata).toEqual({ team: "eng" });
    });

    it("passes through tenantId", () => {
      const goal = buildGoal({ goalDescription: "Tenant", tenantId: "t-42" });
      expect(goal.tenantId).toBe("t-42");
    });

    it("trims whitespace from description", () => {
      const goal = buildGoal({ goalDescription: "  spaced  " });
      expect(goal.description).toBe("spaced");
    });

    it("throws for missing description", () => {
      expect(() => buildGoal({})).toThrow("Missing goal description");
    });

    it("throws for whitespace-only description", () => {
      expect(() => buildGoal({ goalDescription: "   " })).toThrow("Missing goal description");
    });
  });

  describe("findTaskById", () => {
    const nested = [
      makeTask("a", "A", { subTasks: [makeTask("a1", "A1"), makeTask("a2", "A2")] }),
      makeTask("b", "B"),
    ];

    it("finds root-level task", () => {
      expect(findTaskById(nested, "b")?.description).toBe("B");
    });

    it("finds nested task", () => {
      expect(findTaskById(nested, "a2")?.description).toBe("A2");
    });

    it("returns null for missing id", () => {
      expect(findTaskById(nested, "nope")).toBeNull();
    });

    it("returns null for empty tree", () => {
      expect(findTaskById([], "x")).toBeNull();
    });
  });

  describe("findParentTaskId", () => {
    const tree = [
      makeTask("p", "Parent", {
        subTasks: [
          makeTask("c1", "Child1", { subTasks: [makeTask("gc", "GrandChild")] }),
          makeTask("c2", "Child2"),
        ],
      }),
    ];

    it("returns null for root task", () => {
      expect(findParentTaskId(tree, "p")).toBeNull();
    });

    it("finds parent of direct child", () => {
      expect(findParentTaskId(tree, "c1")).toBe("p");
    });

    it("finds parent of grandchild", () => {
      expect(findParentTaskId(tree, "gc")).toBe("c1");
    });

    it("returns null for missing id", () => {
      expect(findParentTaskId(tree, "missing")).toBeNull();
    });
  });

  describe("paginate", () => {
    const items = [1, 2, 3, 4, 5];

    it("returns first page", () => {
      const page = paginate(items, 2, 0);
      expect(page.items).toEqual([1, 2]);
      expect(page.total).toBe(5);
    });

    it("returns middle page", () => {
      expect(paginate(items, 2, 2).items).toEqual([3, 4]);
    });

    it("returns last partial page", () => {
      expect(paginate(items, 2, 4).items).toEqual([5]);
    });

    it("returns empty for offset beyond length", () => {
      expect(paginate(items, 2, 10).items).toEqual([]);
    });

    it("clamps negative offset to 0", () => {
      expect(paginate(items, 2, -5).items).toEqual([1, 2]);
    });

    it("clamps limit to at least 1", () => {
      expect(paginate(items, 0, 0).items).toEqual([1]);
    });
  });

  describe("matchesFilters", () => {
    const task = makeTask("t", "Test", { status: "in_progress", priority: "high" });

    it("matches when no filters", () => {
      expect(matchesFilters(task)).toBe(true);
    });

    it("matches when status matches", () => {
      expect(matchesFilters(task, ["in_progress", "pending"])).toBe(true);
    });

    it("rejects when status does not match", () => {
      expect(matchesFilters(task, ["completed"])).toBe(false);
    });

    it("matches when priority matches", () => {
      expect(matchesFilters(task, undefined, ["high", "critical"])).toBe(true);
    });

    it("rejects when priority does not match", () => {
      expect(matchesFilters(task, undefined, ["low"])).toBe(false);
    });

    it("ignores empty arrays (treats as no filter)", () => {
      expect(matchesFilters(task, [], [])).toBe(true);
    });

    // --- Type filter tests ---

    it("matches when type filter includes task type", () => {
      const typedTask = makeTask("t", "Test", { type: "research" });
      expect(matchesFilters(typedTask, undefined, undefined, ["research", "decision"])).toBe(true);
    });

    it("rejects when type filter excludes task type", () => {
      const typedTask = makeTask("t", "Test", { type: "action" });
      expect(matchesFilters(typedTask, undefined, undefined, ["research"])).toBe(false);
    });

    it("rejects tasks without type when type filter is specified", () => {
      const noTypeTask = makeTask("t", "Test");
      expect(matchesFilters(noTypeTask, undefined, undefined, ["research"])).toBe(false);
    });
  });

  describe("removeFailedTasks", () => {
    it("removes root-level failed tasks", () => {
      const tasks = [makeTask("ok", "OK"), makeTask("fail", "Fail", { status: "failed" })];
      const result = removeFailedTasks(tasks);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("ok");
    });

    it("removes nested failed tasks", () => {
      const tasks = [
        makeTask("a", "A", {
          subTasks: [makeTask("a1", "A1"), makeTask("a2", "A2", { status: "failed" })],
        }),
      ];
      const result = removeFailedTasks(tasks);
      expect(result[0]!.subTasks).toHaveLength(1);
      expect(result[0]!.subTasks[0]!.id).toBe("a1");
    });

    it("returns empty for all-failed tree", () => {
      const tasks = [makeTask("f1", "F1", { status: "failed" })];
      expect(removeFailedTasks(tasks)).toEqual([]);
    });

    it("preserves tree when nothing is failed", () => {
      const tasks = [makeTask("ok", "OK", { subTasks: [makeTask("ok2", "OK2")] })];
      const result = removeFailedTasks(tasks);
      expect(result).toHaveLength(1);
      expect(result[0]!.subTasks).toHaveLength(1);
    });
  });

  describe("filterTaskTree", () => {
    const tree = [
      makeTask("a", "deploy", {
        subTasks: [makeTask("a1", "build step"), makeTask("a2", "test step")],
      }),
      makeTask("b", "clean up"),
    ];

    it("retains matching root nodes", () => {
      const result = filterTaskTree(tree, (t) => t.description === "clean up");
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("b");
    });

    it("retains ancestor when descendant matches", () => {
      const result = filterTaskTree(tree, (t) => t.description === "build step");
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("a");
      expect(result[0]!.subTasks).toHaveLength(1);
      expect(result[0]!.subTasks[0]!.id).toBe("a1");
    });

    it("returns empty when nothing matches", () => {
      expect(filterTaskTree(tree, () => false)).toEqual([]);
    });

    it("returns full tree when everything matches", () => {
      const result = filterTaskTree(tree, () => true);
      expect(result).toHaveLength(2);
      expect(result[0]!.subTasks).toHaveLength(2);
    });
  });

  describe("getGoalOrThrow", () => {
    it("returns goal when found", async () => {
      const goalId = "550e8400-e29b-41d4-a716-446655440000";
      const stored: Goal = {
        id: goalId,
        description: "Test goal",
        status: "planned",
        priority: "medium",
        tasks: [],
        metadata: {},
      };
      const repo = createStaticGoalRepo(goalId, stored);
      const goal = await getGoalOrThrow(repo, goalId);
      expect(goal.id).toBe(goalId);
    });

    it("throws GMS_GOAL_NOT_FOUND for missing goal", async () => {
      const repo = createStaticGoalRepo("other-id", {
        id: "other-id",
        description: "Other",
        status: "pending",
        priority: "medium",
        tasks: [],
        metadata: {},
      });
      await expect(getGoalOrThrow(repo, "550e8400-e29b-41d4-a716-446655440999")).rejects.toThrow(
        "GMS_GOAL_NOT_FOUND",
      );
    });
  });

  describe("wrapToolResponse", () => {
    it("returns stringified JSON with version", () => {
      const raw = wrapToolResponse({ foo: "bar" });
      const parsed = JSON.parse(raw) as { version: string; foo: string };
      expect(parsed.version).toBe("1.0");
      expect(parsed.foo).toBe("bar");
    });

    it("preserves nested data", () => {
      const raw = wrapToolResponse({ items: [1, 2, 3], total: 3 });
      const parsed = JSON.parse(raw) as { items: number[]; total: number; version: string };
      expect(parsed.items).toEqual([1, 2, 3]);
      expect(parsed.total).toBe(3);
    });
  });
});
