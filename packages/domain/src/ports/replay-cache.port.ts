// Generic one-time-use marker (request-signing replay defense) — resolves true the first time
// `key` is seen within ttlMs, false on any subsequent call before it expires.
export interface ReplayCache {
  checkAndRecord(key: string, ttlMs: number): Promise<boolean>;
}
