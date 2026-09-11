// Amounts are integer micros (1 unit = 1e-6 of `currency`), same convention as CostBreakdown/
// CostLedgerEntry, so budget and cost arithmetic never need conversion.
export interface BudgetPolicy {
  readonly period: "daily" | "monthly";
  readonly hardLimitMicros: number;
  // Crossing this (if set) is a soft warning, not a hard-stop.
  readonly softLimitMicros: number | null;
  readonly currency: string;
  // Reserved atomically at admission time (before this request's real cost is known), then trued
  // up once the response completes. Bounds how far concurrent in-flight requests can collectively
  // overshoot the hard limit. Optional — DefaultBudgetEnforcer applies a default when omitted.
  readonly reservationMicros?: number;
}
