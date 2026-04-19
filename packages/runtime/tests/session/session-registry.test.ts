import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KilnError } from "@kilnai/core";
import { SessionRegistry } from "../../src/session/session-registry.js";
import type { SessionStore } from "../../src/session/session-store.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { serializeSession, deserializeSession } from "../../src/session/session-serializer.js";

describe("SessionRegistry", () => {
  describe("getOrCreate", () => {
    it("creates a new session when none exists", async () => {
      const registry = new SessionRegistry();
      const session = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      expect(session).toBeDefined();
      expect(session.appName).toBe("app");
      expect(session.userId).toBe("u1");
    });

    it("returns existing session for same app+user", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      const s2 = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).toBe(s1.id);
    });

    it("creates new session after previous expires", async () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry(5000);
      const s1 = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      vi.advanceTimersByTime(5001);
      const s2 = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
      vi.useRealTimers();
    });

    it("different apps get different sessions for same userId", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({ appName: "app1", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      const s2 = await registry.getOrCreate({ appName: "app2", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
    });

    it("different users get different sessions for same app", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      const s2 = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u2", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
    });
  });

  describe("get", () => {
    it("returns undefined for unknown session", async () => {
      const registry = new SessionRegistry();
      expect(await registry.get("app", "nobody", "t")).toBeUndefined();
    });

    it("returns existing session", async () => {
      const registry = new SessionRegistry();
      const created = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      const found = await registry.get("app", "u1", "t");
      expect(found?.id).toBe(created.id);
    });
  });

  describe("remove", () => {
    it("deletes session and returns true", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      expect(await registry.remove("app", "u1", "t")).toBe(true);
      expect(await registry.get("app", "u1", "t")).toBeUndefined();
    });

    it("returns false for unknown session", async () => {
      const registry = new SessionRegistry();
      expect(await registry.remove("app", "nobody", "t")).toBe(false);
    });
  });

  describe("activeCount", () => {
    it("counts only non-expired sessions", async () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 60000 });

      expect(await registry.activeCount()).toBe(2);

      vi.advanceTimersByTime(5001);
      expect(await registry.activeCount()).toBe(1);

      vi.useRealTimers();
    });

    it("returns zero when no sessions", async () => {
      const registry = new SessionRegistry();
      expect(await registry.activeCount()).toBe(0);
    });
  });

  describe("activeSessions", () => {
    it("returns only non-expired sessions", async () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      const s2 = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 60000 });

      vi.advanceTimersByTime(5001);

      const active = await registry.activeSessions();
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe(s2.id);

      vi.useRealTimers();
    });

    it("returns empty array when no sessions", async () => {
      const registry = new SessionRegistry();
      expect(await registry.activeSessions()).toHaveLength(0);
    });
  });

  describe("cleanup", () => {
    it("removes expired sessions and returns count", async () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 5000 });
      await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u3", systemPrompt: "sys", idleTimeoutMs: 60000 });

      vi.advanceTimersByTime(5001);
      const removed = await registry.cleanup();

      expect(removed).toBe(2);
      expect(await registry.get("app", "u1", "t")).toBeUndefined();
      expect(await registry.get("app", "u2", "t")).toBeUndefined();
      expect(await registry.get("app", "u3", "t")).toBeDefined();

      vi.useRealTimers();
    });

    it("returns 0 when no expired sessions", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      expect(await registry.cleanup()).toBe(0);
    });
  });

  describe("multi-tenant key isolation", () => {
    it("same appName+userId with different tenantId creates separate sessions", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys-a",
      });
      const s2 = await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-b",
        userId: "u1",
        systemPrompt: "sys-b",
      });
      expect(s2.id).not.toBe(s1.id);
      expect(s1.tenantId).toBe("tenant-a");
      expect(s2.tenantId).toBe("tenant-b");
    });

    it("get with tenantId finds tenant-scoped session", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys",
      });
      const found = await registry.get("app", "u1", "tenant-a");
      expect(found?.id).toBe(s1.id);
    });

    it("remove with tenantId only removes that tenant's session", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys-a",
      });
      await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-b",
        userId: "u1",
        systemPrompt: "sys-b",
      });

      expect(await registry.remove("app", "u1", "tenant-a")).toBe(true);
      expect(await registry.get("app", "u1", "tenant-a")).toBeUndefined();
      expect(await registry.get("app", "u1", "tenant-b")).toBeDefined();
    });

    it("session id includes tenantId", async () => {
      const registry = new SessionRegistry();
      const session = await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-x",
        userId: "u1",
        systemPrompt: "sys",
      });
      expect(session.id).toContain("tenant-x");
    });
  });

  describe("save", () => {
    it("persists mutated session back to the store", async () => {
      const registry = new SessionRegistry();
      const session = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });
      session.setSessionMode("queued");
      await registry.save(session);

      const retrieved = await registry.get("app", "u1", "t");
      expect(retrieved?.sessionMode).toBe("queued");
    });

    it("persists tenant-scoped sessions correctly", async () => {
      const registry = new SessionRegistry();
      const session = await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys",
      });
      session.setSessionMode("queued");
      await registry.save(session);

      const retrieved = await registry.get("app", "u1", "tenant-a");
      expect(retrieved?.sessionMode).toBe("queued");
    });

    it("detects concurrent modification with non-reference stores", async () => {
      // Simulate a Redis-like store that deserializes on every get (returns new objects)
      const data = new Map<string, string>();
      const store: SessionStore = {
        async get(key) {
          const json = data.get(key);
          return json ? deserializeSession(json) : undefined;
        },
        async set(key, session) {
          data.set(key, serializeSession(session));
        },
        async delete(key) {
          return data.delete(key);
        },
        async deleteByPrefix(prefix) {
          let count = 0;
          for (const key of data.keys()) {
            if (key.startsWith(prefix)) { data.delete(key); count++; }
          }
          return count;
        },
        async keys() {
          return [...data.keys()];
        },
      };

      const registry = new SessionRegistry(undefined, store);
      const session = await registry.getOrCreate({ appName: "app", tenantId: "t", userId: "u1", systemPrompt: "sys" });

      // Simulate a concurrent modification: another request modifies the stored session
      const concurrentSession = await registry.get("app", "u1", "t");
      concurrentSession!.setSessionMode("queued");
      await registry.save(concurrentSession!);

      // Now the original session's loadedVersion is stale
      session.setSessionMode("human_active");
      await expect(registry.save(session)).rejects.toThrow(KilnError);
      await expect(registry.save(session)).rejects.toThrow(/modified concurrently/);
    });
  });

  describe("invalidateByTenant", () => {
    it("removes all sessions for a given tenant", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", tenantId: "tenant-a", userId: "u1", systemPrompt: "sys" });
      await registry.getOrCreate({ appName: "app", tenantId: "tenant-a", userId: "u2", systemPrompt: "sys" });
      await registry.getOrCreate({ appName: "app", tenantId: "tenant-b", userId: "u1", systemPrompt: "sys" });

      const removed = await registry.invalidateByTenant("app", "tenant-a");

      expect(removed).toBe(2);
      expect(await registry.get("app", "u1", "tenant-a")).toBeUndefined();
      expect(await registry.get("app", "u2", "tenant-a")).toBeUndefined();
      expect(await registry.get("app", "u1", "tenant-b")).toBeDefined();
    });

    it("returns 0 when no sessions match", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", tenantId: "tenant-a", userId: "u1", systemPrompt: "sys" });

      expect(await registry.invalidateByTenant("app", "nonexistent")).toBe(0);
      expect(await registry.get("app", "u1", "tenant-a")).toBeDefined();
    });

    it("does not affect sessions from a different app", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app1", tenantId: "tenant-a", userId: "u1", systemPrompt: "sys" });
      await registry.getOrCreate({ appName: "app2", tenantId: "tenant-a", userId: "u1", systemPrompt: "sys" });

      const removed = await registry.invalidateByTenant("app1", "tenant-a");

      expect(removed).toBe(1);
      expect(await registry.get("app1", "u1", "tenant-a")).toBeUndefined();
      expect(await registry.get("app2", "u1", "tenant-a")).toBeDefined();
    });
  });
});
