import { tool } from "@langchain/core/tools";
import { ReplanGoalInputSchema, coerceLifecycleInput } from "../schemas/lifecycleSchemas.js";
import { stripNulls, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import { handleReplan } from "../handlers/replanHandler.js";

/** Creates the `gms_replan_goal` tool for regenerating tasks using append, replace_failed, or replace_all strategies. */
export const createReplanGoalTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      if (deps.rateLimiter) await deps.rateLimiter.acquire();
      const input = stripNulls(coerceLifecycleInput(rawInput));
      const result = await handleReplan(deps, {
        goalId: input.goalId,
        strategy: input.strategy,
        linkToLastCompleted:
          input.linkToLastCompleted != null ? Boolean(input.linkToLastCompleted) : undefined,
        decomposeOptions: input.decomposeOptions as Record<string, unknown> | undefined,
      });
      return wrapToolResponse(result);
    },
    {
      name: "gms_replan_goal",
      description:
        "Generate new tasks for an existing goal using AI decomposition. " +
        "Strategy controls how new tasks merge with existing ones: " +
        "'append' (default) — adds new tasks alongside existing ones. " +
        "'replace_failed' — removes failed tasks, keeps completed/pending, adds new tasks. " +
        "'replace_all' — discards ALL existing tasks and replaces with fresh plan. " +
        "Returns: { goalId, status, replanStrategy, replacedTaskIds[], newTaskIds[], totalTasks, executionOrder[], tasks[] }.",
      schema: ReplanGoalInputSchema,
    },
  );
