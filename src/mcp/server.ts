/**
 * MCP server module that exposes GMS lifecycle tools via the
 * Model Context Protocol (stdio transport).
 *
 * Usage (stdio):
 * ```bash
 * node -e "import('@farukada/langchain-ts-gms/mcp').then(m => m.startMcpServer())"
 * ```
 *
 * @module
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createEmbeddingProvider } from "../infra/embeddings/embeddingProvider.js";
import { createChatModelProvider } from "../infra/chat/chatModelProvider.js";
import { QdrantGoalRepository } from "../infra/vector/goalMemoryRepository.js";
import { CAPABILITIES_COLLECTION } from "../infra/vector/qdrantClient.js";
import { createPlan } from "../lib/tools/planGoal.js";
import { getGoalOrThrow, stripNulls } from "../lib/helpers.js";
import type { GmsToolDeps } from "../lib/types.js";
import type { Goal, Task } from "../domain/contracts.js";
import { validateGoalInvariants } from "../domain/taskUtils.js";
import { coerceLifecycleInput } from "../lib/schemas/lifecycleSchemas.js";
import {
  handleListGoals,
  handleGetTask,
  handleListTasks,
  handleSearchTasks,
  handleUpdateGoal,
  handleUpdateTask,
  handleGetProgress,
  handleExpandTask,
  handleReplan,
} from "../lib/handlers/index.js";

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/** Options for creating the MCP server. */
export interface GmsMcpServerOptions {
  /** Human-readable name shown to MCP clients. */
  name?: string;
  /** Semantic version string. */
  version?: string;
  /** Whether to call `bootstrap()` on repositories at startup. */
  bootstrap?: boolean;
  /**
   * LangGraph checkpointer for durable workflow state.
   * When omitted, defaults to in-memory `MemorySaver`.
   * @see {@link import('../lib/types.js').GmsToolDeps.checkpointer}
   */
  checkpointer?: BaseCheckpointSaver;
  /** Fired when a task becomes ready for execution (all deps completed). */
  onTaskReady?: (task: Task, goal: Goal) => void | Promise<void>;
  /** Fired when a plan requires human approval. */
  onPlanRequiresApproval?: (goal: Goal) => void | Promise<void>;
  /** Fired when all tasks in a goal are completed. */
  onGoalCompleted?: (goal: Goal) => void | Promise<void>;
}

/**
 * Build environment-driven {@link GmsToolDeps} (mirrors `gmsTool.ts` logic).
 * Shared by the MCP server to avoid duplicating the wiring pattern.
 */
async function buildDeps(
  bootstrap: boolean,
  options: GmsMcpServerOptions = {},
): Promise<GmsToolDeps> {
  const embeddings = createEmbeddingProvider();
  const goalRepository = new QdrantGoalRepository({ embeddings });
  const capabilityRepository = new QdrantGoalRepository({
    embeddings,
    collectionName: CAPABILITIES_COLLECTION,
  });
  const chatModel = createChatModelProvider();

  if (bootstrap) {
    await goalRepository.bootstrap();
    await capabilityRepository.bootstrap();
  }

  return {
    goalRepository,
    capabilityRepository,
    embeddings,
    chatModel,
    ...(options.onTaskReady && { onTaskReady: options.onTaskReady }),
    ...(options.onPlanRequiresApproval && { onPlanRequiresApproval: options.onPlanRequiresApproval }),
    ...(options.onGoalCompleted && { onGoalCompleted: options.onGoalCompleted }),
    ...(options.checkpointer !== undefined && { checkpointer: options.checkpointer }),
  };
}

