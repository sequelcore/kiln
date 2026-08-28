import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readNativeOpenCodeCredential } from "../../../src/agents/credential-acquisition/opencode-credentials.js";

describe("readNativeOpenCodeCredential", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "opencode-credential-import-test-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads native auth from the OpenCode XDG data directory", async () => {
    const dataHome = join(tempDir, "data");
    await mkdir(join(dataHome, "opencode"), { recursive: true });
    await writeFile(
      join(dataHome, "opencode", "auth.json"),
      JSON.stringify({ "opencode-go": { type: "api", key: "sk-go" } }),
      "utf8",
    );
    vi.stubEnv("XDG_DATA_HOME", dataHome);
    vi.stubEnv("OPENCODE_CONFIG_DIR", join(tempDir, "config"));

    await expect(readNativeOpenCodeCredential({ tier: "go" })).resolves.toEqual(
      expect.objectContaining({ api_key: "sk-go", tier: "go" }),
    );
  });

  it("prefers the tier-specific entry over the generic entry", async () => {
    const sourcePath = join(tempDir, "auth.json");
    await writeFile(sourcePath, JSON.stringify({
      opencode: { type: "api", key: "sk-generic" },
      "opencode-go": { type: "api", key: "sk-go" },
      "opencode-zen": { type: "api", key: "sk-zen" },
    }), "utf8");

    await expect(readNativeOpenCodeCredential({ tier: "go", sourcePath })).resolves.toEqual(
      expect.objectContaining({ api_key: "sk-go", tier: "go" }),
    );
    await expect(readNativeOpenCodeCredential({ tier: "zen", sourcePath })).resolves.toEqual(
      expect.objectContaining({ api_key: "sk-zen", tier: "zen" }),
    );
  });

  it("falls back to the access field on a generic API entry", async () => {
    const sourcePath = join(tempDir, "auth.json");
    await writeFile(sourcePath, JSON.stringify({
      opencode: { type: "api", access: "sk-fallback" },
    }), "utf8");

    await expect(readNativeOpenCodeCredential({ sourcePath })).resolves.toEqual(
      expect.objectContaining({ api_key: "sk-fallback", tier: "go" }),
    );
  });

  it.each([
    ["missing", undefined],
    ["invalid JSON", "{"],
    ["non-API entry", JSON.stringify({ opencode: { type: "oauth", access: "token" } })],
    ["missing key", JSON.stringify({ opencode: { type: "api" } })],
    ["empty key", JSON.stringify({ opencode: { type: "api", key: "" } })],
  ])("returns null for %s native input", async (_label, contents) => {
    const sourcePath = join(tempDir, "auth.json");
    if (contents !== undefined) {
      await writeFile(sourcePath, contents, "utf8");
    }

    await expect(readNativeOpenCodeCredential({ sourcePath })).resolves.toBeNull();
  });

  it("fails closed when the native auth source cannot be read", async () => {
    await expect(readNativeOpenCodeCredential({ sourcePath: tempDir })).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
    });
  });
});
