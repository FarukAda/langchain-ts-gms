import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { OllamaEmbeddings } from "@langchain/ollama";
import { loadEnv } from "../../config/env.js";

/** Creates an Ollama embedding model from environment configuration. */
export function createEmbeddingProvider(): EmbeddingsInterface {
  const env = loadEnv();
  return new OllamaEmbeddings({
    baseUrl: env.OLLAMA_HOST,
    model: env.GMS_OLLAMA_EMBEDDING_MODEL ?? env.OLLAMA_EMBEDDING_MODEL,
  });
}
