import { Router } from "express";
import type { ConfigurationService, ConfigurationWriter, ProjectRepository, AuditLogRepository } from "@llm-gateway/domain";
import {
  ENRICHMENT_STAGES_CONFIG_KEY,
  SYSTEM_PROMPT_TEXT_CONFIG_KEY,
  COMPLIANCE_DENIED_TOPICS_CONFIG_KEY,
  COMPLIANCE_PII_REDACTION_ENABLED_CONFIG_KEY,
  CONTENT_FILTER_FAILURE_MODE_CONFIG_KEY,
  CONTENT_FILTER_TIMEOUT_MS_CONFIG_KEY,
  isValidStageListShape,
  isValidSystemPromptShape,
  isValidDeniedTopicsShape,
  isValidPiiRedactionEnabledShape,
  isValidContentFilterFailureModeShape,
  isValidContentFilterTimeoutMsShape,
} from "@llm-gateway/application";
import { createPolicyRouter } from "./policy-router-factory.js";

// /admin/v1/organizations/:orgId/enrichment-policy/* — six config keys, one sub-route each, all
// gated by the same enrichment.policy:read/write pair since together they form one policy. Each
// sub-route is a thin createPolicyRouter() instance.
export function createEnrichmentPolicyRouter(
  configurationService: ConfigurationService,
  configurationWriter: ConfigurationWriter,
  projectRepository: ProjectRepository,
  auditLogRepository: AuditLogRepository,
): Router {
  const router = Router({ mergeParams: true });

  router.use(
    "/stages",
    createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
      configKey: ENRICHMENT_STAGES_CONFIG_KEY,
      readPermission: "enrichment.policy:read",
      writePermission: "enrichment.policy:write",
      isValidShape: isValidStageListShape,
      invalidBodyMessage: "Request body is not a valid stage-name array",
      auditAction: "admin.enrichment_policy.stages_updated",
    }),
  );
  router.use(
    "/system-prompt",
    createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
      configKey: SYSTEM_PROMPT_TEXT_CONFIG_KEY,
      readPermission: "enrichment.policy:read",
      writePermission: "enrichment.policy:write",
      isValidShape: isValidSystemPromptShape,
      invalidBodyMessage: "Request body is not a valid system-prompt string",
      auditAction: "admin.enrichment_policy.system_prompt_updated",
    }),
  );
  router.use(
    "/denied-topics",
    createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
      configKey: COMPLIANCE_DENIED_TOPICS_CONFIG_KEY,
      readPermission: "enrichment.policy:read",
      writePermission: "enrichment.policy:write",
      isValidShape: isValidDeniedTopicsShape,
      invalidBodyMessage: "Request body is not a valid denied-topics array",
      auditAction: "admin.enrichment_policy.denied_topics_updated",
    }),
  );
  router.use(
    "/pii-redaction",
    createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
      configKey: COMPLIANCE_PII_REDACTION_ENABLED_CONFIG_KEY,
      readPermission: "enrichment.policy:read",
      writePermission: "enrichment.policy:write",
      isValidShape: isValidPiiRedactionEnabledShape,
      invalidBodyMessage: "Request body is not a valid boolean",
      auditAction: "admin.enrichment_policy.pii_redaction_updated",
    }),
  );
  router.use(
    "/content-filter-failure-mode",
    createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
      configKey: CONTENT_FILTER_FAILURE_MODE_CONFIG_KEY,
      readPermission: "enrichment.policy:read",
      writePermission: "enrichment.policy:write",
      isValidShape: isValidContentFilterFailureModeShape,
      invalidBodyMessage: 'Request body must be "fail_open" or "fail_closed"',
      auditAction: "admin.enrichment_policy.content_filter_failure_mode_updated",
    }),
  );
  router.use(
    "/content-filter-timeout-ms",
    createPolicyRouter(configurationService, configurationWriter, projectRepository, auditLogRepository, {
      configKey: CONTENT_FILTER_TIMEOUT_MS_CONFIG_KEY,
      readPermission: "enrichment.policy:read",
      writePermission: "enrichment.policy:write",
      isValidShape: isValidContentFilterTimeoutMsShape,
      invalidBodyMessage: "Request body is not a valid positive number",
      auditAction: "admin.enrichment_policy.content_filter_timeout_updated",
    }),
  );

  return router;
}
