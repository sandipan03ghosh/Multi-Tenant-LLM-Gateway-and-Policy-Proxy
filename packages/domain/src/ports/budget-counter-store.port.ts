// Redis fast-path counter for Budget Enforcement — CostLedgerRepository is the durable source of
// truth; this store holds an approximate, periodically-reconciled "remaining budget" figure for
// a cheap admission gate.
export interface BudgetCounterStore {
  // Atomically checks whether `key`'s remaining value (lazily initialized to `limitMicros`)
  // covers `reservationMicros`, and if so decrements it — one atomic check-and-decrement.
  // Nothing is mutated when the check fails.
  reserve(
    key: string,
    reservationMicros: number,
    limitMicros: number,
    ttlMs: number,
  ): Promise<{ allowed: boolean; remainingMicros: number }>;

  // Atomically applies a delta (may be negative) — trues up a prior reserve() to the real cost.
  // Throws BudgetCounterNotFoundError if `key` doesn't exist rather than seeding one. `ttlMs`
  // refreshes the existing key's expiry.
  adjust(key: string, deltaMicros: number, ttlMs: number): Promise<number>;

  // Unconditionally overwrites the counter with a value re-derived from the ledger —
  // reconciliation only, never on the request path.
  reconcile(key: string, remainingMicros: number, ttlMs: number): Promise<void>;

  // Atomically claims a one-time flag (true only for the first caller) — so only the first
  // request to touch a tenant+period arms that period's recurring reconciliation job.
  tryArmOnce(key: string, ttlMs: number): Promise<boolean>;
}
