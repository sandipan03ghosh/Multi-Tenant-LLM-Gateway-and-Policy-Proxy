import { randomUUID } from "node:crypto";
import { ConfigurationNotFoundError, BudgetCounterNotFoundError } from "@llm-gateway/domain";
import type {
  BudgetPolicy,
  BudgetCheckResult,
  BudgetCounterStore,
  CostLedgerRepository,
  JobEnqueuer,
  TenantContext,
  TenantScope,
  ConfigurationService,
  AlertPublisher,
  DomainAlertEvent,
} from "@llm-gateway/domain";
import { BUDGET_POLICY_CONFIG_KEY, toTenantScope } from "./budget-config-keys.js";
import { resolvePeriod } from "./budget-period.js";
import type { ResolvedPeriod } from "./budget-period.js";

// Signals that a budget.policy value exists but is the wrong shape — distinct from "not configured".
class BudgetConfigInvalidError extends Error {}

// Conservative per-request placeholder to reserve *something* atomically before the real cost is
// known. Operators can override per policy (must be > 0).
const DEFAULT_RESERVATION_MICROS = 1_000;

// How often an armed reconciliation job re-runs for a tenant+period (worker-side loop is in
// budget-reconcile.handler.ts).
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

// Returned by checkAndReserve() — `period` is the exact window the reservation was taken against.
// The caller must pass this same value back into debit(), never let debit() recompute its own.
export interface BudgetReservation extends BudgetCheckResult {
  readonly period?: ResolvedPeriod;
}

