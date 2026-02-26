import { describe, it, expect } from "vitest";
import {
  flattenTasks,
  countTasks,
  executionOrder,
  updateTaskById,
  migrateTasksToHierarchy,
  canTransitionTaskStatus,
  validateGoalInvariants,
} from "../../../src/domain/taskUtils.js";
import type { Goal, Task } from "../../../src/domain/contracts.js";

function task(id: string, desc: string, deps: string[] = [], sub: Task[] = []): Task {
  return {
    id,
    description: desc,
    status: "pending",
    priority: "medium",
    dependencies: deps,
    subTasks: sub,
  };
}

describe("taskUtils", () => {
  describe("flattenTasks", () => {
    it("returns empty for empty input", () => {
      expect(flattenTasks([])).toEqual([]);
    });

    it("flattens single level", () => {
      const tasks = [task("a", "A"), task("b", "B")];
      expect(flattenTasks(tasks)).toHaveLength(2);
      expect(flattenTasks(tasks).map((t) => t.id)).toEqual(["a", "b"]);
    });

    it("flattens nested hierarchy (DFS pre-order)", () => {
      const tasks = [
        task("a", "A", [], [task("a1", "A1"), task("a2", "A2", [], [task("a2a", "A2a")])]),
      ];
      const flat = flattenTasks(tasks);
      expect(flat.map((t) => t.id)).toEqual(["a", "a1", "a2", "a2a"]);
    });
  });

  describe("countTasks", () => {
    it("returns 0 for empty", () => {
      expect(countTasks([])).toBe(0);
    });

    it("counts all nodes in tree", () => {
      const tasks = [task("a", "A", [], [task("a1", "A1"), task("a2", "A2")])];
      expect(countTasks(tasks)).toBe(3);
    });
  });

  describe("executionOrder", () => {
    it("respects dependencies (dependents after dependencies)", () => {
      const tasks = [task("b", "B", ["a"]), task("a", "A"), task("c", "C", ["b"])];
      const order = executionOrder(tasks);
      const idx = (id: string) => order.findIndex((t) => t.id === id);
      expect(idx("a")).toBeLessThan(idx("b"));
      expect(idx("b")).toBeLessThan(idx("c"));
    });

    it("handles nested tasks with dependencies", () => {
      const a1 = task("a1", "A1");
      const a2 = task("a2", "A2", ["a1"]);
      const a = task("a", "A", [], [a1, a2]);
      const order = executionOrder([a]);
      const ids = order.map((t) => t.id);
      expect(ids.indexOf("a1")).toBeLessThan(ids.indexOf("a2"));
    });

    it("throws on dependency cycle", () => {
      const a: Task = { ...task("a", "A", ["b"]) };
      const b: Task = { ...task("b", "B", ["a"]) };
      expect(() => executionOrder([a, b])).toThrow("Dependency cycle");
    });

    it("skips missing dependency gracefully", () => {
      // Task 'b' depends on 'nonexistent', which is not in the task list
      const tasks = [task("a", "A"), task("b", "B", ["nonexistent"])];
      const order = executionOrder(tasks);
      expect(order.map((t) => t.id)).toContain("a");
      expect(order.map((t) => t.id)).toContain("b");
    });
  });

  describe("updateTaskById", () => {
    it("updates root task", () => {
      const tasks = [task("a", "A"), task("b", "B")];
      const updated = updateTaskById(tasks, "a", (t) => ({ ...t, status: "completed" as const }));
      expect(updated[0]!.status).toBe("completed");
      expect(updated[1]!.status).toBe("pending");
    });

    it("updates nested task", () => {
      const tasks = [task("a", "A", [], [task("a1", "A1"), task("a2", "A2")])];
      const updated = updateTaskById(tasks, "a2", (t) => ({ ...t, result: "done" }));
      expect(updated[0]!.subTasks[1]!.result).toBe("done");
    });

    it("returns unchanged tree when id not found", () => {
      const tasks = [task("a", "A")];
      const updated = updateTaskById(tasks, "x", (t) => ({ ...t, status: "completed" as const }));
      expect(updated).toEqual(tasks);
    });
  });

  describe("migrateTasksToHierarchy", () => {
    it("returns empty for non-array", () => {
      expect(migrateTasksToHierarchy(null)).toEqual([]);
      expect(migrateTasksToHierarchy(undefined)).toEqual([]);
      expect(migrateTasksToHierarchy({})).toEqual([]);
    });

    it("migrates legacy flat sub_tasks (no subTasks) to hierarchical", () => {
      const raw = [
        { id: "t1", description: "T1", status: "pending", priority: "medium", dependencies: [] },
      ];
      const result = migrateTasksToHierarchy(raw);
      expect(result).toHaveLength(1);
      expect(result[0]!.subTasks).toEqual([]);
    });

    it("preserves nested structure when subTasks present", () => {
      const raw = [
        {
          id: "a",
          description: "A",
          status: "pending",
          subTasks: [{ id: "a1", description: "A1", status: "pending", subTasks: [] }],
        },
      ];
      const result = migrateTasksToHierarchy(raw);
      expect(result[0]!.subTasks).toHaveLength(1);
      expect(result[0]!.subTasks[0]!.id).toBe("a1");
    });

    it("assigns fallback id and description for missing fields", () => {
      const raw = [{ status: "pending" }];
      const result = migrateTasksToHierarchy(raw);
      expect(result).toHaveLength(1);
      // Missing id → crypto.randomUUID(), missing description → ""
      expect(result[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result[0]!.description).toBe("");
    });

    it("falls back to pending for invalid status", () => {
      const raw = [{ id: "t1", description: "T1", status: "BOGUS_STATUS" }];
      const result = migrateTasksToHierarchy(raw);
      expect(result[0]!.status).toBe("pending");
    });

    it("preserves optional fields (parentId, result, error, capabilityId)", () => {
      const raw = [
        {
          id: "t1",
          description: "T1",
          status: "completed",
          priority: "high",
          parentId: "parent-1",
          result: "success output",
          error: "some error",
          capabilityId: "cap-1",
        },
      ];
      const result = migrateTasksToHierarchy(raw);
      expect(result[0]!.parentId).toBe("parent-1");
      expect(result[0]!.result).toBe("success output");
      expect(result[0]!.error).toBe("some error");
      expect(result[0]!.capabilityId).toBe("cap-1");
    });

    // --- Metadata preservation tests ---

    it("preserves metadata fields through migration", () => {
      const raw = [
        {
          id: "t1",
          description: "Research API",
          status: "pending",
          type: "research",
          acceptanceCriteria: "3 candidates listed",
          expectedOutput: "Comparison table",
          riskLevel: "medium",
          estimatedComplexity: "moderate",
          rationale: "Need alternatives",
        },
      ];
      const result = migrateTasksToHierarchy(raw);
      expect(result[0]!.type).toBe("research");
      expect(result[0]!.acceptanceCriteria).toBe("3 candidates listed");
      expect(result[0]!.expectedOutput).toBe("Comparison table");
      expect(result[0]!.riskLevel).toBe("medium");
      expect(result[0]!.estimatedComplexity).toBe("moderate");
      expect(result[0]!.rationale).toBe("Need alternatives");
    });

    it("omits metadata fields when not present in legacy data", () => {
      const raw = [{ id: "t1", description: "Legacy", status: "pending" }];
      const result = migrateTasksToHierarchy(raw);
      expect(result[0]!.type).toBeUndefined();
      expect(result[0]!.riskLevel).toBeUndefined();
    });
  });

  describe("canTransitionTaskStatus", () => {
    it("allows valid transitions", () => {
      expect(canTransitionTaskStatus("pending", "in_progress")).toBe(true);
      expect(canTransitionTaskStatus("in_progress", "completed")).toBe(true);
      expect(canTransitionTaskStatus("failed", "in_progress")).toBe(true);
    });

    it("blocks invalid transitions", () => {
      expect(canTransitionTaskStatus("completed", "in_progress")).toBe(false);
      expect(canTransitionTaskStatus("cancelled", "pending")).toBe(false);
      expect(canTransitionTaskStatus("planned", "completed")).toBe(false);
    });

    it("returns false for unknown status key", () => {
      expect(canTransitionTaskStatus("UNKNOWN" as never, "pending")).toBe(false);
    });
  });

  describe("validateGoalInvariants", () => {
    it("returns valid for correct tree", () => {
      const goal: Goal = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        description: "Valid",
        status: "planned",
        priority: "medium",
        tasks: [
          {
            id: "550e8400-e29b-41d4-a716-446655440001",
            description: "Root",
            status: "pending",
            priority: "medium",
            dependencies: [],
            subTasks: [
              {
                id: "550e8400-e29b-41d4-a716-446655440002",
                description: "Child",
                status: "pending",
                priority: "medium",
                dependencies: [],
                parentId: "550e8400-e29b-41d4-a716-446655440001",
                subTasks: [],
              },
            ],
          },
        ],
        metadata: {},
        _version: 1,
      };
      const result = validateGoalInvariants(goal);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it("detects duplicate ids and missing dependencies", () => {
      const duplicateId = "550e8400-e29b-41d4-a716-446655440010";
      const goal: Goal = {
        id: "550e8400-e29b-41d4-a716-446655440009",
        description: "Invalid",
        status: "planned",
        priority: "medium",
        tasks: [
          {
            id: duplicateId,
            description: "A",
            status: "pending",
            priority: "medium",
            dependencies: ["550e8400-e29b-41d4-a716-446655440099"],
            subTasks: [],
          },
          {
            id: duplicateId,
            description: "B",
            status: "pending",
            priority: "medium",
            dependencies: [],
            subTasks: [],
          },
        ],
        metadata: {},
        _version: 1,
      };
      const result = validateGoalInvariants(goal);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("Duplicate task IDs"))).toBe(true);
      expect(result.issues.some((i) => i.includes("depends on missing task"))).toBe(true);
    });

    it("detects parentId mismatch in subtask", () => {
      const child = task("550e8400-e29b-41d4-a716-446655440003", "Child");
      child.parentId = "wrong-parent-id";
      const parent = task("550e8400-e29b-41d4-a716-446655440002", "Parent", [], [child]);
      const goal: Goal = {
        id: "550e8400-e29b-41d4-a716-446655440001",
        description: "Test",
        status: "planned",
        priority: "medium",
        tasks: [parent],
        metadata: {},
        _version: 1,
      };
      const result = validateGoalInvariants(goal);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("parentId mismatch"))).toBe(true);
    });
  });
});
