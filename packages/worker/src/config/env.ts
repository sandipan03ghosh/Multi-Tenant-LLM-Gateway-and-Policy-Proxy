import { z } from "zod";

// The worker executes dequeued requests through the same routing/resilience stack as the API,
// so it needs the same Redis/provider-key config — but no JWT/API_PORT (it serves no HTTP).
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // The worker's /metrics + /health/live/ready/version port. Stays unpublished from the host.
    METRICS_PORT: z.coerce.number().int().positive().default(9100),
    // Set via a Docker build ARG; "unknown" is correct for non-Docker local dev.
    GIT_COMMIT_SHA: z.string().min(1).default("unknown"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),

    GEMINI_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
  })
  .refine((env) => Boolean(env.GEMINI_API_KEY) || Boolean(env.GROQ_API_KEY), {
    message: "At least one of GEMINI_API_KEY or GROQ_API_KEY must be set — no provider would be available",
    path: ["GEMINI_API_KEY"],
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error("Invalid environment configuration:", z.flattenError(result.error).fieldErrors);
    process.exit(1);
  }
  return result.data;
}
