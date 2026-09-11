import { toConfigKey } from "@llm-gateway/domain";
import type { ConfigKey } from "@llm-gateway/domain";

// Global config value, not tenant-scoped — a provider's per-token price doesn't vary by org/project.
export const PRICING_TABLE_CONFIG_KEY: ConfigKey = toConfigKey("cost.pricing-table");

export interface PricingTableEntry {
  readonly currency: string;
  readonly inputMicrosPerToken: number;
  readonly outputMicrosPerToken: number;
}

// Keyed by pricingKey(providerId, modelId) — flat rather than nested, so the hot-path lookup is
// one property access.
export type PricingTable = Readonly<Record<string, PricingTableEntry>>;

export function pricingKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

// Validates the entire incoming value in one pass — DefaultCostEngine only replaces its table
// with a value that has fully passed this check.
export function isValidPricingTable(raw: unknown): raw is PricingTable {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return false;
  }
  return Object.values(raw as Record<string, unknown>).every(isValidPricingTableEntry);
}

function isValidPricingTableEntry(raw: unknown): raw is PricingTableEntry {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.currency === "string" &&
    candidate.currency.length > 0 &&
    typeof candidate.inputMicrosPerToken === "number" &&
    Number.isFinite(candidate.inputMicrosPerToken) &&
    candidate.inputMicrosPerToken >= 0 &&
    typeof candidate.outputMicrosPerToken === "number" &&
    Number.isFinite(candidate.outputMicrosPerToken) &&
    candidate.outputMicrosPerToken >= 0
  );
}
