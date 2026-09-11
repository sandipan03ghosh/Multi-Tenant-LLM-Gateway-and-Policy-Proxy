import type { PrismaClient } from "@llm-gateway/adapters-postgres";

// Mirrors packages/api/src/health/health-checks.ts — duplicated rather than shared for a
// handful of small functions with no existing api/worker shared package.

// Bounded timeout on every dependency probe — an unbounded check against a hanging dependency
// would block the orchestrator's health-check poller instead of failing fast.
const DEPENDENCY_CHECK_TIMEOUT_MS = 1_500;

// Minimal structural type — avoids depending on ioredis's types here.
interface PingableRedis {
  ping(): Promise<string>;
}

class HealthCheckTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new HealthCheckTimeoutError(`timed out after ${timeoutMs}ms`)), timeoutMs).unref();
    }),
  ]);
}

export interface DependencyCheckResult {
  readonly ok: boolean;
  // Never the raw driver/exception message (unredacted internal detail); "timeout" vs
  // "unreachable" is enough to be useful.
  readonly reason?: "timeout" | "unreachable";
}

async function probe(promise: Promise<unknown>): Promise<DependencyCheckResult> {
  try {
    await withTimeout(promise, DEPENDENCY_CHECK_TIMEOUT_MS);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof HealthCheckTimeoutError ? "timeout" : "unreachable" };
  }
}

export interface ReadinessResult {
  readonly ready: boolean;
  readonly checks: {
    readonly postgres: DependencyCheckResult;
    readonly redis: DependencyCheckResult;
    // Not a live re-probe — a boolean the composition root sets after configurationService.start().
    readonly configuration: { readonly ok: boolean };
  };
}

export async function checkReadiness(
  prisma: Pick<PrismaClient, "$queryRaw">,
  redis: PingableRedis,
  isConfigurationReady: () => boolean,
): Promise<ReadinessResult> {
  const [postgres, redis_] = await Promise.all([probe(prisma.$queryRaw`SELECT 1`), probe(redis.ping())]);
  const configuration = { ok: isConfigurationReady() };
  return {
    ready: postgres.ok && redis_.ok && configuration.ok,
    checks: { postgres, redis: redis_, configuration },
  };
}

export interface VersionInfo {
  readonly version: string;
  readonly nodeEnv: string;
  readonly gitCommitSha: string;
}

export function buildVersionInfo(packageVersion: string, nodeEnv: string, gitCommitSha: string): VersionInfo {
  return { version: packageVersion, nodeEnv, gitCommitSha };
}
