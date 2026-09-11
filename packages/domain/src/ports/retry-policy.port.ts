// A logical call may be retried internally, but produces exactly one final outcome — callers
// record circuit-breaker/health state once per candidate, not once per attempt.
//
// `isRetryable` is supplied by the caller so RetryPolicy stays agnostic of any error shape.
export interface RetryPolicy {
  execute<T>(operation: () => Promise<T>, isRetryable: (error: unknown) => boolean): Promise<T>;
}
