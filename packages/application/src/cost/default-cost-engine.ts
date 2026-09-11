import { ConfigurationNotFoundError } from "@llm-gateway/domain";
import type {
  CostEngine,
  CostBreakdown,
  CostLedgerRepository,
  TenantContext,
  TokenUsage,
  ConfigurationService,
  ConfigSubscriptionUnsubscribe,
} from "@llm-gateway/domain";
import { PRICING_TABLE_CONFIG_KEY, pricingKey, isValidPricingTable } from "./pricing-config-keys.js";
import type { PricingTable } from "./pricing-config-keys.js";

const EMPTY_PRICING_TABLE: PricingTable = {};
const DEFAULT_CURRENCY_ON_MISSING_PRICE = "USD";

// priceRequest() is pure and synchronous by contract even though pricing is config-driven — the
// pricing table is loaded in start() and kept current via ConfigurationService.subscribe().
//
// Cache updates are atomic: the handler validates the whole incoming value, then replaces
// `this.pricingTable` in one assignment (never mutates in place), so a concurrent priceRequest()
// reads either the fully-old or fully-new table. An invalid update is logged and discarded.
export class DefaultCostEngine implements CostEngine {
  private pricingTable: PricingTable = EMPTY_PRICING_TABLE;
  private unsubscribe: ConfigSubscriptionUnsubscribe | undefined;

  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly costLedgerRepository: CostLedgerRepository,
  ) {}

  async start(): Promise<void> {
    this.pricingTable = await this.loadPricingTable();
    this.unsubscribe = this.configurationService.subscribe(PRICING_TABLE_CONFIG_KEY, (value) => {
      if (isValidPricingTable(value)) {
        this.pricingTable = value;
        return;
      }
      console.error(
        "CostEngine: received an invalid cost.pricing-table config update — keeping the previous table:",
        JSON.stringify(value),
      );
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  priceRequest(providerId: string, modelId: string, usage: TokenUsage): CostBreakdown {
    const entry = this.pricingTable[pricingKey(providerId, modelId)];
    if (!entry) {
      console.error(
        `CostEngine: no pricing entry for provider="${providerId}" model="${modelId}" ` +
          `(promptTokens=${usage.promptTokens}, completionTokens=${usage.completionTokens}) — pricing as zero-cost`,
      );
      return {
        providerId,
        modelId,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        inputCostMicros: 0,
        outputCostMicros: 0,
        totalCostMicros: 0,
        currency: DEFAULT_CURRENCY_ON_MISSING_PRICE,
        priced: false,
      };
    }

    const inputCostMicros = Math.round(usage.promptTokens * entry.inputMicrosPerToken);
    const outputCostMicros = Math.round(usage.completionTokens * entry.outputMicrosPerToken);
    return {
      providerId,
      modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      inputCostMicros,
      outputCostMicros,
      totalCostMicros: inputCostMicros + outputCostMicros,
      currency: entry.currency,
      priced: true,
    };
  }

  // Fire-and-forget safe: every path resolves, never rejects — a ledger-append failure is logged,
  // not propagated. A failure here is currently a logged, un-retried gap.
  async recordUsage(tenant: TenantContext, breakdown: CostBreakdown): Promise<void> {
    try {
      await this.costLedgerRepository.append({
        organizationId: tenant.organizationId,
        projectId: tenant.projectId,
        providerId: breakdown.providerId,
        modelId: breakdown.modelId,
        promptTokens: breakdown.promptTokens,
        completionTokens: breakdown.completionTokens,
        inputCostMicros: breakdown.inputCostMicros,
        outputCostMicros: breakdown.outputCostMicros,
        totalCostMicros: breakdown.totalCostMicros,
        currency: breakdown.currency,
      });
    } catch (error) {
      console.error("CostEngine: recordUsage failed to append to the cost ledger:", error);
    }
  }

  private async loadPricingTable(): Promise<PricingTable> {
    let raw: unknown;
    try {
      raw = await this.configurationService.get<unknown>(PRICING_TABLE_CONFIG_KEY);
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return EMPTY_PRICING_TABLE;
      }
      throw error;
    }
    if (isValidPricingTable(raw)) {
      return raw;
    }
    console.error(
      "CostEngine: configured cost.pricing-table value is invalid — starting with an empty table:",
      JSON.stringify(raw),
    );
    return EMPTY_PRICING_TABLE;
  }
}
