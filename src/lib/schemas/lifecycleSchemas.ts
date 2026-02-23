import { z } from "zod/v4";
import { TaskStatusSchema, PrioritySchema, TaskTypeSchema } from "../../domain/contracts.js";

/** Default page size for list/search pagination. */
export const DEFAULT_PAGE_LIMIT = 50;
/** Maximum page size for list/search pagination. */
export const MAX_PAGE_LIMIT = 200;

/* -------------------------------------------------------------------------- */
/*  JSON Schema–safe schemas                                                  */
/*                                                                            */
/*  These schemas avoid `z.coerce.*`, `z.stringbool()`, `.catch()`, and       */
/*  `.transform()` which all create pipe/transform nodes that Zod v4's        */
/*  `toJSONSchema()` refuses to serialize.                                    */
/*                                                                            */
/*  Boolean and numeric fields use union types (e.g. boolean | string) so     */
/*  that LLMs sending strings ("true", "10", "null") still pass Zod parsing.  */
/*  `coerceLifecycleInput()` normalizes values BEFORE schema parsing so the   */
/*  proper branch of each union matches.                                      */
/* -------------------------------------------------------------------------- */

/** Boolean that also accepts string representations (for JSON Schema compat). */
const laxBool = z.union([z.boolean(), z.string()]);

/** Integer that also accepts string representations (for JSON Schema compat). */
const laxInt = z.union([z.number().int(), z.string()]);

/** Float that also accepts string representations (for JSON Schema compat). */
const laxFloat = z.union([z.number(), z.string()]);

/**
 * Array that also accepts a single string value (for LLM compat).
 * LLMs frequently send "null" instead of null, or a single status string
 * instead of an array.  The union lets Zod validation pass; the actual
 * coercion to a proper array happens in `coerceLifecycleInput`.
 */
const laxStatusArray = z.union([z.array(TaskStatusSchema), z.string()]).nullable().optional();
const laxPriorityArray = z.union([z.array(PrioritySchema), z.string()]).nullable().optional();
const laxTaskTypeArray = z.union([z.array(TaskTypeSchema), z.string()]).nullable().optional();

export const GetGoalInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the goal to retrieve" }),
});

export const UpdateGoalInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the goal to update" }),
  description: z.string().min(1).nullable().optional().meta({ description: "New goal description. Must be non-empty if provided." }),
  status: TaskStatusSchema.nullable().optional().meta({ description: "New goal status. Valid: pending, in_progress, completed, failed, cancelled, planned. Must follow valid transitions." }),
  priority: PrioritySchema.nullable().optional().meta({ description: "New goal priority" }),
  metadata: z.union([
    z.string().meta({ description: "JSON-encoded metadata object (will be parsed)" }),
    z.record(z.string(), z.unknown()),
  ]).nullable().optional().meta({ description: "Arbitrary metadata key-value pairs. Pass as a JSON object or a JSON-encoded string. Merges with existing metadata." }),
  tenantId: z.string().nullable().optional().meta({ description: "Tenant identifier for multi-tenancy" }),
});

export const UpdateTaskInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the parent goal" }),
  taskId: z.uuid().meta({ description: "UUID of the task to update" }),
  status: TaskStatusSchema.nullable().optional().meta({ description: "New task status. Valid: pending, in_progress, completed, failed, cancelled. Must follow valid transitions." }),
  result: z.string().nullable().optional().meta({ description: "Task result or output text. Set this when marking status as 'completed'." }),
  error: z.string().nullable().optional().meta({ description: "Error message describing why the task failed. Set this when marking status as 'failed'." }),
});

export const ValidateGoalTreeInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the goal whose task tree to validate" }),
});

export const GetProgressInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the goal to get progress for" }),
});

export const GetTaskInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the parent goal" }),
  taskId: z.uuid().meta({ description: "UUID of the task to retrieve" }),
});

export const ListTasksInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the parent goal" }),
  status: laxStatusArray
    .meta({ description: "Filter by task statuses" }),
  priority: laxPriorityArray
    .meta({ description: "Filter by priority levels" }),
  type: laxTaskTypeArray
    .meta({ description: "Filter by task types (research/action/validation/decision)" }),
  includeSubTasks: laxBool.nullable().optional().default(true)
    .meta({ description: "If true (default), includes nested sub-tasks when flat=true. Ignored when flat=false." }),
  flat: laxBool.nullable().optional().default(true)
    .meta({ description: "If true (default), returns tasks as a flat list. If false, returns nested tree structure." }),
  limit: laxInt.nullable().optional().default(DEFAULT_PAGE_LIMIT)
    .meta({ description: "Maximum number of tasks to return" }),
  offset: laxInt.nullable().optional().default(0)
    .meta({ description: "Number of tasks to skip for pagination" }),
});

export const SearchTasksInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the parent goal" }),
  query: z.string().nullable().optional()
    .meta({ description: "Text query to match against task descriptions, results, and errors" }),
  status: laxStatusArray
    .meta({ description: "Filter by task statuses" }),
  priority: laxPriorityArray
    .meta({ description: "Filter by priority levels" }),
  type: laxTaskTypeArray
    .meta({ description: "Filter by task types (research/action/validation/decision)" }),
  hasDependencies: laxBool.nullable().optional()
    .meta({ description: "Filter tasks by dependency status. true = only tasks with dependencies; false = only independent tasks." }),
  limit: laxInt.nullable().optional().default(DEFAULT_PAGE_LIMIT)
    .meta({ description: "Maximum number of tasks to return" }),
  offset: laxInt.nullable().optional().default(0)
    .meta({ description: "Number of tasks to skip for pagination" }),
});

