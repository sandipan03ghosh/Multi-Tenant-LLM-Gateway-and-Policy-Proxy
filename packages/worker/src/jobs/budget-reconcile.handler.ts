import { z } from "zod";
import type { JobHandler, JobEnqueuer } from "@llm-gateway/domain";
import { RECONCILE_INTERVAL_MS } from "@llm-gateway/application";
import type { DefaultBudgetEnforcer } from "@llm-gateway/application";

const budgetReconcilePayloadSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  periodKey: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
});

// Self-rescheduling recurring job. DefaultBudgetEnforcer.armReconciliation() enqueues one per
// tenant+period (Redis-guarded), and this handler re-enqueues it every RECONCILE_INTERVAL_MS
// until periodEnd — never past it, or a finished period would reconcile forever.
export function createBudgetReconcileHandler(budgetEnforcer: DefaultBudgetEnforcer, jobEnqueuer: JobEnqueuer): JobHandler {
  return async (payload: unknown): Promise<void> => {
    const parsed = budgetReconcilePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`budget_reconcile: payload failed validation: ${JSON.stringify(z.flattenError(parsed.error))}`);
    }
    const { organizationId, projectId, periodKey, periodStart, periodEnd } = parsed.data;
    const periodStartDate = new Date(periodStart);
    const periodEndDate = new Date(periodEnd);

    // reconcile() never throws; the next scheduled run retries naturally.
    await budgetEnforcer.reconcile(organizationId, projectId, periodKey, periodStartDate, periodEndDate);

    if (Date.now() >= periodEndDate.getTime()) {
      return;
    }
    try {
      await jobEnqueuer.enqueue({ type: "budget_reconcile", payload: parsed.data }, { runAt: new Date(Date.now() + RECONCILE_INTERVAL_MS) });
    } catch (error) {
      console.error(`budget_reconcile: failed to re-enqueue the next reconciliation run for org=${organizationId}:`, error);
    }
  };
}
