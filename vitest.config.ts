import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

// Load .env into process.env so agent tests pick up OLLAMA_CHAT_MODEL etc.
// cross-env values from npm scripts still take precedence (already in process.env).
try {
  const envFile = readFileSync(".env", "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    // Only set if not already defined (preserves cross-env overrides)
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file not found — fine, env vars come from the shell
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    reporters: ["default", "allure-vitest/reporter"],
    setupFiles: ["allure-vitest/setup"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
