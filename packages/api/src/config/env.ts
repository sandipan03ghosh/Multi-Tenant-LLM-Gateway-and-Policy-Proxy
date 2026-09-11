import { z } from "zod";

// Every env field the Gateway reads is validated here, once, at startup — no subsystem reads
// process.env directly elsewhere. Fields with no sane default are required; a missing value
// fails startup loudly.
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    API_PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // Separate from API_PORT — /metrics stays unpublished from the host, reachable only inside
    // the compose network for Prometheus to scrape.
    METRICS_PORT: z.coerce.number().int().positive().default(9100),
    // Set via a Docker build ARG; "unknown" is correct for non-Docker local dev.
    GIT_COMMIT_SHA: z.string().min(1).default("unknown"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),

    JWT_SECRET: z
      .string()
      .min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_ISSUER: z.string().min(1, "JWT_ISSUER is required"),
    JWT_AUDIENCE: z.string().min(1, "JWT_AUDIENCE is required"),

    // At least one of these must be set — enforced below via .refine(). .min(1) rejects a blank
    // placeholder at the field level.
    GEMINI_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),

    // Enables CORS for /admin/v1/* only, for this one browser origin (the Admin Web UI). Unset by
    // default — CORS stays opt-in. `.url()` is only shape validation; the compared value is
    // `new URL(...).origin` derived once at startup. preprocess maps a blank placeholder to unset,
    // which `.optional()` alone wouldn't (it only treats an absent key as unset).
    ADMIN_UI_ORIGIN: z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional()),
  })
  .refine((env) => Boolean(env.GEMINI_API_KEY) || Boolean(env.GROQ_API_KEY), {
    message: "At least one of GEMINI_API_KEY or GROQ_API_KEY must be set — no provider would be available",
    path: ["GEMINI_API_KEY"],
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // z.flattenError() reports field names and messages, never the (possibly sensitive) input.
    console.error("Invalid environment configuration:", z.flattenError(result.error).fieldErrors);
    process.exit(1);
  }
  return result.data;
}
