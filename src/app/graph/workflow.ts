import {
  StateGraph,
  START,
  END,
  interrupt,
  MemorySaver,
  type BaseCheckpointSaver,
  type GraphNode,
  type ConditionalEdgeRouter,
} from "@langchain/langgraph";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { GmsStateAnnotation } from "../state/schema.js";
import { decomposeGoal } from "../planning/decomposeGoal.js";
import { evaluateGuardrails } from "../governance/guardrails.js";
import { logInfo, logWarn, withNodeTiming } from "../../infra/observability/tracing.js";
import type { IGoalRepository } from "../../domain/ports.js";
import { createEmbeddingProvider } from "../../infra/embeddings/embeddingProvider.js";
import { createChatModelProvider } from "../../infra/chat/chatModelProvider.js";
import { flattenTasks } from "../../domain/taskUtils.js";
import type { DecomposeOptions } from "../planning/decomposeGoal.js";

export interface WorkflowDeps {
  goalRepository: IGoalRepository;
  capabilityRepository?: IGoalRepository;
  /** Inject for testing; otherwise uses createEmbeddingProvider() */
  embeddings?: EmbeddingsInterface;
  /** Inject for testing; otherwise uses createChatModelProvider() */
  chatModel?: BaseChatModel;
  /** Override decomposition options */
  decomposeOptions?: DecomposeOptions;
  /**
   * Inject a checkpointer; defaults to MemorySaver (in-memory, not for production).
   * For production, use `@langchain/langgraph-checkpoint-sqlite` or
   * `@langchain/langgraph-checkpoint-postgres`.
   */
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Node names used in the GMS workflow graph.
 * Shared with stream event mapping in `planGoal.ts` to prevent silent breakage.
 */
export const GMS_NODE_NAMES = {
  PLANNER: "planner",
  GUARDRAIL: "guardrail",
  HUMAN_APPROVAL: "human_approval",
  SUMMARIZER: "summarizer",
} as const;

/**
 * Builds the GMS LangGraph workflow: planner -> guardrail -> summarizer.
 * GMS produces plans (decomposed tasks) for autonomous agents to execute.
 * Guardrail enforces policy; HITL interrupt for high-risk plans.
 */
export function createGmsWorkflow(deps: WorkflowDeps) {
  const embeddings = deps.embeddings ?? createEmbeddingProvider();
  const chatModel = deps.chatModel ?? createChatModelProvider();

  const checkpointer =
    deps.checkpointer ??
    (() => {
      logWarn(
        "Using in-memory MemorySaver checkpointer — state will be lost on process restart. " +
          "For production, pass a durable checkpointer via WorkflowDeps.checkpointer " +
          "(e.g. @langchain/langgraph-checkpoint-sqlite or @langchain/langgraph-checkpoint-postgres).",
      );
      return new MemorySaver();
    })();

  const graph = new StateGraph(GmsStateAnnotation)
    .addNode(GMS_NODE_NAMES.PLANNER, plannerNode(deps, embeddings, chatModel), {
      retryPolicy: { maxAttempts: 3 },
    })
    .addNode(GMS_NODE_NAMES.GUARDRAIL, guardrailNode(deps))
    .addNode(GMS_NODE_NAMES.HUMAN_APPROVAL, humanApprovalNode())
    .addNode(GMS_NODE_NAMES.SUMMARIZER, summarizerNode(deps))
    .addEdge(START, GMS_NODE_NAMES.PLANNER)
    .addConditionalEdges(GMS_NODE_NAMES.PLANNER, routeAfterPlanner, {
      guardrail: GMS_NODE_NAMES.GUARDRAIL,
      summarizer: GMS_NODE_NAMES.SUMMARIZER,
    })
    .addConditionalEdges(GMS_NODE_NAMES.GUARDRAIL, routeAfterGuardrail, {
      human_approval: GMS_NODE_NAMES.HUMAN_APPROVAL,
      summarizer: GMS_NODE_NAMES.SUMMARIZER,
    })
    .addEdge(GMS_NODE_NAMES.HUMAN_APPROVAL, GMS_NODE_NAMES.SUMMARIZER)
    .addEdge(GMS_NODE_NAMES.SUMMARIZER, END);

  return graph.compile({ checkpointer });
}

function plannerNode(
  deps: WorkflowDeps,
  embeddings: EmbeddingsInterface,
  chatModel: BaseChatModel,
) {
  const node: GraphNode<typeof GmsStateAnnotation> = async (state) => {
    const { goal } = state;
    return withNodeTiming("planner", state.traceId, goal.id, async () => {
      logInfo("Planner starting", {
        goalId: goal.id,
        ...(state.traceId && { traceId: state.traceId }),
      });
      const capRepo = deps.capabilityRepository ?? deps.goalRepository;
      const decomposeOpts = deps.decomposeOptions ?? { topK: 5, maxDepth: 4 };
      const { tasks } = await decomposeGoal(goal, capRepo, embeddings, chatModel, decomposeOpts);
      const totalCount = flattenTasks(tasks).length;
      logInfo("Planner decomposed goal", { goalId: goal.id, taskCount: totalCount });
      // Draft-save: persist goal with status "pending" so lifecycle tools can
      // find it immediately. The summarizer will finalize the status to
      // "planned" or "failed" after guardrails pass (F2).
      const now = new Date().toISOString();
      await deps.goalRepository.upsert({
        ...goal,
        tasks,
        createdAt: goal.createdAt ?? now,
        updatedAt: now,
      });
      return {
        tasks,
        currentPhase: "planning",
      };
    });
  };
  return node;
}

/**
 * Applies policy checks before a plan is finalized.
 * Can block planning output or trigger human approval interrupt routing.
 */
function guardrailNode(_deps: WorkflowDeps) {
  const node: GraphNode<typeof GmsStateAnnotation> = async (state) => {
    const { goal, tasks } = state;
    return withNodeTiming("guardrail", state.traceId, goal.id, () => {
      const { check, needsHumanApproval, flatCount } = evaluateGuardrails(tasks);
      if (!check.allowed) {
        logWarn("Guardrail blocked execution", {
          goalId: goal.id,
          reason: check.reason,
        });
        return {
          error: check.reason,
          humanApprovalPending: false,
        };
      }
      if (needsHumanApproval) {
        logInfo("HITL required, routing to approval", {
          goalId: goal.id,
          taskCount: flatCount,
        });
        return { humanApprovalPending: true };
      }
      return {};
    });
  };
  return node;
}

/**
 * Finalizes workflow output and persists goal status.
 * - `planned` when no error is present
 * - `failed` when guardrail or planner produced an error
 */
function summarizerNode(deps: WorkflowDeps) {
  const node: GraphNode<typeof GmsStateAnnotation> = async (state) => {
    const { goal, error } = state;
    return withNodeTiming("summarizer", state.traceId, goal.id, async () => {
      const status = error ? ("failed" as const) : ("planned" as const);
      const now = new Date().toISOString();
      // When guardrail blocks (error set), preserve original tasks (F1).
      // Preserve original createdAt on replanned goals (F3).
      const tasksToSave = error ? goal.tasks : state.tasks;
      await deps.goalRepository.upsert({
        ...goal,
        status,
        tasks: tasksToSave,
        createdAt: goal.createdAt ?? now,
        updatedAt: now,
      });
      return {
        currentPhase: "summarizing",
        goal: { ...goal, status, updatedAt: now },
        tasks: tasksToSave,
      };
    });
  };
  return node;
}

/** Route to guardrail only when planner produced at least one task. */
const routeAfterPlanner: ConditionalEdgeRouter<typeof GmsStateAnnotation> = (state) => {
  if (state.tasks.length === 0) return "summarizer";
  return "guardrail";
};

/** Route to HITL only when guardrail marks plan as approval-required. */
const routeAfterGuardrail: ConditionalEdgeRouter<typeof GmsStateAnnotation> = (state) => {
  if (state.error) return "summarizer";
  if (state.humanApprovalPending) return "human_approval";
  return "summarizer";
};

/** Emits a LangGraph interrupt payload that external systems can approve/resume. */
function humanApprovalNode() {
  const node: GraphNode<typeof GmsStateAnnotation> = async (state) => {
    const { goal, tasks } = state;
    return withNodeTiming("human_approval", state.traceId, goal.id, () => {
      const totalCount = flattenTasks(tasks).length;
      interrupt({
        action: "approve_plan",
        goalId: goal.id,
        taskCount: totalCount,
        message: "Please approve this plan before execution.",
      });
      return { humanApprovalPending: false };
    });
  };
  return node;
}
