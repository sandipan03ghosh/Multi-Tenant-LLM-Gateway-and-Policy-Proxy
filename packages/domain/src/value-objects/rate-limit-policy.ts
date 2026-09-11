// Only the token-bucket shape exists today; an `algorithm` discriminant is deliberately not
// added yet — see RateLimitAlgorithm's port docs.
export interface RateLimitPolicy {
  /** Maximum tokens the bucket can hold — the burst ceiling. */
  readonly capacity: number;
  /** Tokens added back per refillIntervalMs. */
  readonly refillTokens: number;
  /** Refill cadence, in milliseconds. */
  readonly refillIntervalMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Tokens left in the bucket immediately after this call. */
  readonly remaining: number;
  /** Only present when allowed is false — advisory time until a retry could plausibly succeed. */
  readonly retryAfterMs?: number;
}
