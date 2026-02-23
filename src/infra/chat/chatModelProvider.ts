import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";
import { loadEnv } from "../../config/env.js";

/** Creates an Ollama chat model from environment configuration. */
export function createChatModelProvider(): BaseChatModel {
  const env = loadEnv();
  return new ChatOllama({
    baseUrl: env.OLLAMA_HOST,
    model: env.GMS_OLLAMA_CHAT_MODEL ?? env.OLLAMA_CHAT_MODEL,
    temperature: 0,
  });
}
