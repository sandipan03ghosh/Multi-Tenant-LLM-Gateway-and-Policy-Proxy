import type { ContentModerationPort, ModerationVerdict } from "@llm-gateway/domain";

// Default ContentModerationPort — always allows, immediately. Registered until a real moderation
// adapter is wired in.
export class NoOpContentModerationPort implements ContentModerationPort {
  async moderate(_content: string, _signal?: AbortSignal): Promise<ModerationVerdict> {
    return { allowed: true };
  }
}
