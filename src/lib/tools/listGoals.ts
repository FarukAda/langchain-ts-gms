import { tool } from "@langchain/core/tools";
import {
  ListGoalsInputSchema,
  coerceLifecycleInput,
} from "../schemas/lifecycleSchemas.js";
import { stripNulls, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import { handleListGoals } from "../handlers/listGoalsHandler.js";

/** Creates the `gms_list_goals` tool for listing or searching goals with filters and pagination. */
export const createListGoalsTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      const input = stripNulls(coerceLifecycleInput(rawInput));
      const result = await handleListGoals(deps, {
        status: input.status,
        priority: input.priority,
        tenantId: input.tenantId,
        query: input.query,
        limit: input.limit != null ? Number(input.limit) : undefined,
        offset: input.offset != null ? Number(input.offset) : undefined,
      });
      return wrapToolResponse(result);
    },
    {
      name: "gms_list_goals",
      description:
        "List or search goals with optional filters and pagination. " +
        "Without a query: returns all goals (filtered by status/priority/tenantId). " +
        "With a query string: performs semantic similarity search against goal descriptions. " +
        "Returns paginated JSON: { total, limit, offset, items[] }. " +
        "Each item includes: id, description, status, priority, tenantId, updatedAt.",
      schema: ListGoalsInputSchema,
    },
  );
