import { tool } from "@langchain/core/tools";
import { UpdateGoalInputSchema } from "../schemas/lifecycleSchemas.js";
import { stripNulls, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import { handleUpdateGoal } from "../handlers/updateHandlers.js";
import { logWarn } from "../../infra/observability/tracing.js";

/** Creates the `gms_update_goal` tool for updating a goal's description, status, priority, or metadata. */
export const createUpdateGoalTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      if (deps.rateLimiter) await deps.rateLimiter.acquire();
      const input = stripNulls(rawInput);
      // Small LLMs sometimes pass metadata as a JSON string — coerce to object
      let parsedMeta: Record<string, unknown> | undefined;
      if (typeof input.metadata === "string") {
        try {
          parsedMeta = JSON.parse(input.metadata) as Record<string, unknown>;
        } catch {
          logWarn("Failed to parse metadata JSON string — metadata ignored", {
            goalId: rawInput.goalId,
          });
        }
      } else if (typeof input.metadata === "object" && input.metadata !== null) {
        parsedMeta = input.metadata;
      }
      const { metadata: _rawMeta, ...rest } = input;
      const result = await handleUpdateGoal(deps, rest, parsedMeta);
      return wrapToolResponse(result);
    },
    {
      name: "gms_update_goal",
      description:
        "Update a goal's description, status, priority, or metadata. Does NOT execute tasks. " +
        "Requires goalId; all other fields are optional (only provided fields are changed). " +
        "Status transitions are validated: pending→in_progress/completed/failed/cancelled, " +
        "in_progress→completed/failed/cancelled, failed→in_progress/cancelled. " +
        "Invalid transitions return an INVALID_TRANSITION error. " +
        "Returns: { goalId, status, updatedAt }.",
      schema: UpdateGoalInputSchema,
    },
  );
