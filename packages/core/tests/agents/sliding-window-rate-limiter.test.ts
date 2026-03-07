import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlidingWindowRateLimiter } from "../../src/agents/sliding-window-rate-limiter.js";

describe("SlidingWindowRateLimiter", () => {
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    limiter = new SlidingWindowRateLimiter({ defaultPerMinute: 5 });
    vi.restoreAllMocks();
  });

  it("allows calls under the limit", () => {
    limiter.record("t1", "search");
    limiter.record("t1", "search");
    const result = limiter.check("t1", "search");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
    expect(result.retryAfterMs).toBeUndefined();
  });

  it("denies calls at the limit", () => {
    for (let i = 0; i < 5; i++) limiter.record("t1", "search");
    const result = limiter.check("t1", "search");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("returns correct remaining count", () => {
    limiter.record("t1", "search");
    expect(limiter.check("t1", "search").remaining).toBe(4);
    limiter.record("t1", "search");
    expect(limiter.check("t1", "search").remaining).toBe(3);
    limiter.record("t1", "search");
    limiter.record("t1", "search");
    expect(limiter.check("t1", "search").remaining).toBe(1);
  });

  it("returns retryAfterMs when denied", () => {
    const now = 100_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    for (let i = 0; i < 5; i++) limiter.record("t1", "search");

    // Check at now + 10s -- oldest entry should expire at now + 60s
    vi.spyOn(Date, "now").mockReturnValue(now + 10_000);
    const result = limiter.check("t1", "search");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(50_000); // 60s - 10s = 50s
  });

  it("applies per-tool overrides", () => {
    limiter = new SlidingWindowRateLimiter({
      defaultPerMinute: 60,
      perTool: { expensive_tool: 3 },
    });

    for (let i = 0; i < 3; i++) limiter.record("t1", "expensive_tool");
    expect(limiter.check("t1", "expensive_tool").allowed).toBe(false);

    // Default tool still has headroom
    for (let i = 0; i < 3; i++) limiter.record("t1", "cheap_tool");
    expect(limiter.check("t1", "cheap_tool").allowed).toBe(true);
    expect(limiter.check("t1", "cheap_tool").remaining).toBe(57);
  });

  it("isolates tenants", () => {
    for (let i = 0; i < 5; i++) limiter.record("t1", "search");
    expect(limiter.check("t1", "search").allowed).toBe(false);
    expect(limiter.check("t2", "search").allowed).toBe(true);
    expect(limiter.check("t2", "search").remaining).toBe(5);
  });

  it("reset clears entries for a specific tenant only", () => {
    for (let i = 0; i < 5; i++) {
      limiter.record("t1", "search");
      limiter.record("t2", "search");
    }

    limiter.reset("t1");

    expect(limiter.check("t1", "search").allowed).toBe(true);
    expect(limiter.check("t1", "search").remaining).toBe(5);
    expect(limiter.check("t2", "search").allowed).toBe(false);
  });

  it("prunes timestamps outside the 60s window", () => {
    const base = 100_000;

    // Record 5 calls at base time
    vi.spyOn(Date, "now").mockReturnValue(base);
    for (let i = 0; i < 5; i++) limiter.record("t1", "search");
    expect(limiter.check("t1", "search").allowed).toBe(false);

    // Advance past the window -- all entries should be pruned
    vi.spyOn(Date, "now").mockReturnValue(base + 61_000);
    const result = limiter.check("t1", "search");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });

  it("partially prunes old timestamps while keeping recent ones", () => {
    const base = 100_000;

    // Record 3 calls at base
    vi.spyOn(Date, "now").mockReturnValue(base);
    limiter.record("t1", "search");
    limiter.record("t1", "search");
    limiter.record("t1", "search");

    // Record 2 more calls at base + 40s
    vi.spyOn(Date, "now").mockReturnValue(base + 40_000);
    limiter.record("t1", "search");
    limiter.record("t1", "search");

    // At base + 61s: first 3 entries expire, 2 remain
    vi.spyOn(Date, "now").mockReturnValue(base + 61_000);
    const result = limiter.check("t1", "search");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it("allows a call with no prior records", () => {
    const result = limiter.check("t1", "search");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });
});
