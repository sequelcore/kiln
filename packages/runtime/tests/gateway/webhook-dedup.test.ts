import { describe, it, expect, vi, afterEach } from "vitest";
import { WebhookDedup } from "../../src/gateway/webhook-dedup.js";

describe("WebhookDedup", () => {
  let dedup: WebhookDedup;

  afterEach(() => {
    dedup?.close();
  });

  it("returns false for the first occurrence of a message ID", () => {
    dedup = new WebhookDedup();
    expect(dedup.isDuplicate("msg-001")).toBe(false);
  });

  it("returns true for the second occurrence of the same message ID", () => {
    dedup = new WebhookDedup();
    dedup.isDuplicate("msg-001");
    expect(dedup.isDuplicate("msg-001")).toBe(true);
  });

  it("treats different message IDs independently", () => {
    dedup = new WebhookDedup();
    dedup.isDuplicate("msg-001");
    expect(dedup.isDuplicate("msg-002")).toBe(false);
    expect(dedup.isDuplicate("msg-001")).toBe(true);
  });

  it("returns false after TTL expires", () => {
    vi.useFakeTimers();
    try {
      const ttlMs = 1000;
      dedup = new WebhookDedup(ttlMs);

      expect(dedup.isDuplicate("msg-001")).toBe(false);
      expect(dedup.isDuplicate("msg-001")).toBe(true);

      // Advance past TTL
      vi.advanceTimersByTime(ttlMs + 1);

      expect(dedup.isDuplicate("msg-001")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close() clears the cleanup interval", () => {
    dedup = new WebhookDedup();
    // Should not throw
    dedup.close();
    dedup.close(); // idempotent
  });
});
