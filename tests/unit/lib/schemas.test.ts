import { describe, it, expect } from "vitest";
import { toJSONSchema } from "zod/v4/core";
import { GmsToolInputSchema } from "../../../src/lib/schemas/planningSchemas.js";
import {
  GetGoalInputSchema,
  UpdateGoalInputSchema,
  UpdateTaskInputSchema,
  ValidateGoalTreeInputSchema,
  GetProgressInputSchema,
  GetTaskInputSchema,
  ListTasksInputSchema,
  SearchTasksInputSchema,
  ListGoalsInputSchema,
  ReplanGoalInputSchema,
  coerceLifecycleInput,
} from "../../../src/lib/schemas/lifecycleSchemas.js";

describe("planningSchemas", () => {
  describe("GmsToolInputSchema", () => {
    it("accepts goalDescription", () => {
      const result = GmsToolInputSchema.parse({ goalDescription: "Test" });
      expect(result.goalDescription).toBe("Test");
    });

    it("accepts alias fields", () => {
      expect(() => GmsToolInputSchema.parse({ description: "Test" })).not.toThrow();
      expect(() => GmsToolInputSchema.parse({ goal: "Test" })).not.toThrow();
      expect(() => GmsToolInputSchema.parse({ input: "Test" })).not.toThrow();
      expect(() => GmsToolInputSchema.parse({ query: "Test" })).not.toThrow();
      expect(() => GmsToolInputSchema.parse({ goal_description: "Test" })).not.toThrow();
    });

    it("rejects when no description alias is provided", () => {
      expect(() => GmsToolInputSchema.parse({})).toThrow();
      expect(() => GmsToolInputSchema.parse({ priority: "high" })).toThrow();
    });

    it("rejects empty/whitespace-only description", () => {
      expect(() => GmsToolInputSchema.parse({ goalDescription: "   " })).toThrow();
    });

    it("accepts optional priority and metadata", () => {
      const result = GmsToolInputSchema.parse({
        goalDescription: "Test",
        priority: "critical",
        metadata: { key: "val" },
        traceId: "t-123",
      });
      expect(result.priority).toBe("critical");
      expect(result.metadata).toEqual({ key: "val" });
      expect(result.traceId).toBe("t-123");
    });
  });
});

describe("JSON Schema conversion", () => {
  const schemas = [
    ["GmsToolInputSchema", GmsToolInputSchema],
    ["GetGoalInputSchema", GetGoalInputSchema],
    ["UpdateGoalInputSchema", UpdateGoalInputSchema],
    ["UpdateTaskInputSchema", UpdateTaskInputSchema],
    ["ValidateGoalTreeInputSchema", ValidateGoalTreeInputSchema],
    ["GetProgressInputSchema", GetProgressInputSchema],
    ["GetTaskInputSchema", GetTaskInputSchema],
    ["ListTasksInputSchema", ListTasksInputSchema],
    ["SearchTasksInputSchema", SearchTasksInputSchema],
    ["ListGoalsInputSchema", ListGoalsInputSchema],
    ["ReplanGoalInputSchema", ReplanGoalInputSchema],
  ] as const;

  it.each(schemas)("%s produces valid JSON Schema without throwing", (_name, schema) => {
    expect(() => toJSONSchema(schema)).not.toThrow();
  });
});

