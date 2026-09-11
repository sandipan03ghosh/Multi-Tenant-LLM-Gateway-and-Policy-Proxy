// Demo/dev seed. Tenancy rows go through the real repository ports. Two exceptions use the raw
// Prisma client: the Permission catalog (its repository is read-only) and RolePermission (no
// repository port — a static catalog-to-role binding).
import "dotenv/config";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import {
  createPrismaClient,
  PrismaConfigurationRepository,
  PrismaOrganizationRepository,
  PrismaProjectRepository,
  PrismaUserRepository,
  PrismaApiKeyRepository,
  PrismaRoleRepository,
  PrismaUserRoleAssignmentRepository,
  PrismaApiKeyRoleAssignmentRepository,
} from "@llm-gateway/adapters-postgres";
import type { PrismaClient } from "@llm-gateway/adapters-postgres";
import { createRedisClient, RedisPubSub } from "@llm-gateway/adapters-redis";
import { ConfigurationWriterService } from "@llm-gateway/application";
import {
  ConfigScope,
  toConfigKey,
  Organization,
  Project,
  User,
  ApiKey,
  Role,
  RoleScope,
} from "@llm-gateway/domain";
import type { ApiKeyId, ProjectId, RoleId, UserId } from "@llm-gateway/domain";

// Two independent guards: ALLOW_SEED=true must be set explicitly, AND NODE_ENV must not be
// "production" — so a stray ALLOW_SEED=true in a real environment still can't run this.
if (process.env.ALLOW_SEED !== "true") {
  console.error(
    "Refusing to seed: set ALLOW_SEED=true in the environment to run this script.\n" +
      "This is a safety guard, not a feature flag — set it only in your local/demo .env, " +
      "never in a real/production environment's configuration.",
  );
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error(
    'Refusing to seed: NODE_ENV="production". This script creates demo organizations, ' +
      "projects, and API keys and must never run against a production database, " +
      "regardless of ALLOW_SEED.",
  );
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// --- API key generation (seed-only placeholder hashing) -------------------------------------

const SCRYPT_KEY_LENGTH = 64;

// Seed-only placeholder — real API-key hashing is argon2id (adapters-security). scryptSync is
// used here only because it's built into Node; these are throwaway demo keys. Not for production.
function hashApiKeySeedOnly(secret: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(secret, salt, SCRYPT_KEY_LENGTH);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

interface GeneratedApiKey {
  readonly plaintext: string;
  readonly prefix: string;
  readonly hash: string;
}

function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(24).toString("base64url");
  const prefix = `llmgw_${randomBytes(4).toString("hex")}`;
  return { plaintext: `${prefix}.${secret}`, prefix, hash: hashApiKeySeedOnly(`${prefix}.${secret}`) };
}

// --- Seed data shape --------------------------------------------------------------------------

const PERMISSIONS = [
  { code: "routing.policy:read", description: "View routing policy configuration" },
  { code: "routing.policy:write", description: "Modify routing policy configuration" },
  { code: "rate-limit.policy:read", description: "View rate-limit policy configuration" },
  { code: "rate-limit.policy:write", description: "Modify rate-limit policy configuration" },
  { code: "budget.policy:read", description: "View budget policy configuration" },
  { code: "budget.policy:write", description: "Modify budget policy configuration" },
  { code: "audit.log:read", description: "View the audit log" },
  // Global/platform-only — bound only to PLATFORM_ADMIN_ROLE_NAME below, never to an org-scoped role.
  { code: "provider:read", description: "View provider registration and enabled state" },
  { code: "provider:write", description: "Enable or disable a provider gateway-wide" },
  // Gates all six enrichment-policy sub-routes as one unit; org-scoped.
  { code: "enrichment.policy:read", description: "View enrichment policy configuration" },
  { code: "enrichment.policy:write", description: "Modify enrichment policy configuration" },
  // Global/platform-only — alert channels are operator-facing, so an org-scoped role must never carry this.
  { code: "alert-channel:read", description: "View configured alert channels (redacted)" },
  { code: "alert-channel:write", description: "Create, update, or delete alert channels" },
] as const;

const GLOBAL_ONLY_PERMISSION_CODES = new Set(["provider:read", "provider:write", "alert-channel:read", "alert-channel:write"]);

// Org-scoped roles (Admin/Viewer) are only ever granted permissions outside
// GLOBAL_ONLY_PERMISSION_CODES; those go through seedPlatformAdminRole.
const ORG_SCOPED_PERMISSION_CODES = PERMISSIONS.filter((p) => !GLOBAL_ONLY_PERMISSION_CODES.has(p.code)).map((p) => p.code);
const ADMIN_PERMISSION_CODES = ORG_SCOPED_PERMISSION_CODES;
const VIEWER_PERMISSION_CODES = ORG_SCOPED_PERMISSION_CODES.filter((code) => code.endsWith(":read"));

const GLOBAL_PERMISSION_CODES = [...GLOBAL_ONLY_PERMISSION_CODES] as const;
const PLATFORM_ADMIN_ROLE_NAME = "Platform Admin";

interface OrganizationSeedSpec {
  readonly slug: string;
  readonly name: string;
  readonly adminEmail: string;
  readonly projects: ReadonlyArray<{ slug: string; name: string }>;
}

const ORGANIZATIONS: readonly OrganizationSeedSpec[] = [
  {
    slug: "acme-corp",
    name: "Acme Corp",
    adminEmail: "admin@acme-corp.dev",
    projects: [
      { slug: "production", name: "Production" },
      { slug: "staging", name: "Staging" },
    ],
  },
  {
    slug: "globex-inc",
    name: "Globex Inc",
    adminEmail: "admin@globex-inc.dev",
    projects: [{ slug: "production", name: "Production" }],
  },
];

// --- Repository bundle ---------------------------------------------------------------------

interface Repositories {
  readonly organizations: PrismaOrganizationRepository;
  readonly projects: PrismaProjectRepository;
  readonly users: PrismaUserRepository;
  readonly apiKeys: PrismaApiKeyRepository;
  readonly roles: PrismaRoleRepository;
  readonly userRoleAssignments: PrismaUserRoleAssignmentRepository;
  readonly apiKeyRoleAssignments: PrismaApiKeyRoleAssignmentRepository;
}

function createRepositories(prisma: PrismaClient): Repositories {
  return {
    organizations: new PrismaOrganizationRepository(prisma),
    projects: new PrismaProjectRepository(prisma),
    users: new PrismaUserRepository(prisma),
    apiKeys: new PrismaApiKeyRepository(prisma),
    roles: new PrismaRoleRepository(prisma),
    userRoleAssignments: new PrismaUserRoleAssignmentRepository(prisma),
    apiKeyRoleAssignments: new PrismaApiKeyRoleAssignmentRepository(prisma),
  };
}

// --- Seeding logic -----------------------------------------------------------------------------

// Permission catalog and RolePermission bindings — raw Prisma client by design, see file header.
async function seedPermissionCatalog(prisma: PrismaClient): Promise<Map<string, string>> {
  const permissions = new Map<string, string>(); // code -> id
  for (const permission of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { code: permission.code },
      create: permission,
      update: { description: permission.description },
    });
    permissions.set(row.code, row.id);
  }
  return permissions;
}

