import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionRegistry } from "../../src/session/session-registry.js";

describe("SessionRegistry", () => {
  describe("getOrCreate", () => {
    it("creates a new session when none exists", () => {
      const registry = new SessionRegistry();
      const session = registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(session).toBeDefined();
      expect(session.appName).toBe("app");
      expect(session.userId).toBe("u1");
    });

    it("returns existing session for same app+user", () => {
      const registry = new SessionRegistry();
      const s1 = registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      const s2 = registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).toBe(s1.id);
    });

    it("creates new session after previous expires", () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry(5000);
      const s1 = registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      vi.advanceTimersByTime(5001);
      const s2 = registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
      vi.useRealTimers();
    });

    it("different apps get different sessions for same userId", () => {
      const registry = new SessionRegistry();
      const s1 = registry.getOrCreate({ appName: "app1", userId: "u1", systemPrompt: "sys" });
      const s2 = registry.getOrCreate({ appName: "app2", userId: "u1", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
    });

    it("different users get different sessions for same app", () => {
      const registry = new SessionRegistry();
      const s1 = registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      const s2 = registry.getOrCreate({ appName: "app", userId: "u2", systemPrompt: "sys" });
      expect(s2.id).not.toBe(s1.id);
    });
  });

  describe("get", () => {
    it("returns undefined for unknown session", () => {
      const registry = new SessionRegistry();
      expect(registry.get("app", "nobody")).toBeUndefined();
    });

    it("returns existing session", () => {
      const registry = new SessionRegistry();
      const created = registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      const found = registry.get("app", "u1");
      expect(found?.id).toBe(created.id);
    });
  });

  describe("remove", () => {
    it("deletes session and returns true", () => {
      const registry = new SessionRegistry();
      registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(registry.remove("app", "u1")).toBe(true);
      expect(registry.get("app", "u1")).toBeUndefined();
    });

    it("returns false for unknown session", () => {
      const registry = new SessionRegistry();
      expect(registry.remove("app", "nobody")).toBe(false);
    });
  });

  describe("activeCount", () => {
    it("counts only non-expired sessions", () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry();
      registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      registry.getOrCreate({ appName: "app", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 60000 });

      expect(registry.activeCount()).toBe(2);

      vi.advanceTimersByTime(5001);
      expect(registry.activeCount()).toBe(1);

      vi.useRealTimers();
    });

    it("returns zero when no sessions", () => {
      const registry = new SessionRegistry();
      expect(registry.activeCount()).toBe(0);
    });
  });

  describe("activeSessions", () => {
    it("returns only non-expired sessions", () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry();
      registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      const s2 = registry.getOrCreate({ appName: "app", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 60000 });

      vi.advanceTimersByTime(5001);

      const active = registry.activeSessions();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(s2.id);

      vi.useRealTimers();
    });

    it("returns empty array when no sessions", () => {
      const registry = new SessionRegistry();
      expect(registry.activeSessions()).toHaveLength(0);
    });
  });

  describe("cleanup", () => {
    it("removes expired sessions and returns count", () => {
      vi.useFakeTimers();
      const registry = new SessionRegistry();
      registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys", idleTimeoutMs: 5000 });
      registry.getOrCreate({ appName: "app", userId: "u2", systemPrompt: "sys", idleTimeoutMs: 5000 });
      registry.getOrCreate({ appName: "app", userId: "u3", systemPrompt: "sys", idleTimeoutMs: 60000 });

      vi.advanceTimersByTime(5001);
      const removed = registry.cleanup();

      expect(removed).toBe(2);
      expect(registry.get("app", "u1")).toBeUndefined();
      expect(registry.get("app", "u2")).toBeUndefined();
      expect(registry.get("app", "u3")).toBeDefined();

      vi.useRealTimers();
    });

    it("returns 0 when no expired sessions", () => {
      const registry = new SessionRegistry();
      registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      expect(registry.cleanup()).toBe(0);
    });
  });

  describe("multi-tenant key isolation", () => {
    it("same appName+userId with different tenantId creates separate sessions", () => {
      const registry = new SessionRegistry();
      const s1 = registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys-a",
      });
      const s2 = registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-b",
        userId: "u1",
        systemPrompt: "sys-b",
      });
      expect(s2.id).not.toBe(s1.id);
      expect(s1.tenantId).toBe("tenant-a");
      expect(s2.tenantId).toBe("tenant-b");
    });

    it("tenantId=undefined uses 2-segment key (backward compatible)", () => {
      const registry = new SessionRegistry();
      const s1 = registry.getOrCreate({ appName: "app", userId: "u1", systemPrompt: "sys" });
      const found = registry.get("app", "u1");
      expect(found?.id).toBe(s1.id);
      expect(found?.tenantId).toBeUndefined();
    });

    it("get with tenantId finds tenant-scoped session", () => {
      const registry = new SessionRegistry();
      const s1 = registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys",
      });
      const found = registry.get("app", "u1", "tenant-a");
      expect(found?.id).toBe(s1.id);
    });

    it("get without tenantId does not find tenant-scoped session", () => {
      const registry = new SessionRegistry();
      registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys",
      });
      expect(registry.get("app", "u1")).toBeUndefined();
    });

    it("remove with tenantId only removes that tenant's session", () => {
      const registry = new SessionRegistry();
      registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-a",
        userId: "u1",
        systemPrompt: "sys-a",
      });
      registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-b",
        userId: "u1",
        systemPrompt: "sys-b",
      });

      expect(registry.remove("app", "u1", "tenant-a")).toBe(true);
      expect(registry.get("app", "u1", "tenant-a")).toBeUndefined();
      expect(registry.get("app", "u1", "tenant-b")).toBeDefined();
    });

    it("session id includes tenantId when present", () => {
      const registry = new SessionRegistry();
      const session = registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-x",
        userId: "u1",
        systemPrompt: "sys",
      });
      expect(session.id).toContain("tenant-x");
    });
  });
});
