import { z } from "zod/v4";

/**
 * Planning tool input schema.
 * Supports common alias fields to increase real-world agent tool-calling robustness.
 * All optional fields accept null (local LLMs may emit null for omitted params).
 */
export const GmsToolInputSchema = z
  .object({
    goalDescription: z.string().min(1).nullable().optional().meta({
      description:
        "Natural-language description of the objective to plan. Be specific: include what needs to be done, any constraints, and success criteria.",
    }),
    description: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .meta({ description: "Alias for goalDescription" }),
    goal: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .meta({ description: "Alias for goalDescription" }),
    goal_description: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .meta({ description: "Alias for goalDescription (snake_case variant)" }),
    input: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .meta({ description: "Alias for goalDescription" }),
    query: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .meta({ description: "Alias for goalDescription" }),
    priority: z.enum(["low", "medium", "high", "critical"]).nullable().optional().meta({
      description:
        "Goal priority level. Affects task ordering. Values: low, medium (default), high, critical",
    }),
    tenantId: z
      .string()
      .nullable()
      .optional()
      .meta({ description: "Tenant identifier for multi-tenancy isolation" }),
    metadata: z.record(z.string(), z.unknown()).nullable().optional().meta({
      description:
        "Arbitrary key-value metadata to attach to the goal. Pass as { key: value } object.",
    }),
    traceId: z.string().nullable().optional().meta({
      description:
        "Correlation ID for distributed tracing. Optional. Pass to correlate this planning request with external systems.",
    }),
  })
  .refine(
    (v) =>
      [v.goalDescription, v.description, v.goal, v.goal_description, v.input, v.query].some(
        (s) => typeof s === "string" && s.trim().length > 0,
      ),
    {
      error: "Provide one of: goalDescription, description, goal, goal_description, input, query",
    },
  );
