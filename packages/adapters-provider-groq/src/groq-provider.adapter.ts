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

const GROQ_API_BASE = "https://api.groq.com/openai/v1";

export interface GroqProviderConfig {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}

interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
interface GroqChatCompletionRequest {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  max_tokens?: number;
}
interface GroqChoice {
  message?: { role?: string; content?: string };
  finish_reason?: string;
}
interface GroqUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
interface GroqChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: GroqChoice[];
  usage?: GroqUsage;
}

interface GroqStreamDelta {
  content?: string;
}
interface GroqStreamChoice {
  delta?: GroqStreamDelta;
  finish_reason?: string | null;
}
// The OpenAI-compatible streaming chunk shape (`delta` instead of `message`). With
// `stream_options: { include_usage: true }`, a final chunk carries `usage` with empty `choices`.
interface GroqStreamChunk {
  choices?: GroqStreamChoice[];
  usage?: GroqUsage;
}

interface GroqErrorBody {
  readonly message?: string;
  readonly type?: string;
}

interface HttpFailureRaw {
  readonly httpStatus: unknown;
  readonly payload: unknown;
  /** Whether the upstream response carried a Retry-After header. */
  readonly retryAfterPresent: unknown;
}

// Maps CanonicalRequest/CanonicalResponse to/from Groq's OpenAI-compatible Chat Completions API.
// Written against the documented REST contract; verify field names against a real response.
export class GroqProviderAdapter implements ProviderPort {
  readonly providerId = "groq";
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GroqProviderConfig) {
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async complete(request: CanonicalRequest): Promise<CanonicalResponse> {
    // withProviderSpan (not withSpan): translateError() preserves the provider's error message on
    // the GatewayError, which must never reach the span via recordException.
    let response: Response;
    try {
      response = await withProviderSpan(
        "provider.groq.request",
        () =>
          this.fetchImpl(`${GROQ_API_BASE}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(this.toGroqRequest(request)),
          }),
        { "provider.id": "groq", "llm.model": request.model, "http.method": "POST" },
      );
    } catch (error) {
      throw this.translateError(error);
    }

    // Non-JSON/empty bodies become `undefined` rather than throwing a raw parse error.
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw this.translateError({
        httpStatus: response.status,
        payload,
        retryAfterPresent: response.headers.has("retry-after"),
      });
    }
    if (!this.isGroqChatCompletionResponse(payload)) {
      // A 2xx body not matching the documented shape — API drift or transport corruption. Not
      // retryable (a deterministic mismatch would just waste the retry budget).
      throw new GatewayError(
        "PROVIDER_INVALID_RESPONSE",
        "Groq returned a response that did not match the expected shape",
        502,
        false,
        payload,
      );
    }
    return this.toCanonicalResponse(request.model, payload);
  }

  async *stream(request: CanonicalRequest, signal?: AbortSignal): AsyncIterable<CanonicalStreamEvent> {
    // Span wraps just the initial fetch, not the whole generator — the SSE parsing after this
    // creates no further spans.
    let response: Response;
    try {
      response = await withProviderSpan(
        "provider.groq.request",
        () =>
          this.fetchImpl(`${GROQ_API_BASE}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${this.apiKey}`,
            },
            // stream_options.include_usage asks for a final chunk carrying real token usage,
            // needed for accurate partial-stream cost accounting.
            body: JSON.stringify({ ...this.toGroqRequest(request), stream: true, stream_options: { include_usage: true } }),
            ...(signal ? { signal } : {}),
          }),
        { "provider.id": "groq", "llm.model": request.model, "http.method": "POST", "llm.streaming": true },
      );
    } catch (error) {
      throw this.translateError(error);
    }

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined);
      throw this.translateError({
        httpStatus: response.status,
        payload,
        retryAfterPresent: response.headers.has("retry-after"),
      });
    }
    if (!response.body) {
      throw new GatewayError("PROVIDER_INVALID_RESPONSE", "Groq returned no response body for a streaming request", 502, false);
    }

    yield { type: "start", id: randomUUID(), model: request.model };

    let finishReason: FinishReason | undefined;
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    try {
      for await (const frame of this.parseSseJsonFrames(response.body)) {
        if (!this.isGroqStreamChunk(frame)) {
          // Skip a malformed individual frame rather than aborting an otherwise-good stream.
          continue;
        }
        const choice = frame.choices?.[0];
        if (choice?.delta?.content) {
          yield { type: "delta", content: choice.delta.content };
        }
        if (choice?.finish_reason) {
          finishReason = this.toFinishReason(choice.finish_reason);
        }
        if (frame.usage) {
          usage = {
            promptTokens: frame.usage.prompt_tokens ?? 0,
            completionTokens: frame.usage.completion_tokens ?? 0,
            totalTokens: frame.usage.total_tokens ?? 0,
          };
        }
      }
    } catch (error) {
      throw this.translateError(error);
    }
    if (!finishReason) {
      // Connection ended without a finish_reason — an early cutoff, not a clean completion.
      throw new GatewayError("PROVIDER_INVALID_RESPONSE", "Groq stream ended without a finish signal", 502, false);
    }
    yield { type: "done", finishReason, usage: usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }

  private isGroqStreamChoice(value: unknown): value is GroqStreamChoice {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const choice = value as Record<string, unknown>;
    if (choice.delta !== undefined) {
      if (typeof choice.delta !== "object" || choice.delta === null) {
        return false;
      }
      const content = (choice.delta as Record<string, unknown>).content;
      if (content !== undefined && typeof content !== "string") {
        return false;
      }
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null && typeof choice.finish_reason !== "string") {
      return false;
    }
    return true;
  }

  private isGroqStreamChunk(value: unknown): value is GroqStreamChunk {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const chunk = value as Record<string, unknown>;
    if (chunk.choices !== undefined && !(Array.isArray(chunk.choices) && chunk.choices.every((c) => this.isGroqStreamChoice(c)))) {
      return false;
    }
    if (chunk.usage !== undefined) {
      if (typeof chunk.usage !== "object" || chunk.usage === null) {
        return false;
      }
      const usage = chunk.usage as Record<string, unknown>;
      for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"] as const) {
        if (usage[key] !== undefined && typeof usage[key] !== "number") {
          return false;
        }
      }
    }
    return true;
  }

  // Buffers on SSE frame boundaries (blank line) and JSON-parses each frame's `data:` payload,
  // stopping at `[DONE]`. Duplicated in the Gemini adapter rather than shared — the stream shapes
  // differ enough.
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
      const errorBody = this.extractGroqErrorBody(raw.payload);
      const message = errorBody?.message ?? `Groq request failed with status ${httpStatus}`;
      const retryable = this.isRetryableFailure(httpStatus, errorBody, raw.retryAfterPresent === true);
      return new GatewayError("PROVIDER_ERROR", message, httpStatus >= 500 ? 502 : 400, retryable, raw);
    }
    return new GatewayError(
      "PROVIDER_UNREACHABLE",
      raw instanceof Error ? raw.message : "Failed to reach Groq",
      502,
      // A thrown fetch error means no upstream response at all (DNS/TCP/TLS/timeout) — safe to retry.
      true,
      raw,
    );
  }

  private isHttpFailureRaw(raw: unknown): raw is HttpFailureRaw {
    return typeof raw === "object" && raw !== null && "httpStatus" in raw;
  }

  // Defends translateError() against branching on a non-numeric/out-of-range status — it takes
  // `unknown`, and an injected/mocked `fetchImpl` isn't bound by fetch's guarantees.
  private normalizeHttpStatus(rawStatus: unknown): number {
    return typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus < 600
      ? rawStatus
      : 502;
  }

  private isRetryableFailure(httpStatus: number, errorBody: GroqErrorBody | undefined, retryAfterPresent: boolean): boolean {
    if (httpStatus >= 500) {
      // Upstream server-side failure — transient by convention.
      return true;
    }
    if (httpStatus === 429 || errorBody?.type === "rate_limit_error") {
      // A `Retry-After` header is the genuine signal this rate limit will clear; its absence
      // could be a permanent quota exhaustion returning the same 429, so treat that as not retryable.
      return retryAfterPresent;
    }
    // Everything else (invalid_request, authentication, permission, not_found, ...) is not retryable.
    return false;
  }

  private extractGroqErrorBody(payload: unknown): GroqErrorBody | undefined {
    if (typeof payload !== "object" || payload === null) {
      return undefined;
    }
    const error = (payload as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null) {
      return undefined;
    }
    const e = error as Record<string, unknown>;
    return {
      ...(typeof e.message === "string" ? { message: e.message } : {}),
      ...(typeof e.type === "string" ? { type: e.type } : {}),
    };
  }

  private isGroqChoice(value: unknown): value is GroqChoice {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const choice = value as Record<string, unknown>;
    if (choice.message !== undefined) {
      if (typeof choice.message !== "object" || choice.message === null) {
        return false;
      }
      const message = choice.message as Record<string, unknown>;
      if (message.content !== undefined && typeof message.content !== "string") {
        return false;
      }
      if (message.role !== undefined && typeof message.role !== "string") {
        return false;
      }
    }
    if (choice.finish_reason !== undefined && typeof choice.finish_reason !== "string") {
      return false;
    }
    return true;
  }

  private isGroqChatCompletionResponse(payload: unknown): payload is GroqChatCompletionResponse {
    if (typeof payload !== "object" || payload === null) {
      return false;
    }
    const body = payload as Record<string, unknown>;
    if (body.id !== undefined && typeof body.id !== "string") {
      return false;
    }
    if (body.model !== undefined && typeof body.model !== "string") {
      return false;
    }
    if (body.choices !== undefined && !(Array.isArray(body.choices) && body.choices.every((c) => this.isGroqChoice(c)))) {
      return false;
    }
    if (body.usage !== undefined) {
      if (typeof body.usage !== "object" || body.usage === null) {
        return false;
      }
      const usage = body.usage as Record<string, unknown>;
      for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"] as const) {
        if (usage[key] !== undefined && typeof usage[key] !== "number") {
          return false;
        }
      }
    }
    return true;
  }

  private toGroqRequest(request: CanonicalRequest): GroqChatCompletionRequest {
    const body: GroqChatCompletionRequest = {
      model: request.model,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };

    // Built conditionally because exactOptionalPropertyTypes rejects assigning `undefined` to an
    // optional field.
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxOutputTokens !== undefined) {
      body.max_tokens = request.maxOutputTokens;
    }

    return body;
  }

  private toCanonicalResponse(
    requestedModel: string,
    payload: GroqChatCompletionResponse,
  ): CanonicalResponse {
    const choice = payload.choices?.[0];
    return {
      id: payload.id ?? randomUUID(),
      model: payload.model ?? requestedModel,
      message: {
        role: "assistant",
        content: choice?.message?.content ?? "",
      },
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      },
      finishReason: this.toFinishReason(choice?.finish_reason),
    };
  }

  // Mapped against Groq's OpenAI-compatible finish_reason vocabulary. tool_calls/function_call map
  // to "error" — this adapter has no tool-calling support, and a conversation ending in a tool
  // call isn't a normal "stop".
  private toFinishReason(raw: string | undefined): FinishReason {
    switch (raw) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      case "tool_calls":
      case "function_call":
      case undefined:
        return "error";
      default:
        return "error";
    }
  }
}
