import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteMemoryStore } from "../../src/memory/sqlite-store.js";
import { KilnError } from "../../src/engine/errors.js";

describe("SqliteMemoryStore - tenant isolation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kiln-tenant-iso-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeStore(tenantId?: string) {
    return new SqliteMemoryStore({
      dbPath: join(tmpDir, `${tenantId ?? "no-tenant"}.db`),
      layer: "user",
      tenantId,
    });
  }

  it("adds _tenant:<id> tag automatically on save", async () => {
    const store = makeStore("tenant-a");
    const id = await store.save({ layer: "user", content: "hello", tags: ["custom"] });

    // Search to verify tag was added
    const results = await store.search("hello");
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.id).toBe(id);
    expect(results[0]!.entry.tags).toContain("_tenant:tenant-a");
    expect(results[0]!.entry.tags).toContain("custom");

    store.close();
  });

  it("search only returns entries for the scoped tenant", async () => {
    // Use separate DB files per store to avoid cross-tenant leakage in this test
    const storeA = new SqliteMemoryStore({ dbPath: join(tmpDir, "shared.db"), layer: "user", tenantId: "tenant-a" });
    const storeB = new SqliteMemoryStore({ dbPath: join(tmpDir, "shared.db"), layer: "user", tenantId: "tenant-b" });

    await storeA.save({ layer: "user", content: "tenant-a content", tags: [] });
    await storeB.save({ layer: "user", content: "tenant-b content", tags: [] });

    const resultsA = await storeA.search("tenant");
    const resultsB = await storeB.search("tenant");

    expect(resultsA.every((r) => r.entry.tags.includes("_tenant:tenant-a"))).toBe(true);
    expect(resultsB.every((r) => r.entry.tags.includes("_tenant:tenant-b"))).toBe(true);

    storeA.close();
    // storeB uses same db, already closed
  });

  it("cross-tenant query returns only tenant's own entries (not other tenant's)", async () => {
    const storeA = new SqliteMemoryStore({ dbPath: join(tmpDir, "shared2.db"), layer: "user", tenantId: "tenant-a" });
    const storeB = new SqliteMemoryStore({ dbPath: join(tmpDir, "shared2.db"), layer: "user", tenantId: "tenant-b" });

    await storeA.save({ layer: "user", content: "confidential data for A", tags: [] });

    // tenant-b queries for "confidential" -- should get empty results
    const resultsB = await storeB.search("confidential");
    expect(resultsB).toHaveLength(0);

    storeA.close();
  });

  it("forget with wrong tenant throws TENANT_ISOLATION_VIOLATED", async () => {
    const storeA = new SqliteMemoryStore({ dbPath: join(tmpDir, "shared3.db"), layer: "user", tenantId: "tenant-a" });
    const storeB = new SqliteMemoryStore({ dbPath: join(tmpDir, "shared3.db"), layer: "user", tenantId: "tenant-b" });

    const id = await storeA.save({ layer: "user", content: "tenant-a secret", tags: [] });

    await expect(storeB.forget(id)).rejects.toThrow(KilnError);

    try {
      await storeB.forget(id);
    } catch (err) {
      expect((err as KilnError).code).toBe("TENANT_ISOLATION_VIOLATED");
    }

    storeA.close();
  });

  it("no tenantId = standard behavior (no tenant enforcement)", async () => {
    const store = makeStore(undefined);
    const id = await store.save({ layer: "user", content: "unrestricted content", tags: ["open"] });
    const results = await store.search("unrestricted");
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.id).toBe(id);
    // No tenant tag added
    expect(results[0]!.entry.tags).not.toContain("_tenant:undefined");

    store.close();
  });

  it("recall returns only tenant-scoped content", async () => {
    const storeA = new SqliteMemoryStore({ dbPath: join(tmpDir, "shared4.db"), layer: "user", tenantId: "tenant-a" });
    const storeB = new SqliteMemoryStore({ dbPath: join(tmpDir, "shared4.db"), layer: "user", tenantId: "tenant-b" });

    await storeA.save({ layer: "user", content: "secret alpha content", tags: [] });
    await storeB.save({ layer: "user", content: "secret beta content", tags: [] });

    const recallA = await storeA.recall("secret", 10000);
    expect(recallA).toContain("alpha");
    expect(recallA).not.toContain("beta");

    storeA.close();
  });

  it("forget succeeds for own tenant's entry", async () => {
    const store = makeStore("tenant-x");
    const id = await store.save({ layer: "user", content: "to be deleted", tags: [] });

    // Should not throw
    await expect(store.forget(id)).resolves.toBeUndefined();

    store.close();
  });
});
