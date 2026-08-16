import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { TenantConfig } from "@kilnai/core/engine";
import { AesSecretStore } from "@kilnai/core/security";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";

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

describe("TenantRegistry - encrypted secrets", () => {
  let tmpDir: string;
  let storageDir: string;
  let secretsPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kiln-enc-tenant-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    storageDir = join(tmpDir, "tenants");
    secretsPath = join(tmpDir, "secrets.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRegistry(withSecrets = true) {
    const secretStore = withSecrets ? new AesSecretStore(secretsPath, "master-key-123") : undefined;
    return new TenantRegistry(storageDir, secretStore);
  }

  it("creates tenant with sensitive fields encrypted in persisted file", () => {
    const registry = makeRegistry();
    const tenant = makeTenant({
      tenantId: "biz-enc",
      whatsappAccessToken: "secret-access-token",
      whatsappVerifyToken: "secret-verify-token",
    });
    registry.create(tenant);

    // Verify persisted file does NOT contain plaintext tokens
    const raw = readFileSync(join(storageDir, "biz-enc.json"), "utf-8");
    expect(raw).not.toContain("secret-access-token");
    expect(raw).not.toContain("secret-verify-token");
    expect(raw).toContain("[encrypted]");
  });

  it("get() hydrates sensitive fields (decrypts before returning)", () => {
    const registry = makeRegistry();
    const tenant = makeTenant({
      tenantId: "biz-hydrate",
      whatsappAccessToken: "real-access-token",
      whatsappVerifyToken: "real-verify-token",
    });
    registry.create(tenant);

    const retrieved = registry.get("biz-hydrate");
    expect(retrieved).toBeDefined();
    expect(retrieved!.whatsappAccessToken).toBe("real-access-token");
    expect(retrieved!.whatsappVerifyToken).toBe("real-verify-token");
  });

  it("update() re-encrypts sensitive field with new value", () => {
    const registry = makeRegistry();
    const tenant = makeTenant({
      tenantId: "biz-update",
      whatsappAccessToken: "old-token",
    });
    registry.create(tenant);

    registry.update("biz-update", { whatsappAccessToken: "new-token" });

    // Persisted file should not contain plaintext
    const raw = readFileSync(join(storageDir, "biz-update.json"), "utf-8");
    expect(raw).not.toContain("new-token");
    expect(raw).not.toContain("old-token");

    // But get() should return the new value
    const retrieved = registry.get("biz-update");
    expect(retrieved!.whatsappAccessToken).toBe("new-token");
  });

  it("remove() deletes secrets from the secret store", () => {
    const secretStore = new AesSecretStore(secretsPath, "master-key-123");
    const registry = new TenantRegistry(storageDir, secretStore);

    const tenant = makeTenant({
      tenantId: "biz-remove",
      whatsappAccessToken: "token-to-delete",
    });
    registry.create(tenant);

    // Verify secret exists
    expect(secretStore.has("tenant:biz-remove:whatsappAccessToken")).toBe(true);

    registry.remove("biz-remove");

    // Verify secret was deleted
    expect(secretStore.has("tenant:biz-remove:whatsappAccessToken")).toBe(false);
  });

  it("without SecretStore, sensitive fields are stored in plaintext (standard behavior)", () => {
    const registry = makeRegistry(false);
    const tenant = makeTenant({
      tenantId: "biz-plain",
      whatsappAccessToken: "plaintext-token",
    });
    registry.create(tenant);

    // Without encryption, plaintext is stored as-is
    const raw = readFileSync(join(storageDir, "biz-plain.json"), "utf-8");
    expect(raw).toContain("plaintext-token");

    const retrieved = registry.get("biz-plain");
    expect(retrieved!.whatsappAccessToken).toBe("plaintext-token");
  });

  it("tenant without sensitive fields is unaffected by encryption", () => {
    const registry = makeRegistry();
    const tenant = makeTenant({ tenantId: "biz-no-secrets" });
    const created = registry.create(tenant);

    expect(created.tenantId).toBe("biz-no-secrets");
    expect(created.whatsappAccessToken).toBeUndefined();
    expect(created.whatsappVerifyToken).toBeUndefined();
  });

  it("load() hydrates sensitive fields when loading from disk", () => {
    // Create with one registry instance
    const secretStore = new AesSecretStore(secretsPath, "master-key-123");
    const registry1 = new TenantRegistry(storageDir, secretStore);
    registry1.create(
      makeTenant({
        tenantId: "biz-reload",
        whatsappAccessToken: "persist-me",
      }),
    );

    // Load with a fresh registry sharing the same secret store
    const secretStore2 = new AesSecretStore(secretsPath, "master-key-123");
    const registry2 = new TenantRegistry(storageDir, secretStore2);
    registry2.load();

    const retrieved = registry2.get("biz-reload");
    expect(retrieved).toBeDefined();
    expect(retrieved!.whatsappAccessToken).toBe("persist-me");
  });
});
