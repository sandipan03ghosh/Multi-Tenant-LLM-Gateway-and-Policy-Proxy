import { createHmac, timingSafeEqual } from "node:crypto";
import { ConfigurationNotFoundError } from "@llm-gateway/domain";
import type { SecretStore, ReplayCache, TenantContext, ConfigurationService } from "@llm-gateway/domain";
import { REQUEST_SIGNING_ENABLED_CONFIG_KEY, projectSigningKeySecretKey, toTenantScope } from "./request-signing-config-keys.js";

// Requests outside this skew from server time are rejected outright — bounds how long a captured
// signature stays replayable, and doubles as the nonce cache's TTL.
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export interface SignatureVerificationResult {
  readonly valid: boolean;
  // Internal-only, for logging — never included in an HTTP response body.
  readonly reason?: string;
}

// Optional per-project HMAC request signing — signature covers a timestamp + nonce, checked
// against a short-lived replay cache. No domain port wraps this class; all Redis specifics stay
// behind ReplayCache.
export class DefaultRequestSignatureVerifier {
  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly secretStore: SecretStore,
    private readonly replayCache: ReplayCache,
  ) {}

  async isEnabledForProject(tenant: TenantContext): Promise<boolean> {
    let raw: unknown;
    try {
      raw = await this.configurationService.getWithFallback<unknown>(REQUEST_SIGNING_ENABLED_CONFIG_KEY, toTenantScope(tenant));
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return false;
      }
      throw error;
    }
    if (typeof raw !== "boolean") {
      console.error(`RequestSignatureVerifier: configured ${REQUEST_SIGNING_ENABLED_CONFIG_KEY} value is not a boolean (treating as disabled):`, JSON.stringify(raw));
      return false;
    }
    return raw;
  }

  async verify(tenant: TenantContext, rawBody: Buffer, timestamp: string, nonce: string, signature: string): Promise<SignatureVerificationResult> {
    // Request signing is project-scoped (a per-project key). Guards null and undefined both,
    // rather than trusting the `ProjectId | null` type alone.
    const { projectId } = tenant;
    if (projectId === null || projectId === undefined) {
      return { valid: false, reason: "tenant has no project scope" };
    }

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
      return { valid: false, reason: "timestamp missing, malformed, or outside the allowed skew" };
    }

    const signingKey = await this.secretStore.getSecret(projectSigningKeySecretKey(projectId));
    if (!signingKey) {
      return { valid: false, reason: "no signing key configured for this project" };
    }

    const expectedSignature = createHmac("sha256", signingKey).update(timestamp).update(".").update(nonce).update(".").update(rawBody).digest("hex");

    if (!constantTimeHexEqual(expectedSignature, signature)) {
      return { valid: false, reason: "signature mismatch" };
    }

    // Recorded only once the signature is confirmed valid — so garbage signatures can't burn a
    // legitimate client's nonce.
    const firstUse = await this.replayCache.checkAndRecord(`sig-nonce:${projectId}:${nonce}`, MAX_TIMESTAMP_SKEW_MS);
    if (!firstUse) {
      return { valid: false, reason: "nonce already used (replay)" };
    }

    return { valid: true };
  }
}

// timingSafeEqual() throws on a length mismatch — the length check first avoids that throw and
// leaks nothing (the output size is fixed and public), while still not leaking per-byte timing.
function constantTimeHexEqual(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHex, "hex");
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}
