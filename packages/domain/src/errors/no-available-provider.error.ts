// Raised once every candidate the Routing Engine tried has failed. Carries the per-candidate
// errors as `causes` so diagnostic information isn't dropped.
export class NoAvailableProviderError extends Error {
  constructor(
    public readonly attemptedProviderIds: readonly string[],
    public readonly causes: readonly unknown[] = [],
  ) {
    super(
      `No available provider succeeded (attempted: ${attemptedProviderIds.join(", ") || "none"})`,
    );
    this.name = "NoAvailableProviderError";
  }
}
