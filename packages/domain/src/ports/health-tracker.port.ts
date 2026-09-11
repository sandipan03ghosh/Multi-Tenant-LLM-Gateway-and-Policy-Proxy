// Continuous 0 (unhealthy) - 1 (healthy) signal from recent call outcomes — separate from
// CircuitBreaker: this ranks already-allowed candidates, it doesn't gate a call. adapters-redis.
export interface HealthTracker {
  recordSuccess(providerId: string): Promise<void>;
  recordFailure(providerId: string): Promise<void>;
  getScore(providerId: string): Promise<number>;
}
