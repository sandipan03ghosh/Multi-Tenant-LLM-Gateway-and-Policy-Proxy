import type { BudgetPolicy } from "@llm-gateway/domain";

export interface ResolvedPeriod {
  /** Stable string identifying this period instance, e.g. "2026-08-09" or "2026-08". */
  readonly periodKey: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

// Pure function, UTC calendar boundaries — so the reconciliation job and the API process never
// disagree about where a period starts/ends regardless of process timezone.
export function resolvePeriod(policy: BudgetPolicy, now: Date): ResolvedPeriod {
  if (policy.period === "daily") {
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const periodEnd = new Date(periodStart.getTime());
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
    return { periodKey: periodStart.toISOString().slice(0, 10), periodStart, periodEnd };
  }

  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodKey: periodStart.toISOString().slice(0, 7), periodStart, periodEnd };
}