async function assignPermissions(
  prisma: PrismaClient,
  roleId: string,
  codes: readonly string[],
  permissionIds: Map<string, string>,
): Promise<void> {
  for (const code of codes) {
    const permissionId = permissionIds.get(code);
    if (!permissionId) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      create: { roleId, permissionId },
      update: {},
    });
  }
}

async function ensureUserRoleAssignment(
  repo: PrismaUserRoleAssignmentRepository,
  args: { userId: UserId; roleId: RoleId; projectId: ProjectId | null },
): Promise<void> {
  const existing = await repo.listByUser(args.userId);
  const alreadyAssigned = existing.some(
    (a) => a.roleId === args.roleId && a.projectId === args.projectId,
  );
  if (!alreadyAssigned) {
    await repo.create(args);
  }
}

async function ensureApiKeyRoleAssignment(
  repo: PrismaApiKeyRoleAssignmentRepository,
  args: { apiKeyId: ApiKeyId; roleId: RoleId; projectId: ProjectId | null },
): Promise<void> {
  const existing = await repo.listByApiKey(args.apiKeyId);
  const alreadyAssigned = existing.some(
    (a) => a.roleId === args.roleId && a.projectId === args.projectId,
  );
  if (!alreadyAssigned) {
    await repo.create(args);
  }
}

// The global/platform-role counterpart to seedOrganization's per-org Admin/Viewer roles — one
// Role row with organizationId: null, carrying the global-only permissions.
//
// RoleScope.ORGANIZATION (not PROJECT) is correct despite the name: scope governs whether an
// assignment must be project-pinned, and a platform role's assignment has no project to pin to.
//
// Deliberately not assigned to anyone: auto-granting a cross-tenant permission to a demo org's
// admin would defeat the reason this role is global. A human operator creates the assignment.
async function seedPlatformAdminRole(
  prisma: PrismaClient,
  repos: Repositories,
  permissionIds: Map<string, string>,
): Promise<void> {
  const now = new Date();

  let platformAdminRole = await repos.roles.findGlobalRoleByName(PLATFORM_ADMIN_ROLE_NAME);
  if (!platformAdminRole) {
    platformAdminRole = Role.create({
      id: randomUUID(),
      organizationId: null,
      name: PLATFORM_ADMIN_ROLE_NAME,
      scope: RoleScope.ORGANIZATION,
      createdAt: now,
      updatedAt: now,
    });
    await repos.roles.save(platformAdminRole);
  }

  await assignPermissions(prisma, platformAdminRole.id, GLOBAL_PERMISSION_CODES, permissionIds);

  console.log(`\nGlobal role: ${PLATFORM_ADMIN_ROLE_NAME} (organizationId: null)`);
  console.log(`  Permissions: ${GLOBAL_PERMISSION_CODES.join(", ")}`);
  console.log("  Not assigned to any user or API key — see seedPlatformAdminRole's comment.");
}

