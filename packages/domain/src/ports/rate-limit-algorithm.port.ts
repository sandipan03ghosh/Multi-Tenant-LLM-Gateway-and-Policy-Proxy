import type { RateLimitPolicy, RateLimitResult } from "../value-objects/rate-limit-policy.js";

// `key` identifies the bucket (tenant-scoped, resolved by the caller); `cost` charges more than
// one token for an expensive operation. RedisTokenBucketAlgorithm is the only implementation
// today; consumers depend on this port so another algorithm is a swap-in.
export interface RateLimitAlgorithm {
  checkAndConsume(key: string, cost: number, policy: RateLimitPolicy): Promise<RateLimitResult>;
}
