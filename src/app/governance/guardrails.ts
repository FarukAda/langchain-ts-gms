import type { Task } from "../../domain/contracts.js";
import { flattenTasks } from "../../domain/taskUtils.js";

/**
 * Default forbidden patterns (case-insensitive) that block execution.
 *
 * @todo Consider making forbidden patterns configurable per-tenant or
 *       per-environment via WorkflowDeps / GuardrailConfig. This would
 *       allow teams to add domain-specific blockers without code changes.
 */
export const DEFAULT_FORBIDDEN_PATTERNS: readonly string[] = [
  "delete production",
  "drop database",
  "overwrite production",
  "rm -rf /",
  "format c:",
  "wipe all",
  "destroy data",
];

/** Default maximum task count before requiring human approval. */
export const DEFAULT_MAX_TASK_COUNT = 10;

export interface GuardrailOptions {
  /** Patterns (case-insensitive substrings) that block execution. Defaults to `DEFAULT_FORBIDDEN_PATTERNS`. */
  forbiddenPatterns?: readonly string[];
}

export interface HumanApprovalOptions {
  /** Maximum number of tasks (including nested) before requiring human approval. Defaults to `DEFAULT_MAX_TASK_COUNT`. */
  maxTaskCount?: number;
}

/**
 * Policy guardrail: checks proposed tasks (including nested) against forbidden patterns.
 * Returns { allowed: false, reason } if any task violates policy.
 *
 * @param tasks       – hierarchical task tree
 * @param options     – override forbidden patterns
 * @param preFlat     – optional pre-flattened tasks to avoid redundant flattening
 */
export function checkGuardrail(
  tasks: Task[],
  options: GuardrailOptions = {},
  preFlat?: Task[],
): { allowed: true } | { allowed: false; reason: string } {
  const patterns = options.forbiddenPatterns ?? DEFAULT_FORBIDDEN_PATTERNS;
  const flat = preFlat ?? flattenTasks(tasks);
  const lower = (s: string) => s.toLowerCase();
  for (const task of flat) {
    const desc = lower(task.description);
    for (const pattern of patterns) {
      if (desc.includes(lower(pattern))) {
        return {
          allowed: false,
          reason: `Task violates policy: "${pattern}" detected in "${task.description}"`,
        };
      }
    }
  }
  return { allowed: true };
}

/**
 * Determines if a plan requires human approval (e.g. many tasks, high-risk).
 * Counts all tasks in the hierarchy.
 *
 * @param tasks       – hierarchical task tree
 * @param options     – override max task count
 * @param preFlat     – optional pre-flattened tasks to avoid redundant flattening
 */
export function requiresHumanApproval(
  tasks: Task[],
  options: HumanApprovalOptions = {},
  preFlat?: Task[],
): boolean {
  const max = options.maxTaskCount ?? DEFAULT_MAX_TASK_COUNT;
  const flat = preFlat ?? flattenTasks(tasks);
  if (flat.length > max) return true;
  // Any task with critical or high risk level triggers human approval
  return flat.some((t) => t.riskLevel === "critical" || t.riskLevel === "high");
}

/** Combined guardrail + human approval evaluation. Flattens the task tree once. */
export interface GuardrailResult {
  check: { allowed: true } | { allowed: false; reason: string };
  needsHumanApproval: boolean;
  flatCount: number;
}

/**
 * Evaluate both policy guardrails and human-approval requirements in a single
 * pass over the flattened task tree.
 */
export function evaluateGuardrails(
  tasks: Task[],
  guardOpts: GuardrailOptions = {},
  approvalOpts: HumanApprovalOptions = {},
): GuardrailResult {
  const flat = flattenTasks(tasks);
  const check = checkGuardrail(tasks, guardOpts, flat);
  const needsHumanApproval = check.allowed
    ? requiresHumanApproval(tasks, approvalOpts, flat)
    : false;
  return { check, needsHumanApproval, flatCount: flat.length };
}
