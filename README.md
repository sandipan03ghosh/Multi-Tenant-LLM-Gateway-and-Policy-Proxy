# Multi-Tenant-LLM-Gateway-and-Policy-Proxy

A self-hostable, provider-agnostic gateway that sits between applications and multiple LLM
providers. Applications talk only to the gateway; it owns authentication, authorization, request
enrichment, routing, streaming, rate limiting, budget/cost tracking, resilience, and
observability — while staying independent of any single provider.

Built with **Hexagonal (Ports & Adapters) architecture** and **Domain-Driven Design**: the
`domain` and `application` layers depend only on interfaces, and every provider SDK, database
client, and transport lives behind an adapter. Adding a provider or swapping a datastore never
touches the business logic.

> Full design rationale, subsystem-by-subsystem, is in
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Features

| Area | What it does |
|---|---|
| **Multi-provider routing** | Routing strategies (manual, round-robin, weighted, health-aware, sticky) behind a single `ProviderPort`. Wired: Google Gemini, Groq. |
| **Streaming** | SSE proxying of provider streams via a transport-agnostic `CanonicalStreamEvent` layer; a client disconnect aborts the upstream call. |
| **Configuration service** | All dynamic config (routing, limits, budgets, enrichment) is read through one service — Postgres as source of truth, Redis read-through cache, pub/sub cache invalidation, **no restart** for any config change. |
| **Authentication & RBAC** | JWT (human) + API key (machine) auth resolving to a tenant context; role/permission checks at organization and project scope. |
| **Rate limiting** | Redis token-bucket algorithm behind a pluggable `RateLimitAlgorithm` port. |
| **Budget enforcement** | Postgres cost ledger + Redis fast-path counters, reconciled by a background job. |
| **Request enrichment** | Ordered, config-driven stage pipeline — system-prompt injection, compliance / topic deny-lists, PII redaction, pluggable content moderation. |
| **Resilience** | Per-`(provider, model)` circuit breaker with Redis-shared state, exponential-backoff retries, active + passive health scoring. |
| **Batch processing** | `202 Accepted` + job handle; a separate worker drains a Redis priority queue through the same routing path. |
| **Audit logging** | Append-only trail of every administrative mutation (INSERT/SELECT grants only). |
| **Observability** | OpenTelemetry spans across the request path, Prometheus `/metrics`, structured JSON logs with secret redaction, `/health` · `/ready` · `/live` · `/version`. |

---

## Tech stack

- **Runtime:** Node.js 22+, TypeScript (strict), ESM
- **Monorepo:** pnpm workspaces (14 packages)
- **HTTP:** Express 5
- **Data:** PostgreSQL (Prisma 7), Redis (ioredis)
- **Providers:** Google Gemini, Groq
- **Auth:** `jose` (JWT), argon2id (API-key hashing)
- **Observability:** OpenTelemetry, Prometheus, Grafana, Alertmanager
- **Testing:** Jest

---

## Getting started

### Prerequisites

- Node.js ≥ 22 and pnpm ≥ 11 (`corepack enable`)
- Docker (for PostgreSQL + Redis)
- A Groq and/or Gemini API key

### Setup

```bash
pnpm install

# config
cp .env.example .env
# edit .env — set JWT_SECRET (32+ chars) and GROQ_API_KEY and/or GEMINI_API_KEY

# infrastructure
docker compose up -d postgres redis

# database
pnpm prisma:generate
pnpm prisma:migrate

# demo data — creates orgs, projects and a demo API key
ALLOW_SEED=true pnpm db:seed
```

### Run

```bash
pnpm --filter @llm-gateway/api dev       # API      :3000  (metrics :9100)
pnpm --filter @llm-gateway/worker dev    # worker          (metrics :9101)
```

### Call it

```bash
curl localhost:3000/ready

curl -X POST localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
        "provider": "groq",
        "model": "openai/gpt-oss-20b",
        "messages": [{ "role": "user", "content": "hello" }]
      }'
```

Streaming is the same endpoint with `Accept: text/event-stream`.

