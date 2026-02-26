import { tool } from "@langchain/core/tools";
import { GetGoalInputSchema } from "../schemas/lifecycleSchemas.js";
import { getGoalOrThrow, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";

/** Creates the `gms_get_goal` tool for retrieving a goal and its full task tree by ID. */
export const createGetGoalTool = (deps: GmsToolDeps) =>
  tool(
    async (input) => {
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      return wrapToolResponse({ goal });
    },
    {
      name: "gms_get_goal",
      description:
        "Retrieve a single goal and its full task tree by goalId. " +
        "Returns the goal object with all nested tasks, statuses, and metadata. " +
        "Use this when you need the complete current state of a specific goal. " +
        "Use gms_list_goals instead if you need to browse or search across goals.",
      schema: GetGoalInputSchema,
    },
  );
