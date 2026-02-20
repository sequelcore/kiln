import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolCache } from "../../src/agents/tool-cache.js";

describe("ToolCache", () => {
  let cache: ToolCache;

  beforeEach(() => {
    cache = new ToolCache();
    vi.restoreAllMocks();
  });

  it("returns undefined for cache miss", () => {
    expect(cache.get("search", { q: "test" })).toBeUndefined();
  });

  it("stores and retrieves a result", () => {
    cache.set("search", { q: "test" }, { data: 42 }, 60);
    expect(cache.get("search", { q: "test" })).toEqual({ data: 42 });
  });

  it("produces deterministic keys regardless of property order", () => {
    cache.set("tool", { b: 2, a: 1 }, "result", 60);
    expect(cache.get("tool", { a: 1, b: 2 })).toBe("result");
  });

  it("returns undefined after TTL expires", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1000)   // set
      .mockReturnValueOnce(62000); // get (61s later, past 60s TTL)

    cache.set("tool", { a: 1 }, "old", 60);
    expect(cache.get("tool", { a: 1 })).toBeUndefined();
  });

  it("removes expired entry on access", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1000)   // set
      .mockReturnValueOnce(62000); // get

    cache.set("tool", { a: 1 }, "old", 60);
    cache.get("tool", { a: 1 });
    expect(cache.size).toBe(0);
  });

  it("does not store when ttl <= 0", () => {
    cache.set("tool", { a: 1 }, "result", 0);
    expect(cache.size).toBe(0);
    cache.set("tool", { a: 1 }, "result", -1);
    expect(cache.size).toBe(0);
  });

  it("supports Infinity TTL", () => {
    cache.set("tool", { a: 1 }, "forever", Infinity);
    expect(cache.get("tool", { a: 1 })).toBe("forever");
  });

  describe("invalidate", () => {
    it("clears a specific entry", () => {
      cache.set("tool", { a: 1 }, "r1", 60);
      cache.set("tool", { a: 2 }, "r2", 60);
      cache.invalidate("tool", { a: 1 });
      expect(cache.get("tool", { a: 1 })).toBeUndefined();
      expect(cache.get("tool", { a: 2 })).toBe("r2");
    });

    it("clears all entries for a tool", () => {
      cache.set("tool", { a: 1 }, "r1", 60);
      cache.set("tool", { a: 2 }, "r2", 60);
      cache.set("other", { a: 1 }, "r3", 60);
      cache.invalidate("tool");
      expect(cache.size).toBe(1);
      expect(cache.get("other", { a: 1 })).toBe("r3");
    });

    it("clears everything when called with no args", () => {
      cache.set("a", { x: 1 }, "r1", 60);
      cache.set("b", { x: 1 }, "r2", 60);
      cache.invalidate();
      expect(cache.size).toBe(0);
    });
  });
});
