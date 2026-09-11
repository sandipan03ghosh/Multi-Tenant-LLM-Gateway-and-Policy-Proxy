import type { RetryPolicy } from "@llm-gateway/domain";

export interface ExponentialBackoffRetryPolicyConfig {
  /** Total attempts including the first — e.g. 3 means "1 try + up to 2 retries". */
  readonly maxAttempts?: number;
  /** Base delay for the first retry, before jitter. */
  readonly baseDelayMs?: number;
  /** Ceiling the exponential delay is capped at, before jitter. */
  readonly maxDelayMs?: number;
}

const DEFAULT_CONFIG: Required<ExponentialBackoffRetryPolicyConfig> = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
};

// Full-jitter exponential backoff: delay = random(0, min(maxDelayMs, baseDelayMs * 2^attempt)),
// spreading retries from concurrent callers instead of having them retry in lockstep.
export class ExponentialBackoffRetryPolicy implements RetryPolicy {
  private readonly config: Required<ExponentialBackoffRetryPolicyConfig>;

  constructor(config: ExponentialBackoffRetryPolicyConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Fail fast on a misconfigured policy rather than silently degrade into "never retries",
    // "retry in a hot loop", or a max delay below the base delay.
    if (!Number.isInteger(this.config.maxAttempts) || this.config.maxAttempts < 1) {
      throw new Error(`ExponentialBackoffRetryPolicy: maxAttempts must be an integer >= 1, got ${this.config.maxAttempts}`);
    }
    if (this.config.baseDelayMs < 0) {
      throw new Error(`ExponentialBackoffRetryPolicy: baseDelayMs must be >= 0, got ${this.config.baseDelayMs}`);
    }
    if (this.config.maxDelayMs < this.config.baseDelayMs) {
      throw new Error(
        `ExponentialBackoffRetryPolicy: maxDelayMs (${this.config.maxDelayMs}) must be >= baseDelayMs (${this.config.baseDelayMs})`,
      );
    }
  }

  async execute<T>(operation: () => Promise<T>, isRetryable: (error: unknown) => boolean): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt === this.config.maxAttempts - 1;
        if (isLastAttempt || !isRetryable(error)) {
          throw error;
        }
        await this.sleep(this.computeDelayMs(attempt));
      }
    }
    // Unreachable given maxAttempts >= 1, but keeps the return type honest.
    throw lastError;
  }

  private computeDelayMs(attempt: number): number {
    const cappedExponential = Math.min(this.config.maxDelayMs, this.config.baseDelayMs * 2 ** attempt);
    return Math.random() * cappedExponential;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
