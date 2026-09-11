import type { Redis } from "ioredis";
import type { PubSub, PubSubHandler, PubSubUnsubscribe } from "@llm-gateway/domain";

// A connection that has issued SUBSCRIBE can only do pub/sub commands afterward, so this adapter
// keeps the caller's `publisher` connection free for PUBLISH and lazily opens one dedicated
// subscriber connection per channel, shared across every handler on that channel.
export class RedisPubSub implements PubSub {
  private readonly subscriberConnections = new Map<string, Redis>();
  private readonly channelHandlers = new Map<string, Set<PubSubHandler>>();

  constructor(private readonly publisher: Redis) {}

  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  async subscribe(channel: string, handler: PubSubHandler): Promise<PubSubUnsubscribe> {
    let handlers = this.channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set<PubSubHandler>();
      this.channelHandlers.set(channel, handlers);

      const subscriber = this.publisher.duplicate();
      this.subscriberConnections.set(channel, subscriber);
      subscriber.on("message", (receivedChannel, message) => {
        if (receivedChannel !== channel) {
          return;
        }
        for (const registeredHandler of this.channelHandlers.get(channel) ?? []) {
          registeredHandler(message);
        }
      });
      await subscriber.subscribe(channel);
    }

    handlers.add(handler);

    return async () => {
      const currentHandlers = this.channelHandlers.get(channel);
      currentHandlers?.delete(handler);
      if (currentHandlers && currentHandlers.size === 0) {
        const subscriber = this.subscriberConnections.get(channel);
        if (subscriber) {
          await subscriber.unsubscribe(channel);
          subscriber.disconnect();
          this.subscriberConnections.delete(channel);
        }
        this.channelHandlers.delete(channel);
      }
    };
  }
}