describe("lifecycleSchemas", () => {
  const validUuid = "550e8400-e29b-41d4-a716-446655440000";

  describe("GetGoalInputSchema", () => {
    it("accepts valid UUID", () => {
      expect(GetGoalInputSchema.parse({ goalId: validUuid }).goalId).toBe(validUuid);
    });

    it("rejects non-UUID", () => {
      expect(() => GetGoalInputSchema.parse({ goalId: "not-a-uuid" })).toThrow();
    });
  });

  describe("UpdateGoalInputSchema", () => {
    it("accepts goalId with optional fields", () => {
      const result = UpdateGoalInputSchema.parse({
        goalId: validUuid,
        status: "completed",
        priority: "high",
      });
      expect(result.status).toBe("completed");
      expect(result.priority).toBe("high");
    });

    it("rejects invalid status", () => {
      expect(() => UpdateGoalInputSchema.parse({ goalId: validUuid, status: "invalid" })).toThrow();
    });
  });

  describe("UpdateTaskInputSchema", () => {
    it("requires both goalId and taskId", () => {
      expect(() => UpdateTaskInputSchema.parse({ goalId: validUuid })).toThrow();
    });

    it("accepts valid input", () => {
      const result = UpdateTaskInputSchema.parse({
        goalId: validUuid,
        taskId: validUuid,
        status: "in_progress",
        result: "partial",
      });
      expect(result.status).toBe("in_progress");
    });
  });

  describe("ListTasksInputSchema", () => {
    it("applies defaults", () => {
      const result = ListTasksInputSchema.parse({ goalId: validUuid });
      expect(result.includeSubTasks).toBe(true);
      expect(result.flat).toBe(true);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });
  });

  describe("SearchTasksInputSchema", () => {
    it("accepts query with filters", () => {
      const result = SearchTasksInputSchema.parse({
        goalId: validUuid,
        query: "deploy",
        status: ["pending", "in_progress"],
        hasDependencies: true,
      });
      expect(result.query).toBe("deploy");
      expect(result.status).toEqual(["pending", "in_progress"]);
    });
  });

  describe("ListGoalsInputSchema", () => {
    it("accepts optional filters", () => {
      const result = ListGoalsInputSchema.parse({
        status: "planned",
        limit: 20,
      });
      expect(result.status).toBe("planned");
      expect(result.limit).toBe(20);
    });
  });

  describe("ReplanGoalInputSchema", () => {
    it("defaults strategy to append", () => {
      const result = ReplanGoalInputSchema.parse({ goalId: validUuid });
      expect(result.strategy).toBe("append");
    });

    it("accepts nested decomposeOptions", () => {
      const result = ReplanGoalInputSchema.parse({
        goalId: validUuid,
        strategy: "replace_all",
        decomposeOptions: { topK: 5, maxDepth: 2 },
      });
      expect(result.decomposeOptions?.topK).toBe(5);
    });

    it("rejects invalid strategy", () => {
      expect(() =>
        ReplanGoalInputSchema.parse({
          goalId: validUuid,
          strategy: "invalid_strategy",
        }),
      ).toThrow();
    });
  });

  describe("coerceLifecycleInput edge cases", () => {
    it("converts string 'null' to null", () => {
      const result = coerceLifecycleInput({ limit: "null" });
      expect(result.limit).toBeNull();
    });

    it("coerces decomposeOptions recursively", () => {
      const result = coerceLifecycleInput({
        decomposeOptions: { topK: "5", maxDepth: "3" },
      });
      expect((result.decomposeOptions as unknown as { topK: number }).topK).toBe(5);
      expect((result.decomposeOptions as unknown as { maxDepth: number }).maxDepth).toBe(3);
    });

    it("treats decomposeOptions 'null' as null", () => {
      const result = coerceLifecycleInput({ decomposeOptions: "null" });
      expect(result.decomposeOptions).toBeNull();
    });

    it("cleans array fields with 'null' string values", () => {
      const result = coerceLifecycleInput({ status: ["pending", "null", ""] });
      expect(result.status).toEqual(["pending"]);
    });

    it("converts empty array field to undefined", () => {
      const result = coerceLifecycleInput({ status: ["null", ""] });
      expect(result.status).toBeUndefined();
    });

    it("wraps single string status to array", () => {
      const result = coerceLifecycleInput({ status: "pending" });
      expect(result.status).toEqual(["pending"]);
    });

    it("converts empty or 'undefined' string status to undefined", () => {
      expect(coerceLifecycleInput({ status: "" }).status).toBeUndefined();
      expect(coerceLifecycleInput({ status: "undefined" }).status).toBeUndefined();
    });

    it("handles non-finite int as undefined", () => {
      const result = coerceLifecycleInput({ limit: "abc" });
      expect(result.limit).toBeUndefined();
    });

    it("coerces boolean strings (yes/no/on/off)", () => {
      expect(coerceLifecycleInput({ includeSubTasks: "yes" }).includeSubTasks).toBe(true);
      expect(coerceLifecycleInput({ includeSubTasks: "no" }).includeSubTasks).toBe(false);
      expect(coerceLifecycleInput({ flat: "on" }).flat).toBe(true);
      expect(coerceLifecycleInput({ flat: "off" }).flat).toBe(false);
    });

    it("wraps single string priority to array", () => {
      const result = coerceLifecycleInput({ priority: "high" });
      expect(result.priority).toEqual(["high"]);
    });
  });

  describe("ListGoalsInputSchema extended", () => {
    it("accepts query and tenantId", () => {
      const result = ListGoalsInputSchema.parse({
        query: "cloud",
        tenantId: "t-1",
        limit: 5,
        offset: 0,
      });
      expect(result.query).toBe("cloud");
      expect(result.tenantId).toBe("t-1");
    });

    it("defaults limit and offset", () => {
      const result = ListGoalsInputSchema.parse({});
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it("passes through non-object decomposeOptions unchanged", () => {
      const result = coerceLifecycleInput({ decomposeOptions: 42 });
      expect(result.decomposeOptions).toBe(42);
    });

    it("coerces string 'null' decomposeOptions to null via early handler", () => {
      // L168-171: the generic "null" → null handler runs before L216
      const result = coerceLifecycleInput({ decomposeOptions: "null" });
      expect(result.decomposeOptions).toBeNull();
    });

    it("coerces null decomposeOptions to undefined", () => {
      const result = coerceLifecycleInput({ decomposeOptions: null });
      expect(result.decomposeOptions).toBeUndefined();
    });
  });
});
