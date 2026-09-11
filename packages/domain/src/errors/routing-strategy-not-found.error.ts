// Raised when the Routing Engine has no RoutingStrategy registered for a policy's type — a
// wiring problem, not a runtime routing failure like NoAvailableProviderError.
export class RoutingStrategyNotFoundError extends Error {
  constructor(public readonly policyType: string) {
    super(`No RoutingStrategy registered for policy type "${policyType}"`);
    this.name = "RoutingStrategyNotFoundError";
  }
}
