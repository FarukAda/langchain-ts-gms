import { describe, it, expect } from "vitest";
import {
  checkGuardrail,
  requiresHumanApproval,
  evaluateGuardrails,
} from "../../../../src/app/governance/guardrails.js";
import type { Task } from "../../../../src/domain/contracts.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "1",
    description: "Safe task",
    status: "pending",
    priority: "medium",
    dependencies: [],
    subTasks: [],
    ...overrides,
  };
}

describe("guardrails", () => {
  it("allows safe tasks", () => {
    const result = checkGuardrail([makeTask({ description: "Analyze logs" })]);
    expect(result.allowed).toBe(true);
  });

  it("blocks forbidden patterns", () => {
    const result = checkGuardrail([makeTask({ description: "Delete production database" })]);
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toContain("delete production");
  });

  it("blocks custom forbidden patterns", () => {
    const result = checkGuardrail([makeTask({ description: "run my-custom-danger command" })], {
      forbiddenPatterns: ["my-custom-danger"],
    });
    expect(result.allowed).toBe(false);
  });

  it("checks sub-tasks for forbidden patterns", () => {
    const parent = makeTask({
      description: "Safe parent",
      subTasks: [makeTask({ description: "delete production files" })],
    });
    const result = checkGuardrail([parent]);
    expect(result.allowed).toBe(false);
  });

  it("requires human approval for many tasks", () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      makeTask({ id: i.toString(), description: `Task ${i}` }),
    );
    expect(requiresHumanApproval(many)).toBe(true);
  });

  it("does not require human approval for few tasks", () => {
    const few = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: i.toString(), description: `Task ${i}` }),
    );
    expect(requiresHumanApproval(few)).toBe(false);
  });

  it("respects custom maxTaskCount", () => {
    const tasks = Array.from({ length: 3 }, (_, i) =>
      makeTask({ id: i.toString(), description: `Task ${i}` }),
    );
    expect(requiresHumanApproval(tasks, { maxTaskCount: 2 })).toBe(true);
    expect(requiresHumanApproval(tasks, { maxTaskCount: 5 })).toBe(false);
  });

  it("uses pre-flattened tasks when provided", () => {
    const tasks = [makeTask()];
    const preFlat = Array.from({ length: 15 }, (_, i) => makeTask({ id: i.toString() }));
    expect(requiresHumanApproval(tasks, {}, preFlat)).toBe(true);
  });

  // --- Risk-based HITL tests ---

  it("requires human approval for high riskLevel tasks", () => {
    const tasks = [
      makeTask({ id: "1", riskLevel: "high" }),
      makeTask({ id: "2", riskLevel: "low" }),
    ];
    expect(requiresHumanApproval(tasks)).toBe(true);
  });

  it("requires human approval for critical riskLevel tasks", () => {
    const tasks = [makeTask({ id: "1", riskLevel: "critical" })];
    expect(requiresHumanApproval(tasks)).toBe(true);
  });

  it("does NOT require human approval for low/medium riskLevel tasks", () => {
    const tasks = [
      makeTask({ id: "1", riskLevel: "low" }),
      makeTask({ id: "2", riskLevel: "medium" }),
      makeTask({ id: "3" }), // no riskLevel (undefined)
    ];
    expect(requiresHumanApproval(tasks)).toBe(false);
  });
});

describe("evaluateGuardrails", () => {
  it("returns allowed + no approval for safe, small plan", () => {
    const tasks = [
      makeTask({ id: "1", description: "Plan A" }),
      makeTask({ id: "2", description: "Plan B" }),
    ];
    const result = evaluateGuardrails(tasks);
    expect(result.check.allowed).toBe(true);
    expect(result.needsHumanApproval).toBe(false);
    expect(result.flatCount).toBe(2);
  });

  it("returns allowed + needs approval for many tasks", () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      makeTask({ id: i.toString(), description: `Task ${i}` }),
    );
    const result = evaluateGuardrails(tasks);
    expect(result.check.allowed).toBe(true);
    expect(result.needsHumanApproval).toBe(true);
    expect(result.flatCount).toBe(12);
  });

  it("returns blocked + no approval when forbidden pattern detected", () => {
    const tasks = [makeTask({ description: "delete production DB" })];
    const result = evaluateGuardrails(tasks);
    expect(result.check.allowed).toBe(false);
    expect(result.needsHumanApproval).toBe(false);
  });

  it("respects custom guard and approval options", () => {
    const tasks = [
      makeTask({ id: "1", description: "Safe" }),
      makeTask({ id: "2", description: "Also safe" }),
      makeTask({ id: "3", description: "Still safe" }),
    ];
    const result = evaluateGuardrails(tasks, {}, { maxTaskCount: 2 });
    expect(result.check.allowed).toBe(true);
    expect(result.needsHumanApproval).toBe(true);
  });

  it("counts sub-tasks in flatCount", () => {
    const tasks = [
      makeTask({
        id: "1",
        subTasks: [makeTask({ id: "1a" }), makeTask({ id: "1b" })],
      }),
      makeTask({ id: "2" }),
    ];
    const result = evaluateGuardrails(tasks);
    expect(result.flatCount).toBe(4);
  });
});
