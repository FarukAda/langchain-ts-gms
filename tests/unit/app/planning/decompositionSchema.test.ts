import { describe, it, expect } from "vitest";
import {
  DecompositionOutputSchema,
} from "../../../../src/app/planning/decompositionSchema.js";

describe("decompositionSchema", () => {
  describe("DecompositionOutputSchema", () => {
    it("parses valid output with two tasks", () => {
      const result = DecompositionOutputSchema.parse({
        tasks: [
          { description: "Task A", priority: "high" },
          { description: "Task B", priority: "low" },
        ],
      });
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0]!.description).toBe("Task A");
      expect(result.tasks[0]!.priority).toBe("high");
    });

    it("applies default subTasks ([])", () => {
      const result = DecompositionOutputSchema.parse({
        tasks: [
          { description: "Task A", priority: "medium" },
          { description: "Task B", priority: "low" },
        ],
      });
      expect(result.tasks[0]!.subTasks).toEqual([]);
      expect(result.tasks[1]!.subTasks).toEqual([]);
    });

    it("rejects single-task array (min 2)", () => {
      expect(() =>
        DecompositionOutputSchema.parse({
          tasks: [{ description: "Only one", priority: "medium" }],
        }),
      ).toThrow();
    });

    it("rejects empty tasks array (min 2)", () => {
      expect(() =>
        DecompositionOutputSchema.parse({
          tasks: [],
        }),
      ).toThrow();
    });

    it("rejects missing description", () => {
      expect(() =>
        DecompositionOutputSchema.parse({
          tasks: [
            { priority: "high" },
            { description: "Task B", priority: "medium" },
          ],
        }),
      ).toThrow();
    });

    it("parses recursive subTasks", () => {
      const result = DecompositionOutputSchema.parse({
        tasks: [
          {
            description: "Parent",
            priority: "high",
            subTasks: [
              {
                description: "Child 1",
                priority: "medium",
                subTasks: [{ description: "Grandchild", priority: "low" }],
              },
            ],
          },
          { description: "Sibling", priority: "medium" },
        ],
      });
      expect(result.tasks[0]!.subTasks).toHaveLength(1);
      expect(result.tasks[0]!.subTasks[0]!.subTasks).toHaveLength(1);
      expect(result.tasks[0]!.subTasks[0]!.subTasks[0]!.description).toBe(
        "Grandchild",
      );
    });

    it("rejects invalid priority value", () => {
      expect(() =>
        DecompositionOutputSchema.parse({
          tasks: [
            { description: "Task A", priority: "urgent" },
            { description: "Task B", priority: "medium" },
          ],
        }),
      ).toThrow();
    });

    it("rejects missing tasks field entirely", () => {
      expect(() => DecompositionOutputSchema.parse({})).toThrow();
    });

    // --- Metadata tests ---

    it("applies default metadata when fields are omitted", () => {
      const result = DecompositionOutputSchema.parse({
        tasks: [
          { description: "Task A", priority: "high" },
          { description: "Task B", priority: "low" },
        ],
      });
      expect(result.tasks[0]!.type).toBe("action");
      expect(result.tasks[0]!.riskLevel).toBe("low");
      expect(result.tasks[0]!.estimatedComplexity).toBe("simple");
      expect(result.tasks[0]!.acceptanceCriteria).toBeUndefined();
      expect(result.tasks[0]!.rationale).toBeUndefined();
    });

    it("preserves explicit metadata through parsing", () => {
      const result = DecompositionOutputSchema.parse({
        tasks: [
          {
            description: "Research task",
            priority: "high",
            type: "research",
            acceptanceCriteria: "3 options listed",
            expectedOutput: "Comparison table",
            riskLevel: "medium",
            estimatedComplexity: "complex",
            rationale: "Must research before acting",
          },
          { description: "Task B", priority: "low" },
        ],
      });
      expect(result.tasks[0]!.type).toBe("research");
      expect(result.tasks[0]!.riskLevel).toBe("medium");
      expect(result.tasks[0]!.rationale).toBe("Must research before acting");
    });

    it("applies defaults recursively in subTasks", () => {
      const result = DecompositionOutputSchema.parse({
        tasks: [
          {
            description: "Parent",
            priority: "high",
            type: "decision",
            subTasks: [
              { description: "Child", priority: "medium" },
            ],
          },
          { description: "Sibling", priority: "low" },
        ],
      });
      const child = result.tasks[0]!.subTasks[0]!;
      expect(child.type).toBe("action");
      expect(child.riskLevel).toBe("low");
    });
  });
});
