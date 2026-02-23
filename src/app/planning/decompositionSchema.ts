import { z } from "zod/v4";
import {
  PrioritySchema,
  TaskTypeSchema,
  RiskLevelSchema,
  ComplexitySchema,
} from "../../domain/contracts.js";

/**
 * Schema for a single decomposed task produced by the LLM.
 * Uses a getter with an explicit return type for the recursive `subTasks`
 * field (Zod v4 recursive object pattern).
 *
 * Fields with `.default()` use the pattern `.default().meta()` (no `.optional()`):
 * - `.default()` alone makes input optional and output required
 * - `.meta()` must appear last for `z.toJSONSchema()` to pick up descriptions
 * - Zod defaults act as structural fallback if the LLM omits the field
 */
const DecomposedTaskSchema = z.object({
  description: z
    .string()
    .meta({ description: "Clear, actionable task description (one sentence)" }),
  priority: PrioritySchema.meta({ description: "Task priority: low, medium, high, or critical" }),
  type: TaskTypeSchema.default("action").meta({
    description:
      "Task type: research (gather info), action (execute), validation (verify), or decision (choose)",
  }),
  acceptanceCriteria: z.string().optional().meta({
    description: "How to know this task is done. E.g. 'API returns 200 with valid JWT'",
  }),
  expectedOutput: z.string().optional().meta({
    description:
      "What this task produces for downstream tasks. E.g. 'List of framework candidates with pros/cons'",
  }),
  riskLevel: RiskLevelSchema.default("low").meta({
    description: "Risk level for HITL gating: low, medium, high, or critical",
  }),
  estimatedComplexity: ComplexitySchema.default("simple").meta({
    description: "Estimated effort: trivial, simple, moderate, or complex",
  }),
  rationale: z.string().optional().meta({
    description: "Why this task exists in the plan — what knowledge gap or action it addresses",
  }),
  get subTasks(): z.ZodDefault<z.ZodArray<typeof DecomposedTaskSchema>> {
    return z.array(DecomposedTaskSchema).default([]).meta({
      description: "Further breakdown if this task is still complex; leave empty for atomic tasks",
    });
  },
});

export type DecomposedTask = z.infer<typeof DecomposedTaskSchema>;

/**
 * Top-level schema returned by the LLM when decomposing a goal.
 * Used with `model.withStructuredOutput(DecompositionOutputSchema)`.
 */
export const DecompositionOutputSchema = z.object({
  tasks: z
    .array(DecomposedTaskSchema)
    .min(2)
    .meta({
      description:
        "Top-level tasks needed to accomplish the goal. " +
        "Break the goal into at least 2 clear, actionable steps. " +
        "Each task may have subTasks for further breakdown.",
    }),
});

export type DecompositionOutput = z.infer<typeof DecompositionOutputSchema>;
