import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "../../src/session/in-memory-session-store.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";

function makeSession(userId: string): ModeBSession {
  return new ModeBSession({
    appName: "app",
    userId,
    systemPrompt: "sys",
  });
}

describe("InMemorySessionStore", () => {
  it("get returns undefined for missing key", async () => {
    const store = new InMemorySessionStore();
    expect(await store.get("nonexistent")).toBeUndefined();
  });

  it("set + get roundtrip", async () => {
    const store = new InMemorySessionStore();
    const session = makeSession("u1");
    await store.set("key1", session);
    const retrieved = await store.get("key1");
    expect(retrieved).toBe(session);
    expect(retrieved!.userId).toBe("u1");
  });

  it("delete returns true for existing key", async () => {
    const store = new InMemorySessionStore();
    await store.set("key1", makeSession("u1"));
    expect(await store.delete("key1")).toBe(true);
    expect(await store.get("key1")).toBeUndefined();
  });

  it("delete returns false for missing key", async () => {
    const store = new InMemorySessionStore();
    expect(await store.delete("nonexistent")).toBe(false);
  });

  it("deleteByPrefix removes matching keys", async () => {
    const store = new InMemorySessionStore();
    await store.set("app:tenant-a:u1", makeSession("u1"));
    await store.set("app:tenant-a:u2", makeSession("u2"));
    await store.set("app:tenant-b:u1", makeSession("u1"));

    const count = await store.deleteByPrefix("app:tenant-a:");
    expect(count).toBe(2);
    expect(await store.get("app:tenant-a:u1")).toBeUndefined();
    expect(await store.get("app:tenant-a:u2")).toBeUndefined();
    expect(await store.get("app:tenant-b:u1")).toBeDefined();
  });

  it("deleteByPrefix returns 0 when no keys match", async () => {
    const store = new InMemorySessionStore();
    await store.set("key1", makeSession("u1"));
    expect(await store.deleteByPrefix("nomatch:")).toBe(0);
  });

  it("keys returns all stored keys", async () => {
    const store = new InMemorySessionStore();
    await store.set("a", makeSession("u1"));
    await store.set("b", makeSession("u2"));
    await store.set("c", makeSession("u3"));

    const keys = await store.keys();
    expect(keys).toHaveLength(3);
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys).toContain("c");
  });

  it("keys returns empty array when no sessions stored", async () => {
    const store = new InMemorySessionStore();
    expect(await store.keys()).toHaveLength(0);
  });
});
