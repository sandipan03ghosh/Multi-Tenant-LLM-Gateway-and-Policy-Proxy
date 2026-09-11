import pino from "pino";
import type { Logger } from "pino";
import { trace } from "@opentelemetry/api";
import { getCurrentRequestId } from "./request-context.js";

// pino's redact option reaches every log call site, but only scans structured fields by path,
// not free-text messages. Call sites must pass secrets as structured fields, never interpolate
// them into the message string.
const REDACT_PATHS = [
  // Leading "*" matches at any depth, so these field names are caught wherever they appear.
  "*.apiKey",
  "*.api_key",
  "*.authorization",
  "*.password",
  "*.keyHash",
  "*.key_hash",
  "*.secret",
  "*.token",
  "*.jwt",
  "*.signature",
  // Header-level secrets need their own paths, distinct from body fields.
  "req.headers.authorization",
  'req.headers["x-api-key"]',
  'req.headers["x-gateway-signature"]',
  "res.headers.authorization",
];

const KNOWN_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    // Correlation source, in priority order: (1) the active OTel span's traceId; (2) the
    // AsyncLocalStorage-backed requestId, for worker jobs with no active span. Both surface under
    // the same "requestId" field.
    mixin() {
      const traceId = trace.getActiveSpan()?.spanContext().traceId;
      if (traceId) {
        return { requestId: traceId };
      }
      const requestId = getCurrentRequestId();
      return requestId ? { requestId } : {};
    },
  });
}

// A bare singleton, not constructor-injected. Constructed at module load so every early import
// has a working logger; configureLogger() swaps it once startup has a real LOG_LEVEL. Never
// reads process.env directly.
export let logger: Logger = createLogger("info");

// Each composition root calls this once, immediately after loadEnv(), with its validated
// LOG_LEVEL. An unrecognized level falls back to "info" rather than throwing.
export function configureLogger(level: string): void {
  logger = createLogger(KNOWN_LEVELS.has(level) ? level : "info");
}
