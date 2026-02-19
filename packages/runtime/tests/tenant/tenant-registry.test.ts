import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { TenantConfig } from "@kilnai/core";
import {
  TenantRegistry,
  TenantNotFoundError,
  TenantValidationFailedError,
} from "../../src/tenant/tenant-registry.js";

function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: `tenant-${randomUUID().slice(0, 8)}`,
    appName: "test-app",
    name: "Test Business",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("TenantRegistry", () => {
  let storageDir: string;
  let registry: TenantRegistry;

  beforeEach(() => {
    storageDir = join(tmpdir(), `kiln-test-${randomUUID()}`);
    registry = new TenantRegistry(storageDir);
  });

  describe("create + get round-trip", () => {
    it("creates and retrieves a tenant", () => {
      const tenant = makeTenant({ tenantId: "salon-maria" });
      registry.create(tenant);
      const found = registry.get("salon-maria");
      expect(found).toBeDefined();
      expect(found!.tenantId).toBe("salon-maria");
      expect(found!.name).toBe("Test Business");
    });

    it("persists tenant to disk", () => {
      const tenant = makeTenant({ tenantId: "salon-maria" });
      registry.create(tenant);
      expect(existsSync(join(storageDir, "salon-maria.json"))).toBe(true);
    });
  });

  describe("list", () => {
    it("filters by appName", () => {
      registry.create(makeTenant({ tenantId: "biz-a0", appName: "app1" }));
      registry.create(makeTenant({ tenantId: "biz-b0", appName: "app2" }));
      const filtered = registry.list("app1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.tenantId).toBe("biz-a0");
    });

    it("returns all when no filter", () => {
      registry.create(makeTenant({ tenantId: "biz-a1", appName: "app1" }));
      registry.create(makeTenant({ tenantId: "biz-b1", appName: "app2" }));
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("merges fields and preserves tenantId/appName/createdAt", () => {
      const original = makeTenant({ tenantId: "biz-xx", name: "Original" });
      registry.create(original);
      const updated = registry.update("biz-xx", { name: "Updated" });
      expect(updated.name).toBe("Updated");
      expect(updated.tenantId).toBe("biz-xx");
      expect(updated.appName).toBe("test-app");
      expect(updated.createdAt).toBe(original.createdAt);
    });

    it("sets updatedAt", () => {
      const original = makeTenant({ tenantId: "biz-yy" });
      registry.create(original);
      const updated = registry.update("biz-yy", { name: "New Name" });
      expect(updated.updatedAt).not.toBe(original.updatedAt);
    });

    it("throws TenantNotFoundError for unknown tenant", () => {
      expect(() => registry.update("nope", { name: "X" })).toThrow(TenantNotFoundError);
    });
  });

  describe("remove", () => {
    it("returns true for existing tenant", () => {
      registry.create(makeTenant({ tenantId: "biz-rm" }));
      expect(registry.remove("biz-rm")).toBe(true);
      expect(registry.get("biz-rm")).toBeUndefined();
    });

    it("returns false for unknown tenant", () => {
      expect(registry.remove("nope")).toBe(false);
    });
  });

  describe("resolveByPhone", () => {
    it("finds matching tenant by phoneNumberId and appName", () => {
      registry.create(
        makeTenant({
          tenantId: "biz-phone",
          appName: "atendia",
          whatsappPhoneNumberId: "12345",
          enabled: true,
        }),
      );
      const found = registry.resolveByPhone("12345", "atendia");
      expect(found?.tenantId).toBe("biz-phone");
    });

    it("returns undefined for disabled tenant", () => {
      registry.create(
        makeTenant({
          tenantId: "biz-disabled",
          appName: "atendia",
          whatsappPhoneNumberId: "12345",
          enabled: false,
        }),
      );
      expect(registry.resolveByPhone("12345", "atendia")).toBeUndefined();
    });

    it("returns undefined for wrong appName", () => {
      registry.create(
        makeTenant({
          tenantId: "biz-wrong-app",
          appName: "other-app",
          whatsappPhoneNumberId: "12345",
          enabled: true,
        }),
      );
      expect(registry.resolveByPhone("12345", "atendia")).toBeUndefined();
    });

    it("returns undefined for unknown phone number", () => {
      expect(registry.resolveByPhone("99999", "atendia")).toBeUndefined();
    });
  });

  describe("load", () => {
    it("reads existing JSON files from disk", () => {
      mkdirSync(storageDir, { recursive: true });
      const tenant = makeTenant({ tenantId: "pre-existing" });
      writeFileSync(join(storageDir, "pre-existing.json"), JSON.stringify(tenant), "utf-8");

      const freshRegistry = new TenantRegistry(storageDir);
      freshRegistry.load();
      expect(freshRegistry.get("pre-existing")).toBeDefined();
    });

    it("survives non-existent directory", () => {
      const nonExistent = join(tmpdir(), `kiln-noexist-${randomUUID()}`);
      const reg = new TenantRegistry(nonExistent);
      expect(() => reg.load()).not.toThrow();
    });
  });

  describe("create errors", () => {
    it("throws on duplicate tenantId", () => {
      registry.create(makeTenant({ tenantId: "dup-biz" }));
      expect(() => registry.create(makeTenant({ tenantId: "dup-biz" }))).toThrow(
        TenantValidationFailedError,
      );
    });

    it("throws on invalid config", () => {
      expect(() =>
        registry.create(makeTenant({ tenantId: "" })),
      ).toThrow(TenantValidationFailedError);
    });
  });
});
