import { describe, it, expect, vi, afterEach } from "vitest";
import { WebhookDedup } from "../../src/gateway/webhook-dedup.js";

// ---------------------------------------------------------------------------
// Adversarial tests for WebhookDedup
// Probes replay attacks, concurrency, edge cases, and high cardinality.
// ---------------------------------------------------------------------------

describe("WebhookDedup adversarial: Replay attack", () => {
  let dedup: WebhookDedup;

  afterEach(() => {
    dedup?.close();
  });

  it("only processes the first of 100 identical message IDs", () => {
    dedup = new WebhookDedup();
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(dedup.isDuplicate("replay-msg-001"));
    }

    // First call returns false (not a duplicate), all others return true
    expect(results[0]).toBe(false);
    expect(results.slice(1).every((r) => r === true)).toBe(true);
    expect(results.filter((r) => r === false)).toHaveLength(1);
  });

  it("handles replay with multiple different message IDs interleaved", () => {
    dedup = new WebhookDedup();

    // First occurrence of each should return false
    expect(dedup.isDuplicate("msg-a")).toBe(false);
    expect(dedup.isDuplicate("msg-b")).toBe(false);
    expect(dedup.isDuplicate("msg-c")).toBe(false);

    // All replays should return true
    for (let i = 0; i < 50; i++) {
      expect(dedup.isDuplicate("msg-a")).toBe(true);
      expect(dedup.isDuplicate("msg-b")).toBe(true);
      expect(dedup.isDuplicate("msg-c")).toBe(true);
    }
  });
});

describe("WebhookDedup adversarial: TTL expiry", () => {
  let dedup: WebhookDedup;

  afterEach(() => {
    vi.useRealTimers();
    dedup?.close();
  });

  it("allows reprocessing after TTL expires", () => {
    vi.useFakeTimers();
    const ttlMs = 2000;
    dedup = new WebhookDedup(ttlMs);

    expect(dedup.isDuplicate("msg-ttl")).toBe(false);
    expect(dedup.isDuplicate("msg-ttl")).toBe(true);

    // Advance time past TTL
    vi.advanceTimersByTime(ttlMs + 1);

    // Should be processable again
    expect(dedup.isDuplicate("msg-ttl")).toBe(false);
    expect(dedup.isDuplicate("msg-ttl")).toBe(true);
  });

  it("does not allow reprocessing before TTL expires", () => {
    vi.useFakeTimers();
    const ttlMs = 5000;
    dedup = new WebhookDedup(ttlMs);

    expect(dedup.isDuplicate("msg-early")).toBe(false);

    // Advance just under TTL
    vi.advanceTimersByTime(ttlMs - 1);
    expect(dedup.isDuplicate("msg-early")).toBe(true);
  });

  it("TTL applies independently per message ID", () => {
    vi.useFakeTimers();
    const ttlMs = 3000;
    dedup = new WebhookDedup(ttlMs);

    expect(dedup.isDuplicate("msg-x")).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(dedup.isDuplicate("msg-y")).toBe(false);

    // Advance past msg-x TTL but not msg-y
    vi.advanceTimersByTime(1600);
    expect(dedup.isDuplicate("msg-x")).toBe(false); // expired, reprocessable
    expect(dedup.isDuplicate("msg-y")).toBe(true); // still within TTL
  });
});

describe("WebhookDedup adversarial: Concurrent duplicates", () => {
  let dedup: WebhookDedup;

  afterEach(() => {
    dedup?.close();
  });

  it("only one of many rapid calls returns false", () => {
    dedup = new WebhookDedup();

    // Simulate rapid concurrent-like calls (synchronous, since isDuplicate is sync)
    const results: boolean[] = [];
    for (let i = 0; i < 50; i++) {
      results.push(dedup.isDuplicate("concurrent-msg"));
    }

    // Exactly one should return false
    expect(results.filter((r) => r === false)).toHaveLength(1);
    expect(results[0]).toBe(false);
  });
});

