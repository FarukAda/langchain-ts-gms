import type { GmsToolDeps } from "../types.js";
import type { Goal, Task } from "../../domain/contracts.js";
import type { DecomposeOptions } from "../../app/planning/decomposeGoal.js";
import { getGoalOrThrow, removeFailedTasks } from "../helpers.js";
import { flattenTasks, executionOrder } from "../../domain/taskUtils.js";
import { decomposeGoal } from "../../app/planning/decomposeGoal.js";
import { evaluateGuardrails } from "../../app/governance/guardrails.js";
import { ErrorCodes, logWarn } from "../../infra/observability/tracing.js";

// ---------------------------------------------------------------------------
// Replan handler — shared by LangChain tool and MCP server
// ---------------------------------------------------------------------------

export type ReplanStrategy = "append" | "replace_failed" | "replace_all";

export interface ReplanInput {
  goalId: string;
  strategy?: ReplanStrategy | undefined;
  linkToLastCompleted?: boolean | undefined;
  /** Raw decompose options — may contain undefined/null values that the handler filters out. */
  decomposeOptions?: Record<string, unknown> | undefined;
}

export interface ReplanResult {
  goalId: string;
  status: string;
  replanStrategy: ReplanStrategy;
  replacedTaskIds: string[];
  newTaskIds: string[];
  totalTasks: number;
  executionOrder: string[];
  tasks: Array<{
    id: string;
    description: string;
    status: string;
    priority: string;
    dependencies: string[];
    type?: string;
    riskLevel?: string;
    estimatedComplexity?: string;
  }>;
}

/** Result returned when guardrail requires human approval instead of completing. */
export interface ReplanHumanApprovalResult {
  goalId: string;
  status: "human_approval_required";
  reason: string;
  taskCount: number;
}

export type ReplanOutcome = ReplanResult | ReplanHumanApprovalResult;

/**
 * Core replan logic shared by the LangChain tool and MCP server.
 *
 * 1. Fetches the existing goal
 * 2. Decomposes via LLM
 * 3. Enforces guardrails
 * 4. Applies the chosen merge strategy
 * 5. Persists with optimistic locking
 */
export async function handleReplan(
  deps: GmsToolDeps,
  input: ReplanInput,
): Promise<ReplanOutcome> {
  const goal = await getGoalOrThrow(deps.goalRepository, input.goalId);

  // ── Dependency check ─────────────────────────────────────────────────
  if (!deps.embeddings) {
    throw new Error(
      `[${ErrorCodes.MISSING_DEPENDENCY}] embeddings must be provided in deps for replan`,
    );
  }
  const embeddings = deps.embeddings;
  const capabilityRepo = deps.capabilityRepository ?? deps.goalRepository;

  // ── Merge decompose options (input takes precedence over deps) ──────
  const optsRaw = input.decomposeOptions
    ? { ...deps.decomposeOptions, ...input.decomposeOptions }
    : deps.decomposeOptions;
  const opts: DecomposeOptions | undefined = optsRaw
    ? (Object.fromEntries(
        Object.entries(optsRaw).filter(([, v]) => v != null),
      ) as DecomposeOptions)
    : undefined;

  // ── LLM decomposition ───────────────────────────────────────────────
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
      { goalId: goal.id },
    );
  }

  // ── Guardrail enforcement ──────────────────────────────────────────
  if (generatedTasks.length > 0) {
    const guardrailResult = evaluateGuardrails(generatedTasks);
    if (!guardrailResult.check.allowed) {
      throw new Error(
        `[${ErrorCodes.GUARDRAIL_BLOCKED}] Replan blocked by guardrail: ${guardrailResult.check.reason}`,
      );
    }
    if (guardrailResult.needsHumanApproval) {
      return {
        goalId: goal.id,
        status: "human_approval_required",
        reason: "Plan exceeds automated approval threshold",
        taskCount: guardrailResult.flatCount,
      };
    }
  }

  // ── Strategy dispatch ──────────────────────────────────────────────
  const strategy: ReplanStrategy = input.strategy ?? "append";
  const oldFlat = flattenTasks(goal.tasks);
  let nextTasks: Task[];
  const replacedTaskIds: string[] = [];

  if (strategy === "replace_all") {
    replacedTaskIds.push(...oldFlat.map((t) => t.id));
    nextTasks = generatedTasks;
  } else if (strategy === "replace_failed") {
    replacedTaskIds.push(
      ...oldFlat.filter((t) => t.status === "failed").map((t) => t.id),
    );
    const kept = removeFailedTasks(goal.tasks);
    nextTasks = [...kept, ...generatedTasks];
  } else {
    // Append strategy: optionally link new tasks to the last completed task
    if (input.linkToLastCompleted && generatedTasks.length > 0) {
      const completedTasks = oldFlat
        .filter((t) => t.status === "completed")
        .sort((a, b) => {
          if (a.completedAt && b.completedAt) return a.completedAt.localeCompare(b.completedAt);
          if (a.completedAt) return 1;
          if (b.completedAt) return -1;
          return 0;
        });
      if (completedTasks.length > 0) {
        const lastCompleted = completedTasks[completedTasks.length - 1]!;
        generatedTasks[0] = {
          ...generatedTasks[0]!,
          dependencies: [lastCompleted.id, ...generatedTasks[0]!.dependencies],
        };
      }
    }
    nextTasks = [...goal.tasks, ...generatedTasks];
  }

  // ── Persist ────────────────────────────────────────────────────────
  const updated: Goal = {
    ...goal,
    status: "planned",
    tasks: nextTasks,
    updatedAt: new Date().toISOString(),
  };
  await deps.goalRepository.upsert(updated, goal._version);

  // ── Build response ─────────────────────────────────────────────────
  const newFlat = flattenTasks(generatedTasks);
  const updatedFlat = flattenTasks(updated.tasks);

  return {
    goalId: updated.id,
    status: updated.status,
    replanStrategy: strategy,
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
  };
}
