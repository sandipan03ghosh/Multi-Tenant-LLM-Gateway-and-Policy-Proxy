import type { Router } from "express";
import type { ConfigurationService, ConfigurationWriter, ProjectRepository, AuditLogRepository } from "@llm-gateway/domain";
import { BUDGET_POLICY_CONFIG_KEY, isValidBudgetPolicyShape } from "@llm-gateway/application";
import { createPolicyRouter } from "./policy-router-factory.js";

// GET/PUT /admin/v1/organizations/:orgId/budget-policy[?projectId=].
export function createBudgetPolicyRouter(
  configurationService: ConfigurationService,
  configurationWriter: ConfigurationWriter,
  projectRepository: ProjectRepository,
  auditLogRepository: AuditLogRepository,
): Router {
  return createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
    configKey: BUDGET_POLICY_CONFIG_KEY,
    readPermission: "budget.policy:read",
    writePermission: "budget.policy:write",
    isValidShape: isValidBudgetPolicyShape,
    invalidBodyMessage: "Request body is not a valid BudgetPolicy",
    auditAction: "admin.budget_policy.updated",
  });
}
