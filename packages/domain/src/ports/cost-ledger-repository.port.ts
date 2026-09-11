import type { CostLedgerEntry, CreateCostLedgerEntryInput } from "../value-objects/cost-ledger-entry.js";

export interface CostLedgerRepository {
  append(input: CreateCostLedgerEntryInput): Promise<CostLedgerEntry>;

  // For Budget Enforcement's reconciliation job — re-derives the Redis fast-path counter from
  // this authoritative sum. projectId null means org-level.
  sumCostMicrosForPeriod(
    organizationId: string,
    projectId: string | null,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number>;
}
