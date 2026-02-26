import { tool } from "@langchain/core/tools";
import { isGraphInterrupt } from "@langchain/langgraph";
import { GmsToolInputSchema } from "../schemas/planningSchemas.js";
import { normalizeInput, buildGoal } from "../helpers.js";
import type { GmsToolDeps, GmsToolInput, GmsPlanResult } from "../types.js";
import { logWarn } from "../../infra/observability/tracing.js";
import { RESPONSE_CONTRACT_VERSION } from "../../domain/contracts.js";
import type { Goal } from "../../domain/contracts.js";
import { executionOrder } from "../../domain/taskUtils.js";
import { createGmsWorkflow, GMS_NODE_NAMES } from "../../app/graph/workflow.js";
import type { WorkflowDeps } from "../../app/graph/workflow.js";
import type { GmsState } from "../../app/state/schema.js";

/** The compiled workflow type returned by `createGmsWorkflow`. */
type CompiledGmsWorkflow = ReturnType<typeof createGmsWorkflow>;

/** Map tool-level deps to workflow-level deps, stripping tool-only fields. */
function buildWorkflowDeps(deps: Omit<GmsToolDeps, "toolName" | "toolDescription">): WorkflowDeps {
  return {
    goalRepository: deps.goalRepository,
    ...(deps.capabilityRepository != null && {
      capabilityRepository: deps.capabilityRepository,
    }),
    ...(deps.embeddings != null && { embeddings: deps.embeddings }),
    ...(deps.chatModel != null && { chatModel: deps.chatModel }),
    ...(deps.decomposeOptions != null && { decomposeOptions: deps.decomposeOptions }),
    ...(deps.checkpointer != null && { checkpointer: deps.checkpointer }),
  };
}

/**
 * Core planning logic without a LangChain tool wrapper.
 * Useful for service-layer usage where direct function invocation is preferred.
 */
export async function createPlan(
  input: GmsToolInput,
  deps: Omit<GmsToolDeps, "toolName" | "toolDescription">,
): Promise<GmsPlanResult> {
  const workflow = createGmsWorkflow(buildWorkflowDeps(deps));
  return createPlanWithWorkflow(input, workflow, deps);
}

/**
 * Creates the primary LangChain planning tool (`gms_plan_goal`).
 *
 * The compiled workflow is created once and reused across all tool invocations,
 * avoiding repeated StateGraph compilation and MemorySaver instantiation.
 */
export const createGmsPlanTool = (deps: GmsToolDeps) => {
  const cachedWorkflow = createGmsWorkflow(buildWorkflowDeps(deps));

  return tool(
    async (input: GmsToolInput): Promise<string> => {
      if (deps.rateLimiter) await deps.rateLimiter.acquire();
      const result = await createPlanWithWorkflow(input, cachedWorkflow, deps);
      return JSON.stringify(result);
    },
    {
      name: deps.toolName ?? "gms_plan_goal",
      description:
        deps.toolDescription ??
        "Create a structured task plan from a natural-language goal description. " +
          "Use this FIRST when you receive a new objective that needs breakdown into steps. " +
          "Returns JSON: { goalId, status, tasks[], executionOrder[] }. " +
          "This tool only plans — it does NOT execute tasks. " +
          "After planning, use gms_update_task to track progress on individual tasks.",
      schema: GmsToolInputSchema,
    },
  );
};

/**
 * Internal helper: runs planning against a provided compiled workflow instance.
 * Used by `createGmsPlanTool` (cached) and available for direct use.
 */
