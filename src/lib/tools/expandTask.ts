import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";
import type { GmsToolDeps } from "../types.js";
import { wrapToolResponse } from "../helpers.js";
import { handleExpandTask } from "../handlers/expandTaskHandler.js";

/** Schema for the gms_expand_task tool input. */
const ExpandTaskInputSchema = z.object({
  goalId: z.string().describe("UUID of the goal containing the task"),
  parentTaskId: z.string().describe("UUID of the task to expand into sub-tasks"),
  subTasks: z
    .array(
      z.object({
        description: z.string().min(1).describe("Description of the sub-task"),
        priority: z
          .enum(["critical", "high", "medium", "low"])
          .optional()
          .describe("Priority (inherits parent if omitted)"),
        expectedInputs: z
          .array(z.string())
          .optional()
          .describe("Named inputs from upstream tasks"),
        providedOutputs: z
          .array(z.string())
          .optional()
          .describe("Named outputs for downstream tasks"),
      }),
    )
    .min(1)
    .describe("Sub-tasks to add under the parent task"),
});


/**
 * Creates the `gms_expand_task` tool for dynamic "fan-out" at runtime.
 *
 * This allows agents to split a single parent task into multiple sub-tasks
 * after the plan has been created, enabling map-reduce patterns and data-driven
 * graph expansion.
 */
export function createExpandTaskTool(deps: GmsToolDeps) {
  return tool(
    async (input: z.infer<typeof ExpandTaskInputSchema>) => {
      const result = await handleExpandTask(deps, input);
      return wrapToolResponse(result);
    },
    {
      name: "gms_expand_task",
      description:
        "Dynamically expand a parent task into sub-tasks at runtime. " +
        "Use for map-reduce patterns or when data reveals the task needs breakdown.",
      schema: ExpandTaskInputSchema,
    },
  );
}
