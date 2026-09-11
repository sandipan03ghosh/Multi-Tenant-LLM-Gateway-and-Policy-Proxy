// Postgres adapter — implements domain repository ports via Prisma. Depends on @llm-gateway/domain only.

export { createPrismaClient } from "./prisma-client.js";
export type { PrismaClient } from "./prisma-client.js";
export { PrismaConfigurationRepository } from "./repositories/prisma-configuration.repository.js";
export { PrismaOrganizationRepository } from "./repositories/prisma-organization.repository.js";
export { PrismaProjectRepository } from "./repositories/prisma-project.repository.js";
export { PrismaUserRepository } from "./repositories/prisma-user.repository.js";
export { PrismaApiKeyRepository } from "./repositories/prisma-api-key.repository.js";
export { PrismaRoleRepository } from "./repositories/prisma-role.repository.js";
export { PrismaPermissionRepository } from "./repositories/prisma-permission.repository.js";
export { PrismaUserRoleAssignmentRepository } from "./repositories/prisma-user-role-assignment.repository.js";
export { PrismaApiKeyRoleAssignmentRepository } from "./repositories/prisma-api-key-role-assignment.repository.js";
export { PrismaRolePermissionRepository } from "./repositories/prisma-role-permission.repository.js";
export { PostgresJobScheduler } from "./job-scheduler/postgres-job-scheduler.js";
export type { PostgresJobSchedulerConfig } from "./job-scheduler/postgres-job-scheduler.js";
export { PrismaBatchRequestRepository } from "./repositories/prisma-batch-request.repository.js";
export { PrismaAuditLogRepository } from "./repositories/prisma-audit-log.repository.js";
export { PrismaCostLedgerRepository } from "./repositories/prisma-cost-ledger.repository.js";
export { PrismaAlertChannelConfigRepository } from "./repositories/prisma-alert-channel-config.repository.js";
