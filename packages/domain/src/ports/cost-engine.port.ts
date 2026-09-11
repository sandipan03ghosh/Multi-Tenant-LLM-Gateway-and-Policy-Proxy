import type { TokenUsage } from "../value-objects/canonical-response.js";
import type { CostBreakdown } from "../value-objects/cost-breakdown.js";
import type { TenantContext } from "../value-objects/tenant-context.js";

// priceRequest() is pure and synchronous by contract (no I/O). recordUsage() is the only async
// member and must never let a ledger-write failure propagate as a rejection — a client request
// must never fail because cost-recording did.
export interface CostEngine {
  priceRequest(providerId: string, modelId: string, usage: TokenUsage): CostBreakdown;
  recordUsage(tenant: TenantContext, breakdown: CostBreakdown): Promise<void>;
}
