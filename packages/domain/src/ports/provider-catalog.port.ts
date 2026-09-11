import type { ProviderModelMetadata } from "../value-objects/provider-model-metadata.js";

// Static/config-driven capability + metadata catalog, separate from ProviderRegistry: answers
// "what can this provider/model do", not "give me a live instance". getModel() throws
// ProviderModelNotFoundError rather than returning null.
export interface ProviderCatalog {
  getModel(providerId: string, modelId: string): ProviderModelMetadata;
  listModels(providerId: string): ProviderModelMetadata[];
}
