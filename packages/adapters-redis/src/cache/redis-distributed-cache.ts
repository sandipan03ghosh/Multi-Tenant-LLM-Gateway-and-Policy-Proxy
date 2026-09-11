import type { Redis } from "ioredis";
import type { DistributedCache } from "@llm-gateway/domain";

export class RedisDistributedCache implements DistributedCache {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupted/foreign entry — treat as a cache miss and clear it so the next read doesn't hit it.
      await this.redis.del(key);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds !== undefined) {
      await this.redis.set(key, raw, "EX", ttlSeconds);
    } else {
      await this.redis.set(key, raw);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
