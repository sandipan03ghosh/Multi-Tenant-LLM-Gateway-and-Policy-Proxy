// Implemented by adapters-redis. Used for cross-instance cache invalidation.
export type PubSubHandler = (message: string) => void;
export type PubSubUnsubscribe = () => Promise<void>;

export interface PubSub {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: PubSubHandler): Promise<PubSubUnsubscribe>;
}
