// Durable record of a priced request — the source Budget Enforcement's reconciliation job and
// cost-reporting APIs read from. Carries the full tenant/provider/model/token/cost breakdown.
export interface CreateCostLedgerEntryInput {
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly providerId: string;
  readonly modelId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly inputCostMicros: number;
  readonly outputCostMicros: number;
  readonly totalCostMicros: number;
  readonly currency: string;
}

export interface CostLedgerEntry extends CreateCostLedgerEntryInput {
  readonly id: string;
  readonly createdAt: Date;
}
