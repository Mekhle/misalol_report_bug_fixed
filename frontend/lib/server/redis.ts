import "server-only";

import Redis from "ioredis";

declare global {
  var __misaRedis: Redis | undefined;
}

export function redis() {
  if (!global.__misaRedis) {
    global.__misaRedis = new Redis(process.env.DRAGONFLY_URL || process.env.MISA_DRAGONFLY_URL || "redis://dragonfly:6379/0", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  }
  return global.__misaRedis;
}
