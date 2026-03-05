import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionRegistry } from "../../src/session/session-registry.js";

describe("SessionRegistry", () => {
  describe("getOrCreate", () => {
    it("creates a new session when none exists", async () => {
      const registry = new SessionRegistry();
      const session = await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(session).toBeDefined();
      expect(session.appName).toBe("app");
      expect(session.userId).toBe("u1");
    });

    it("returns existing session for same app+user", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      const s2 = await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).toBe(s1.id);
    });

    it("creates new session after previous expires", async () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry(5000);
      const s1 = await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      vi.advanceTimersByTime(5001);
      const s2 = await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
      vi.useRealTimers();
    });

    it("different apps get different sessions for same userId", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({ appName: "app1", userId: "u1", systemPrompt: "sys" });
      const s2 = await registry.getOrCreate({ appName: "app2", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
    });

    it("different users get different sessions for same app", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      const s2 = await registry.getOrCreate({ appName: "app", userId: "u2", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
    });
  });

  describe("get", () => {
    it("returns undefined for unknown session", async () => {
      const registry = new SessionRegistry();
      expect(await registry.get("app", "nobody")).toBeUndefined();
    });

    it("returns existing session", async () => {
      const registry = new SessionRegistry();
      const created = await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      const found = await registry.get("app", "u1");
      expect(found?.id).toBe(created.id);
    });
  });

  describe("remove", () => {
    it("deletes session and returns true", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(await registry.remove("app", "u1")).toBe(true);
      expect(await registry.get("app", "u1")).toBeUndefined();
    });

    it("returns false for unknown session", async () => {
      const registry = new SessionRegistry();
      expect(await registry.remove("app", "nobody")).toBe(false);
    });
  });

  describe("activeCount", () => {
    it("counts only non-expired sessions", async () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      await registry.getOrCreate({ appName: "app", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 60000 });

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
      await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      const s2 = await registry.getOrCreate({ appName: "app", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 60000 });

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
      await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      await registry.getOrCreate({ appName: "app", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 5000 });
      await registry.getOrCreate({ appName: "app", userId: "u3", systemPrompt: "sys", idleTimeoutMs: 60000 });

      vi.advanceTimersByTime(5001);
      const removed = await registry.cleanup();

      expect(removed).toBe(2);
      expect(await registry.get("app", "u1")).toBeUndefined();
      expect(await registry.get("app", "u2")).toBeUndefined();
      expect(await registry.get("app", "u3")).toBeDefined();

      vi.useRealTimers();
    });

    it("returns 0 when no expired sessions", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
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

    it("tenantId=undefined uses 2-segment key (backward compatible)", async () => {
      const registry = new SessionRegistry();
      const s1 = await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      const found = await registry.get("app", "u1");
      expect(found?.id).toBe(s1.id);
      expect(found?.tenantId).toBeUndefined();
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

    it("get without tenantId does not find tenant-scoped session", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys",
      });
      expect(await registry.get("app", "u1")).toBeUndefined();
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

    it("session id includes tenantId when present", async () => {
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

    it("does not affect non-tenant sessions", async () => {
      const registry = new SessionRegistry();
      await registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      await registry.getOrCreate({ appName: "app", tenantId: "tenant-a", userId: "u1", systemPrompt: "sys" });

      const removed = await registry.invalidateByTenant("app", "tenant-a");

      expect(removed).toBe(1);
      expect(await registry.get("app", "u1")).toBeDefined();
    });
  });
});
