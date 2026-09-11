import type { FinishReason, TokenUsage } from "./canonical-response.js";
import type { GatewayError } from "../errors/gateway.error.js";

// Transport-agnostic streaming event a ProviderPort adapter emits — the StreamTransport
// implementation owns how these reach the client and never sees provider-native chunk shapes.
export type CanonicalStreamEvent =
  | { readonly type: "start"; readonly id: string; readonly model: string }
  | { readonly type: "delta"; readonly content: string }
  | { readonly type: "done"; readonly finishReason: FinishReason; readonly usage: TokenUsage }
  // `error` carries an already-client-safe GatewayError — never a raw provider error or stack trace.
  | { readonly type: "error"; readonly error: GatewayError };