async function createPlanWithWorkflow(
  input: GmsToolInput,
  workflow: CompiledGmsWorkflow,
  deps?: Partial<Pick<GmsToolDeps, "onPlanRequiresApproval">>,
): Promise<GmsPlanResult> {
  const normalized = normalizeInput(input);
  const goal = buildGoal(normalized);
  try {
    const result: GmsState = await workflow.invoke(
      {
        goal,
        tasks: [],
        currentPhase: "planning",
        humanApprovalPending: false,
        ...(input.traceId != null && { traceId: input.traceId }),
      },
      { configurable: { thread_id: goal.id } },
    );
    if (result.humanApprovalPending) {
      await fireApprovalHook(deps, result.goal);
      return {
        version: RESPONSE_CONTRACT_VERSION,
        goalId: result.goal.id,
        status: "human_approval_required",
        tasks: result.tasks,
        executionOrder: executionOrder(result.tasks).map((t) => t.id),
        ...(input.traceId != null && { traceId: input.traceId }),
      };
    }
    return {
      version: RESPONSE_CONTRACT_VERSION,
      goalId: result.goal.id,
      status: result.goal.status,
      tasks: result.tasks,
      executionOrder: executionOrder(result.tasks).map((t) => t.id),
      ...(input.traceId != null && { traceId: input.traceId }),
    };
  } catch (err) {
    if (isGraphInterrupt(err)) {
      await fireApprovalHook(deps, goal);
      return {
        version: RESPONSE_CONTRACT_VERSION,
        goalId: goal.id,
        status: "human_approval_required",
        tasks: [],
        executionOrder: [],
        ...(input.traceId != null && { traceId: input.traceId }),
        interrupt: err.interrupts?.[0],
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      version: RESPONSE_CONTRACT_VERSION,
      goalId: goal.id,
      status: "failed",
      tasks: [],
      executionOrder: [],
      ...(input.traceId != null && { traceId: input.traceId }),
      error: msg,
    };
  }
}

/** Fire the onPlanRequiresApproval hook (non-fatal on error). */
async function fireApprovalHook(
  deps: Partial<Pick<GmsToolDeps, "onPlanRequiresApproval">> | undefined,
  goal: { id: string } & Record<string, unknown>,
): Promise<void> {
  if (!deps?.onPlanRequiresApproval) return;
  try {
    await deps.onPlanRequiresApproval(goal as Goal);
  } catch (err) {
    logWarn("onPlanRequiresApproval hook error (non-fatal)", {
      goalId: goal.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Event-Driven Streaming
// ---------------------------------------------------------------------------

/** Event types emitted during plan streaming. */
export type GmsEventType =
  | "PLANNER_START"
  | "PLANNER_COMPLETE"
  | "GUARDRAIL_START"
  | "GUARDRAIL_COMPLETE"
  | "SUMMARIZER_START"
  | "SUMMARIZER_COMPLETE"
  | "HUMAN_APPROVAL_REQUIRED"
  | "PLAN_COMPLETE"
  | "PLAN_ERROR";

/** Structured event yielded by `streamPlan`. */
export interface GmsEvent {
  type: GmsEventType;
  data?: unknown;
  timestamp: string;
}

/**
 * Streams the planning process as an `AsyncGenerator<GmsEvent>`.
 *
 * Uses LangGraph's `streamEvents` (v2) under the hood, mapping internal
 * graph transitions to typed GMS events. Consumers can pipe these over
 * SSE, WebSockets, or any async channel.
 *
 * @example
 * ```ts
 * for await (const event of streamPlan(input, deps)) {
 *   console.log(event.type, event.data);
 * }
 * ```
 */
/** WeakMap cache: reuse compiled workflows across streamPlan calls with the same deps object. */
const streamWorkflowCache = new WeakMap<object, CompiledGmsWorkflow>();

export async function* streamPlan(
  input: GmsToolInput,
  deps: Omit<GmsToolDeps, "toolName" | "toolDescription">,
): AsyncGenerator<GmsEvent> {
  const normalized = normalizeInput(input);
  const goal = buildGoal(normalized);
  let workflow = streamWorkflowCache.get(deps);
  if (!workflow) {
    workflow = createGmsWorkflow(buildWorkflowDeps(deps));
    streamWorkflowCache.set(deps, workflow);
  }

  const now = () => new Date().toISOString();

  try {
    const stream = workflow.streamEvents(
      {
        goal,
        tasks: [],
        currentPhase: "planning" as const,
        humanApprovalPending: false,
        ...(input.traceId != null && { traceId: input.traceId }),
      },
      { version: "v2", configurable: { thread_id: goal.id } },
    );

    for await (const event of stream) {
      const mapped = mapStreamEvent(event, goal.id);
      if (mapped) yield mapped;
    }

    yield { type: "PLAN_COMPLETE", data: { goalId: goal.id }, timestamp: now() };
  } catch (err) {
    if (isGraphInterrupt(err)) {
      yield {
        type: "HUMAN_APPROVAL_REQUIRED",
        data: { goalId: goal.id, interrupt: (err as { interrupts?: unknown[] }).interrupts?.[0] },
        timestamp: now(),
      };
      return;
    }
    yield {
      type: "PLAN_ERROR",
      data: { goalId: goal.id, error: err instanceof Error ? err.message : String(err) },
      timestamp: now(),
    };
  }
}

/** Maps a LangGraph v2 stream event to a typed GmsEvent (returns null for unmapped events). */
function mapStreamEvent(
  event: { event: string; name?: string; data?: unknown },
  goalId: string,
): GmsEvent | null {
  const now = new Date().toISOString();

  switch (event.event) {
    case "on_chain_start":
      if (event.name === GMS_NODE_NAMES.PLANNER) {
        return { type: "PLANNER_START", data: { goalId }, timestamp: now };
      }
      if (event.name === GMS_NODE_NAMES.GUARDRAIL) {
        return { type: "GUARDRAIL_START", data: { goalId }, timestamp: now };
      }
      if (event.name === GMS_NODE_NAMES.SUMMARIZER) {
        return { type: "SUMMARIZER_START", data: { goalId }, timestamp: now };
      }
      if (event.name === GMS_NODE_NAMES.HUMAN_APPROVAL) {
        return { type: "HUMAN_APPROVAL_REQUIRED", data: { goalId }, timestamp: now };
      }
      return null;

    case "on_chain_end":
      if (event.name === GMS_NODE_NAMES.PLANNER) {
        return {
          type: "PLANNER_COMPLETE",
          data: { goalId, output: event.data },
          timestamp: now,
        };
      }
      if (event.name === GMS_NODE_NAMES.GUARDRAIL) {
        return {
          type: "GUARDRAIL_COMPLETE",
          data: { goalId, output: event.data },
          timestamp: now,
        };
      }
      if (event.name === GMS_NODE_NAMES.SUMMARIZER) {
        return {
          type: "SUMMARIZER_COMPLETE",
          data: { goalId, output: event.data },
          timestamp: now,
        };
      }
      return null;

    default:
      return null;
  }
}

