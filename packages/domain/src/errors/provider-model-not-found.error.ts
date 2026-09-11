export class ProviderModelNotFoundError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly modelId: string,
  ) {
    super(`Model "${modelId}" not found for provider "${providerId}"`);
    this.name = "ProviderModelNotFoundError";
  }
}
