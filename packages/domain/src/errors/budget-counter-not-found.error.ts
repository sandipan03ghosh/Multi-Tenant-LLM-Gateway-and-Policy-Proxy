// Thrown by BudgetCounterStore.adjust() when the target key doesn't exist — a true-up must never
// invent a fresh counter for a key with no known prior state. DefaultBudgetEnforcer.debit()
// catches this and logs.
export class BudgetCounterNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Budget counter "${key}" not found — refusing to true-up a reservation with no known prior state`);
    this.name = "BudgetCounterNotFoundError";
  }
}
