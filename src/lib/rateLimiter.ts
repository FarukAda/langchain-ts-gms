/**
 * A simple in-process token-bucket rate limiter.
 *
 * Designed for use as `GmsToolDeps.rateLimiter` to throttle tool invocations
 * and prevent resource exhaustion of backing services (Ollama, Qdrant).
 *
 * @example
 * ```ts
 * const limiter = new TokenBucketLimiter({ maxTokens: 10, refillRatePerSecond: 2 });
 * // In a tool handler:
 * await limiter.acquire(); // blocks until a token is available
 * ```
 */
export class TokenBucketLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRatePerSecond: number;
  private readonly waitTimeoutMs: number;
  private lastRefillTime: number;

  constructor(options: {
    /** Maximum tokens in the bucket. */
    maxTokens: number;
    /** Tokens added per second. */
    refillRatePerSecond: number;
    /** Maximum time (ms) to wait for a token before throwing. Defaults to 30 000. */
    waitTimeoutMs?: number;
  }) {
    this.maxTokens = options.maxTokens;
    this.refillRatePerSecond = options.refillRatePerSecond;
    this.waitTimeoutMs = options.waitTimeoutMs ?? 30_000;
    this.tokens = options.maxTokens;
    this.lastRefillTime = Date.now();
  }

  /** Refill tokens based on elapsed time since last refill. */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000;
    const refilled = elapsed * this.refillRatePerSecond;
    this.tokens = Math.min(this.maxTokens, this.tokens + refilled);
    this.lastRefillTime = now;
  }

  /**
   * Acquire a single token. Resolves immediately if a token is available,
   * otherwise waits until a token becomes available via refill.
   *
   * @throws {RateLimitError} if no token becomes available within `waitTimeoutMs`.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait for refill
    const msPerToken = 1000 / this.refillRatePerSecond;
    const deadline = Date.now() + this.waitTimeoutMs;

    return new Promise<void>((resolve, reject) => {
      const check = (): void => {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new RateLimitError(Math.ceil(msPerToken)));
          return;
        }
        setTimeout(check, Math.min(msPerToken, 100));
      };
      setTimeout(check, Math.min(msPerToken, 100));
    });
  }
}

/**
 * Thrown when the rate limiter cannot acquire a token within the configured timeout.
 */
export class RateLimitError extends Error {
  readonly code = "GMS_RATE_LIMIT_EXCEEDED" as const;
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`[GMS_RATE_LIMIT_EXCEEDED] Rate limit exceeded. Retry after ~${retryAfterMs}ms.`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}
