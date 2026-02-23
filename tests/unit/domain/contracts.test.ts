import { describe, it, expect } from "vitest";
import {
  GoalSchema,
  TaskSchema,
  CapabilityVectorSchema,
  TaskStatusSchema,
  TaskTypeSchema,
  RiskLevelSchema,
  ComplexitySchema,
  RESPONSE_CONTRACT_VERSION,
} from "../../../src/domain/contracts.js";

describe("domain contracts", () => {
  it("validates Task", () => {
    const task = TaskSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      description: "Analyze logs",
      status: "pending",
    });
    expect(task.priority).toBe("medium");
    expect(task.dependencies).toEqual([]);
    expect(task.subTasks).toEqual([]);
  });

  it("validates Goal with hierarchical tasks", () => {
    const goal = GoalSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440001",
      description: "Optimize cloud spend",
      status: "pending",
    });
    expect(goal.tasks).toEqual([]);
  });

  it("validates CapabilityVector", () => {
    const cap = CapabilityVectorSchema.parse({
      id: "log-analyzer",
      description: "Analyzes log files for anomalies",
    });
    expect(cap.version).toBe("1.0.0");
  });

  it("rejects invalid TaskStatus", () => {
    expect(() => TaskStatusSchema.parse("invalid")).toThrow();
  });

  // --- New metadata tests ---

  it("validates TaskTypeSchema enum values", () => {
    expect(TaskTypeSchema.parse("research")).toBe("research");
    expect(TaskTypeSchema.parse("action")).toBe("action");
    expect(TaskTypeSchema.parse("validation")).toBe("validation");
    expect(TaskTypeSchema.parse("decision")).toBe("decision");
    expect(() => TaskTypeSchema.parse("unknown")).toThrow();
  });

  it("validates RiskLevelSchema enum values", () => {
    expect(RiskLevelSchema.parse("low")).toBe("low");
    expect(RiskLevelSchema.parse("critical")).toBe("critical");
    expect(() => RiskLevelSchema.parse("extreme")).toThrow();
  });

  it("validates ComplexitySchema enum values", () => {
    expect(ComplexitySchema.parse("trivial")).toBe("trivial");
    expect(ComplexitySchema.parse("complex")).toBe("complex");
    expect(() => ComplexitySchema.parse("impossible")).toThrow();
  });

  it("parses TaskSchema with all new metadata fields", () => {
    const task = TaskSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      description: "Research API options",
      status: "pending",
      type: "research",
      acceptanceCriteria: "List of 3+ API candidates",
      expectedOutput: "Comparison table",
      riskLevel: "low",
      estimatedComplexity: "moderate",
      rationale: "Need to evaluate alternatives",
    });
    expect(task.type).toBe("research");
    expect(task.riskLevel).toBe("low");
  });

  it("parses TaskSchema without new fields (backward compatibility)", () => {
    const task = TaskSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      description: "Legacy task",
      status: "completed",
    });
    expect(task.type).toBeUndefined();
    expect(task.riskLevel).toBeUndefined();
    expect(task.estimatedComplexity).toBeUndefined();
  });

  it("reports v1.0 contract version", () => {
    expect(RESPONSE_CONTRACT_VERSION).toBe("1.0");
  });
});
