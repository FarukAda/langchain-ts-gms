import { tool } from "@langchain/core/tools";
import { ValidateGoalTreeInputSchema } from "../schemas/lifecycleSchemas.js";
import { getGoalOrThrow, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import { flattenTasks, validateGoalInvariants } from "../../domain/taskUtils.js";

/** Creates the `gms_validate_goal_tree` tool for checking structural integrity, cycles, and dependency validity. */
export const createValidateGoalTreeTool = (deps: GmsToolDeps) =>
  tool(
    async (input) => {
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      const result = validateGoalInvariants(goal);
      return wrapToolResponse({
        goalId: goal.id,
        valid: result.valid,
        issues: result.issues,
        warnings: result.warnings,
        taskCount: flattenTasks(goal.tasks).length,
      });
    },
    {
      name: "gms_validate_goal_tree",
      description:
        "Check a goal's task tree for structural issues: cycles, missing dependencies, " +
        "orphaned tasks, and invalid parent references. " +
        "Use this after replan or manual task modifications to ensure consistency. " +
        "Returns: { goalId, valid: boolean, issues: string[], taskCount }.",
      schema: ValidateGoalTreeInputSchema,
    },
  );
