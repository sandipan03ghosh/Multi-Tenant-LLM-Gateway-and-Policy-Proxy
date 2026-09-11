import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { CompositePropagator, W3CTraceContextPropagator, W3CBaggagePropagator } from "@opentelemetry/core";

let activeProvider: NodeTracerProvider | undefined;

// Registered once per process, before anything else runs — targets the docker-compose collector
// (OTLP HTTP receiver on :4318). Idempotent: a second call is a no-op.
//
// No sampler is configured, which defaults to AlwaysOnSampler. A production deployment at volume
// should set a TraceIdRatioBasedSampler here.
export function initTracing(serviceName: string): void {
  if (activeProvider) {
    return;
  }
  const exporter = new OTLPTraceExporter({ url: "http://otel-collector:4318/v1/traces" });
  activeProvider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  // Explicit W3C trace-context + baggage propagator, spelled out rather than left to the default.
  activeProvider.register({
    propagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  });
}

// BatchSpanProcessor buffers spans in memory — call this before process exit or the last batch
// is dropped. Composition roots call it from their SIGTERM/SIGINT handler.
export async function shutdownTracing(): Promise<void> {
  await activeProvider?.shutdown();
}
