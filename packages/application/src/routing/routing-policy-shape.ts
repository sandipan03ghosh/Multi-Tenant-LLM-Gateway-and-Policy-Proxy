import { toConfigKey } from "@llm-gateway/domain";
import type { ConfigKey, ProviderCandidate, RoutingPolicy, ShadowRoutingConfig, WeightedCandidate } from "@llm-gateway/domain";

// Tenant-scoped — the stored fallback policy used by chat-completions.routes.ts when a request
// omits an explicit `provider`. Read via ConfigurationService.getWithFallback().
export const ROUTING_POLICY_CONFIG_KEY: ConfigKey = toConfigKey("routing.policy");

function isProviderCandidate(raw: unknown): raw is ProviderCandidate {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  return typeof candidate.providerId === "string" && candidate.providerId.length > 0 && typeof candidate.modelId === "string" && candidate.modelId.length > 0;
}

function isWeightedCandidate(raw: unknown): raw is WeightedCandidate {
  if (!isProviderCandidate(raw)) {
    return false;
  }
  const candidate = raw as unknown as Record<string, unknown>;
  return typeof candidate.weight === "number" && Number.isFinite(candidate.weight);
}

function isShadowRoutingConfig(raw: unknown): raw is ShadowRoutingConfig {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const shadow = raw as Record<string, unknown>;
  return (
    isProviderCandidate(shadow.candidate) &&
    typeof shadow.sampleRate === "number" &&
    Number.isFinite(shadow.sampleRate) &&
    shadow.sampleRate >= 0 &&
    shadow.sampleRate <= 1
  );
}

// Validates the full RoutingPolicy union variant-for-variant, not just the discriminant —
// exported so the Admin API's routing-policy write endpoint validates with these exact rules
// rather than a copy that could drift. Hand-written type guard, not zod.
export function isValidRoutingPolicyShape(raw: unknown): raw is RoutingPolicy {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const policy = raw as Record<string, unknown>;
  if (policy.shadow !== undefined && !isShadowRoutingConfig(policy.shadow)) {
    return false;
  }

  switch (policy.type) {
    case "manual":
      return typeof policy.providerId === "string" && policy.providerId.length > 0;
    case "round_robin":
      return (
        typeof policy.cursorKey === "string" &&
        policy.cursorKey.length > 0 &&
        Array.isArray(policy.candidates) &&
        policy.candidates.length > 0 &&
        policy.candidates.every(isProviderCandidate)
      );
    case "weighted":
      return Array.isArray(policy.candidates) && policy.candidates.length > 0 && policy.candidates.every(isWeightedCandidate);
    case "health_aware":
      return Array.isArray(policy.candidates) && policy.candidates.length > 0 && policy.candidates.every(isProviderCandidate);
    case "sticky":
      return (
        typeof policy.sessionKey === "string" &&
        policy.sessionKey.length > 0 &&
        Array.isArray(policy.candidates) &&
        policy.candidates.length > 0 &&
        policy.candidates.every(isProviderCandidate) &&
        (policy.pinTtlMs === undefined || (typeof policy.pinTtlMs === "number" && Number.isFinite(policy.pinTtlMs)))
      );
    default:
      return false;
  }
}
