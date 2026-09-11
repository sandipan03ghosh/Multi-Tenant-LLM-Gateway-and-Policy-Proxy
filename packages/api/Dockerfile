# syntax=docker/dockerfile:1
#
# Builds and runs the Gateway API — a stateless container with no orchestrator-specific coupling.
# `pnpm prisma:generate` must succeed at build time. Build context is the repository root
# (the whole workspace); .dockerignore keeps secrets/.env out of it.

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
RUN pnpm --filter "@llm-gateway/api..." run build

FROM base AS runtime
ENV NODE_ENV=production
# The ENV assignment makes the build ARG readable at runtime (surfaced at GET /version).
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
# Full workspace (including devDependencies) copied for simplicity; trimming to production-only
# is a future optimization.
COPY --from=build /workspace ./
EXPOSE 3000
CMD ["node", "packages/api/dist/index.js"]
