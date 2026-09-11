import { ProviderModelNotFoundError } from "@llm-gateway/domain";
import type { ProviderCatalog, ProviderModelMetadata } from "@llm-gateway/domain";

// Fixed list supplied at construction, not read from ConfigurationService. Swappable for a
// config-driven implementation later without touching any consumer.
export class StaticProviderCatalog implements ProviderCatalog {
  private readonly modelsByProvider = new Map<string, ProviderModelMetadata[]>();

  constructor(models: readonly ProviderModelMetadata[]) {
    for (const model of models) {
      const existing = this.modelsByProvider.get(model.providerId) ?? [];
      existing.push(model);
      this.modelsByProvider.set(model.providerId, existing);
    }
  }

  getModel(providerId: string, modelId: string): ProviderModelMetadata {
    const model = this.modelsByProvider.get(providerId)?.find((m) => m.modelId === modelId);
    if (!model) {
      throw new ProviderModelNotFoundError(providerId, modelId);
    }
    return model;
  }

  listModels(providerId: string): ProviderModelMetadata[] {
    // Shallow copy — callers must not mutate the catalog's internal array.
    return [...(this.modelsByProvider.get(providerId) ?? [])];
  }
}
