export type MessageRole = "system" | "user" | "assistant";

export interface CanonicalMessage {
  readonly role: MessageRole;
  readonly content: string;
}

// Provider-agnostic request shape. Every ProviderPort adapter translates this to/from its
// provider's native format — nothing outside adapters-provider-* sees a provider-native shape.
export interface CanonicalRequest {
  readonly model: string;
  readonly messages: readonly CanonicalMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}
