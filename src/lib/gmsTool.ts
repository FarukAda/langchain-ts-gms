/**
 * GMS Tool – public barrel export.
 *
 * This module re-exports all tool factories, the `createPlan` service function,
 * types, helpers, and environment-driven convenience factories.
 *
 * Previously a 790-line monolith; now a thin façade that delegates to focused modules.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  GmsToolDeps,
  GmsToolInput,
  GmsPlanResult,
  CreateGmsToolFromEnvOptions,
  AllGmsTools,
} from "./types.js";

// ── Convenience composites ───────────────────────────────────────────
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { GmsToolDeps, CreateGmsToolFromEnvOptions, AllGmsTools } from "./types.js";
import { createGmsPlanTool } from "./tools/planGoal.js";
import { createGetGoalTool } from "./tools/getGoal.js";
import { createUpdateGoalTool } from "./tools/updateGoal.js";
import { createUpdateTaskTool } from "./tools/updateTask.js";
import { createValidateGoalTreeTool } from "./tools/validateGoalTree.js";
import { createGetProgressTool } from "./tools/getProgress.js";
import { createGetTaskTool } from "./tools/getTask.js";
import { createListTasksTool } from "./tools/listTasks.js";
import { createSearchTasksTool } from "./tools/searchTasks.js";
import { createListGoalsTool } from "./tools/listGoals.js";
import { createReplanGoalTool } from "./tools/replanGoal.js";
import { createEmbeddingProvider } from "../infra/embeddings/embeddingProvider.js";
import { createChatModelProvider } from "../infra/chat/chatModelProvider.js";
import { GoalMemoryRepository } from "../infra/vector/goalMemoryRepository.js";
import { CAPABILITIES_COLLECTION } from "../infra/vector/qdrantClient.js";

// ── Backward-compatible composite factories ──────────────────────────

/**
 * Creates the lifecycle toolset used for retrieval, mutation, validation,
 * progress, and replanning. These tools do not execute tasks; they only
 * manage planning state.
 */
export function createGmsLifecycleTools(deps: GmsToolDeps): StructuredToolInterface[] {
  return [
    createGetGoalTool(deps),
    createGetTaskTool(deps),
    createListTasksTool(deps),
    createSearchTasksTool(deps),
    createListGoalsTool(deps),
    createUpdateGoalTool(deps),
    createUpdateTaskTool(deps),
    createValidateGoalTreeTool(deps),
    createGetProgressTool(deps),
    createReplanGoalTool(deps),
  ];
}

/** Build env-driven deps (embeddings + repos), optionally bootstrapping. */
async function buildEnvDeps(options: CreateGmsToolFromEnvOptions = {}): Promise<GmsToolDeps> {
  const embeddings = createEmbeddingProvider();
  const goalRepository = new GoalMemoryRepository({ embeddings });
  const capabilityRepository = new GoalMemoryRepository({
    embeddings,
    collectionName: CAPABILITIES_COLLECTION,
  });
  const shouldBootstrap = options.bootstrap ?? true;
  if (shouldBootstrap) await goalRepository.bootstrap();
  return {
    goalRepository,
    capabilityRepository,
    embeddings,
    chatModel: createChatModelProvider(),
    ...(options.decomposeOptions !== undefined && { decomposeOptions: options.decomposeOptions }),
    ...(options.toolName !== undefined && { toolName: options.toolName }),
    ...(options.toolDescription !== undefined && { toolDescription: options.toolDescription }),
  };
}

/** Creates `gms_plan_goal` from environment-driven defaults. */
export async function createGmsToolFromEnv(
  options: CreateGmsToolFromEnvOptions = {},
): Promise<StructuredToolInterface> {
  const deps = await buildEnvDeps(options);
  return createGmsPlanTool(deps);
}

/** Creates lifecycle tools from environment-driven defaults. */
export async function createGmsLifecycleToolsFromEnv(
  options: CreateGmsToolFromEnvOptions = {},
): Promise<StructuredToolInterface[]> {
  const deps = await buildEnvDeps(options);
  return createGmsLifecycleTools(deps);
}

/**
 * Creates both planning and lifecycle tools sharing the **same** repository
 * instances, avoiding state inconsistency.
 */
export async function createAllGmsToolsFromEnv(
  options: CreateGmsToolFromEnvOptions = {},
): Promise<AllGmsTools> {
  const deps = await buildEnvDeps(options);
  return {
    planningTool: createGmsPlanTool(deps),
    lifecycleTools: createGmsLifecycleTools(deps),
  };
}