async function seedOrganization(
  prisma: PrismaClient,
  repos: Repositories,
  spec: OrganizationSeedSpec,
  permissionIds: Map<string, string>,
): Promise<void> {
  const now = new Date();

  let organization = await repos.organizations.findBySlug(spec.slug);
  if (!organization) {
    organization = Organization.create({
      id: randomUUID(),
      name: spec.name,
      slug: spec.slug,
      createdAt: now,
      updatedAt: now,
    });
    await repos.organizations.save(organization);
  }

  let adminRole = await repos.roles.findByNameInOrganization(organization.id, "Admin");
  if (!adminRole) {
    adminRole = Role.create({
      id: randomUUID(),
      organizationId: organization.id,
      name: "Admin",
      scope: RoleScope.ORGANIZATION,
      createdAt: now,
      updatedAt: now,
    });
    await repos.roles.save(adminRole);
  }

  let viewerRole = await repos.roles.findByNameInOrganization(organization.id, "Viewer");
  if (!viewerRole) {
    viewerRole = Role.create({
      id: randomUUID(),
      organizationId: organization.id,
      name: "Viewer",
      scope: RoleScope.PROJECT,
      createdAt: now,
      updatedAt: now,
    });
    await repos.roles.save(viewerRole);
  }

  await assignPermissions(prisma, adminRole.id, ADMIN_PERMISSION_CODES, permissionIds);
  await assignPermissions(prisma, viewerRole.id, VIEWER_PERMISSION_CODES, permissionIds);

  let adminUser = await repos.users.findByEmailInOrganization(organization.id, spec.adminEmail);
  if (!adminUser) {
    adminUser = User.create({
      id: randomUUID(),
      organizationId: organization.id,
      // passwordHash intentionally null: login isn't wired up.
      email: spec.adminEmail,
      passwordHash: null,
      createdAt: now,
      updatedAt: now,
    });
    await repos.users.save(adminUser);
  }
  await ensureUserRoleAssignment(repos.userRoleAssignments, {
    userId: adminUser.id,
    roleId: adminRole.id,
    projectId: null,
  });

  console.log(`\nOrganization: ${spec.name} (${spec.slug})`);
  console.log(`  Admin user: ${spec.adminEmail}`);

  for (const projectSpec of spec.projects) {
    let project = await repos.projects.findBySlugInOrganization(organization.id, projectSpec.slug);
    if (!project) {
      project = Project.create({
        id: randomUUID(),
        organizationId: organization.id,
        name: projectSpec.name,
        slug: projectSpec.slug,
        createdAt: now,
        updatedAt: now,
      });
      await repos.projects.save(project);
    }

    const existingKeys = await repos.apiKeys.listByProject(project.id);
    let apiKey = existingKeys.find((k) => k.name === "Demo Seed Key") ?? null;

    if (apiKey) {
      console.log(
        `  Project ${projectSpec.slug}: API key already seeded (prefix ${apiKey.keyPrefix})`,
      );
    } else {
      const generated = generateApiKey();
      apiKey = ApiKey.create({
        id: randomUUID(),
        projectId: project.id,
        name: "Demo Seed Key",
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        createdAt: now,
        revokedAt: null,
      });
      await repos.apiKeys.save(apiKey);
      // Shown once — only the hash is persisted, so this line is the only place the plaintext exists.
      console.log(`  Project ${projectSpec.slug}: new demo API key generated —`);
      console.log(
        "    *** SECRET — do not commit, log elsewhere, or share this value *** " +
          `${generated.plaintext}`,
      );
    }

    await ensureApiKeyRoleAssignment(repos.apiKeyRoleAssignments, {
      apiKeyId: apiKey.id,
      roleId: viewerRole.id,
      projectId: project.id,
    });
  }
}

async function seedGlobalConfig(prisma: PrismaClient, redisUrl: string): Promise<void> {
  const redis = createRedisClient(redisUrl);
  const publisherRedis = createRedisClient(redisUrl);
  try {
    const repository = new PrismaConfigurationRepository(prisma);
    const pubSub = new RedisPubSub(publisherRedis);
    const writer = new ConfigurationWriterService(repository, pubSub);

    await writer.set(
      ConfigScope.GLOBAL,
      "global",
      toConfigKey("demo.welcome-message"),
      "This value was written by prisma/seed.ts through ConfigurationWriterService.",
    );
    console.log("\nSeeded ConfigurationEntry: demo.welcome-message (GLOBAL scope)");
  } finally {
    redis.disconnect();
    publisherRedis.disconnect();
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const redisUrl = requireEnv("REDIS_URL");

  const prisma = createPrismaClient(databaseUrl);
  try {
    const repos = createRepositories(prisma);
    const permissionIds = await seedPermissionCatalog(prisma);
    await seedPlatformAdminRole(prisma, repos, permissionIds);
    for (const spec of ORGANIZATIONS) {
      await seedOrganization(prisma, repos, spec, permissionIds);
    }
    await seedGlobalConfig(prisma, redisUrl);
    console.log("\nSeed complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
