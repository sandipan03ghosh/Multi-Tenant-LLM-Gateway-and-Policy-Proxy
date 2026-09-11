import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { CircuitBreaker, CircuitBreakerCheckResult, AlertPublisher, DomainAlertEvent } from "@llm-gateway/domain";

export interface RedisCircuitBreakerConfig {
  /** Consecutive failures (within failureCounterTtlMs of each other) before tripping to open. */
  readonly failureThreshold?: number;
  /** How long the breaker stays open before allowing a half-open trial. */
  readonly cooldownMs?: number;
  /** How long a caller holds the half-open trial slot before another caller may claim it. */
  readonly trialLockTtlMs?: number;
  /** Window in which failures count as "consecutive". */
  readonly failureCounterTtlMs?: number;
  /** TTL on state/timestamp keys so an unused breaker's Redis footprint doesn't grow unbounded. */
  readonly stateTtlMs?: number;
}

const DEFAULT_CONFIG: Required<RedisCircuitBreakerConfig> = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  trialLockTtlMs: 10_000,
  failureCounterTtlMs: 60_000,
  stateTtlMs: 24 * 60 * 60 * 1000,
};

// Bounded retry count for every WATCH/MULTI/EXEC transaction below — an optimistic-locking abort
// is the expected outcome under contention; each retry re-reads fresh state.
const MAX_OPTIMISTIC_RETRIES = 5;

interface BreakerKeys {
  readonly state: string;
  readonly failures: string;
  readonly openedAt: string;
  readonly trialLock: string;
}

// Plain atomic Redis commands and WATCH/MULTI/EXEC optimistic transactions, not a Lua script.
//
// The stored `state` key only holds "closed" or "open" — "half_open" is derived from the trial
// lock, and claiming it is folded into the transaction that re-verifies the breaker is still
// open with an elapsed cooldown (see tryClaimTrial).
//
// Every transaction WATCHes all four of a breaker's keys (state, failures, openedAt, trialLock),
// not just the ones it reads — each commits writes to some, and a concurrent transaction may
// touch any of the others, so watching the full set forces a retry on any relevant concurrent
// activity. The one exception is the plain INCR in recordFailure()'s normal path: INCR is atomic
// on its own, only the resulting open() transition needs the full watch.
//
// WATCH/MULTI/EXEC state is connection-scoped, so each transaction runs on its own duplicated
// connection, opened and torn down per call; retries reuse it.
//
// Redis Cluster: every transaction touches keys from a single keysFor() call, and keysFor()
// hash-tags all four keys so they resolve to the same slot.
//
// Alerting: alertPublisher.publish() is fire-and-forget at every call site and never guards a
// state transition. Only fired at genuine transitions — closeIfNotOpen() (the recordSuccess()
// normal path) deliberately does not alert, since it runs on every success; the trial-resolution
// path already covers the "recovered" signal.
//
// providerId/modelId in published alerts are safe for an external webhook: every caller is
// reached via DefaultRoutingEngine only after providerCatalog.getModel() has already rejected
// anything not in the fixed StaticProviderCatalog, so they're always one of a small known set.
export class RedisCircuitBreaker implements CircuitBreaker {
  private readonly config: Required<RedisCircuitBreakerConfig>;

