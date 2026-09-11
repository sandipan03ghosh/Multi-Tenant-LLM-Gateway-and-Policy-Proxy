# syntax=docker/dockerfile:1
#
# Builds and runs the Gateway worker — mirrors packages/api/Dockerfile's structure.
# `pnpm prisma:generate` must succeed at build time. Build context is the repository root;
# .dockerignore keeps secrets/.env out of it.

FROM node:24-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm prisma:generate
RUN pnpm --filter "@llm-gateway/worker..." run build

FROM base AS runtime
ENV NODE_ENV=production
# The ENV assignment makes the build ARG readable at runtime (surfaced at GET /version).
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
# Full workspace (including devDependencies) copied for simplicity; trimming is a future optimization.
COPY --from=build /workspace ./
# No API port — the worker serves only /metrics on METRICS_PORT (9100).
EXPOSE 9100
CMD ["node", "packages/worker/dist/index.js"]
