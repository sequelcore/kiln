import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CredentialFileStore,
  CredentialFileStoreError,
  CredentialHealthStore,
  CredentialPoolFactory,
} from "../../src/agents/credential-pool/index.js";

type TestAuth = { readonly apiKey: string };

describe("runtime credential pool services", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kiln-credential-pool-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("reads and writes provider credential files without leaking auth in status", async () => {
    const store = new CredentialFileStore<TestAuth>({ rootDir });

    await store.writeCredential({
      providerId: "opencode",
      id: "work",
      label: "Work account",
      auth: { apiKey: "sk-secret" },
      tier: "zen",
      priority: 10,
    });

    const credentials = await store.readProviderCredentials("opencode");
    expect(credentials).toMatchObject([{
      id: "work",
      label: "Work account",
      providerId: "opencode",
      auth: { apiKey: "sk-secret" },
      tier: "zen",
      priority: 10,
    }]);

    const status = await store.readProviderCredentialStatus("opencode");
    expect(status).toEqual([{
      id: "work",
      label: "Work account",
      providerId: "opencode",
      source: "manual",
      priority: 10,
      tier: "zen",
      fileName: "work.json",
    }]);
    expect(JSON.stringify(status)).not.toContain("sk-secret");
  });

  it("fails malformed credential files with provider and file context", async () => {
    const store = new CredentialFileStore<TestAuth>({ rootDir });
    await mkdir(join(rootDir, "anthropic"), { recursive: true });
    await writeFile(join(rootDir, "anthropic", "bad.json"), "{\"id\": 1}", "utf8");

    await expect(store.readProviderCredentials("anthropic")).rejects.toMatchObject({
      name: "CredentialFileStoreError",
      providerId: "anthropic",
    });
    await expect(store.readProviderCredentials("anthropic")).rejects.toBeInstanceOf(CredentialFileStoreError);
  });

  it("builds a core pool from runtime DTOs and persists health through the state port", async () => {
    const store = new CredentialFileStore<TestAuth>({ rootDir });
    const healthStore = new CredentialHealthStore({ rootDir });
    await store.writeCredential({
      providerId: "openai",
      id: "primary",
      label: "Primary",
      auth: { apiKey: "sk-primary" },
    });
    const factory = new CredentialPoolFactory<TestAuth>({ fileStore: store, healthStore });

    const pool = await factory.loadPool("openai");
    const lease = pool.acquire();
    pool.report(lease, { type: "rate-limited", resetAt: 1_800_000 });

    const health = await healthStore.readProviderHealth("openai");
    expect(health).toEqual([expect.objectContaining({
      credentialId: "primary",
      providerId: "openai",
      requestCount: 1,
      lastOutcome: { type: "rate-limited", resetAt: 1_800_000 },
      cooldownUntil: expect.any(Number),
    })]);
    expect(JSON.stringify(health)).not.toContain("sk-primary");
  });
});
