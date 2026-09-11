import type { Router } from "express";
import type { ConfigurationService, ConfigurationWriter, ProjectRepository, AuditLogRepository } from "@llm-gateway/domain";
import { ROUTING_POLICY_CONFIG_KEY, isValidRoutingPolicyShape } from "@llm-gateway/application";
import { createPolicyRouter } from "./policy-router-factory.js";

// GET/PUT /admin/v1/organizations/:orgId/routing-policy[?projectId=]. The stored policy this
// writes is what chat-completions.routes.ts falls back to when a request omits `provider`.
export function createRoutingPolicyRouter(
  configurationService: ConfigurationService,
  configurationWriter: ConfigurationWriter,
  projectRepository: ProjectRepository,
  auditLogRepository: AuditLogRepository,
): Router {
  return createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
    configKey: ROUTING_POLICY_CONFIG_KEY,
    readPermission: "routing.policy:read",
    writePermission: "routing.policy:write",
    isValidShape: isValidRoutingPolicyShape,
    invalidBodyMessage: "Request body is not a valid RoutingPolicy",
    auditAction: "admin.routing_policy.updated",
  });
}
