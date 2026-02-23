import type { Goal, Task, TaskStatus, Priority, TaskType } from "../domain/contracts.js";
import { RESPONSE_CONTRACT_VERSION } from "../domain/contracts.js";
import { flattenTasks } from "../domain/taskUtils.js";
import type { GoalMemoryRepository } from "../infra/vector/goalMemoryRepository.js";
import { ErrorCodes } from "../infra/observability/tracing.js";
import type { GmsToolInput } from "./types.js";

/**
 * Mapped type that removes `null` from every property value.
 * Used as the return type of `stripNulls`.
 */
type StripNullProps<T> = {
  [K in keyof T]: Exclude<T[K], null>;
};

/**
 * Replace `null` values with `undefined` in a shallow copy of the input.
 *
 * Zod schemas use `.nullable().optional()` so they accept null during
 * validation, but downstream code expects proper JS types.  This helper
 * converts null → undefined without performing any type coercion.
 *
 * For tools that also need boolean/numeric coercion (e.g. tools with
 * `laxBool` / `laxInt` fields), use `coerceLifecycleInput` from
 * `lifecycleSchemas.ts` **before** calling `stripNulls`.
 */
export function stripNulls<T extends Record<string, unknown>>(obj: T): StripNullProps<T> {
  const copy = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(copy)) {
    if (copy[key] === null) {
      copy[key] = undefined;
    }
  }
  return copy as StripNullProps<T>;
}

/** Resolve alias fields (description, goal, input, query, etc.) to `goalDescription`. */
export function normalizeInput(input: GmsToolInput): GmsToolInput {
  const goalDescription =
    input.goalDescription ??
    input.description ??
    input.goal ??
    input.goal_description ??
    input.input ??
    input.query;
  if (!goalDescription || goalDescription.trim().length === 0) {
    throw new Error("Missing goal description");
  }
  return {
    ...input,
    goalDescription,
  };
}

/** Construct a new Goal domain object from normalized input. */
export function buildGoal(input: GmsToolInput): Goal {
  const goalDescription = input.goalDescription?.trim();
  if (!goalDescription) {
    throw new Error("Missing goal description");
  }
  const now = new Date().toISOString();
  const goal: Goal = {
    id: crypto.randomUUID(),
    description: goalDescription,
    status: "pending",
    priority: input.priority ?? "medium",
    tasks: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
  if (input.tenantId != null) goal.tenantId = input.tenantId;
  if (input.metadata != null) goal.metadata = input.metadata;
  return goal;
}

/** Find a task in a hierarchy by ID. */
export function findTaskById(tasks: Task[], taskId: string): Task | null {
  const flat = flattenTasks(tasks);
  return flat.find((t) => t.id === taskId) ?? null;
}

/** Find the parent task ID for a given task in a hierarchy. */
export function findParentTaskId(tasks: Task[], taskId: string): string | null {
  const stack: Array<{ node: Task; parentId?: string }> = tasks.map((t) => ({ node: t }));
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.node.id === taskId) return current.parentId ?? null;
    for (const child of current.node.subTasks) {
      stack.push({ node: child, parentId: current.node.id });
    }
  }
  return null;
}

/** Generic offset/limit pagination. */
export function paginate<T>(
  items: T[],
  limit: number,
  offset: number,
): { items: T[]; total: number } {
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, limit);
  return {
    items: items.slice(safeOffset, safeOffset + safeLimit),
    total: items.length,
  };
}

/** Filter predicate for task status, priority, and type arrays. */
export function matchesFilters(
  task: Task,
  status?: TaskStatus[] | string | null,
  priority?: Priority[] | string | null,
  type?: TaskType[] | string | null,
): boolean {
  const statusArr = Array.isArray(status) ? status : undefined;
  const priorityArr = Array.isArray(priority) ? priority : undefined;
  const typeArr = Array.isArray(type) ? type : undefined;
  if (statusArr && statusArr.length > 0 && !statusArr.includes(task.status)) return false;
  if (priorityArr && priorityArr.length > 0 && !priorityArr.includes(task.priority)) return false;
  if (typeArr && typeArr.length > 0 && (!task.type || !typeArr.includes(task.type))) return false;
  return true;
}

/** Remove failed tasks from a tree (recursive). */
export function removeFailedTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.status !== "failed")
    .map((t) => ({ ...t, subTasks: removeFailedTasks(t.subTasks) }));
}

/**
 * Hierarchy-preserving tree filter.
 * Retains a node if it matches the predicate OR if any descendant matches.
 */
export function filterTaskTree(tasks: Task[], predicate: (t: Task) => boolean): Task[] {
  return tasks
    .map((t) => {
      const filteredChildren = filterTaskTree(t.subTasks, predicate);
      if (predicate(t) || filteredChildren.length > 0) {
        return { ...t, subTasks: filteredChildren };
      }
      return null;
    })
    .filter((t): t is Task => t !== null);
}

/** Fetch a goal by ID or throw a domain error. */
export async function getGoalOrThrow(repo: GoalMemoryRepository, goalId: string): Promise<Goal> {
  const goal = await repo.getById(goalId);
  if (!goal) throw new Error(`[${ErrorCodes.GOAL_NOT_FOUND}] Goal not found: ${goalId}`);
  return goal;
}

/** Wrap a tool response with the contract version stamp. */
export function wrapToolResponse(data: Record<string, unknown>): string {
  return JSON.stringify({ version: RESPONSE_CONTRACT_VERSION, ...data });
}
