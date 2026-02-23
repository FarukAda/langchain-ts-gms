import { describe, it, expect } from "vitest";
import * as lib from "../../../src/lib/index.js";

/**
 * Verify that all expected named exports from the public barrel entrypoint
 * are defined and importable. Uses a snapshot-style assertion to catch
 * accidental removals or renames of the public API surface.
 */
describe("lib/index.ts barrel re-exports", () => {
  it("exposes the complete public API surface", () => {
    const exportedNames = Object.keys(lib).sort();
    expect(exportedNames).toEqual([
      "CAPABILITIES_COLLECTION",
      "ComplexitySchema",
      "DEFAULT_FORBIDDEN_PATTERNS",
      "DEFAULT_MAX_TASK_COUNT",
      "ErrorCodes",
      "GOALS_COLLECTION",
      "GmsStateAnnotation",
      "GoalMemoryRepository",
      "RESPONSE_CONTRACT_VERSION",
      "RiskLevelSchema",
      "TaskTypeSchema",
      "canTransitionTaskStatus",
      "checkGuardrail",
      "countTasks",
      "createAllGmsToolsFromEnv",
      "createEmbeddingProvider",
      "createGetGoalTool",
      "createGetProgressTool",
      "createGetTaskTool",
      "createGmsLifecycleTools",
      "createGmsLifecycleToolsFromEnv",
      "createGmsPlanTool",
      "createGmsToolFromEnv",
      "createGmsWorkflow",
      "createListGoalsTool",
      "createListTasksTool",
      "createPlan",
      "createReplanGoalTool",
      "createSearchTasksTool",
      "createUpdateGoalTool",
      "createUpdateTaskTool",
      "createValidateGoalTreeTool",
      "decomposeGoal",
      "evaluateGuardrails",
      "executionOrder",
      "flattenTasks",
      "migrateTasksToHierarchy",
      "requiresHumanApproval",
      "updateTaskById",
      "validateGoalInvariants",
    ]);
  });
});
