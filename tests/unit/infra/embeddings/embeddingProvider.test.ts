import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetEnv } from "../../../../src/config/env.js";

// Mock the LangChain embedding module to avoid real instantiation.
vi.mock("@langchain/ollama", () => ({
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
const { createEmbeddingProvider } =
  await import("../../../../src/infra/embeddings/embeddingProvider.js");

describe("createEmbeddingProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnv();
  });

  it("returns OllamaEmbeddings with default config", () => {
    process.env.NODE_ENV = "test";
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

    const provider = createEmbeddingProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.embedQuery).toBe("function");
  });

  it("uses GMS_OLLAMA_EMBEDDING_MODEL when set", () => {
    process.env.NODE_ENV = "test";
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";
    process.env.GMS_OLLAMA_EMBEDDING_MODEL = "custom-embed";

    const provider = createEmbeddingProvider();
    expect(provider).toBeDefined();
    expect((provider as unknown as { model: string }).model).toBe("custom-embed");
  });

  it("falls back to OLLAMA_EMBEDDING_MODEL when GMS override is not set", () => {
    process.env.NODE_ENV = "test";
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";
    delete process.env.GMS_OLLAMA_EMBEDDING_MODEL;

    const provider = createEmbeddingProvider();
    expect((provider as unknown as { model: string }).model).toBe("nomic-embed-text");
  });
});
