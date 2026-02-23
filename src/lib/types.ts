import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { DecomposeOptions } from "../app/planning/decomposeGoal.js";
import type { GoalMemoryRepository } from "../infra/vector/goalMemoryRepository.js";
import type { Goal, Task } from "../domain/contracts.js";

/** Dependency contract for creating planning and lifecycle tools. */
export interface GmsToolDeps {
  goalRepository: GoalMemoryRepository;
  capabilityRepository?: GoalMemoryRepository;
  embeddings?: EmbeddingsInterface;
  chatModel: BaseChatModel;
  decomposeOptions?: DecomposeOptions;
  toolName?: string;
  toolDescription?: string;
}

/** Env-based factory options used by `createGmsToolFromEnv` and lifecycle variant. */
export interface CreateGmsToolFromEnvOptions {
  decomposeOptions?: DecomposeOptions;
  bootstrap?: boolean;
  toolName?: string;
  toolDescription?: string;
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
