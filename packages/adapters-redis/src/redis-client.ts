import { Redis } from "ioredis";

// Pinned to ioredis 5.x rather than 6.0.0, which changes the default wire protocol (RESP3) and
// minimum Node version.
export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    // Fail fast on an unreachable Redis rather than buffering commands indefinitely.
    maxRetriesPerRequest: 3,
  });
}
