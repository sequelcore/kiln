import { describe, it, expect } from "vitest";
import { InMemoryIdentityResolver } from "../../src/channels/types.js";

describe("InMemoryIdentityResolver", () => {
  it("resolves a mapped identity", async () => {
    const resolver = new InMemoryIdentityResolver();
    resolver.addMapping("whatsapp", "+1234567890", "user-42");

    const result = await resolver.resolve("whatsapp", "+1234567890");
    expect(result).toBe("user-42");
  });

  it("returns null for unmapped identity", async () => {
    const resolver = new InMemoryIdentityResolver();
    const result = await resolver.resolve("slack", "U123");
    expect(result).toBeNull();
  });

  it("isolates mappings by channel", async () => {
    const resolver = new InMemoryIdentityResolver();
    resolver.addMapping("slack", "U123", "user-1");
    resolver.addMapping("whatsapp", "U123", "user-2");

    expect(await resolver.resolve("slack", "U123")).toBe("user-1");
    expect(await resolver.resolve("whatsapp", "U123")).toBe("user-2");
  });

  it("overwrites existing mapping", async () => {
    const resolver = new InMemoryIdentityResolver();
    resolver.addMapping("web", "session-1", "user-old");
    resolver.addMapping("web", "session-1", "user-new");

    expect(await resolver.resolve("web", "session-1")).toBe("user-new");
  });
});
