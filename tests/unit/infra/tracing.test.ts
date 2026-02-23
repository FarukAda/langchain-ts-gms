import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  log,
  logInfo,
  logWarn,
  logError,
  logDebug,
  setLogSilent,
  setLogLevel,
  setLogWriter,
  withNodeTiming,
  ErrorCodes,
} from "../../../src/infra/observability/tracing.js";
import type * as TracingModule from "../../../src/infra/observability/tracing.js";

describe("tracing", () => {
  beforeEach(() => {
    setLogSilent(false);
    setLogLevel("debug");
    // Reset the writer to default console.log before each test
    setLogWriter((json) => console.log(json));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    setLogSilent(true);
    setLogLevel("info");
    setLogWriter((json) => console.log(json));
    vi.restoreAllMocks();
  });

  describe("log levels", () => {
    it("emits structured JSON for info", () => {
      logInfo("test message", { goalId: "g1" });
      expect(console.log).toHaveBeenCalledOnce();
      const entry = JSON.parse(
        (console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string,
      ) as { level: string; msg: string; goalId: string };
      expect(entry.level).toBe("info");
      expect(entry.msg).toBe("test message");
      expect(entry.goalId).toBe("g1");
    });

    it("emits warn level", () => {
      logWarn("warning");
      const entry = JSON.parse(
        (console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string,
      ) as { level: string };
      expect(entry.level).toBe("warn");
    });

    it("emits error level", () => {
      logError("error");
      const entry = JSON.parse(
        (console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string,
      ) as { level: string };
      expect(entry.level).toBe("error");
    });

    it("emits debug level", () => {
      logDebug("debug");
      const entry = JSON.parse(
        (console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string,
      ) as { level: string };
      expect(entry.level).toBe("debug");
    });

    it("suppresses info when minLevel is warn", () => {
      setLogLevel("warn");
      logInfo("suppressed");
      expect(console.log).not.toHaveBeenCalled();
      logWarn("visible");
      expect(console.log).toHaveBeenCalledOnce();
    });

    it("suppresses debug and info when minLevel is error", () => {
      setLogLevel("error");
      logDebug("suppressed");
      logInfo("suppressed");
      logWarn("suppressed");
      expect(console.log).not.toHaveBeenCalled();
      logError("visible");
      expect(console.log).toHaveBeenCalledOnce();
    });

    it("omits undefined context values from log entry", () => {
      logInfo("no-ctx", { traceId: undefined, goalId: "g1" });
      const entry = JSON.parse(
        (console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string,
      ) as Record<string, unknown>;
      expect(entry.goalId).toBe("g1");
      expect("traceId" in entry).toBe(false);
    });

    it("does not overwrite explicit setLogLevel with env fallback", () => {
      // Simulate: explicit level set BEFORE any log() call
      setLogLevel("error");
      // This log should be suppressed because "debug" < "error"
      logDebug("should be suppressed");
      expect(console.log).not.toHaveBeenCalled();
      // This log should emit because "error" >= "error"
      logError("should be visible");
      expect(console.log).toHaveBeenCalledOnce();
    });
  });

  describe("setLogSilent", () => {
    it("suppresses all logging when silent", () => {
      setLogSilent(true);
      log("info", "should be silent");
      expect(console.log).not.toHaveBeenCalled();
    });

    it("re-enables logging when unsilenced", () => {
      setLogSilent(true);
      setLogSilent(false);
      log("info", "should be visible");
      expect(console.log).toHaveBeenCalledOnce();
    });
  });

  describe("env-based log level fallback", () => {
    it("reads LOG_LEVEL from env when setLogLevel was not called", async () => {
      // Use a fresh module to reset internal state (_levelInitialized = false)
      const {
        log: freshLog,
        setLogSilent: freshSilent,
        setLogWriter: freshWriter,
      } = (await import(
        "../../../src/infra/observability/tracing.js?env-test" + Date.now()
      )) as typeof TracingModule;
      freshSilent(false);
      const captured: string[] = [];
      freshWriter((json: string) => captured.push(json));
      process.env.LOG_LEVEL = "warn";
      // "info" should be suppressed because env LOG_LEVEL is "warn"
      freshLog("info", "should-be-suppressed");
      // "warn" should pass
      freshLog("warn", "should-be-visible");
      expect(captured).toHaveLength(1);
      const entry = JSON.parse(captured[0]!) as { msg: string };
      expect(entry.msg).toBe("should-be-visible");
    });
  });

  describe("setLogWriter", () => {
    it("routes logs to custom writer", () => {
      const captured: string[] = [];
      setLogWriter((json) => captured.push(json));

      logInfo("routed message");

      expect(captured).toHaveLength(1);
      const entry = JSON.parse(captured[0]!) as { msg: string };
      expect(entry.msg).toBe("routed message");
      // console.log should NOT be called because custom writer was set
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("ErrorCodes", () => {
    it("defines all expected error codes", () => {
      expect(ErrorCodes.GOAL_NOT_FOUND).toBe("GMS_GOAL_NOT_FOUND");
      expect(ErrorCodes.TASK_NOT_FOUND).toBe("GMS_TASK_NOT_FOUND");
      expect(ErrorCodes.INVALID_INPUT).toBe("GMS_INVALID_INPUT");
      expect(ErrorCodes.INVALID_TRANSITION).toBe("GMS_INVALID_TRANSITION");
      expect(ErrorCodes.INVARIANT_VIOLATION).toBe("GMS_INVARIANT_VIOLATION");
      expect(ErrorCodes.INFRA_RETRIABLE).toBe("GMS_INFRA_RETRIABLE");
      expect(ErrorCodes.MISSING_DEPENDENCY).toBe("GMS_MISSING_DEPENDENCY");
    });

    it("has 7 error codes", () => {
      expect(Object.keys(ErrorCodes)).toHaveLength(7);
    });
  });

  describe("withNodeTiming", () => {
    it("returns result and logs start/complete", async () => {
      const result = await withNodeTiming("test_node", "trace-1", "goal-1", () => 42);
      expect(result).toBe(42);
      // debug (start) + info (complete) = 2 calls
      expect(console.log).toHaveBeenCalledTimes(2);
    });

    it("logs error and rethrows on failure", async () => {
      await expect(
        withNodeTiming("fail_node", "trace-2", "goal-2", () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      // debug (start) + error (failed) = 2 calls
      expect(console.log).toHaveBeenCalledTimes(2);
      const errorCall = JSON.parse(
        (console.log as ReturnType<typeof vi.fn>).mock.calls[1]![0] as string,
      ) as { level: string; error: string };
      expect(errorCall.level).toBe("error");
      expect(errorCall.error).toBe("boom");
    });

    it("handles non-Error throw values", async () => {
      await expect(
        withNodeTiming("fail_node", "trace-3", "goal-3", () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "string-error";
        }),
      ).rejects.toBe("string-error");
      const errorCall = JSON.parse(
        (console.log as ReturnType<typeof vi.fn>).mock.calls[1]![0] as string,
      ) as { error: string };
      expect(errorCall.error).toBe("string-error");
    });

    it("works with async functions", async () => {
      const result = await withNodeTiming("async_node", undefined, "goal-3", () =>
        Promise.resolve("async-result"),
      );
      expect(result).toBe("async-result");
    });
  });
});
