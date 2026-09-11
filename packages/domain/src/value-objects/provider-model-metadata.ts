// Capability/metadata catalog entry. Pricing fields live in config (CostEngine), not here.
export interface ProviderModelMetadata {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly supportsStreaming: boolean;
}
