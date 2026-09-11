import type {
  ShadowTrafficDispatcher,
  ShadowRoutingConfig,
  CanonicalRequest,
  ProviderCandidate,
  ProviderRegistry,
  HealthTracker,
} from "@llm-gateway/domain";

// dispatch() returns void and must never throw synchronously or produce an unhandled rejection,
// whatever fails inside — a shadow-traffic failure is a log line, never client-visible. No
// circuit-breaker involvement: shadow traffic fires whenever sampled, to exercise a
// not-yet-trusted candidate; only HealthTracker is updated, since that feeds the promotion decision.
export class DefaultShadowTrafficDispatcher implements ShadowTrafficDispatcher {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly healthTracker: HealthTracker,
  ) {}

  dispatch(request: CanonicalRequest, shadow: ShadowRoutingConfig): void {
    // Top-level synchronous safety boundary — nothing here is expected to throw synchronously,
    // but it's wrapped so the "never throws" guarantee doesn't depend on that staying true.
    try {
      if (!this.shouldSample(shadow.sampleRate)) {
        return;
      }
      // Not awaited — runShadowCall() catches everything internally.
      void this.runShadowCall(request, shadow.candidate);
    } catch (error) {
      console.error("ShadowTrafficDispatcher.dispatch failed unexpectedly:", error);
    }
  }

  private shouldSample(sampleRate: number): boolean {
    if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
      console.error(`ShadowTrafficDispatcher: invalid sampleRate ${sampleRate} (must be finite and in [0, 1]) — skipping shadow dispatch`);
      return false;
    }
    return Math.random() < sampleRate;
  }

  // Records exactly one recordSuccess or recordFailure per call, matching the provider call's
  // own outcome; a tracker failure is logged and swallowed, never flipped to the other outcome.
  private async runShadowCall(request: CanonicalRequest, candidate: ProviderCandidate): Promise<void> {
    try {
      const provider = this.registry.resolve(candidate.providerId);
      await provider.complete({ ...request, model: candidate.modelId });
    } catch (error) {
      console.error(`Shadow traffic call failed for ${candidate.providerId}/${candidate.modelId}:`, error);
      try {
        await this.healthTracker.recordFailure(candidate.providerId);
      } catch (trackerError) {
        console.error(`HealthTracker.recordFailure failed during shadow traffic for ${candidate.providerId}:`, trackerError);
      }
      return;
    }

    try {
      await this.healthTracker.recordSuccess(candidate.providerId);
    } catch (trackerError) {
      console.error(`HealthTracker.recordSuccess failed during shadow traffic for ${candidate.providerId}:`, trackerError);
    }
  }
}