Login/JWT issuance is not implemented — mint a development token with
`pnpm exec tsx --env-file=.env packages/api/scripts/dev-token.ts`.

### Full stack (with observability)

```bash
docker compose --profile observability up -d
# Grafana http://localhost:3001 · Prometheus :9090 · Alertmanager :9093
```

---

## Project structure

```
packages/
├── domain/                  entities, value objects, port interfaces — zero infrastructure deps
├── application/             use-cases: routing, enrichment, scheduling, budget, cost, auth
├── adapters-postgres/       Prisma repositories, job scheduler
├── adapters-redis/          rate limiter, circuit breaker, priority queue, cache, pub/sub
├── adapters-provider-*/     Gemini / Groq adapters
├── adapters-security/       JWT, argon2 hashing, secret store
├── adapters-observability/  OpenTelemetry, Prometheus, logging
├── api/                     Express app — composition root
├── worker/                  background worker — composition root
├── sdk-node/  sdk-python/   client SDKs
├── cli/                     operator CLI
└── admin-web/               admin UI (React)
prisma/                      schema, migrations, seed
docker/                      Prometheus / Grafana / Alertmanager / OTel config
```

The dependency direction is enforced with `dependency-cruiser` — CI fails if `domain` or
`application` imports an adapter.

---

## Testing

```bash
pnpm test          # unit tests
pnpm typecheck
pnpm lint
```

Beyond unit tests, I ran an end-to-end verification pass against a live stack (API + worker +
PostgreSQL + Redis + Groq). Verified working:

- Health / readiness / version endpoints
- JWT auth + RBAC (permission and organization-scope checks)
- Chat completions through the full pipeline (auth → RBAC → rate-limit → budget → enrichment → routing → provider → cost recording)
- SSE streaming (`start` / `delta` / `done`, token by token)
- Configuration service — a policy write takes effect on the next request with no restart
- Routing-policy fallback (a request with no explicit provider uses the stored policy)
- Rate limiting (`429` past the limit)
- Budget enforcement (`402` past the limit)
- Enrichment pipeline — the compliance stage rejects a denied topic and passes others
- Batch API — submit → Redis queue → worker drain → job execution → result persisted
- Circuit breaker — full cycle: closed → open (fast-fail) → half-open → closed, reflected in the metrics gauge
- Prometheus metrics endpoints (API and worker)

---

## Known limitations

This is a working implementation of the architecture in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); some later-phase items are scaffolded but not
complete:

- **Observability dashboards not run locally.** The Grafana / Prometheus / Alertmanager images
  couldn't be pulled on the networks available (Docker registry TLS interception). The metrics
  endpoints and span emission are verified directly; the dashboards are provisioned as code but
  unrendered.
- **Tracing has no UI backend.** The OTel Collector's trace pipeline exports to `debug` only — no
  Jaeger/Tempo is in the compose stack.
- **Request signing (HMAC)** and **secret envelope encryption** are scaffolded but not wired into
  the request path.
- **Cross-provider failover** — the routing engine supports multi-candidate strategies, but the
  chat and batch endpoints currently construct only single-candidate (`manual`) policies, so
  failover across providers isn't reachable through the API yet.
- **No pricing table is seeded** — the cost engine runs but computes zero cost until a
  `cost.pricing-table` config value is set.
- **Provider enable/disable and alert-channel management** require the global *Platform Admin*
  role, which the seed creates but assigns to no one.

### Open bugs

- Seed API keys are hashed with scrypt while the API verifies argon2id — demo keys don't
  authenticate; JWT auth (via the token-minting script) is the working path.
- `express.json({ strict: true })` rejects the primitive-body enrichment sub-endpoints
  (`/system-prompt`, `/pii-redaction`, `/content-filter-*`); only the array-body ones work.
- The fallback error handler returns `500` for client errors that carry `statusCode: 400`
  (malformed JSON, wrong body type).
- Rate-limit and budget middleware gate `/admin/v1/*`, so an over-strict policy can lock a tenant
  out of its own admin API (a budget lockout currently needs a direct DB fix).

---

## License

MIT — see [LICENSE](LICENSE).
