import { Transport } from "./transport.js";
import type { TransportOptions } from "./transport.js";
import { parseChatCompletionStream } from "./streaming.js";
import type {
  ListModelsResponse,
  ChatCompletionRequest,
  ChatCompletionStreamOptions,
  ChatCompletionResponse,
  ChatCompletionStreamEvent,
  CreateBatchRequest,
  CreateBatchResponse,
  GetBatchResponse,
} from "./types.js";

export type GatewayClientOptions = TransportOptions;

// Typed client for the Gateway's Public API (/v1/*). Every method maps to one route.
export class GatewayClient {
  private readonly transport: Transport;

  constructor(options: GatewayClientOptions) {
    this.transport = new Transport(options);
  }

  async listModels(): Promise<ListModelsResponse> {
    return this.transport.requestJson<ListModelsResponse>({ method: "GET", path: "/v1/models" });
  }

  /**
   * Creates a chat completion. Pass `{ stream: true }` as the second argument to get back an
   * AsyncIterable of ChatCompletionStreamEvent instead of a resolved response — the overload
   * return type follows which one you asked for, no cast needed.
   */
  createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  createChatCompletion(request: ChatCompletionRequest, options: ChatCompletionStreamOptions): AsyncIterable<ChatCompletionStreamEvent>;
  createChatCompletion(
    request: ChatCompletionRequest,
    options?: ChatCompletionStreamOptions,
  ): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionStreamEvent> {
    if (options?.stream) {
      return this.streamChatCompletion(request);
    }
    return this.transport.requestJson<ChatCompletionResponse>({ method: "POST", path: "/v1/chat/completions", body: request });
  }

  private async *streamChatCompletion(request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    const response = await this.transport.requestStream({ method: "POST", path: "/v1/chat/completions", body: request });
    yield* parseChatCompletionStream(response);
  }

  async createBatch(request: CreateBatchRequest): Promise<CreateBatchResponse> {
    return this.transport.requestJson<CreateBatchResponse>({ method: "POST", path: "/v1/batches", body: request });
  }

  async getBatch(id: string): Promise<GetBatchResponse> {
    return this.transport.requestJson<GetBatchResponse>({ method: "GET", path: `/v1/batches/${encodeURIComponent(id)}` });
  }
}
