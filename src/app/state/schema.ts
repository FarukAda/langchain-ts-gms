import { Annotation } from "@langchain/langgraph";
import type { Goal, Task } from "../../domain/contracts.js";

/** Workflow phase indicator: tracks which stage of the GMS pipeline is active. */
export type GmsPhase = "planning" | "executing" | "summarizing" | "replanning";

/**
 * LangGraph state definition — shared across planner, guardrail, summarizer.
 *
 * `StateSchema` + `ReducedValue` (LangGraph v1.1+) is the preferred API for new
 * graphs, but `Annotation.Root` is used here because `@langchain/langgraph`
 * does **not** re-export `StateSchemaFieldsToStateDefinition` from its public
 * entry-point — it is only available from the internal path
 * `@langchain/langgraph/dist/state/schema.js`. When `declaration: true` is
 * enabled in tsconfig, TypeScript cannot name the inferred return type of
 * `createGmsWorkflow()` without a reference to that internal path, triggering
 * **TS2742**. Once the upstream package exports this type publicly, migrate
 * to `StateSchema` + `ReducedValue`.
 *
 * @see https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph.StateSchema.html
 */
export const GmsStateAnnotation = Annotation.Root({
  goal: Annotation<Goal>(),
  tasks: Annotation<Task[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentPhase: Annotation<GmsPhase>({
    reducer: (_prev, next) => next,
    default: () => "planning",
  }),
  error: Annotation<string | undefined>(),
  traceId: Annotation<string | undefined>(),
  humanApprovalPending: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
});

export type GmsState = typeof GmsStateAnnotation.State;