  constructor(
    private readonly redis: Redis,
    private readonly alertPublisher: AlertPublisher,
    config: RedisCircuitBreakerConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // Pure read, no side effects — unlike checkAndReserve(). For the circuit_breaker_state metrics
  // gauge, which reads state at scrape time and must not influence which caller gets the next trial.
  async getState(providerId: string, modelId: string): Promise<"closed" | "open" | "half_open"> {
    const keys = this.keysFor(providerId, modelId);
    const state = await this.redis.get(keys.state);
    if (state === null || state === "closed") {
      return "closed";
    }
    const trialLock = await this.redis.get(keys.trialLock);
    return trialLock !== null ? "half_open" : "open";
  }

  async checkAndReserve(providerId: string, modelId: string): Promise<CircuitBreakerCheckResult> {
    const keys = this.keysFor(providerId, modelId);
    const state = await this.redis.get(keys.state);

    if (state === null || state === "closed") {
      return { allowed: true, state: "closed" };
    }

    const openedAtRaw = await this.redis.get(keys.openedAt);
    const openedAt = openedAtRaw ? Number(openedAtRaw) : 0;
    if (Date.now() - openedAt < this.config.cooldownMs) {
      return { allowed: false, state: "open" };
    }

    // Cooldown appears elapsed — tryClaimTrial re-verifies atomically, since a concurrent close
    // could land between these reads and now.
    return this.tryClaimTrial(keys, providerId, modelId);
  }

  async recordSuccess(providerId: string, modelId: string, trialToken?: string): Promise<void> {
    const keys = this.keysFor(providerId, modelId);

    if (trialToken !== undefined) {
      // A token-bearing report never falls through to the normal path — a stale/superseded token
      // is a silent no-op.
      await this.resolveTrial(keys, trialToken, "closed", providerId, modelId);
      return;
    }

    await this.closeIfNotOpen(keys);
  }

  async recordFailure(providerId: string, modelId: string, trialToken?: string): Promise<void> {
    const keys = this.keysFor(providerId, modelId);

    if (trialToken !== undefined) {
      await this.resolveTrial(keys, trialToken, "open", providerId, modelId);
      return;
    }

    // Plain INCR is safe outside a transaction; only the resulting open() transition needs the watch.
    const failures = await this.redis.incr(keys.failures);
    await this.redis.pexpire(keys.failures, this.config.failureCounterTtlMs);
    if (failures >= this.config.failureThreshold) {
      await this.openIfThresholdStillCrossed(keys, providerId, modelId);
    }
  }

  // Atomically verify `state` is still "open" with an elapsed cooldown, and if so claim the trial
  // slot. Watches all four keys and retries with fresh reads on abort.
  private async tryClaimTrial(keys: BreakerKeys, providerId: string, modelId: string): Promise<CircuitBreakerCheckResult> {
    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(keys.state, keys.openedAt, keys.failures, keys.trialLock);
        const [currentState, currentOpenedAtRaw] = await Promise.all([
          tx.get(keys.state),
          tx.get(keys.openedAt),
        ]);

        if (currentState === null || currentState === "closed") {
          await tx.unwatch();
          return { allowed: true, state: "closed" };
        }
        const currentOpenedAt = currentOpenedAtRaw ? Number(currentOpenedAtRaw) : 0;
        if (Date.now() - currentOpenedAt < this.config.cooldownMs) {
          await tx.unwatch();
          return { allowed: false, state: "open" };
        }

        const trialToken = randomUUID();
        const execResult = await tx
          .multi()
          .set(keys.trialLock, trialToken, "PX", this.config.trialLockTtlMs, "NX")
          .exec();

        if (execResult === null) {
          // Something changed concurrently — retry with fresh reads.
          continue;
        }
        const setOutcome = execResult[0]?.[1];
        if (setOutcome === "OK") {
          this.publishAlert(providerId, modelId, "warning", "circuit_breaker.half_open", "Circuit breaker probing recovery (half-open trial)", {});
          return { allowed: true, state: "half_open", trialToken };
        }
        return { allowed: false, state: "half_open" };
      }
      // Exhausted retries under contention — fail closed; the next request gets a fresh attempt.
      return { allowed: false, state: "open" };
    } finally {
      tx.disconnect();
    }
  }

  // Atomically verify the trial lock still holds expectedToken, and if so delete it and apply the
  // outcome (close on success, reopen with a fresh cooldown on failure) in one transaction. A
  // token mismatch returns immediately; only a transaction abort retries.
  private async resolveTrial(
    keys: BreakerKeys,
    expectedToken: string,
    outcome: "closed" | "open",
    providerId: string,
    modelId: string,
  ): Promise<void> {
    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(keys.trialLock, keys.state, keys.failures, keys.openedAt);
        const currentValue = await tx.get(keys.trialLock);
        if (currentValue !== expectedToken) {
          await tx.unwatch();
          return;
        }

        const pipeline = tx.multi().del(keys.trialLock);
        if (outcome === "closed") {
          pipeline.set(keys.state, "closed", "PX", this.config.stateTtlMs).del(keys.failures).del(keys.openedAt);
        } else {
          pipeline
            .set(keys.state, "open", "PX", this.config.stateTtlMs)
            .set(keys.openedAt, String(Date.now()), "PX", this.config.stateTtlMs);
        }
        const result = await pipeline.exec();
        if (result !== null) {
          if (outcome === "closed") {
            this.publishAlert(providerId, modelId, "warning", "circuit_breaker.closed", "Circuit breaker recovered (half-open trial succeeded)", {});
          } else {
            this.publishAlert(providerId, modelId, "critical", "circuit_breaker.opened", "Circuit breaker reopened (half-open trial failed)", {
              trigger: "half_open_trial_failed",
            });
          }
          return;
        }
        // Aborted — re-read the trial lock fresh rather than assume our token is still live.
      }
    } finally {
      tx.disconnect();
    }
  }

  // Normal-path success: close the breaker (reset failures/openedAt) unless `state` is "open".
  // Watches all four keys. Deliberately does not alert (runs on every successful call).
  private async closeIfNotOpen(keys: BreakerKeys): Promise<void> {
    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(keys.state, keys.failures, keys.openedAt, keys.trialLock);
        const state = await tx.get(keys.state);
        if (state === "open") {
          await tx.unwatch();
          return;
        }
        const result = await tx
          .multi()
          .set(keys.state, "closed", "PX", this.config.stateTtlMs)
          .del(keys.failures)
          .del(keys.openedAt)
          .exec();
        if (result !== null) {
          return;
        }
        // Aborted — retry and re-check fresh state.
      }
    } finally {
      tx.disconnect();
    }
  }

  // Normal-path failure that just crossed the threshold: re-verify the failure count and `state`
  // against fresh watched reads before opening — so a concurrent success resetting the counter
  // can't be followed by a stale open() on the pre-reset count.
  private async openIfThresholdStillCrossed(keys: BreakerKeys, providerId: string, modelId: string): Promise<void> {
    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(keys.state, keys.failures, keys.openedAt, keys.trialLock);
        const [state, failuresRaw] = await Promise.all([tx.get(keys.state), tx.get(keys.failures)]);
        const currentFailures = failuresRaw ? Number(failuresRaw) : 0;
        if (state === "open" || currentFailures < this.config.failureThreshold) {
          await tx.unwatch();
          return;
        }
        const result = await tx
          .multi()
          .set(keys.state, "open", "PX", this.config.stateTtlMs)
          .set(keys.openedAt, String(Date.now()), "PX", this.config.stateTtlMs)
          .exec();
        if (result !== null) {
          this.publishAlert(providerId, modelId, "critical", "circuit_breaker.opened", "Circuit breaker opened (failure threshold crossed)", {
            trigger: "threshold_crossed",
            failureThreshold: this.config.failureThreshold,
          });
          return;
        }
        // Aborted — retry and re-check fresh state/failures.
      }
    } finally {
      tx.disconnect();
    }
  }

  // Fire-and-forget — never awaited, and alertPublisher.publish() never throws, so this can't
  // affect breaker correctness. `type` is always a hardcoded literal at each call site.
  private publishAlert(
    providerId: string,
    modelId: string,
    severity: DomainAlertEvent["severity"],
    type: string,
    message: string,
    metadata: Record<string, unknown>,
  ): void {
    void this.alertPublisher.publish({
      id: randomUUID(),
      type,
      severity,
      // Provider/model-scoped — no single organization/project owns a circuit breaker.
      organizationId: null,
      projectId: null,
      message: `${message} (provider=${providerId}, model=${modelId})`,
      metadata: { ...metadata, providerId, modelId },
      occurredAt: new Date(),
    });
  }

  private keysFor(providerId: string, modelId: string): BreakerKeys {
    // `{...}` is a Redis Cluster hash tag so all four keys share a slot.
    const base = `breaker:{${providerId}:${modelId}}`;
    return {
      state: `${base}:state`,
      failures: `${base}:failures`,
      openedAt: `${base}:opened_at`,
      trialLock: `${base}:trial_lock`,
    };
  }
}
