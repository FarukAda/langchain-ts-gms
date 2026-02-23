import { tool } from "@langchain/core/tools";
import { isGraphInterrupt } from "@langchain/langgraph";
import { GmsToolInputSchema } from "../schemas/planningSchemas.js";
import { normalizeInput, buildGoal } from "../helpers.js";
import type { GmsToolDeps, GmsToolInput, GmsPlanResult } from "../types.js";
import { RESPONSE_CONTRACT_VERSION } from "../../domain/contracts.js";
import { executionOrder } from "../../domain/taskUtils.js";
import { createGmsWorkflow } from "../../app/graph/workflow.js";
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
  return createPlanWithWorkflow(input, workflow);
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
      const normalized = normalizeInput(input);
      const result = await createPlanWithWorkflow(normalized, cachedWorkflow);
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
): Promise<GmsPlanResult> {
  const goal = buildGoal(input);
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
