import type { Goal, Task, TaskStatus, TaskType, RiskLevel, Complexity } from "./contracts.js";
import { TaskStatusSchema, PrioritySchema } from "./contracts.js";

/**
 * Flattens a tree of tasks into a single array (DFS pre-order).
 * Used for guardrails, counting, and iteration.
 */
export function flattenTasks(tasks: Task[]): Task[] {
  const out: Task[] = [];
  function visit(t: Task) {
    out.push(t);
    for (const child of t.subTasks) visit(child);
  }
  for (const t of tasks) visit(t);
  return out;
}

/**
 * Total count of tasks in the tree (including nested).
 */
export function countTasks(tasks: Task[]): number {
  return flattenTasks(tasks).length;
}

/**
 * Topological execution order: tasks whose dependencies are satisfied come first.
 * Dependencies can reference sibling or ancestor tasks by id.
 *
 * @throws {Error} if a dependency cycle is detected
 */
export function executionOrder(tasks: Task[]): Task[] {
  const flat = flattenTasks(tasks);
  const byId = new Map(flat.map((t) => [t.id, t]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: Task[] = [];

  function visit(t: Task) {
    if (visited.has(t.id)) return;
    if (visiting.has(t.id)) {
      throw new Error(`Dependency cycle detected involving task ${t.id}`);
    }
    visiting.add(t.id);
    for (const depId of t.dependencies) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(t.id);
    visited.add(t.id);
    result.push(t);
  }

  for (const t of flat) visit(t);
  return result;
}

/**
 * Migrates legacy payload (flat sub_tasks or tasks) to hierarchical Task[].
 * Ensures each node has subTasks array for backward compatibility.
 */
export function migrateTasksToHierarchy(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    const t = item as Record<string, unknown>;
    const subTasks = Array.isArray(t.subTasks) ? migrateTasksToHierarchy(t.subTasks) : [];

    const statusParse = TaskStatusSchema.safeParse(t.status);
    const status: TaskStatus = statusParse.success ? statusParse.data : "pending";

    const priorityParse = PrioritySchema.safeParse(t.priority);
    const priority: Task["priority"] = priorityParse.success ? priorityParse.data : "medium";

    return {
      id: typeof t.id === "string" ? t.id : crypto.randomUUID(),
      description: typeof t.description === "string" ? t.description : "",
      status,
      priority,
      dependencies: Array.isArray(t.dependencies) ? (t.dependencies as string[]) : [],
      subTasks,
      ...(t.parentId !== undefined && { parentId: t.parentId as string }),
      ...(t.result !== undefined && { result: t.result as string }),
      ...(t.error !== undefined && { error: t.error as string }),
      ...(t.capabilityId !== undefined && { capabilityId: t.capabilityId as string }),
      // --- Rich metadata ---
      ...(t.type !== undefined && { type: t.type as TaskType }),
      ...(t.acceptanceCriteria !== undefined && {
        acceptanceCriteria: t.acceptanceCriteria as string,
      }),
      ...(t.expectedOutput !== undefined && { expectedOutput: t.expectedOutput as string }),
      ...(t.riskLevel !== undefined && { riskLevel: t.riskLevel as RiskLevel }),
      ...(t.estimatedComplexity !== undefined && {
        estimatedComplexity: t.estimatedComplexity as Complexity,
      }),
      ...(t.rationale !== undefined && { rationale: t.rationale as string }),
    } satisfies Task;
  });
}

/**
 * Updates a task in the tree by id. Returns a new tree (immutable).
 */
export function updateTaskById(tasks: Task[], taskId: string, updater: (t: Task) => Task): Task[] {
  return tasks.map((t) => {
    if (t.id === taskId) return updater(t);
    if (t.subTasks.length > 0) {
      return { ...t, subTasks: updateTaskById(t.subTasks, taskId, updater) };
    }
    return t;
  });
}

/** Allowed status transitions for deterministic lifecycle behavior. */
const ALLOWED_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress", "cancelled", "failed", "completed"],
  in_progress: ["completed", "failed", "cancelled"],
  completed: ["completed"],
  failed: ["in_progress", "failed", "cancelled"],
  cancelled: ["cancelled"],
  planned: ["pending", "planned"],
};

/** True if moving from current status to next status is allowed. */
export function canTransitionTaskStatus(current: TaskStatus, next: TaskStatus): boolean {
  return ALLOWED_STATUS_TRANSITIONS[current]?.includes(next) ?? false;
}

/** Result object returned by goal-tree invariant validation. */
export interface GoalInvariantResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validate structural and lifecycle invariants for a goal/task tree:
 * - unique ids
 * - parent-child consistency
 * - dependency references and no self-deps
 * - no dependency cycles
 */
export function validateGoalInvariants(goal: Goal): GoalInvariantResult {
  const issues: string[] = [];
  const flat = flattenTasks(goal.tasks);
  const byId = new Map<string, Task>();
  const duplicates = new Set<string>();

  for (const t of flat) {
    if (byId.has(t.id)) duplicates.add(t.id);
    byId.set(t.id, t);
  }
  if (duplicates.size > 0) {
    issues.push(`Duplicate task IDs: ${Array.from(duplicates).join(", ")}`);
  }

  for (const t of flat) {
    for (const child of t.subTasks) {
      if (child.parentId !== undefined && child.parentId !== t.id) {
        issues.push(`Task ${child.id} parentId mismatch: expected ${t.id}, got ${child.parentId}`);
      }
    }
    for (const dep of t.dependencies) {
      if (!byId.has(dep)) issues.push(`Task ${t.id} depends on missing task ${dep}`);
      if (dep === t.id) issues.push(`Task ${t.id} depends on itself`);
    }
  }

  const graph = new Map<string, string[]>();
  for (const t of flat) graph.set(t.id, [...t.dependencies]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[] = [];
  const dfs = (id: string): void => {
    if (visiting.has(id)) {
      cycles.push(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) dfs(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) dfs(id);
  if (cycles.length > 0) {
    issues.push(`Dependency cycles detected near: ${Array.from(new Set(cycles)).join(", ")}`);
  }

  return { valid: issues.length === 0, issues };
}
