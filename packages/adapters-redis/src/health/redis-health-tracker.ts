import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { HealthTracker, AlertPublisher, DomainAlertEvent } from "@llm-gateway/domain";

export interface RedisHealthTrackerConfig {
  /** Number of most-recent outcomes retained per provider for the rolling score. */
  readonly windowSize?: number;
  /** TTL refreshed on every write so a provider with no recent traffic ages out. */
  readonly ttlMs?: number;
  /** Score below which a provider is considered unhealthy for alerting purposes. */
  readonly unhealthyScoreThreshold?: number;
  /** Minimum recorded outcomes before threshold-crossing alerts fire at all. */
  readonly minSamplesForAlerting?: number;
}

const DEFAULT_CONFIG: Required<RedisHealthTrackerConfig> = {
  windowSize: 50,
  ttlMs: 60 * 60 * 1000,
  unhealthyScoreThreshold: 0.5,
  minSamplesForAlerting: 5,
};

// Bounded retry count for the alert-transition claim below.
const MAX_OPTIMISTIC_RETRIES = 5;

// record()'s LPUSH/LTRIM/PEXPIRE does not need transaction-level correctness — the score is an
// approximate ranking signal, not a safety gate. LPUSH/LTRIM are each atomic, so no outcome is
// lost; concurrent calls can transiently leave the list a few entries over windowSize, which
// barely moves an average over 50 samples.
//
// Alerting needs more care, since nothing gates calls on health score. This class guards against:
//   - Repeat firing: score is read before and after each record() so an alert is only considered
//     on an actual threshold crossing.
//   - Duplicate firing from concurrent callers: tryClaimAlertTransition() uses a WATCH/MULTI/EXEC
//     claim so only one caller publishes for a given crossing.
export class RedisHealthTracker implements HealthTracker {
  private readonly config: Required<RedisHealthTrackerConfig>;

  constructor(
    private readonly redis: Redis,
    private readonly alertPublisher: AlertPublisher,
    config: RedisHealthTrackerConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async recordSuccess(providerId: string): Promise<void> {
    await this.record(providerId, "1");
  }

  async recordFailure(providerId: string): Promise<void> {
    await this.record(providerId, "0");
  }

  async getScore(providerId: string): Promise<number> {
    const key = this.keyFor(providerId);
    const outcomes = await this.redis.lrange(key, 0, -1);
    if (outcomes.length === 0) {
      // No data yet — assume healthy rather than penalize a fresh or recently-idle provider.
      return 1;
    }
    const successes = outcomes.filter((outcome) => outcome === "1").length;
    return successes / outcomes.length;
  }

  private async record(providerId: string, outcome: "0" | "1"): Promise<void> {
    const key = this.keyFor(providerId);
    const previousScore = await this.getScore(providerId);
    await this.redis.lpush(key, outcome);
    await this.redis.ltrim(key, 0, this.config.windowSize - 1);
    await this.redis.pexpire(key, this.config.ttlMs);
    const currentScore = await this.getScore(providerId);
    await this.maybeAlertOnThresholdCrossing(providerId, previousScore, currentScore);
  }

  // Fire-and-forget-safe: never throws, so a failure here can't affect record()'s own outcome.
  private async maybeAlertOnThresholdCrossing(providerId: string, previousScore: number, currentScore: number): Promise<void> {
    const threshold = this.config.unhealthyScoreThreshold;
    const wasHealthy = previousScore >= threshold;
    const isHealthy = currentScore >= threshold;
    if (wasHealthy === isHealthy) {
      // No crossing — the common case.
      return;
    }
    let sampleCount: number;
    try {
      sampleCount = await this.redis.llen(this.keyFor(providerId));
    } catch (error) {
      console.error(`RedisHealthTracker: failed to read sample count for ${providerId} (skipping alert):`, error);
      return;
    }
    if (sampleCount < this.config.minSamplesForAlerting) {
      return;
    }

    const newState = isHealthy ? "healthy" : "unhealthy";
    let claimed: boolean;
    try {
      claimed = await this.tryClaimAlertTransition(providerId, newState);
    } catch (error) {
      console.error(`RedisHealthTracker: failed to claim alert-transition for ${providerId} (skipping alert):`, error);
      return;
    }
    if (!claimed) {
      // Another caller already claimed this transition, or the last-alerted state already matches.
      return;
    }

    const type = isHealthy ? "provider.healthy" : "provider.unhealthy";
    const message = isHealthy
      ? `Provider ${providerId} recovered (score=${currentScore.toFixed(2)})`
      : `Provider ${providerId} marked unhealthy (score=${currentScore.toFixed(2)})`;
    // Provider-scoped — no single organization/project owns a provider's health signal.
    // providerId is safe to include: every path in validates it against StaticProviderCatalog first.
    void this.alertPublisher.publish({
      id: randomUUID(),
      type,
      severity: "warning" satisfies DomainAlertEvent["severity"],
      organizationId: null,
      projectId: null,
      message,
      metadata: { providerId, score: currentScore },
      occurredAt: new Date(),
    });
  }

  // Atomically: only the first caller to observe `newState` since the last-recorded alert-state
  // gets to publish. Exhausting retries under contention fails closed (no alert) — preferring a
  // missed alert over a flood of duplicates.
  private async tryClaimAlertTransition(providerId: string, newState: "healthy" | "unhealthy"): Promise<boolean> {
    const key = `health:alert-state:${providerId}`;
    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(key);
        const current = await tx.get(key);
        if (current === newState) {
          await tx.unwatch();
          return false;
        }
        const result = await tx.multi().set(key, newState, "PX", this.config.ttlMs).exec();
        if (result !== null) {
          return true;
        }
        // Aborted — retry and re-check the fresh alert-state.
      }
      return false;
    } finally {
      tx.disconnect();
    }
  }

  private keyFor(providerId: string): string {
    return `health:${providerId}`;
  }
}
