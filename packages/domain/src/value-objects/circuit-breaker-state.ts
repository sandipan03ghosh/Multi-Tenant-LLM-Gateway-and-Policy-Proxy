export type CircuitBreakerState = "closed" | "open" | "half_open";

// trialToken is set only when state is "half_open" and this call was granted the trial. The
// caller passes it back to recordSuccess()/recordFailure() so the implementation can verify the
// report still matches the current reservation before driving a state transition.
export interface CircuitBreakerCheckResult {
  readonly allowed: boolean;
  readonly state: CircuitBreakerState;
  readonly trialToken?: string;
}
