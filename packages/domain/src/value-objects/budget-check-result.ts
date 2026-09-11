export interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly remainingMicros: number;
}
