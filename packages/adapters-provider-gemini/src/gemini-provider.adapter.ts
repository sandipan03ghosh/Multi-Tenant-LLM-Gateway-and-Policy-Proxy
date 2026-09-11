import { randomUUID } from "node:crypto";
import { GatewayError } from "@llm-gateway/domain";
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  FinishReason,
  ProviderPort,
} from "@llm-gateway/domain";
import { withProviderSpan } from "@llm-gateway/adapters-observability";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiProviderConfig {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}

interface GeminiPart {
  text: string;
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
}
interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: GeminiGenerationConfig;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
}
interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}
interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

interface GeminiErrorDetail {
  readonly ["@type"]?: string;
}
interface GeminiErrorBody {
  readonly message?: string;
  readonly status?: string;
  readonly details?: readonly GeminiErrorDetail[];
}

// Google's signal that a failure is expected to clear and is safe to retry (google.rpc.RetryInfo)
// — the closest available way to tell a transient per-minute rate limit from a permanent daily
// quota, which return the same status.
const RETRY_INFO_TYPE = "type.googleapis.com/google.rpc.RetryInfo";

// Maps CanonicalRequest/CanonicalResponse to/from Google's Generative Language API
// (generateContent). Written against the documented REST contract; verify field names against a
// real response.
export class GeminiProviderAdapter implements ProviderPort {
  readonly providerId = "gemini";
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async complete(request: CanonicalRequest): Promise<CanonicalResponse> {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(request.model)}:generateContent`;

    // withProviderSpan (not withSpan): translateError() preserves the provider's error message on
    // the GatewayError, which must never reach the span via recordException.
    let response: Response;
    try {
      response = await withProviderSpan(
        "provider.gemini.request",
        () =>
          this.fetchImpl(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify(this.toGeminiRequest(request)),
          }),
        { "provider.id": "gemini", "llm.model": request.model, "http.method": "POST" },
      );
    } catch (error) {
      throw this.translateError(error);
    }

    // Non-JSON/empty bodies become `undefined` rather than throwing a raw parse error.
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw this.translateError({ httpStatus: response.status, payload });
    }
    if (!this.isGeminiGenerateContentResponse(payload)) {
      // A 2xx body not matching the documented shape — API drift or transport corruption. Not
      // retryable (a deterministic mismatch would just waste the retry budget).
      throw new GatewayError(
        "PROVIDER_INVALID_RESPONSE",
        "Gemini returned a response that did not match the expected shape",
        502,
        false,
        payload,
      );
    }
    return this.toCanonicalResponse(request.model, payload);
  }

  async *stream(request: CanonicalRequest, signal?: AbortSignal): AsyncIterable<CanonicalStreamEvent> {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;

    // Span wraps just the initial fetch, not the whole generator — the SSE parsing after this
    // creates no further spans.
    let response: Response;
    try {
      response = await withProviderSpan(
        "provider.gemini.request",
        () =>
          this.fetchImpl(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify(this.toGeminiRequest(request)),
            ...(signal ? { signal } : {}),
          }),
        { "provider.id": "gemini", "llm.model": request.model, "http.method": "POST", "llm.streaming": true },
      );
    } catch (error) {
      throw this.translateError(error);
    }

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined);
      throw this.translateError({ httpStatus: response.status, payload });
    }
    if (!response.body) {
      throw new GatewayError("PROVIDER_INVALID_RESPONSE", "Gemini returned no response body for a streaming request", 502, false);
    }

    yield { type: "start", id: randomUUID(), model: request.model };

    // Each SSE frame is a partial GenerateContentResponse — the last one carries finishReason/
    // usageMetadata, the terminal signal checked for below.
    let finished = false;
    try {
      for await (const frame of this.parseSseJsonFrames(response.body)) {
        if (!this.isGeminiGenerateContentResponse(frame)) {
          // Skip a malformed individual frame rather than aborting an otherwise-good stream.
          continue;
        }
        const candidate = frame.candidates?.[0];
        const text = candidate?.content?.parts?.map((part) => part.text).join("") ?? "";
        if (text.length > 0) {
          yield { type: "delta", content: text };
        }
        if (candidate?.finishReason !== undefined || frame.usageMetadata !== undefined) {
          const usage = frame.usageMetadata;
          yield {
            type: "done",
            finishReason: this.toFinishReason(candidate?.finishReason),
            usage: {
              promptTokens: usage?.promptTokenCount ?? 0,
              completionTokens: usage?.candidatesTokenCount ?? 0,
              totalTokens: usage?.totalTokenCount ?? 0,
            },
          };
          finished = true;
        }
      }
    } catch (error) {
      throw this.translateError(error);
    }
    if (!finished) {
      // Connection ended without a finishReason/usageMetadata frame — an early cutoff, not a
      // clean completion.
      throw new GatewayError("PROVIDER_INVALID_RESPONSE", "Gemini stream ended without a finish signal", 502, false);
    }
  }

  // Buffers on SSE frame boundaries (blank line) and JSON-parses each frame's `data:` payload.
  // Duplicated in the Groq adapter rather than shared — the stream shapes differ enough.
  private async *parseSseJsonFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLines = rawFrame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim());
        if (dataLines.length === 0) {
          continue;
        }
        const data = dataLines.join("\n");
        if (data === "[DONE]") {
          return;
        }
        try {
          yield JSON.parse(data);
        } catch {
          // Skip an unparsable frame rather than aborting the whole stream.
          continue;
        }
      }
    }
  }

  translateError(raw: unknown): GatewayError {
    if (this.isHttpFailureRaw(raw)) {
      const httpStatus = this.normalizeHttpStatus(raw.httpStatus);
      const errorBody = this.extractGeminiErrorBody(raw.payload);
      const message = errorBody?.message ?? `Gemini request failed with status ${httpStatus}`;
      const retryable = this.isRetryableFailure(httpStatus, errorBody);
      return new GatewayError("PROVIDER_ERROR", message, httpStatus >= 500 ? 502 : 400, retryable, raw);
    }
    return new GatewayError(
      "PROVIDER_UNREACHABLE",
      raw instanceof Error ? raw.message : "Failed to reach Gemini",
      502,
      // A thrown fetch error means no upstream response at all (DNS/TCP/TLS/timeout) — safe to retry.
      true,
      raw,
    );
  }

  private isHttpFailureRaw(raw: unknown): raw is { httpStatus: unknown; payload: unknown } {
    return typeof raw === "object" && raw !== null && "httpStatus" in raw;
  }

  // Defends translateError() against branching on a non-numeric/out-of-range status — it takes
  // `unknown`, and an injected/mocked `fetchImpl` isn't bound by fetch's guarantees.
  private normalizeHttpStatus(rawStatus: unknown): number {
    return typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus < 600
      ? rawStatus
      : 502;
  }

  private isRetryableFailure(httpStatus: number, errorBody: GeminiErrorBody | undefined): boolean {
    if (httpStatus >= 500) {
      // Upstream server-side failure — transient by convention.
      return true;
    }
    if (httpStatus === 429 || errorBody?.status === "RESOURCE_EXHAUSTED") {
      return this.hasRetryInfo(errorBody?.details);
    }
    if (errorBody?.status === "UNAVAILABLE" || errorBody?.status === "DEADLINE_EXCEEDED") {
      return true;
    }
    // INVALID_ARGUMENT, UNAUTHENTICATED, PERMISSION_DENIED, NOT_FOUND, and anything else
    // unrecognized fail identically on retry — not retryable.
    return false;
  }

  private hasRetryInfo(details: readonly GeminiErrorDetail[] | undefined): boolean {
    return details?.some((detail) => detail["@type"] === RETRY_INFO_TYPE) ?? false;
  }

  private extractGeminiErrorBody(payload: unknown): GeminiErrorBody | undefined {
    if (typeof payload !== "object" || payload === null) {
      return undefined;
    }
    const error = (payload as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null) {
      return undefined;
    }
    const e = error as Record<string, unknown>;
    const details = Array.isArray(e.details)
      ? e.details.filter((d): d is GeminiErrorDetail => typeof d === "object" && d !== null)
      : undefined;
    return {
      ...(typeof e.message === "string" ? { message: e.message } : {}),
      ...(typeof e.status === "string" ? { status: e.status } : {}),
      ...(details ? { details } : {}),
    };
  }

  private isGeminiPart(value: unknown): value is GeminiPart {
    return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).text === "string";
  }

  private isGeminiCandidate(value: unknown): value is GeminiCandidate {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.content !== undefined) {
      if (typeof candidate.content !== "object" || candidate.content === null) {
        return false;
      }
      const content = candidate.content as Record<string, unknown>;
      if (content.parts !== undefined && !(Array.isArray(content.parts) && content.parts.every((p) => this.isGeminiPart(p)))) {
        return false;
      }
    }
    if (candidate.finishReason !== undefined && typeof candidate.finishReason !== "string") {
      return false;
    }
    return true;
  }

  private isGeminiGenerateContentResponse(payload: unknown): payload is GeminiGenerateContentResponse {
    if (typeof payload !== "object" || payload === null) {
      return false;
    }
    const body = payload as Record<string, unknown>;
    if (body.candidates !== undefined && !(Array.isArray(body.candidates) && body.candidates.every((c) => this.isGeminiCandidate(c)))) {
      return false;
    }
    if (body.usageMetadata !== undefined) {
      if (typeof body.usageMetadata !== "object" || body.usageMetadata === null) {
        return false;
      }
      const usage = body.usageMetadata as Record<string, unknown>;
      for (const key of ["promptTokenCount", "candidatesTokenCount", "totalTokenCount"] as const) {
        if (usage[key] !== undefined && typeof usage[key] !== "number") {
          return false;
        }
      }
    }
    return true;
  }

  private toGeminiRequest(request: CanonicalRequest): GeminiGenerateContentRequest {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const turnMessages = request.messages.filter((m) => m.role !== "system");

    const contents: GeminiContent[] = turnMessages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    const body: GeminiGenerateContentRequest = { contents };

    if (systemMessages.length > 0) {
      body.systemInstruction = {
        parts: [{ text: systemMessages.map((m) => m.content).join("\n\n") }],
      };
    }

    // Built conditionally because exactOptionalPropertyTypes rejects assigning `undefined` to an
    // optional field.
    const generationConfig: GeminiGenerationConfig = {};
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    if (request.maxOutputTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxOutputTokens;
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    return body;
  }

  private toCanonicalResponse(
    model: string,
    payload: GeminiGenerateContentResponse,
  ): CanonicalResponse {
    const candidate = payload.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text).join("") ?? "";
    const usage = payload.usageMetadata;

    return {
      id: randomUUID(),
      model,
      message: { role: "assistant", content: text },
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      finishReason: this.toFinishReason(candidate?.finishReason),
    };
  }

  // Mapped against Gemini's documented FinishReason enum.
  private toFinishReason(raw: string | undefined): FinishReason {
    switch (raw) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "SAFETY":
      case "RECITATION":
      case "BLOCKLIST":
      case "PROHIBITED_CONTENT":
      case "SPII":
      case "LANGUAGE":
      case "IMAGE_SAFETY":
        return "content_filter";
      case "MALFORMED_FUNCTION_CALL":
      case "OTHER":
      case "FINISH_REASON_UNSPECIFIED":
      case undefined:
        return "error";
      default:
        return "error";
    }
  }
}
