import { GatewayError, NoAvailableProviderError, RoutingStrategyNotFoundError } from "@llm-gateway/domain";
import type {
  RoutingEngine,
  RoutingStrategy,
  ProviderScorer,
  ProviderRegistry,
  ProviderPort,
  RoutingPolicy,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  CircuitBreaker,
  HealthTracker,
  RetryPolicy,
  ShadowTrafficDispatcher,
} from "@llm-gateway/domain";
import {
  logger,
  withSpan,
  withProviderSpan,
  providerRequestsTotal,
  providerRequestDurationSeconds,
} from "@llm-gateway/adapters-observability";

function isRetryableGatewayError(error: unknown): boolean {
  return error instanceof GatewayError && error.retryable;
}

function toGatewayError(error: unknown): GatewayError {
  return error instanceof GatewayError
    ? error
    : new GatewayError("INTERNAL_ERROR", "An unexpected error occurred while streaming", 500, false, error);
}

// Orchestrates the routing pipeline: Strategy -> Scorer -> Registry -> Adapter, with
// per-candidate resilience: CircuitBreaker gates whether a candidate is attempted, RetryPolicy
// governs in-call retries, and CircuitBreaker/HealthTracker get exactly one outcome per
// candidate — never once per retry attempt.
export class DefaultRoutingEngine implements RoutingEngine {
  constructor(
    private readonly strategies: ReadonlyMap<string, RoutingStrategy>,
    private readonly scorer: ProviderScorer,
    private readonly registry: ProviderRegistry,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly healthTracker: HealthTracker,
    private readonly retryPolicy: RetryPolicy,
    private readonly shadowTrafficDispatcher: ShadowTrafficDispatcher,
  ) {}

  async route(request: CanonicalRequest, policy: RoutingPolicy): Promise<CanonicalResponse> {
    return withSpan("routing.route", () => this.routeInner(request, policy), {
      "routing.policy.type": policy.type,
    });
  }

  private async routeInner(request: CanonicalRequest, policy: RoutingPolicy): Promise<CanonicalResponse> {
    const strategy = this.strategies.get(policy.type);
    if (!strategy) {
      throw new RoutingStrategyNotFoundError(policy.type);
    }

    if (policy.shadow) {
      // Fired unconditionally alongside the real routing attempt — a genuine mirror of live
      // request timing. dispatch() is contractually synchronous void, but guarded here too so a
      // faulty implementation can't break primary routing.
      try {
        this.shadowTrafficDispatcher.dispatch(request, policy.shadow);
      } catch (error) {
        logger.error({ err: error }, "ShadowTrafficDispatcher.dispatch threw synchronously (swallowed)");
      }
    }

    const candidates = await strategy.selectCandidates(request, policy);
    const ranked = await this.scorer.score(candidates);
    const sorted = [...ranked].sort((a, b) => b.score - a.score);

    const attempted: string[] = [];
    const causes: unknown[] = [];
    for (const candidate of sorted) {
      // Registry lookup runs BEFORE the circuit-breaker check: an unregistered or disabled
      // provider means no call was attempted, so there's no outcome to report — and it never
      // claims a half-open trial slot only to abandon it (which would stick until its TTL).
      let provider: ProviderPort;
      try {
        provider = this.registry.resolve(candidate.providerId);
      } catch (error) {
        causes.push(error);
        continue;
      }

      const check = await this.circuitBreaker.checkAndReserve(candidate.providerId, candidate.modelId);
      if (!check.allowed) {
        // No call was made, so no outcome is reported to the breaker or health tracker. Still
        // surfaced as a synthetic cause so NoAvailableProviderError explains why it was skipped.
        causes.push(
          new GatewayError(
            "PROVIDER_CIRCUIT_OPEN",
            `Provider ${candidate.providerId} is temporarily unavailable (circuit open)`,
            503,
            true,
          ),
        );
        continue;
      }

      attempted.push(candidate.providerId);
      const startedAt = process.hrtime.bigint();
      try {
        const isHalfOpenTrial = check.trialToken !== undefined;
        // A half-open trial is a single cautious probe — retrying it internally would add load to
        // a provider we're not sure has recovered and blur which attempt the trialToken
        // describes. Only a closed-state call gets the full retry policy.
        const response = isHalfOpenTrial
          ? await provider.complete({ ...request, model: candidate.modelId })
          : await this.retryPolicy.execute(
              () => provider.complete({ ...request, model: candidate.modelId }),
              isRetryableGatewayError,
            );

        // A real success must reach the caller even if bookkeeping is down — recordOutcome() never throws.
        await this.recordOutcome("success", candidate.providerId, candidate.modelId, check.trialToken, startedAt);
        return response;
      } catch (error) {
        // The real provider failure must be the reported cause even if bookkeeping fails —
        // recordOutcome() swallows its own errors.
        await this.recordOutcome("failure", candidate.providerId, candidate.modelId, check.trialToken, startedAt);
        causes.push(error);
      }
    }

    throw new NoAvailableProviderError(attempted, causes);
  }

