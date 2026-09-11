import { ConfigurationNotFoundError } from "@llm-gateway/domain";
import type {
  RateLimitAlgorithm,
  RateLimitResult,
  RateLimitPolicy,
  TenantContext,
  ConfigurationService,
} from "@llm-gateway/domain";
import { RATE_LIMIT_POLICY_CONFIG_KEY, toTenantScope } from "./rate-limit-config-keys.js";

// Signals that a rate-limit.policy value exists but is the wrong shape — distinct from "not
// configured" so a broken policy fails closed rather than behaving like no policy.
class RateLimitConfigInvalidError extends Error {}

// A tenant with no configured policy has no limit — an org/project must opt in.
const UNLIMITED_RESULT: RateLimitResult = { allowed: true, remaining: Number.POSITIVE_INFINITY };

// No domain port wraps this — only the algorithm is pluggable, not this config-resolution step.
// Resolves the tenant's policy from ConfigurationService fresh per call, then delegates the
// check to the injected RateLimitAlgorithm. Fractional tokens are supported: capacity/
// refillTokens/cost are finite numbers, not required to be integers.
export class DefaultRateLimiter {
  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly rateLimitAlgorithm: RateLimitAlgorithm,
  ) {}

  async checkAndConsume(tenant: TenantContext, cost = 1): Promise<RateLimitResult> {
    if (!Number.isFinite(cost) || cost <= 0) {
      // A caller bug (e.g. an uncomputed NaN cost) — fails closed rather than admit an uncosted request.
      console.error(`RateLimiter: checkAndConsume called with invalid cost (${String(cost)}) — failing closed`);
      return { allowed: false, remaining: 0 };
    }

    let policy: RateLimitPolicy | null;
    try {
      policy = await this.resolvePolicy(tenant);
    } catch (error) {
      if (error instanceof RateLimitConfigInvalidError) {
        console.error("RateLimiter: configured rate-limit.policy value is invalid (failing closed):", error.message);
        return { allowed: false, remaining: 0 };
      }
      throw error;
    }
    if (policy === null) {
      return UNLIMITED_RESULT;
    }

    const key = tenant.projectId ? `${tenant.organizationId}:${tenant.projectId}` : tenant.organizationId;
    try {
      return await this.rateLimitAlgorithm.checkAndConsume(key, cost, policy);
    } catch (error) {
      // Redis unavailable -> fail closed (reject rather than allow unlimited consumption).
      console.error("RateLimiter: RateLimitAlgorithm call failed (failing closed):", error);
      return { allowed: false, remaining: 0, retryAfterMs: policy.refillIntervalMs };
    }
  }

  // Returns null for "not configured" (pass-through); throws RateLimitConfigInvalidError for a
  // configured-but-malformed value.
  private async resolvePolicy(tenant: TenantContext): Promise<RateLimitPolicy | null> {
    let raw: unknown;
    try {
      raw = await this.configurationService.getWithFallback<unknown>(RATE_LIMIT_POLICY_CONFIG_KEY, toTenantScope(tenant));
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return null;
      }
      throw error;
    }
    if (!isValidPolicyShape(raw)) {
      throw new RateLimitConfigInvalidError(`rate-limit.policy value is not a valid RateLimitPolicy: ${JSON.stringify(raw)}`);
    }
    return raw;
  }
}

// Validated as finite numbers, not required to be integers. Exported so the Admin API's
// rate-limit-policy write endpoint validates with these exact rules rather than a copy that
// could drift.
export function isValidPolicyShape(raw: unknown): raw is RateLimitPolicy {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.capacity === "number" &&
    Number.isFinite(candidate.capacity) &&
    candidate.capacity > 0 &&
    typeof candidate.refillTokens === "number" &&
    Number.isFinite(candidate.refillTokens) &&
    candidate.refillTokens >= 0 &&
    typeof candidate.refillIntervalMs === "number" &&
    Number.isFinite(candidate.refillIntervalMs) &&
    candidate.refillIntervalMs > 0
  );
}
