import { tool } from "@langchain/core/tools";
import { ReplanGoalInputSchema, coerceLifecycleInput } from "../schemas/lifecycleSchemas.js";
import { getGoalOrThrow, removeFailedTasks, stripNulls, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import type { Goal, Task } from "../../domain/contracts.js";
import { flattenTasks, executionOrder } from "../../domain/taskUtils.js";
import { decomposeGoal } from "../../app/planning/decomposeGoal.js";
import type { DecomposeOptions } from "../../app/planning/decomposeGoal.js";
import { ErrorCodes, logWarn } from "../../infra/observability/tracing.js";

export const createReplanGoalTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      const input = stripNulls(coerceLifecycleInput(rawInput));
      const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);
      const capabilityRepo = deps.capabilityRepository ?? deps.goalRepository;
      if (!deps.embeddings) {
        throw new Error(
          `[${ErrorCodes.MISSING_DEPENDENCY}] embeddings must be provided in deps for replan`,
        );
      }
      const embeddings = deps.embeddings;
      const optsRaw = input.decomposeOptions ?? deps.decomposeOptions;
      const opts: DecomposeOptions | undefined = optsRaw
        ? (Object.fromEntries(
            Object.entries(optsRaw).filter(([, v]) => v != null),
          ) as DecomposeOptions)
        : undefined;
      const { tasks: generatedTasks } = await decomposeGoal(
        goal,
        capabilityRepo,
        embeddings,
        deps.chatModel,
        opts,
      );

      if (generatedTasks.length === 0) {
        logWarn(
          "Replan decomposition produced zero tasks — capability search may have returned no results",
          {
            goalId: goal.id,
          },
        );
      }

      const oldFlat = flattenTasks(goal.tasks);
      let nextTasks: Task[];
      let replacedTaskIds: string[] = [];
      if (input.strategy === "replace_all") {
        replacedTaskIds = oldFlat.map((t) => t.id);
        nextTasks = generatedTasks;
      } else if (input.strategy === "replace_failed") {
        replacedTaskIds = oldFlat.filter((t) => t.status === "failed").map((t) => t.id);
        const kept = removeFailedTasks(goal.tasks);
        nextTasks = [...kept, ...generatedTasks];
      } else {
        nextTasks = [...goal.tasks, ...generatedTasks];
      }

      const updated: Goal = {
        ...goal,
        status: "planned",
        tasks: nextTasks,
        updatedAt: new Date().toISOString(),
      };
      await deps.goalRepository.upsert(updated);

      const newFlat = flattenTasks(generatedTasks);
      const updatedFlat = flattenTasks(updated.tasks);

      return wrapToolResponse({
        goalId: updated.id,
        status: updated.status,
        replanStrategy: input.strategy,
        replacedTaskIds,
        newTaskIds: newFlat.map((t) => t.id),
        totalTasks: updatedFlat.length,
        executionOrder: executionOrder(updated.tasks).map((t) => t.id),
        tasks: updatedFlat.map((t) => ({
          id: t.id,
          description: t.description,
          status: t.status,
          priority: t.priority,
          dependencies: t.dependencies,
          ...(t.type && { type: t.type }),
          ...(t.riskLevel && { riskLevel: t.riskLevel }),
          ...(t.estimatedComplexity && { estimatedComplexity: t.estimatedComplexity }),
        })),
      });
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
