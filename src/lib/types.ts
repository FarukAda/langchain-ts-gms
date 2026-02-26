import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { DecomposeOptions } from "../app/planning/decomposeGoal.js";
import type { IGoalRepository } from "../domain/ports.js";
import type { Goal, Task } from "../domain/contracts.js";
import type { TokenBucketLimiter } from "./rateLimiter.js";

/** Dependency contract for creating planning and lifecycle tools. */
export interface GmsToolDeps {
  goalRepository: IGoalRepository;
  capabilityRepository?: IGoalRepository;
  embeddings?: EmbeddingsInterface;
  chatModel: BaseChatModel;
  decomposeOptions?: DecomposeOptions;
  toolName?: string;
  toolDescription?: string;
  /**
   * Optional rate limiter for throttling tool invocations.
   * When provided, each tool call acquires a token before executing.
   */
  rateLimiter?: TokenBucketLimiter;
  /**
   * LangGraph checkpointer for durable workflow state.
   * Defaults to in-memory `MemorySaver` (not for production).
   * For production, pass `@langchain/langgraph-checkpoint-sqlite` or
   * `@langchain/langgraph-checkpoint-postgres`.
   */
  checkpointer?: BaseCheckpointSaver;
  // --- Execution hooks (Feature 7) ---
  /** Fired when a task becomes ready (all dependencies completed). */
  onTaskReady?: (task: Task, goal: Goal) => void | Promise<void>;
  /** Fired when a plan requires human approval before execution. */
  onPlanRequiresApproval?: (goal: Goal) => void | Promise<void>;
  /** Fired when all tasks in a goal are completed. */
  onGoalCompleted?: (goal: Goal) => void | Promise<void>;
}

/** Env-based factory options used by `createGmsToolFromEnv` and lifecycle variant. */
export interface CreateGmsToolFromEnvOptions {
  decomposeOptions?: DecomposeOptions;
  bootstrap?: boolean;
  toolName?: string;
  toolDescription?: string;
  /**
   * LangGraph checkpointer for durable workflow state.
   * When omitted, defaults to in-memory `MemorySaver`.
   * @see {@link GmsToolDeps.checkpointer}
   */
  checkpointer?: BaseCheckpointSaver;
}

import type { z } from "zod/v4";
import type { GmsToolInputSchema } from "./schemas/planningSchemas.js";

/**
 * Input type derived from the planning schema.
 * Using `z.infer` ensures this type cannot silently drift from
 * {@link GmsToolInputSchema} when fields are added or removed.
 */
export type GmsToolInput = z.infer<typeof GmsToolInputSchema>;

/** Structured output contract returned by GMS planning calls. */
export interface GmsPlanResult {
  version?: string;
  goalId: string;
  status: Goal["status"] | "human_approval_required";
  tasks: Task[];
  executionOrder: string[];
  traceId?: string;
  interrupt?: unknown;
  error?: string;
}

/** Return shape of the combined factory. */
export interface AllGmsTools {
  planningTool: StructuredToolInterface;
  lifecycleTools: StructuredToolInterface[];
}