// No domain port wraps this class — nothing needs to swap the orchestration, only the counter
// store underneath it. Redis (BudgetCounterStore) is the fast path only; every number it
// produces is provisional and corrected by reconcile() against the append-only Postgres ledger.
// Being wrong in Redis only costs precision until the next reconciliation, never billing correctness.
export class DefaultBudgetEnforcer {
  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly budgetCounterStore: BudgetCounterStore,
    private readonly costLedgerRepository: CostLedgerRepository,
    private readonly jobEnqueuer: JobEnqueuer,
    private readonly alertPublisher: AlertPublisher,
  ) {}

  // Pre-request gate. Atomically reserves a provisional amount — the real cost isn't known until
  // the provider call completes, so debit() trues it up afterward. Redis failure -> fail closed.
  async checkAndReserve(tenant: TenantContext): Promise<BudgetReservation> {
    let policy: BudgetPolicy | null;
    try {
      policy = await this.resolvePolicy(toTenantScope(tenant));
    } catch (error) {
      if (error instanceof BudgetConfigInvalidError) {
        console.error("BudgetEnforcer: configured budget.policy value is invalid (failing closed):", error.message);
        return { allowed: false, remainingMicros: 0 };
      }
      throw error;
    }
    if (policy === null) {
      return { allowed: true, remainingMicros: Number.POSITIVE_INFINITY };
    }

    const resolved = resolvePeriod(policy, new Date());
    const key = this.keyFor(tenant.organizationId, tenant.projectId, resolved.periodKey);
    const reservationMicros = policy.reservationMicros ?? DEFAULT_RESERVATION_MICROS;
    const ttlMs = this.ttlFor(resolved);

    let result: BudgetCheckResult;
    try {
      result = await this.budgetCounterStore.reserve(key, reservationMicros, policy.hardLimitMicros, ttlMs);
    } catch (error) {
      console.error("BudgetEnforcer: BudgetCounterStore.reserve() failed (failing closed):", error);
      return { allowed: false, remainingMicros: 0, period: resolved };
    }

    if (result.allowed) {
      // Fire-and-forget: arming reconciliation must never affect the admission decision already
      // computed above.
      void this.armReconciliation(tenant.organizationId, tenant.projectId, resolved);
    } else {
      // A genuine hard-limit hit (not an infra failure) — critical. Every denied request re-fires
      // this (no dedup) — an operator wants visibility into a hard stop continuing to happen.
      void this.alertPublisher.publish(
        this.buildAlertEvent(tenant, "critical", "budget.hard_stop", "Budget hard limit reached — request denied", {
          hardLimitMicros: policy.hardLimitMicros,
        }),
      );
    }
    return { ...result, period: resolved };
  }

  // Fire-and-forget safe: every path resolves, never rejects. Trues up the provisional
  // reservation to the now-known real cost.
  //
  // `period` must be the exact ResolvedPeriod checkAndReserve() returned — recomputing it here
  // would be a bug: a request straddling a period boundary would true up the wrong period's counter.
  async debit(tenant: TenantContext, actualCostMicros: number, period: ResolvedPeriod): Promise<void> {
    let policy: BudgetPolicy | null;
    try {
      policy = await this.resolvePolicy(toTenantScope(tenant));
    } catch (error) {
      console.error("BudgetEnforcer: debit() could not resolve budget.policy (skipping true-up):", error);
      return;
    }
    if (policy === null) {
      // Policy was removed between reserve and debit -> nothing left to safely true up against.
      return;
    }

    const key = this.keyFor(tenant.organizationId, tenant.projectId, period.periodKey);
    const reservationMicros = policy.reservationMicros ?? DEFAULT_RESERVATION_MICROS;
    const delta = actualCostMicros - reservationMicros;

    try {
      const remaining = await this.budgetCounterStore.adjust(key, delta, this.ttlFor(period));
      void this.warnIfSoftLimitCrossed(tenant, policy, remaining, period);
    } catch (error) {
      if (error instanceof BudgetCounterNotFoundError) {
        // The counter expired or was never initialized (a TTL race). The ledger append already
        // happened via CostEngine, so only this period's fast-path precision is lost — the next
        // reconciliation corrects it.
        console.error(`BudgetEnforcer: debit() found no existing counter for org=${tenant.organizationId} — skipping true-up (ledger is unaffected):`, error.message);
        return;
      }
      console.error("BudgetEnforcer: debit() failed to true up the budget counter:", error);
    }
  }

  // Called by the budget_reconcile job handler — re-derives the counter from the ledger, the
  // only step in this class that touches CostLedgerRepository. Corrects any accumulated drift.
  async reconcile(
    organizationId: string,
    projectId: string | null,
    periodKey: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    const scope: TenantScope = { organizationId, ...(projectId ? { projectId } : {}) };
    let policy: BudgetPolicy | null;
    try {
      policy = await this.resolvePolicy(scope);
    } catch (error) {
      console.error(`BudgetEnforcer: reconcile() could not resolve budget.policy for org=${organizationId}:`, error);
      return;
    }
    if (policy === null) {
      // Policy was removed since this reconciliation was armed -> nothing left to reconcile.
      return;
    }

    let spentMicros: number;
    try {
      spentMicros = await this.costLedgerRepository.sumCostMicrosForPeriod(organizationId, projectId, periodStart, periodEnd);
    } catch (error) {
      console.error(`BudgetEnforcer: reconcile() failed to sum the cost ledger for org=${organizationId}:`, error);
      return;
    }

    const remainingMicros = policy.hardLimitMicros - spentMicros;
    const key = this.keyFor(organizationId, projectId, periodKey);
    const ttlMs = Math.max(periodEnd.getTime() - Date.now(), 1_000);
    try {
      await this.budgetCounterStore.reconcile(key, remainingMicros, ttlMs);
    } catch (error) {
      console.error(`BudgetEnforcer: reconcile() failed to write the corrected counter for org=${organizationId}:`, error);
    }
  }

  // Fire-and-forget from debit(). Deduplicated via tryArmOnce() so only the first debit() to
  // observe the crossing within a tenant+period publishes an alert.
  private async warnIfSoftLimitCrossed(
    tenant: TenantContext,
    policy: BudgetPolicy,
    remainingMicros: number,
    period: ResolvedPeriod,
  ): Promise<void> {
    if (policy.softLimitMicros === null) {
      return;
    }
    const spentMicros = policy.hardLimitMicros - remainingMicros;
    if (spentMicros < policy.softLimitMicros) {
      return;
    }
    const armKey = `budget:soft-limit-alerted:${this.keyFor(tenant.organizationId, tenant.projectId, period.periodKey)}`;
    let armed: boolean;
    try {
      armed = await this.budgetCounterStore.tryArmOnce(armKey, this.ttlFor(period));
    } catch (error) {
      console.error(`BudgetEnforcer: failed to arm soft-limit alert dedup for org=${tenant.organizationId}:`, error);
      return;
    }
    if (!armed) {
      return;
    }
    void this.alertPublisher.publish(
      this.buildAlertEvent(tenant, "warning", "budget.soft_limit_crossed", "Budget soft limit crossed", {
        spentMicros,
        softLimitMicros: policy.softLimitMicros,
      }),
    );
  }

  // `type` is always a hardcoded literal at each call site — domain_alerts_total labels by it, so
  // a tenant-controlled value would be a metric-cardinality risk.
  private buildAlertEvent(
    tenant: TenantContext,
    severity: DomainAlertEvent["severity"],
    type: string,
    message: string,
    metadata: Record<string, unknown>,
  ): DomainAlertEvent {
    return {
      id: randomUUID(),
      type,
      severity,
      organizationId: tenant.organizationId,
      projectId: tenant.projectId,
      message,
      metadata,
      occurredAt: new Date(),
    };
  }

  // Ensures only the first request to touch a tenant+period schedules that period's recurring
  // reconciliation job — fire-and-forget.
  private async armReconciliation(organizationId: string, projectId: string | null, resolved: ResolvedPeriod): Promise<void> {
    const armKey = `budget:recon-armed:${this.keyFor(organizationId, projectId, resolved.periodKey)}`;
    try {
      const armed = await this.budgetCounterStore.tryArmOnce(armKey, this.ttlFor(resolved));
      if (!armed) {
        return;
      }
      await this.jobEnqueuer.enqueue(
        {
          type: "budget_reconcile",
          payload: {
            organizationId,
            projectId,
            periodKey: resolved.periodKey,
            periodStart: resolved.periodStart.toISOString(),
            periodEnd: resolved.periodEnd.toISOString(),
          },
        },
        { runAt: new Date(Date.now() + RECONCILE_INTERVAL_MS) },
      );
    } catch (error) {
      console.error(`BudgetEnforcer: failed to arm reconciliation for org=${organizationId}:`, error);
    }
  }

  private keyFor(organizationId: string, projectId: string | null, periodKey: string): string {
    return `budget:${organizationId}${projectId ? `:${projectId}` : ""}:${periodKey}`;
  }

  private ttlFor(resolved: ResolvedPeriod): number {
    return Math.max(resolved.periodEnd.getTime() - Date.now(), 1_000);
  }

  private async resolvePolicy(scope: TenantScope): Promise<BudgetPolicy | null> {
    let raw: unknown;
    try {
      raw = await this.configurationService.getWithFallback<unknown>(BUDGET_POLICY_CONFIG_KEY, scope);
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return null;
      }
      throw error;
    }
    if (!isValidBudgetPolicyShape(raw)) {
      throw new BudgetConfigInvalidError(`budget.policy value is not a valid BudgetPolicy: ${JSON.stringify(raw)}`);
    }
    return raw;
  }
}

// Exported so the Admin API's budget-policy write endpoint validates with these exact rules
// rather than a copy that could drift.
export function isValidBudgetPolicyShape(raw: unknown): raw is BudgetPolicy {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.period !== "daily" && candidate.period !== "monthly") {
    return false;
  }
  if (typeof candidate.hardLimitMicros !== "number" || !Number.isFinite(candidate.hardLimitMicros) || candidate.hardLimitMicros <= 0) {
    return false;
  }
  if (
    candidate.softLimitMicros !== null &&
    (typeof candidate.softLimitMicros !== "number" || !Number.isFinite(candidate.softLimitMicros) || candidate.softLimitMicros < 0)
  ) {
    return false;
  }
  if (typeof candidate.currency !== "string" || candidate.currency.length === 0) {
    return false;
  }
  // Must be > 0 when present — a zero reservation decrements nothing, defeating admission bounding.
  if (
    candidate.reservationMicros !== undefined &&
    (typeof candidate.reservationMicros !== "number" || !Number.isFinite(candidate.reservationMicros) || candidate.reservationMicros <= 0)
  ) {
    return false;
  }
  return true;
}
