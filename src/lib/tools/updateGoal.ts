import { tool } from "@langchain/core/tools";
import { UpdateGoalInputSchema } from "../schemas/lifecycleSchemas.js";
import { getGoalOrThrow, stripNulls, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import type { Goal } from "../../domain/contracts.js";
import { canTransitionTaskStatus } from "../../domain/taskUtils.js";
import { ErrorCodes } from "../../infra/observability/tracing.js";

export const createUpdateGoalTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      const input = stripNulls(rawInput);
      // Small LLMs sometimes pass metadata as a JSON string — coerce to object
      let parsedMeta: Record<string, unknown> | undefined;
      if (typeof input.metadata === "string") {
        try {
          parsedMeta = JSON.parse(input.metadata) as Record<string, unknown>;
        } catch {
          /* ignore unparseable */
        }
      } else if (typeof input.metadata === "object" && input.metadata !== null) {
        parsedMeta = input.metadata;
      }
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      if (input.status !== undefined && !canTransitionTaskStatus(goal.status, input.status)) {
        throw new Error(
          `[${ErrorCodes.INVALID_TRANSITION}] Invalid goal status transition: ${goal.status} -> ${input.status}`,
        );
      }
      if (input.description !== undefined && input.description.trim().length === 0) {
        throw new Error(
          `[${ErrorCodes.INVALID_INPUT}] Goal description cannot be empty or whitespace-only`,
        );
      }
      const updated: Goal = {
        ...goal,
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.tenantId !== undefined && { tenantId: input.tenantId }),
        ...(parsedMeta !== undefined && {
          metadata: { ...(goal.metadata ?? {}), ...parsedMeta },
        }),
        updatedAt: new Date().toISOString(),
      };
      await deps.goalRepository.upsert(updated);
      return wrapToolResponse({
        goalId: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt,
      });
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
