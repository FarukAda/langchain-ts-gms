import { describe, it, expect, beforeEach } from "vitest";
import { loadEnv, resetEnv } from "../../../src/config/env.js";

describe("loadEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  it("returns valid config with defaults when minimal env is set", () => {
    process.env.NODE_ENV = "test";
    const env = loadEnv();
    expect(env.NODE_ENV).toBe("test");
    expect(env.QDRANT_URL).toBe("http://localhost:6333");
  });

  it("accepts OLLAMA_HOST as optional", () => {
    process.env.NODE_ENV = "test";
    process.env.OLLAMA_HOST = "http://localhost:11434";
    const env = loadEnv();
    expect(env.OLLAMA_HOST).toBe("http://localhost:11434");
  });

  it("rejects invalid NODE_ENV value", () => {
    process.env.NODE_ENV = "staging";
    expect(() => loadEnv()).toThrow("Invalid environment configuration");
  });

  it("rejects invalid LOG_LEVEL value", () => {
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "verbose";
    expect(() => loadEnv()).toThrow("Invalid environment configuration");
  });

  it("rejects invalid QDRANT_URL format", () => {
    process.env.NODE_ENV = "test";
    process.env.QDRANT_URL = "not-a-url";
    expect(() => loadEnv()).toThrow("Invalid environment configuration");
  });

  it("returns cached env on subsequent calls without reset", () => {
    process.env.NODE_ENV = "test";
    const first = loadEnv();
    const second = loadEnv();
    expect(first).toBe(second); // same reference
  });
});
