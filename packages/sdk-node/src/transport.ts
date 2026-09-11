import { LlmGatewayApiError, LlmGatewayNetworkError } from "./errors.js";
import type { GatewayErrorPayload } from "./types.js";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface TransportOptions {
  /** e.g. "https://gateway.example.com" — no trailing slash required, one is stripped if present. */
  readonly baseUrl: string;
  /** Sent as the X-API-Key header. Mutually exclusive with bearerToken — exactly one is required. */
  readonly apiKey?: string;
  /** Sent as "Authorization: Bearer <token>". Mutually exclusive with apiKey. */
  readonly bearerToken?: string;
  /** Number of retry attempts after the first, transport-failure-only (see request() docs). Default 2. */
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  /** Per-attempt timeout; a timed-out attempt is treated as a transport failure, eligible for retry. */
  readonly timeoutMs?: number;
  /** Injectable for tests — defaults to the global fetch (Node >=22 has this built in). */
  readonly fetchImpl?: typeof fetch;
}

interface RequestSpec {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly query?: Record<string, string | undefined>;
  readonly body?: unknown;
  readonly accept?: "application/json" | "text/event-stream";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGatewayErrorPayload(raw: unknown): raw is GatewayErrorPayload {
  return typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>).code === "string" && typeof (raw as Record<string, unknown>).message === "string";
}

// Shared HTTP layer for GatewayClient and AdminClient. Zero runtime dependencies — built on the
// global fetch/AbortController.
export class Transport {
  private readonly baseUrl: string;
  private readonly authHeader: readonly [string, string];
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TransportOptions) {
    const hasApiKey = options.apiKey !== undefined;
    const hasBearerToken = options.bearerToken !== undefined;
    if (hasApiKey === hasBearerToken) {
      // Catches both "neither" and "both" — exactly one credential is required.
      throw new Error("Transport requires exactly one of `apiKey` or `bearerToken`, not zero or both.");
    }
    // apiKey narrows via TS's aliased-condition analysis on hasApiKey; bearerToken doesn't, so it still needs the assertion.
    this.authHeader = hasApiKey ? ["X-API-Key", options.apiKey] : ["Authorization", `Bearer ${options.bearerToken as string}`];

    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** JSON in, JSON out. Throws LlmGatewayApiError for any non-2xx response. Returns undefined for a 204. */
  async requestJson<TResponse>(spec: RequestSpec): Promise<TResponse> {
    const response = await this.execute(spec, "application/json");
    return this.parseJsonResponse<TResponse>(response);
  }

  /**
   * Returns the raw Response for a streaming request, once its status confirms success. A request
   * that fails before any SSE bytes are sent still returns a plain JSON error body, same as
   * requestJson.
   */
  async requestStream(spec: RequestSpec): Promise<Response> {
    const response = await this.execute(spec, "text/event-stream");
    if (!response.ok) {
      await this.throwApiError(response);
    }
    return response;
  }

  private async execute(spec: RequestSpec, accept: RequestSpec["accept"]): Promise<Response> {
    const url = this.buildUrl(spec.path, spec.query);
    const headers = new Headers();
    headers.set(this.authHeader[0], this.authHeader[1]);
    headers.set("Accept", accept ?? "application/json");
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(spec.body);
    }
    return this.executeWithRetry(url, { method: spec.method, headers, ...(body !== undefined ? { body } : {}) });
  }

  // Retries ONLY when fetch() itself rejects (network/DNS failure, connection reset, or a
  // per-attempt timeout) — no response was received. The moment fetch() resolves (any status,
  // including 5xx) the response is returned and never retried: retrying a non-idempotent call the
  // server already processed risks a duplicate provider call or billing.
  private async executeWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await this.fetchImpl(url, { ...init, signal: controller.signal });
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await delay(this.retryBaseDelayMs * 2 ** attempt);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new LlmGatewayNetworkError(`Request to ${url} failed after ${this.maxRetries + 1} attempt(s) without receiving a response`, lastError);
  }

  private async parseJsonResponse<TResponse>(response: Response): Promise<TResponse> {
    if (!response.ok) {
      await this.throwApiError(response);
    }
    if (response.status === 204) {
      return undefined as TResponse;
    }
    return (await response.json()) as TResponse;
  }

  private async throwApiError(response: Response): Promise<never> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (isGatewayErrorPayload(payload)) {
      throw LlmGatewayApiError.fromPayload(response.status, payload);
    }
    // The gateway always sends the {code, message} envelope for a non-2xx — this fallback only
    // guards against a proxy/load balancer returning its own differently-shaped error body.
    throw new LlmGatewayApiError("UNKNOWN_ERROR", `Request failed with status ${response.status}`, response.status);
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }
}
