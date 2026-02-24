import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DevTokenStore } from "../../src/gateway/dev-token-store.js";

describe("DevTokenStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issue returns a unique token string", () => {
    const store = new DevTokenStore();
    const t1 = store.issue("user-1");
    const t2 = store.issue("user-1");
    expect(typeof t1).toBe("string");
    expect(t1.length).toBeGreaterThan(0);
    expect(t1).not.toBe(t2);
  });

  it("validate returns valid:true and userId for a fresh token", () => {
    const store = new DevTokenStore();
    const token = store.issue("user-abc");
    const result = store.validate(token);
    expect(result).toEqual({ valid: true, userId: "user-abc" });
  });

  it("validate returns valid:false for an unknown token", () => {
    const store = new DevTokenStore();
    const result = store.validate("nonexistent-token");
    expect(result).toEqual({ valid: false });
  });

  it("validate returns valid:false for an expired token", () => {
    const store = new DevTokenStore(1000); // 1 second TTL
    const token = store.issue("user-x");

    vi.advanceTimersByTime(1001);

    const result = store.validate(token);
    expect(result).toEqual({ valid: false });
  });

  it("validate updates lastActivityAt (sliding window)", () => {
    const store = new DevTokenStore(5000); // 5 second TTL
    const token = store.issue("user-y");

    // Advance 3 seconds -- still valid, refreshes lastActivityAt
    vi.advanceTimersByTime(3000);
    expect(store.validate(token)).toEqual({ valid: true, userId: "user-y" });

    // Advance another 3 seconds (6 total from issue, but only 3 from last validate)
    vi.advanceTimersByTime(3000);
    expect(store.validate(token)).toEqual({ valid: true, userId: "user-y" });

    // Advance 6 seconds without validate -- now expired
    vi.advanceTimersByTime(6000);
    expect(store.validate(token)).toEqual({ valid: false });
  });

  it("revoke invalidates a token", () => {
    const store = new DevTokenStore();
    const token = store.issue("user-z");
    expect(store.validate(token).valid).toBe(true);

    const revoked = store.revoke(token);
    expect(revoked).toBe(true);
    expect(store.validate(token).valid).toBe(false);
  });

  it("revoke returns false for unknown token", () => {
    const store = new DevTokenStore();
    expect(store.revoke("unknown")).toBe(false);
  });

  it("cleanup removes expired tokens and returns count", () => {
    const store = new DevTokenStore(1000);
    store.issue("user-1");
    store.issue("user-2");
    store.issue("user-3");

    vi.advanceTimersByTime(1001);

    const removed = store.cleanup();
    expect(removed).toBe(3);
  });

  it("cleanup preserves active tokens", () => {
    const store = new DevTokenStore(5000);
    const active = store.issue("active-user");
    store.issue("expired-user");

    vi.advanceTimersByTime(3000);

    // Refresh the active token
    store.validate(active);

    vi.advanceTimersByTime(3000);

    const removed = store.cleanup();
    expect(removed).toBe(1); // only expired-user
    expect(store.validate(active).valid).toBe(true);
  });

  it("multiple tokens for same userId are independent", () => {
    const store = new DevTokenStore();
    const t1 = store.issue("shared-user");
    const t2 = store.issue("shared-user");

    store.revoke(t1);

    expect(store.validate(t1).valid).toBe(false);
    expect(store.validate(t2)).toEqual({ valid: true, userId: "shared-user" });
  });
});
