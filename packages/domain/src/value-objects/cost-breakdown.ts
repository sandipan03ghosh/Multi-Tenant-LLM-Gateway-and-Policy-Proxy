// CostEngine.priceRequest()'s return value. Costs are integer micros (1 unit = 1e-6 of
// `currency`), so repeated summation never accumulates floating-point drift.
export interface CostBreakdown {
  readonly providerId: string;
  readonly modelId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly inputCostMicros: number;
  readonly outputCostMicros: number;
  readonly totalCostMicros: number;
  readonly currency: string;
  // False when no pricing entry existed at price time — the breakdown is still a well-formed
  // zero-cost value, but callers can distinguish "genuinely free" from "price unknown."
  readonly priced: boolean;
}
