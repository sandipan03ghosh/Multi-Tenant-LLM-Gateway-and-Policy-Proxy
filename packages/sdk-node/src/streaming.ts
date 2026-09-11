import type { ChatCompletionStreamEvent } from "./types.js";

// Parses the wire format SseStreamTransport writes: `event: <type>\ndata: <json>\n\n` per frame.
// Once a stream has started, mid-stream failures propagate as a plain thrown error from this
// generator, not wrapped or retried.
export async function* parseChatCompletionStream(response: Response): AsyncIterable<ChatCompletionStreamEvent> {
  if (!response.body) {
    throw new Error("Streaming response has no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      // Asserting read()'s result (not just the destructuring pattern) is what clears `any` from the untyped reader.
      const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      let frameEnd = buffer.indexOf("\n\n");
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const event = parseFrame(frame);
        if (event) {
          yield event;
        }
        frameEnd = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): ChatCompletionStreamEvent | null {
  let dataLine: string | undefined;
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("data: ")) {
      dataLine = line.slice("data: ".length);
    }
  }
  if (dataLine === undefined) {
    return null;
  }
  // The `data:` payload already carries its own `type` field — no merge with the `event:` line needed.
  return JSON.parse(dataLine) as ChatCompletionStreamEvent;
}
