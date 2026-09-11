import { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api";
import type { Attributes, Span, Context } from "@opentelemetry/api";

const tracer = trace.getTracer("llm-gateway");

// The common case: a span whose lifetime matches one async operation. Nests under the currently
// active span — the per-request root span from tracing.middleware.ts — so every other withSpan()
// call becomes a descendant, never a second root.
export async function withSpan<T>(name: string, fn: () => Promise<T>, attributes?: Attributes): Promise<T> {
  return tracer.startActiveSpan(name, attributes ? { attributes } : {}, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// Same shape as withSpan(), for call sites where the thrown error may carry upstream-provider-
// sourced content (a provider's translateError() building a GatewayError.message from the
// provider's error body). recordException() would export that content unredacted, so this records
// a fixed marker instead — the original error still propagates unchanged.
export async function withProviderSpan<T>(name: string, fn: () => Promise<T>, attributes?: Attributes): Promise<T> {
  return tracer.startActiveSpan(name, attributes ? { attributes } : {}, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(new Error("Provider request failed"));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

// For a span whose end point isn't known at the call site that starts it — the HTTP root span
// and the streaming chat-completion span. The caller owns calling endSpanWithOutcome(); this only
// creates the span, optionally under an explicit parent context (for an extracted inbound
// traceparent).
export function startManualSpan(name: string, attributes?: Attributes, parentContext?: Context): Span {
  return tracer.startSpan(name, attributes ? { attributes } : {}, parentContext ?? context.active());
}

// Makes `span` the active context for fn's duration, so any withSpan()/startManualSpan() call
// made anywhere inside fn's (possibly async) call chain nests under it automatically.
export function runInSpanContext<T>(span: Span, fn: () => T): T {
  return context.with(trace.setSpan(context.active(), span), fn);
}

export function endSpanWithOutcome(span: Span, outcome: "ok" | "error", error?: unknown): void {
  if (outcome === "error") {
    recordError(span, error);
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

// recordException() captures the message/stacktrace as a span event (kept for debuggability).
// The span status message carries no text, just the ERROR code. Call sites where the error may
// carry provider content use withProviderSpan() or a sanitized error instead.
function recordError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

// Extracts an inbound W3C traceparent (if the caller propagated one) so the Gateway's root span
// nests under an upstream trace instead of starting a fresh one — used by tracing.middleware.ts.
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): Context {
  return propagation.extract(context.active(), headers);
}

export type { Span };
