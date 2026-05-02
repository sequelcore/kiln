import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CredentialFileStore,
  CredentialWatcher,
  DirectProviderCredentialPoolService,
} from "../../src/agents/credential-pool/index.js";

describe("CredentialWatcher", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kiln-credential-watcher-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("notifies the changed provider when credential files are added", async () => {
    const watcher = new CredentialWatcher({ rootDir });
    const onOpenAi = vi.fn();
    const onAnthropic = vi.fn();
    watcher.onProviderChanged("openai", onOpenAi);
    watcher.onProviderChanged("anthropic", onAnthropic);

    await watcher.scanOnce();
    await mkdir(join(rootDir, "openai"), { recursive: true });
    await writeFile(join(rootDir, "openai", "primary.json"), "{}", "utf8");
    await watcher.scanOnce();

    expect(onOpenAi).toHaveBeenCalledTimes(1);
    expect(onAnthropic).not.toHaveBeenCalled();
  });

  it("ignores health metadata changes", async () => {
    const watcher = new CredentialWatcher({ rootDir });
    const onOpenAi = vi.fn();
    watcher.onProviderChanged("openai", onOpenAi);

    await watcher.scanOnce();
    await mkdir(join(rootDir, ".health", "openai"), { recursive: true });
    await writeFile(join(rootDir, ".health", "openai", "primary.json"), "{}", "utf8");
    await watcher.scanOnce();

    expect(onOpenAi).not.toHaveBeenCalled();
  });

  it("reloads an existing direct-provider pool when its provider directory changes", async () => {
    const watcher = new CredentialWatcher({ rootDir });
    const store = new CredentialFileStore<{ apiKey: string }>({ rootDir });
    await store.writeCredential({
      providerId: "openai",
      id: "primary",
      label: "Primary",
      auth: { apiKey: "sk-primary" },
    });
    const service = new DirectProviderCredentialPoolService({ rootDir, watcher });
    const pool = await service.createPool("openai");

    expect(pool.snapshot().metrics.totalCredentials).toBe(1);

    await watcher.scanOnce();
    await store.writeCredential({
      providerId: "openai",
      id: "secondary",
      label: "Secondary",
      auth: { apiKey: "sk-secondary" },
    });
    await watcher.scanOnce();

    expect(pool.snapshot().entries.map((entry) => entry.id)).toEqual(["primary", "secondary"]);
  });
});