/** Helper: wrap any value as MCP text content. */
function textResult(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/**
 * Creates a configured {@link McpServer} with all GMS tools registered.
 *
 * The returned server is **not** connected to any transport yet —
 * call {@link startMcpServer} to wire it to stdio, or use
 * `McpServer.connect()` with any supported transport.
 */
export async function createGmsMcpServer(
  options: GmsMcpServerOptions = {},
): Promise<McpServer> {
  const { name = "gms-mcp-server", version = "0.1.0", bootstrap = true } = options;
  const deps = await buildDeps(bootstrap, options);

  const server = new McpServer({ name, version });

  // ── gms_plan_goal ──────────────────────────────────────────────────────
  server.tool(
    "gms_plan_goal",
    "Decompose a user goal into a structured, multi-level task tree with dependencies",
    {
      goal: z.string().describe("Description of the goal to achieve"),
      priority: z
        .enum(["critical", "high", "medium", "low"])
        .optional()
        .describe("Goal priority (defaults to medium)"),
      traceId: z.string().optional().describe("Optional trace ID for observability"),
    },
    async ({ goal, priority, traceId }) => {
      const result = await createPlan(
        { goal, priority: priority ?? "medium", traceId },
        deps,
      );
      return textResult(result);
    },
  );

  // ── gms_get_goal ───────────────────────────────────────────────────────
  server.tool(
    "gms_get_goal",
    "Retrieve a goal by its ID",
    {
      goalId: z.string().describe("UUID of the goal to retrieve"),
    },
    async ({ goalId }) => {
      const goal = await getGoalOrThrow(deps.goalRepository, goalId);
      return textResult(goal);
    },
  );

  // ── gms_list_goals ─────────────────────────────────────────────────────
  server.tool(
    "gms_list_goals",
    "List or search goals with optional filters and pagination. " +
      "Without a query: returns all goals filtered by status/priority/tenantId. " +
      "With a query: performs semantic similarity search against goal descriptions.",
    {
      status: z
        .enum(["pending", "planned", "in_progress", "completed", "failed", "cancelled"])
        .optional()
        .describe("Filter goals by status"),
      priority: z
        .enum(["critical", "high", "medium", "low"])
        .optional()
        .describe("Filter goals by priority"),
      tenantId: z.string().optional().describe("Filter goals by tenant identifier"),
      query: z
        .string()
        .optional()
        .describe(
          "Semantic similarity search query. When provided, goals are ranked " +
            "by description similarity instead of listed chronologically.",
        ),
      limit: z.number().optional().describe("Max number of goals to return"),
      offset: z.number().optional().describe("Number of goals to skip"),
    },
    async (input) => textResult(await handleListGoals(deps, stripNulls(coerceLifecycleInput(input)))),
  );

  // ── gms_get_task ───────────────────────────────────────────────────────
  server.tool(
    "gms_get_task",
    "Retrieve a specific task within a goal by its ID",
    {
      goalId: z.string().describe("UUID of the parent goal"),
      taskId: z.string().describe("UUID of the task to retrieve"),
    },
    async (input) => textResult(await handleGetTask(deps, input)),
  );

  // ── gms_list_tasks ─────────────────────────────────────────────────────
  server.tool(
    "gms_list_tasks",
    "List and filter tasks within a goal. Supports status, priority, type filters and pagination.",
    {
      goalId: z.string().describe("UUID of the goal"),
      status: z.array(z.string()).optional().describe("Filter by status(es)"),
      priority: z.array(z.string()).optional().describe("Filter by priority(ies)"),
      type: z
        .array(z.enum(["research", "action", "validation", "decision"]))
        .optional()
        .describe("Filter by type(s)"),
      flat: z.boolean().optional().describe("Flatten task tree (default true)"),
      includeSubTasks: z
        .boolean()
        .optional()
        .describe(
          "If true (default), includes nested sub-tasks when flat=true. " +
            "Ignored when flat=false.",
        ),
      limit: z.number().optional().describe("Page size"),
      offset: z.number().optional().describe("Number of items to skip"),
    },
    async (input) => textResult(await handleListTasks(deps, stripNulls(coerceLifecycleInput(input)))),
  );

  // ── gms_search_tasks ───────────────────────────────────────────────────
  server.tool(
    "gms_search_tasks",
    "Search and filter for tasks within a goal using text matching. " +
      "Supports status, priority, type, and dependency filters.",
    {
      goalId: z.string().describe("UUID of the goal"),
      query: z.string().optional().describe("Search query text (case-insensitive substring match)"),
      status: z.array(z.string()).optional().describe("Filter by status(es)"),
      priority: z.array(z.string()).optional().describe("Filter by priority(ies)"),
      type: z
        .array(z.enum(["research", "action", "validation", "decision"]))
        .optional()
        .describe("Filter by type(s)"),
      hasDependencies: z
        .boolean()
        .optional()
        .describe("Filter tasks with/without dependencies"),
      limit: z.number().optional().describe("Page size"),
      offset: z.number().optional().describe("Number of items to skip"),
    },
    async (input) => textResult(await handleSearchTasks(deps, stripNulls(coerceLifecycleInput(input)))),
  );

  // ── gms_update_goal ────────────────────────────────────────────────────
  server.tool(
    "gms_update_goal",
    "Update a goal's description, status, priority, tenant ID, or metadata",
    {
      goalId: z.string().describe("UUID of the goal to update"),
      description: z.string().optional().describe("New goal description"),
      status: z
        .enum(["pending", "planned", "in_progress", "completed", "failed", "cancelled"])
        .optional()
        .describe("New status"),
      priority: z
        .enum(["critical", "high", "medium", "low"])
        .optional()
        .describe("New priority"),
      tenantId: z.string().optional().describe("Tenant ID for multi-tenancy"),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Arbitrary metadata key-value pairs. " +
            "Merges with existing metadata (does not replace).",
        ),
    },
    async (input) => textResult(await handleUpdateGoal(deps, input)),
  );

  // ── gms_update_task ────────────────────────────────────────────────────
  server.tool(
    "gms_update_task",
    "Update a task's status, result, or error within a goal",
    {
      goalId: z.string().describe("UUID of the parent goal"),
      taskId: z.string().describe("UUID of the task to update"),
      status: z
        .enum(["pending", "planned", "in_progress", "completed", "failed", "cancelled"])
        .optional()
        .describe("New status"),
      result: z.string().optional().describe("Task result output"),
      error: z.string().optional().describe("Task error message"),
    },
    async (input) => textResult(await handleUpdateTask(deps, input)),
  );

  // ── gms_get_progress ───────────────────────────────────────────────────
  server.tool(
    "gms_get_progress",
    "Get completion progress and statistics for a goal",
    {
      goalId: z.string().describe("UUID of the goal"),
    },
    async ({ goalId }) => textResult(await handleGetProgress(deps, goalId)),
  );

  // ── gms_validate_goal_tree ─────────────────────────────────────────────
  server.tool(
    "gms_validate_goal_tree",
    "Validate the structural integrity of a goal's task tree (cycles, orphan deps, duplicates)",
    {
      goalId: z.string().describe("UUID of the goal to validate"),
    },
    async ({ goalId }) => {
      const goal = await getGoalOrThrow(deps.goalRepository, goalId);
      const result = validateGoalInvariants(goal);
      return textResult({
        goalId,
        valid: result.valid,
        issueCount: result.issues.length,
        issues: result.issues,
        warnings: result.warnings,
      });
    },
  );

  // ── gms_replan_goal ────────────────────────────────────────────────────
  server.tool(
    "gms_replan_goal",
    "Regenerate tasks for a goal using LLM decomposition. " +
      "Supports append, replace_failed, and replace_all strategies.",
    {
      goalId: z.string().describe("UUID of the goal to replan"),
      strategy: z
        .enum(["append", "replace_failed", "replace_all"])
        .optional()
        .describe("Replan strategy (default: append)"),
      linkToLastCompleted: z
        .boolean()
        .optional()
        .describe("Link first new task to last completed task"),
      decomposeOptions: z
        .object({
          topK: z.number().int().optional().describe("Number of capabilities to consider"),
          maxDepth: z.number().int().optional().describe("Maximum nesting depth"),
        })
        .optional()
        .describe("Override default decomposition parameters"),
    },
    async (input) => textResult(await handleReplan(deps, stripNulls(coerceLifecycleInput(input)))),
  );

  // ── gms_expand_task ────────────────────────────────────────────────────
  server.tool(
    "gms_expand_task",
    "Add sub-tasks to an existing task within a goal",
    {
      goalId: z.string().describe("UUID of the parent goal"),
      parentTaskId: z.string().describe("UUID of the parent task to expand"),
      subTasks: z
        .array(
          z.object({
            description: z.string().describe("Sub-task description"),
            priority: z
              .enum(["critical", "high", "medium", "low"])
              .optional()
              .describe("Priority (inherits from parent if omitted)"),
            expectedInputs: z
              .array(z.string())
              .optional()
              .describe("Named inputs this sub-task expects from upstream tasks"),
            providedOutputs: z
              .array(z.string())
              .optional()
              .describe("Named outputs this sub-task provides to downstream tasks"),
          }),
        )
        .describe("Sub-tasks to add"),
    },
    async (input) => textResult(await handleExpandTask(deps, input)),
  );

  return server;
}

// ---------------------------------------------------------------------------
// Convenience CLI entry-point
// ---------------------------------------------------------------------------

/**
 * Start the MCP server with stdio transport.
 *
 * This is the default entry-point when running the MCP module directly:
 * ```bash
 * node dist/mcp/server.js
 * ```
 */
export async function startMcpServer(
  options: GmsMcpServerOptions = {},
): Promise<void> {
  const server = await createGmsMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
