// Pluggable moderation backend consumed by ContentFilterStage — the default
// (NoOpContentModerationPort) always allows; future adapters can call a third-party API.
// `signal`, when provided, must abort the underlying call — ContentFilterStage aborts it when
// its configured timeout elapses.
export type ModerationVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export interface ContentModerationPort {
  moderate(content: string, signal?: AbortSignal): Promise<ModerationVerdict>;
}