export const ListGoalsInputSchema = z.object({
  status: TaskStatusSchema.nullable().optional()
    .meta({ description: "Filter goals by status" }),
  priority: PrioritySchema.nullable().optional()
    .meta({ description: "Filter goals by priority" }),
  tenantId: z.string().nullable().optional()
    .meta({ description: "Filter goals by tenant identifier" }),
  query: z.string().nullable().optional()
    .meta({ description: "Semantic similarity search query. When provided, goals are ranked by description similarity instead of listed chronologically." }),
  limit: laxInt.nullable().optional().default(DEFAULT_PAGE_LIMIT)
    .meta({ description: "Maximum number of goals to return" }),
  offset: laxInt.nullable().optional().default(0)
    .meta({ description: "Number of goals to skip for pagination" }),
});

export const ReplanGoalInputSchema = z.object({
  goalId: z.uuid().meta({ description: "UUID of the goal to replan" }),
  strategy: z.enum(["append", "replace_failed", "replace_all"]).nullable().optional().default("append")
    .meta({ description: "How to merge new tasks with existing ones. 'append' (default): keep all existing, add new. 'replace_failed': remove failed tasks, add new. 'replace_all': discard all existing, generate fresh plan." }),
  decomposeOptions: z
    .object({
      topK: laxInt.nullable().optional(),
      maxDepth: laxInt.nullable().optional(),
      minScoreForLeaf: laxFloat.nullable().optional(),
      maxDescriptionLength: laxInt.nullable().optional(),
    })
    .nullable()
    .optional(),
});

/* -------------------------------------------------------------------------- */
/*  Runtime coercion helper                                                   */
/*                                                                            */
/*  LLMs sometimes send booleans as strings ("true"/"false", "1"/"0",         */
/*  "yes"/"no") and numbers as strings ("100") or even "null".                */
/*  This helper normalizes the raw input BEFORE Zod schema parsing so that    */
/*  the JSON Schema–safe schemas above can still accept messy LLM output.     */
/* -------------------------------------------------------------------------- */

const BOOL_TRUE = new Set(["true", "1", "yes", "on"]);
const BOOL_FALSE = new Set(["false", "0", "no", "off"]);

const BOOL_FIELDS = new Set(["includeSubTasks", "flat", "hasDependencies"]);
const INT_FIELDS = new Set(["limit", "offset", "topK", "maxDepth", "maxDescriptionLength"]);
const FLOAT_FIELDS = new Set(["minScoreForLeaf"]);
const ARRAY_FIELDS = new Set(["status", "priority", "type"]);

/**
 * Coerce LLM-sent string booleans / string numbers in raw tool input.
 * Returns a shallow copy with coerced values; the original is not mutated.
 *
 * Apply to tool inputs containing laxBool / laxInt / laxFloat fields (e.g.
 * ListTasks, SearchTasks, ListGoals, ReplanGoal). Tools whose schemas only
 * declare uuid / string / enum inputs (e.g. GetGoal, GetTask, UpdateTask)
 * can use {@link stripNulls} alone.
 */
export function coerceLifecycleInput<T extends Record<string, unknown>>(raw: T): T {
  const out: Record<string, unknown> = { ...raw };

  for (const key of Object.keys(out)) {
    const val = out[key];

    // Treat the string "null" the same as actual null
    if (val === "null") {
      out[key] = null;
      continue;
    }

    // Coerce string values for array fields (status, priority)
    // LLMs may send a single string value instead of an array,
    // e.g. "pending" instead of ["pending"].
    if (ARRAY_FIELDS.has(key) && typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed === "" || trimmed === "undefined") {
        out[key] = undefined;
      } else {
        out[key] = [trimmed];
      }
      continue;
    }

    // Clean array fields that contain "null" strings or empty strings
    if (ARRAY_FIELDS.has(key) && Array.isArray(val)) {
      const cleaned = (val as unknown[]).filter(
        (v) => v !== null && v !== "null" && v !== "",
      );
      out[key] = cleaned.length > 0 ? cleaned : undefined;
      continue;
    }

    if (BOOL_FIELDS.has(key) && typeof val === "string") {
      const s = val.toLowerCase().trim();
      if (BOOL_TRUE.has(s)) out[key] = true;
      else if (BOOL_FALSE.has(s)) out[key] = false;
      continue;
    }

    if (INT_FIELDS.has(key) && typeof val === "string") {
      const n = Number(val);
      out[key] = Number.isFinite(n) ? Math.trunc(n) : undefined;
      continue;
    }

    if (FLOAT_FIELDS.has(key) && typeof val === "string") {
      const n = Number(val);
      out[key] = Number.isFinite(n) ? n : undefined;
      continue;
    }

    // Recurse one level into decomposeOptions
    if (key === "decomposeOptions") {
      if (val === "null" || val === null) {
        out[key] = undefined;
        continue;
      }
      if (typeof val === "object" && !Array.isArray(val)) {
        out[key] = coerceLifecycleInput(val as Record<string, unknown>);
        continue;
      }
    }
  }

  return out as T;
}
