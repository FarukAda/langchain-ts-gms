import { z } from "zod/v4";

/** Task status in the execution lifecycle */
export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "planned",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Priority for scheduling and ordering */
export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

/** Task type for research-then-action planning (OASF-aligned) */
export const TaskTypeSchema = z.enum([
  "research", // Gather information before acting
  "action", // Concrete executable step
  "validation", // Verify a previous task's result
  "decision", // Choose between alternatives
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

/** Risk level for HITL gating */
export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/** Estimated complexity for timeout/budget management */
export const ComplexitySchema = z.enum(["trivial", "simple", "moderate", "complex"]);
export type Complexity = z.infer<typeof ComplexitySchema>;

/** Recursive task: can have nested sub-tasks for hierarchical decomposition */
export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dependencies: string[];
  parentId?: string | undefined;
  subTasks: Task[];
  result?: string | undefined;
  error?: string | undefined;
  capabilityId?: string | undefined;
  /** ISO datetime when this task was marked as completed. */
  completedAt?: string | undefined;
  // --- Rich metadata ---
  type?: TaskType | undefined;
  acceptanceCriteria?: string | undefined;
  expectedOutput?: string | undefined;
  riskLevel?: RiskLevel | undefined;
  estimatedComplexity?: Complexity | undefined;
  rationale?: string | undefined;
  /** Consumer-defined custom fields from customTaskSchema. */
  customFields?: Record<string, unknown> | undefined;
  // --- Data-flow routing ---
  /** Named inputs this task expects from upstream tasks. */
  expectedInputs?: string[] | undefined;
  /** Named outputs this task produces for downstream tasks. */
  providedOutputs?: string[] | undefined;
}

export const TaskSchema = z.object({
  id: z.uuid(),
  description: z.string().min(1),
  status: TaskStatusSchema,
  priority: PrioritySchema.default("medium"),
  dependencies: z.array(z.uuid()).default([]),
  parentId: z.uuid().optional(),
  get subTasks(): z.ZodDefault<z.ZodArray<typeof TaskSchema>> {
    return z.array(TaskSchema).default([]);
  },
  result: z.string().optional(),
  error: z.string().optional(),
  capabilityId: z.string().optional(),
  completedAt: z.iso.datetime({ offset: true }).optional().meta({
    description: "ISO datetime when this task was marked as completed",
  }),
  // --- Rich metadata ---
  type: TaskTypeSchema.optional().meta({
    description: "Task type: research, action, validation, or decision",
  }),
  acceptanceCriteria: z.string().optional().meta({ description: "How to know this task is done" }),
  expectedOutput: z
    .string()
    .optional()
    .meta({ description: "What this task produces for downstream tasks" }),
  riskLevel: RiskLevelSchema.optional().meta({ description: "Risk level for HITL gating" }),
  estimatedComplexity: ComplexitySchema.optional().meta({ description: "Estimated effort" }),
  rationale: z.string().optional().meta({ description: "Why this task exists in the plan" }),
  customFields: z.record(z.string(), z.unknown()).optional().meta({
    description: "Consumer-defined custom fields from customTaskSchema",
  }),
  // --- Data-flow routing ---
  expectedInputs: z.array(z.string()).optional().meta({
    description: "Named inputs this task expects from upstream tasks' providedOutputs",
  }),
  providedOutputs: z.array(z.string()).optional().meta({
    description: "Named outputs this task produces for downstream tasks' expectedInputs",
  }),
});

/** Top-level goal with optional parent (for sub-goals). Uses hierarchical tasks. */
export const GoalSchema = z.object({
  id: z.uuid(),
  description: z.string().min(1),
  status: TaskStatusSchema,
  priority: PrioritySchema.default("medium"),
  tasks: z.array(TaskSchema).default([]),
  parentGoal: z.object({ id: z.uuid() }).optional(),
  tenantId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  /** Optimistic-lock version counter. Incremented on every successful write. */
  _version: z.number().int().min(1).default(1),
});
export type Goal = z.infer<typeof GoalSchema>;

/** Versioned Capability Vector - describes an agent/tool capability for semantic matching */
export const CapabilityVectorSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  version: z.string().default("1.0.0"),
  cost: z.number().min(0).optional(),
  constraints: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CapabilityVector = z.infer<typeof CapabilityVectorSchema>;

/** Response contract version stamped on all GMS tool outputs. */
export const RESPONSE_CONTRACT_VERSION = "1.0";
