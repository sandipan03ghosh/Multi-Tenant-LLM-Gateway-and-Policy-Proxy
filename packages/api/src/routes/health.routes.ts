import { Router } from "express";
import type { ReadinessResult, VersionInfo } from "../health/health-checks.js";

// All four unauthenticated, registered before the auth middleware — an orchestrator's healthcheck
// needs no credentials. Takes the composition root's bound checkReadiness()/versionInfo.
export function createHealthRouter(checkReadiness: () => Promise<ReadinessResult>, versionInfo: VersionInfo): Router {
  const router = Router();

  // Minimal process-is-up check — the docker-compose healthcheck targets this path. /live is the
  // same check under the k8s-conventional name.
  router.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Liveness: never touches Postgres/Redis — a failed liveness probe would trigger a restart
  // storm during exactly the kind of outage the rest of the system is built to degrade through.
  // Always 200 while the process can respond.
  router.get("/live", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/ready", async (_req, res) => {
    const result = await checkReadiness();
    res.status(result.ready ? 200 : 503).json(result);
  });

  router.get("/version", (_req, res) => {
    res.status(200).json(versionInfo);
  });

  return router;
}
