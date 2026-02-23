import type { Goal, Task, CapabilityVector } from "../../domain/contracts.js";
import { RESPONSE_CONTRACT_VERSION } from "../../domain/contracts.js";
import type { GoalMemoryRepository } from "../../infra/vector/goalMemoryRepository.js";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  DecompositionOutputSchema,
  type DecomposedTask,
} from "./decompositionSchema.js";

export interface DecomposeResult {
  tasks: Task[];
  capabilityMatches: Array<{ capability: CapabilityVector; score: number }>;
}

export interface DecomposeOptions {
  topK?: number;
  maxDepth?: number;
  /**
   * Override the system prompt template. Receives the same arguments as
   * `buildDecompositionPrompt` and should return the full prompt string.
   * When not provided, the built-in research-then-action prompt is used.
   */
  promptTemplate?: (
    goal: Goal,
    capabilities: Array<{ goal: Goal; score: number }>,
    maxDepth: number,
  ) => string;
}

/**
 * LLM-powered task decomposition: embeds the goal, searches for relevant
 * capabilities in the vector store for context, then uses a chat model with
 * structured output to break the goal into a hierarchical task tree.
 */
export async function decomposeGoal(
  goal: Goal,
  repository: GoalMemoryRepository,
  embeddings: EmbeddingsInterface,
  chatModel: BaseChatModel,
  options: DecomposeOptions = {},
): Promise<DecomposeResult> {
  const { topK = 5, maxDepth = 4 } = options;

  // 1. Embed the goal and search for relevant capabilities (context for LLM)
  const queryVector = await embeddings.embedQuery(goal.description);
  const filter = goal.tenantId ? { tenantId: goal.tenantId } : undefined;
  const results = await repository.searchByVector(queryVector, {
    k: topK,
    ...(filter && { filter }),
  });

  // Exclude the goal's own document from capability matches
  const filtered = results.filter((r) => r.goal.id !== goal.id);

  const capabilityMatches = filtered.map((r) => ({
    capability: {
      id: r.goal.id,
      description: r.goal.description,
      version: RESPONSE_CONTRACT_VERSION,
      constraints: [],
      metadata: r.goal.metadata ?? {},
    },
    score: r.score,
  }));

  // 2. Use the LLM to decompose the goal
  const tasks = await llmDecompose(goal, chatModel, filtered, maxDepth, options);
  return { tasks, capabilityMatches };
}

// ---------------------------------------------------------------------------
// LLM-based decomposition
// ---------------------------------------------------------------------------

/** Builds the system prompt that instructs the LLM how to decompose. */
function buildDecompositionPrompt(
  goal: Goal,
  capabilities: Array<{ goal: Goal; score: number }>,
  maxDepth: number,
): string {
  const capSection =
    capabilities.length > 0
      ? `\n\nRelevant existing capabilities that may inform your decomposition:\n${capabilities
          .map((c, i) => `${i + 1}. ${c.goal.description} (relevance: ${(c.score * 100).toFixed(0)}%)`)
          .join("\n")}`
      : "";

  return [
    `You are an expert task-planning assistant. Decompose the following goal into a **phased plan** with distinct task types.`,
    ``,
    `## Task Types (assign one to each task)`,
    `- **research**: Gather current information needed before acting (addresses LLM knowledge cutoff)`,
    `- **action**: A concrete, executable step that produces a deliverable`,
    `- **validation**: Verify a previous task's output meets acceptance criteria`,
    `- **decision**: Choose between alternatives based on research findings`,
    ``,
    `## Planning Phases (order tasks accordingly)`,
    `1. Research phase — what information must be gathered first?`,
    `2. Decision phase — what choices depend on research results?`,
    `3. Action phase — what concrete steps implement the chosen approach?`,
    `4. Validation phase — how to verify the outcome is correct?`,
    ``,
    `## Goal`,
    `"${goal.description}"`,
    `Priority: ${goal.priority}`,
    `Maximum nesting depth: ${maxDepth}`,
    capSection,
    ``,
    `## Rules`,
    `- Break the goal into at least 2 top-level tasks`,
    `- CRITICAL: Include at least one "action" task and one "validation" task at the TOP LEVEL`,
    `- Research tasks must be FLAT (no subTasks) — each answers a single question`,
    `- Decision tasks must be FLAT (no subTasks) — each chooses between specific alternatives`,
    `- Only "action" tasks may have subTasks for breakdown of complex deliverables`,
    `- Maximum ${Math.min(maxDepth, 3)} subTask levels — leaf tasks must be atomic`,
    `- Each task must have a clear "type" (research/action/validation/decision)`,
    `- Research tasks should come before action tasks that depend on their findings`,
    `- Every action task should have "acceptanceCriteria" (how to know it's done)`,
    `- Research/decision tasks should have "expectedOutput" (what they produce)`,
    `- Assign "riskLevel" based on destructiveness (low=read-only, high=state-changing, critical=irreversible)`,
    `- Assign "estimatedComplexity" based on effort required`,
    `- Include "rationale" explaining why each task exists`,
    `- Leaf tasks should be atomic (executable in one step)`,
    `- Tasks should be in logical execution order`,
    ``,
    `Return your answer as a JSON object with a single "tasks" array.`,
  ].join("\n");
}

/**
 * Calls the LLM with `withStructuredOutput` to produce a hierarchical
 * task decomposition, then hydrates the result with UUIDs and dependency chains.
 */
async function llmDecompose(
  goal: Goal,
  chatModel: BaseChatModel,
  capabilities: Array<{ goal: Goal; score: number }>,
  maxDepth: number,
  options: DecomposeOptions = {},
): Promise<Task[]> {
  const prompt = options.promptTemplate
    ? options.promptTemplate(goal, capabilities, maxDepth)
    : buildDecompositionPrompt(goal, capabilities, maxDepth);

  const structuredModel = chatModel.withStructuredOutput(DecompositionOutputSchema);
  const result = await structuredModel.invoke(prompt);

  return hydrateTasks(result.tasks, goal.priority);
}

/**
 * Converts the LLM-generated task tree into proper Task objects with UUIDs,
 * dependency chains (sequential: each task depends on the previous), and parentIds.
 */
function hydrateTasks(
  decomposed: DecomposedTask[],
  defaultPriority: Goal["priority"],
  parentId?: string,
): Task[] {
  const tasks: Task[] = [];
  const prevIds: string[] = [];

  for (const dt of decomposed) {
    const taskId = crypto.randomUUID();
    const deps = prevIds.length > 0 ? [prevIds[prevIds.length - 1]!] : [];
    prevIds.push(taskId);

    const subTasks = dt.subTasks.length > 0
      ? hydrateTasks(dt.subTasks, dt.priority ?? defaultPriority, taskId)
      : [];

    const task: Task = {
      id: taskId,
      description: dt.description,
      status: "pending",
      priority: dt.priority ?? defaultPriority,
      dependencies: deps,
      subTasks,
      type: dt.type ?? "action",
      ...(dt.acceptanceCriteria && { acceptanceCriteria: dt.acceptanceCriteria }),
      ...(dt.expectedOutput && { expectedOutput: dt.expectedOutput }),
      ...(dt.riskLevel && { riskLevel: dt.riskLevel }),
      ...(dt.estimatedComplexity && { estimatedComplexity: dt.estimatedComplexity }),
      ...(dt.rationale && { rationale: dt.rationale }),
    };
    if (parentId !== undefined) task.parentId = parentId;
    tasks.push(task);
  }

  return tasks;
}
