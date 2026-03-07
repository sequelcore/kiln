import type { RateLimiter, RateLimitConfig, RateLimitResult } from "../engine/domain/rate-limiter.js";

const WINDOW_MS = 60_000;

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  check(tenantId: string, toolName: string): RateLimitResult {
    const key = `${tenantId}:${toolName}`;
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    const timestamps = this.prune(key, cutoff);
    const limit = this.config.perTool?.[toolName] ?? this.config.defaultPerMinute;
    const count = timestamps.length;

    if (count >= limit) {
      const oldest = timestamps[0]!;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: oldest + WINDOW_MS - now,
      };
    }

    return { allowed: true, remaining: limit - count };
  }

  record(tenantId: string, toolName: string): void {
    const key = `${tenantId}:${toolName}`;
    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }
    timestamps.push(Date.now());
  }

  reset(tenantId: string): void {
    const prefix = `${tenantId}:`;
    for (const key of this.windows.keys()) {
      if (key.startsWith(prefix)) {
        this.windows.delete(key);
      }
    }
  }

  private prune(key: string, cutoff: number): number[] {
    const timestamps = this.windows.get(key);
    if (!timestamps) return [];

    const pruned = timestamps.filter((t) => t > cutoff);
    if (pruned.length === 0) {
      this.windows.delete(key);
    } else {
      this.windows.set(key, pruned);
    }
    return pruned;
  }
}
