import { z } from "zod/v4";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  QDRANT_URL: z.url().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),

  OLLAMA_HOST: z.url().default("http://localhost:11434"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  OLLAMA_CHAT_MODEL: z.string().default("qwen3:8b"),
  GMS_OLLAMA_EMBEDDING_MODEL: z.string().optional(),
  GMS_OLLAMA_CHAT_MODEL: z.string().optional(),

  LANGCHAIN_TRACING_V2: z.stringbool().default(false),
  LANGCHAIN_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/** Reset cached env (for tests only) */
export function resetEnv(): void {
  _env = null;
}

/**
 * Loads and validates environment variables (cached after first call).
 * @note In tests, call `resetEnv()` before each test to avoid stale cached values
 *       from bleeding into subsequent test cases.
 */
export function loadEnv(): Env {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((e) => `${e.path.map(String).join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  _env = parsed.data;
  return _env;
}
