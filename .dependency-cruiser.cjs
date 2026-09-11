/**
 * Architectural boundary rules for the monorepo — the allowed dependency directions between
 * packages. Add the dependency-cruiser dev dependency and run `depcruise` (e.g. as a CI step)
 * to enforce these.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "domain-no-infra",
      comment:
        "domain must have zero dependencies on infrastructure adapters, provider adapters, " +
        "or any composition root — it may only depend on the standard library and other " +
        "domain code.",
      severity: "error",
      from: { path: "^packages/domain" },
      to: {
        path: "^packages/(adapters-.*|api|worker|sdk-node|sdk-python|cli)",
      },
    },
    {
      name: "application-no-infra",
      comment:
        "application may depend on domain, plus adapters-observability specifically. Observability " +
        "is a cross-cutting concern exempted from the hexagonal boundary for every layer. Everything " +
        "else in adapters-* stays forbidden — those are wired in via DI at the composition root.",
      severity: "error",
      from: { path: "^packages/application" },
      to: {
        path: "^packages/(adapters-.*|api|worker|sdk-node|sdk-python|cli)",
        pathNot: "^packages/adapters-observability",
      },
    },
    {
      name: "adapters-no-application",
      comment:
        "adapters implement domain ports; they must not depend on application use-cases " +
        "(that would invert the hexagonal dependency direction) or on other adapters " +
        "(cross-adapter coupling belongs in application, not infrastructure) — except " +
        "adapters-observability, exempted for the same cross-cutting-concern reason as above.",
      severity: "error",
      from: { path: "^packages/adapters-" },
      to: {
        path: "^packages/(application|adapters-)",
        pathNot: "^packages/adapters-observability",
      },
    },
    {
      name: "adapters-no-composition-roots",
      comment: "adapters must not depend on api, worker, or any delivery package.",
      severity: "error",
      from: { path: "^packages/adapters-" },
      to: { path: "^packages/(api|worker|sdk-node|sdk-python|cli)" },
    },
    {
      name: "no-provider-adapter-cross-import",
      comment:
        "provider adapters (gemini, groq, ...) must never import each other — each is an " +
        "independent implementation of ProviderPort, and adding a provider must never require " +
        "touching an existing one.",
      severity: "error",
      from: { path: "^packages/adapters-provider-([^/]+)/" },
      to: {
        path: "^packages/adapters-provider-([^/]+)/",
        pathNot: "^packages/adapters-provider-$1/",
      },
    },
    {
      name: "sdk-and-cli-no-internal-packages",
      comment:
        "sdk-node, sdk-python, and cli must only depend on the published HTTP/OpenAPI contract " +
        "(and, for cli, on sdk-node) — never on domain, application, or any adapter directly. " +
        "This keeps them safe to run against any deployed Gateway instance with network access " +
        "only.",
      severity: "error",
      from: { path: "^packages/(sdk-node|sdk-python|cli)" },
      to: {
        path: "^packages/(domain|application|adapters-)",
      },
    },
    {
      name: "no-circular",
      comment: "No circular dependencies between packages, in either direction.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
