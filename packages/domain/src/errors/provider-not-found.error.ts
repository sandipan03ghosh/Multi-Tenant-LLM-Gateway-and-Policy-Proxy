export class ProviderNotFoundError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider "${providerId}" is not registered`);
    this.name = "ProviderNotFoundError";
  }
}