  // Streaming's resilience shape differs from route(): once a stream has yielded one event, bytes
  // may already be on the wire, so there's no safe point to retry or fail over. This method:
  //   - never applies RetryPolicy (not even for a half-open trial);
  //   - never fires shadow traffic;
  //   - only fails over if pulling the FIRST event throws — the one point where nothing is sent;
  //   - once a first event is yielded, a later failure becomes a synthetic `error` event, so the
  //     caller always gets an explicit terminal signal, never a silently truncated stream.
  //
  // registry.resolve() runs BEFORE the circuit-breaker check, same as route() — a resolve()
  // failure isn't a "call was attempted" outcome, so it's kept out of the withProviderSpan
  // callback below.
  //
  // Not wrapped in withSpan() like route(): an async generator's active span doesn't reliably
  // survive yield/resume points, so only the per-candidate first-event pull is span-wrapped
  // individually.
  async *routeStream(
    request: CanonicalRequest,
    policy: RoutingPolicy,
    signal?: AbortSignal,
  ): AsyncIterable<CanonicalStreamEvent> {
    const strategy = this.strategies.get(policy.type);
    if (!strategy) {
      throw new RoutingStrategyNotFoundError(policy.type);
    }

    const candidates = await strategy.selectCandidates(request, policy);
    const ranked = await this.scorer.score(candidates);
    const sorted = [...ranked].sort((a, b) => b.score - a.score);

    const attempted: string[] = [];
    const causes: unknown[] = [];
    for (const candidate of sorted) {
      let provider: ProviderPort;
      try {
        provider = this.registry.resolve(candidate.providerId);
      } catch (error) {
        causes.push(error);
        continue;
      }

      const check = await this.circuitBreaker.checkAndReserve(candidate.providerId, candidate.modelId);
      if (!check.allowed) {
        causes.push(
          new GatewayError(
            "PROVIDER_CIRCUIT_OPEN",
            `Provider ${candidate.providerId} is temporarily unavailable (circuit open)`,
            503,
            true,
          ),
        );
        continue;
      }

      attempted.push(candidate.providerId);

      let iterator: AsyncIterator<CanonicalStreamEvent> | undefined;
      let first: IteratorResult<CanonicalStreamEvent>;
      const startedAt = process.hrtime.bigint();
      try {
        // withProviderSpan (not withSpan): a thrown error here may be the provider's own
        // GatewayError, which must never reach this span's recordException.
        first = await withProviderSpan(
          "routing.routeStream",
          async () => {
            iterator = provider.stream({ ...request, model: candidate.modelId }, signal)[Symbol.asyncIterator]();
            return iterator.next();
          },
          { "routing.policy.type": policy.type, "provider.id": candidate.providerId, "llm.model": candidate.modelId },
        );
      } catch (error) {
        await this.recordOutcome("failure", candidate.providerId, candidate.modelId, check.trialToken, startedAt);
        causes.push(error);
        continue;
      }
      // Time-to-first-event is the meaningful "provider responded" latency for streaming — the
      // rest is client consumption time, so record it here, once.
      await this.recordOutcome("success", candidate.providerId, candidate.modelId, check.trialToken, startedAt);

      // Committed: at least one event is about to reach the caller — no more failover past here.
      // `iterator` is always assigned once the span call above resolved without throwing.
      try {
        let result = first;
        while (!result.done) {
          yield result.value;
          result = await iterator!.next();
        }
        return;
      } catch (error) {
        yield { type: "error", error: toGatewayError(error) };
        return;
      }
    }

    throw new NoAvailableProviderError(attempted, causes);
  }

  // Updates CircuitBreaker, HealthTracker, and the provider request metrics for one candidate's
  // outcome. Never throws — a bookkeeping failure is logged and swallowed rather than converting
  // a real success into an error or replacing a real error. Each update is independently guarded.
  private async recordOutcome(
    outcome: "success" | "failure",
    providerId: string,
    modelId: string,
    trialToken: string | undefined,
    startedAt: bigint,
  ): Promise<void> {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const metricLabels = { provider: providerId, model: modelId, outcome };
    providerRequestsTotal.inc(metricLabels);
    providerRequestDurationSeconds.observe(metricLabels, durationSeconds);

    try {
      if (outcome === "success") {
        await this.circuitBreaker.recordSuccess(providerId, modelId, trialToken);
      } else {
        await this.circuitBreaker.recordFailure(providerId, modelId, trialToken);
      }
    } catch (bookkeepingError) {
      logger.error(
        { err: bookkeepingError, "provider.id": providerId, "llm.model": modelId, outcome },
        "CircuitBreaker.recordOutcome bookkeeping failed",
      );
    }

    try {
      if (outcome === "success") {
        await this.healthTracker.recordSuccess(providerId);
      } else {
        await this.healthTracker.recordFailure(providerId);
      }
    } catch (bookkeepingError) {
      logger.error(
        { err: bookkeepingError, "provider.id": providerId, outcome },
        "HealthTracker.recordOutcome bookkeeping failed",
      );
    }
  }
}
