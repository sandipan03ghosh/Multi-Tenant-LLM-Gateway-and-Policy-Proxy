import type { Redis } from "ioredis";
import type { ReplayCache } from "@llm-gateway/domain";

// SET ... NX is atomic as a single command — no WATCH/MULTI/EXEC needed. Shares the caller's
// connection; issues only this one plain command on it.
export class RedisReplayCache implements ReplayCache {
  constructor(private readonly redis: Redis) {}

  async checkAndRecord(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, "1", "PX", ttlMs, "NX");
    return result === "OK";
  }
}
