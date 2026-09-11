// Implemented by adapters-redis. Read-through cache in front of ConfigurationRepository.
export interface DistributedCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}
