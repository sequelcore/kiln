import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderCredentialApplicationService } from "../../../src/agents/credential-acquisition/provider-credential-application-service.js";

describe("ProviderCredentialApplicationService", () => {
  let tempDir: string;
  let kilnHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "provider-credential-application-test-"));
    kilnHome = join(tempDir, "kiln");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("imports native OpenCode credentials directly into the Runtime-owned pool", async () => {
    const dataHome = join(tempDir, "data");
    const sourcePath = join(dataHome, "opencode", "auth.json");
    await mkdir(join(dataHome, "opencode"), { recursive: true });
    await writeFile(sourcePath, JSON.stringify({
      "opencode-zen": { type: "api", key: "sk-native-zen" },
    }), "utf8");
    vi.stubEnv("XDG_DATA_HOME", dataHome);
    const service = new ProviderCredentialApplicationService({ kilnHome });

    await expect(service.importNativeOpenCodeCredential({
      tier: "zen",
      id: "zen-work",
    })).resolves.toBe(true);

    const stored = JSON.parse(await readFile(
      join(kilnHome, "auth", "opencode-api", "zen-work.json"),
      "utf8",
    )) as Record<string, unknown>;
    expect(stored).toMatchObject({
      id: "zen-work",
      providerId: "opencode-api",
      tier: "zen",
      auth: {
        api_key: "sk-native-zen",
        tier: "zen",
      },
    });
  });

  it("does not create pooled state when native OpenCode credentials are absent", async () => {
    vi.stubEnv("XDG_DATA_HOME", join(tempDir, "absent-data"));
    const service = new ProviderCredentialApplicationService({ kilnHome });

    await expect(service.importNativeOpenCodeCredential({
      tier: "go",
      id: "go-primary",
    })).resolves.toBe(false);
    await expect(readFile(
      join(kilnHome, "auth", "opencode-api", "go-primary.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ignores obsolete pooled marker files when determining whether credentials exist", async () => {
    const authDir = join(kilnHome, "auth");
    await mkdir(authDir, { recursive: true });
    await writeFile(join(authDir, "opencode.json"), "{}", "utf8");
    await writeFile(join(authDir, "codex-oauth.json"), "{}", "utf8");

    await expect(
      new ProviderCredentialApplicationService({ kilnHome }).inspectStoredCredentials(),
    ).resolves.toMatchObject({ hasStoredEntries: false });
  });

  it("projects store inventory without exposing credential contents", async () => {
    const authDir = join(kilnHome, "auth");
    await mkdir(join(authDir, "opencode-api"), { recursive: true });
    await mkdir(join(authDir, "codex-oauth"), { recursive: true });
    await writeFile(
      join(authDir, "legacy.json"),
      JSON.stringify({ access_token: "legacy-secret", expires_at: "2099-01-01T00:00:00.000Z" }),
      "utf8",
    );

    const result = await new ProviderCredentialApplicationService({ kilnHome }).inspectStoredCredentials();

    expect(result).toMatchObject({
      hasStoredEntries: true,
      hasOpenCodePool: true,
      hasCodexOAuthPool: true,
      legacyProviders: [{
        provider: "legacy",
        status: "valid",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }],
    });
    expect(JSON.stringify(result)).not.toContain("legacy-secret");
  });
});
