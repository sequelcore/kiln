// Engine domain: rate limiting types for Phase 5b (tenant tool config)

export interface RateLimitConfig {
  readonly defaultPerMinute: number;
  readonly perTool?: Readonly<Record<string, number>>;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs?: number;
}

export interface RateLimiter {
  check(tenantId: string, toolName: string): RateLimitResult;
  record(tenantId: string, toolName: string): void;
  reset(tenantId: string): void;
}
