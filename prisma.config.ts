// Prisma 7 config entry point — replaces the pre-v7 pattern of relying solely on the schema's
// datasource url. See README.md Section 7 (Configuration Service) for how this database is
// consumed at runtime (always through ConfigurationService, never queried directly by
// application code).
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "./prisma/migrations",
    // README.md Section 24 (Demo Environment & Seed Data). tsx avoids the ESM/loader friction
    // ts-node needs (the --esm flag this used to require) — the toolchain now standardizes on
    // tsx for running TS source directly; see packages/api's "dev" script for the same choice.
    seed: "tsx prisma/seed.ts",
  },
});
