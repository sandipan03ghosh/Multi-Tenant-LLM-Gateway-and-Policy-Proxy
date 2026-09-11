import type { Router } from "express";
import type { ConfigurationService, ConfigurationWriter, ProjectRepository, AuditLogRepository } from "@llm-gateway/domain";
import { RATE_LIMIT_POLICY_CONFIG_KEY, isValidPolicyShape } from "@llm-gateway/application";
import { createPolicyRouter } from "./policy-router-factory.js";

// GET/PUT /admin/v1/organizations/:orgId/rate-limit-policy[?projectId=].
export function createRateLimitPolicyRouter(
  configurationService: ConfigurationService,
  configurationWriter: ConfigurationWriter,
  projectRepository: ProjectRepository,
  auditLogRepository: AuditLogRepository,
): Router {
  return createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
    configKey: RATE_LIMIT_POLICY_CONFIG_KEY,
    readPermission: "rate-limit.policy:read",
    writePermission: "rate-limit.policy:write",
    isValidShape: isValidPolicyShape,
    invalidBodyMessage: "Request body is not a valid RateLimitPolicy",
    auditAction: "admin.rate_limit_policy.updated",
  });
}