describe("WebhookDedup adversarial: Empty and null-like message IDs", () => {
  let dedup: WebhookDedup;

  afterEach(() => {
    dedup?.close();
  });

  it("handles empty string message ID without crashing", () => {
    dedup = new WebhookDedup();
    expect(dedup.isDuplicate("")).toBe(false);
    expect(dedup.isDuplicate("")).toBe(true);
  });

  it("treats empty string as a valid dedup key (distinct from other IDs)", () => {
    dedup = new WebhookDedup();
    expect(dedup.isDuplicate("")).toBe(false);
    expect(dedup.isDuplicate("non-empty")).toBe(false);
    expect(dedup.isDuplicate("")).toBe(true);
  });

  it("handles whitespace-only message IDs", () => {
    dedup = new WebhookDedup();
    expect(dedup.isDuplicate("   ")).toBe(false);
    expect(dedup.isDuplicate("   ")).toBe(true);
    // Different whitespace is a different key
    expect(dedup.isDuplicate("\t")).toBe(false);
  });

  it("handles message ID with special characters", () => {
    dedup = new WebhookDedup();
    expect(dedup.isDuplicate("msg-\u0000-null")).toBe(false);
    expect(dedup.isDuplicate("msg-\u0000-null")).toBe(true);
  });
});

describe("WebhookDedup adversarial: Very long message IDs", () => {
  let dedup: WebhookDedup;

  afterEach(() => {
    dedup?.close();
  });

  it("handles 10,000 character message ID without crashing", () => {
    dedup = new WebhookDedup();
    const longId = "x".repeat(10_000);
    expect(dedup.isDuplicate(longId)).toBe(false);
    expect(dedup.isDuplicate(longId)).toBe(true);
  });

  it("distinguishes long IDs that differ only at the end", () => {
    dedup = new WebhookDedup();
    const base = "a".repeat(9999);
    expect(dedup.isDuplicate(base + "1")).toBe(false);
    expect(dedup.isDuplicate(base + "2")).toBe(false);
    expect(dedup.isDuplicate(base + "1")).toBe(true);
    expect(dedup.isDuplicate(base + "2")).toBe(true);
  });
});

describe("WebhookDedup adversarial: High cardinality", () => {
  let dedup: WebhookDedup;

  afterEach(() => {
    vi.useRealTimers();
    dedup?.close();
  });

  it("handles 10,000 unique IDs without crashing", () => {
    dedup = new WebhookDedup();
    for (let i = 0; i < 10_000; i++) {
      expect(dedup.isDuplicate(`unique-${i}`)).toBe(false);
    }

    // Verify a few are still marked as duplicates
    expect(dedup.isDuplicate("unique-0")).toBe(true);
    expect(dedup.isDuplicate("unique-5000")).toBe(true);
    expect(dedup.isDuplicate("unique-9999")).toBe(true);
  });

  it("cleanup evicts expired entries under high cardinality", () => {
    vi.useFakeTimers();
    const ttlMs = 1000;
    dedup = new WebhookDedup(ttlMs);

    // Add 10,000 entries
    for (let i = 0; i < 10_000; i++) {
      dedup.isDuplicate(`hc-${i}`);
    }

    // All should be duplicates now
    expect(dedup.isDuplicate("hc-0")).toBe(true);
    expect(dedup.isDuplicate("hc-9999")).toBe(true);

    // Advance past TTL
    vi.advanceTimersByTime(ttlMs + 1);

    // Trigger cleanup by advancing to the next interval tick (60s)
    vi.advanceTimersByTime(60_000);

    // After cleanup + TTL expiry, entries should be reprocessable
    expect(dedup.isDuplicate("hc-0")).toBe(false);
    expect(dedup.isDuplicate("hc-5000")).toBe(false);
    expect(dedup.isDuplicate("hc-9999")).toBe(false);
  });
});
