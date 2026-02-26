export interface LogContext {
  traceId?: string | undefined;
  goalId?: string | undefined;
  node?: string | undefined;
  errorCode?: string | undefined;
  error?: string | undefined;
  durationMs?: number | undefined;
  [key: string]: unknown;
}

export interface StructuredLog {
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  ts: string;
  [key: string]: unknown;
}

/** Pluggable log writer. Override with `setLogWriter` to route structured logs externally. */
let _writer: (json: string) => void = (json) => console.log(json);

/** Replace the default `console.log` writer with a custom sink. */
export function setLogWriter(writer: (json: string) => void): void {
  _writer = writer;
}

/** When true, all structured logging is suppressed (useful in tests). */
let _silent = false;
/** Suppress all structured logging output (useful for silencing logs in tests). */
export function setLogSilent(value: boolean): void {
  _silent = value;
}

/** Numeric log level ordering for filtering (lower = more verbose). */
const LOG_LEVEL_ORDER: Record<StructuredLog["level"], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** The minimum log level to emit. Messages below this level are suppressed. */
let _minLevel: StructuredLog["level"] = "info";
let _levelInitialized = false;

/** Set the minimum log level (e.g. from env config). */
export function setLogLevel(level: StructuredLog["level"]): void {
  _minLevel = level;
  _levelInitialized = true;
}

/**
 * Emits structured JSON logs for observability. Use traceId for correlation across nodes.
 */
export function log(level: StructuredLog["level"], msg: string, context: LogContext = {}): void {
  if (_silent) return;
  if (!_levelInitialized) {
    _levelInitialized = true;
    const envLevel = process.env["LOG_LEVEL"];
    if (envLevel && envLevel in LOG_LEVEL_ORDER) {
      _minLevel = envLevel as StructuredLog["level"];
    }
  }
  if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[_minLevel]) return;
  const entry: Record<string, unknown> = {
    level,
    msg,
    ts: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(context)) {
    if (v !== undefined) entry[k] = v;
  }
  _writer(JSON.stringify(entry));
}

/** Emit a structured info-level log entry. */
export function logInfo(msg: string, context?: LogContext): void {
  log("info", msg, context);
}

/** Emit a structured warning-level log entry. */
export function logWarn(msg: string, context?: LogContext): void {
  log("warn", msg, context);
}

/** Emit a structured error-level log entry. */
export function logError(msg: string, context?: LogContext): void {
  log("error", msg, context);
}

/** Emit a structured debug-level log entry. */
export function logDebug(msg: string, context?: LogContext): void {
  log("debug", msg, context);
}

/** Canonical error codes used across GMS for structured error identification. */
export const ErrorCodes = {
  GOAL_NOT_FOUND: "GMS_GOAL_NOT_FOUND",
  TASK_NOT_FOUND: "GMS_TASK_NOT_FOUND",
  INVALID_INPUT: "GMS_INVALID_INPUT",
  INVALID_TRANSITION: "GMS_INVALID_TRANSITION",
  INVARIANT_VIOLATION: "GMS_INVARIANT_VIOLATION",
  INFRA_RETRIABLE: "GMS_INFRA_RETRIABLE",
  MISSING_DEPENDENCY: "GMS_MISSING_DEPENDENCY",
  CONCURRENT_MODIFICATION: "GMS_CONCURRENT_MODIFICATION",
  GUARDRAIL_BLOCKED: "GMS_GUARDRAIL_BLOCKED",
  RATE_LIMIT_EXCEEDED: "GMS_RATE_LIMIT_EXCEEDED",
} as const;

export async function withNodeTiming<T>(
  node: string,
  traceId: string | undefined,
  goalId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const start = Date.now();
  logDebug("Node start", { node, traceId, goalId });
  try {
    const out = await fn();
    logInfo("Node complete", { node, traceId, goalId, durationMs: Date.now() - start });
    return out;
  } catch (err) {
    logError("Node failed", {
      node,
      traceId,
      goalId,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
