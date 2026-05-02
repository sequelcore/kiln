import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { CredentialFileStore, HarnessCredentialPoolService } from "../../src/agents/credential-pool/index.js";

describe("HarnessCredentialPoolService", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kiln-harness-pool-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("loads wrapper home directories from provider credential files", async () => {
    const store = new CredentialFileStore<{ homeDir: string }>({ rootDir });
    await store.writeCredential({
      providerId: "codex",
      id: "plus",
      label: "Codex Plus",
      auth: { homeDir: "C:/Users/Ricardo/.codex-plus" },
    });

    const service = new HarnessCredentialPoolService({ rootDir });

    await expect(service.listStatus("codex")).resolves.toMatchObject([{
      id: "plus",
      label: "Codex Plus",
      providerId: "codex",
    }]);
    const pool = await service.createPool("codex");
    const lease = pool.acquire();
    expect(lease.auth.homeDir).toBe("C:/Users/Ricardo/.codex-plus");
  });

  it("fails fast when a harness credential has no homeDir", async () => {
    const store = new CredentialFileStore<Record<string, never>>({ rootDir });
    await store.writeCredential({
      providerId: "opencode",
      id: "broken",
      label: "Broken",
      auth: {},
    });

    const service = new HarnessCredentialPoolService({ rootDir });

    await expect(service.createPool("opencode")).rejects.toThrow("requires homeDir");
  });
});
