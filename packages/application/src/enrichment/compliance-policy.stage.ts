import { ConfigurationNotFoundError } from "@llm-gateway/domain";
import type { EnrichmentStage, EnrichmentResult, CanonicalRequest, TenantContext, ConfigurationService, TenantScope } from "@llm-gateway/domain";
import {
  COMPLIANCE_DENIED_TOPICS_CONFIG_KEY,
  COMPLIANCE_PII_REDACTION_ENABLED_CONFIG_KEY,
  toTenantScope,
} from "./enrichment-config-keys.js";

// Basic regex-based redaction covering two common PII shapes (emails, long digit sequences) —
// not a full PII detection engine.
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const LONG_DIGIT_SEQUENCE_PATTERN = /\d{9,}/g;

function redactPii(content: string): string {
  return content.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]").replace(LONG_DIGIT_SEQUENCE_PATTERN, "[REDACTED_NUMBER]");
}

// Topic deny lists + PII redaction. Compliance-critical: an infra failure resolving this stage's
// config fails closed (rejects) — the stage can't certify a request against a policy it couldn't
// read. "Not configured" is the normal default and passes through.
//
// Both checks scan only non-"system" messages — the concern is untrusted user/assistant content,
// not an operator's own configured system prompt.
export class CompliancePolicyStage implements EnrichmentStage {
  readonly name = "compliance_policy";

  constructor(private readonly configurationService: ConfigurationService) {}

  async apply(request: CanonicalRequest, tenant: TenantContext): Promise<EnrichmentResult> {
    const scope = toTenantScope(tenant);

    let deniedTopics: readonly string[];
    let piiRedactionEnabled: boolean;
    try {
      [deniedTopics, piiRedactionEnabled] = await Promise.all([
        this.readDeniedTopics(scope),
        this.readPiiRedactionEnabled(scope),
      ]);
    } catch (error) {
      console.error("CompliancePolicyStage: failed to resolve compliance configuration (failing closed):", error);
      return {
        action: "reject",
        code: "COMPLIANCE_POLICY_UNAVAILABLE",
        reason: "Request could not be checked against compliance policy",
      };
    }

    if (deniedTopics.length > 0) {
      for (const message of request.messages) {
        if (message.role === "system") {
          continue;
        }
        const lowerContent = message.content.toLowerCase();
        if (deniedTopics.some((topic) => lowerContent.includes(topic.toLowerCase()))) {
          return {
            action: "reject",
            code: "COMPLIANCE_POLICY_VIOLATION",
            reason: "Request content matched a denied topic",
          };
        }
      }
    }

    if (!piiRedactionEnabled) {
      return { action: "continue", request };
    }
    return {
      action: "continue",
      request: {
        ...request,
        messages: request.messages.map((message) =>
          message.role === "system" ? message : { ...message, content: redactPii(message.content) },
        ),
      },
    };
  }

  // Returns [] for "not configured"; throws for a genuine infra failure (propagated to apply()'s
  // fail-closed handling). A malformed value is logged and treated as empty.
  private async readDeniedTopics(scope: TenantScope): Promise<readonly string[]> {
    let raw: unknown;
    try {
      raw = await this.configurationService.getWithFallback<unknown>(COMPLIANCE_DENIED_TOPICS_CONFIG_KEY, scope);
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return [];
      }
      throw error;
    }
    if (!Array.isArray(raw) || !raw.every((topic) => typeof topic === "string")) {
      console.error("CompliancePolicyStage: configured denied-topics value is not a string[] (ignoring, treating as empty)");
      return [];
    }
    return raw;
  }

  private async readPiiRedactionEnabled(scope: TenantScope): Promise<boolean> {
    let raw: unknown;
    try {
      raw = await this.configurationService.getWithFallback<unknown>(COMPLIANCE_PII_REDACTION_ENABLED_CONFIG_KEY, scope);
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return false;
      }
      throw error;
    }
    if (typeof raw !== "boolean") {
      console.error("CompliancePolicyStage: configured pii-redaction-enabled value is not a boolean (ignoring, treating as disabled)");
      return false;
    }
    return raw;
  }
}
