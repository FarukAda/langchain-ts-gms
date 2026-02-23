import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetEnv } from "../../../../src/config/env.js";

// Mock the LangChain Ollama module to avoid real instantiation.
vi.mock("@langchain/ollama", () => ({
  ChatOllama: class MockChatOllama {
    _type = "ollama";
    baseUrl: string;
    model: string;
    temperature: number;
    constructor(opts: { baseUrl: string; model: string; temperature: number }) {
      this.baseUrl = opts.baseUrl;
      this.model = opts.model;
      this.temperature = opts.temperature;
    }
  },
  OllamaEmbeddings: class MockOllamaEmbeddings {
    _type = "ollama";
    baseUrl: string;
    model: string;
    constructor(opts: { baseUrl: string; model: string }) {
      this.baseUrl = opts.baseUrl;
      this.model = opts.model;
    }
    embedQuery() {
      return Promise.resolve(new Array(384).fill(0) as number[]);
    }
    embedDocuments() {
      return Promise.resolve([] as number[][]);
    }
  },
}));

// Dynamic import AFTER mocks are set up
const { createChatModelProvider } = await import(
  "../../../../src/infra/chat/chatModelProvider.js"
);

describe("createChatModelProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnv();
  });

  it("returns ChatOllama with default config", () => {
    process.env.NODE_ENV = "test";
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_CHAT_MODEL = "llama3";

    const provider = createChatModelProvider();
    expect(provider).toBeDefined();
    expect((provider as unknown as { model: string }).model).toBe("llama3");
    expect((provider as unknown as { baseUrl: string }).baseUrl).toBe(
      "http://localhost:11434",
    );
  });

  it("uses GMS_OLLAMA_CHAT_MODEL when set", () => {
    process.env.NODE_ENV = "test";
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_CHAT_MODEL = "llama3";
    process.env.GMS_OLLAMA_CHAT_MODEL = "custom-chat";

    const provider = createChatModelProvider();
    expect((provider as unknown as { model: string }).model).toBe(
      "custom-chat",
    );
  });

  it("falls back to OLLAMA_CHAT_MODEL when GMS override is not set", () => {
    process.env.NODE_ENV = "test";
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_CHAT_MODEL = "llama3";
    delete process.env.GMS_OLLAMA_CHAT_MODEL;

    const provider = createChatModelProvider();
    expect((provider as unknown as { model: string }).model).toBe("llama3");
  });

  it("sets temperature to 0", () => {
    process.env.NODE_ENV = "test";
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_CHAT_MODEL = "llama3";

    const provider = createChatModelProvider();
    expect((provider as unknown as { temperature: number }).temperature).toBe(
      0,
    );
  });
});
