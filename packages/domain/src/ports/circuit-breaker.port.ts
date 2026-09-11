import type { CircuitBreakerCheckResult } from "../value-objects/circuit-breaker-state.js";

// One state machine per (providerId, modelId) pair. Implemented by adapters-redis so every
// instance observes the same state immediately.
//
// checkAndReserve() is not a pure read: in the half-open case it atomically claims the single
// trial slot and returns an opaque trialToken. Callers MUST pass that token back to
// recordSuccess()/recordFailure() for a half-open trial's outcome — the implementation verifies
// it still matches the current reservation, so a stale report can't corrupt a later trial. Omit
// trialToken for a normal call.
export interface CircuitBreaker {
  checkAndReserve(providerId: string, modelId: string): Promise<CircuitBreakerCheckResult>;
  recordSuccess(providerId: string, modelId: string, trialToken?: string): Promise<void>;
  recordFailure(providerId: string, modelId: string, trialToken?: string): Promise<void>;
}
