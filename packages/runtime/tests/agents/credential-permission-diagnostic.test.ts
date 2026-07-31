import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CredentialFileStore } from "../../src/agents/credential-pool/credential-file-store.js";
import { listOverPermissiveCredentialFiles } from "../../src/agents/credential-pool/credential-permission-diagnostic.js";

// POSIX-only assertions: Windows does not implement mode bits. CI runs Linux.
const isWindows = process.platform === "win32";

describe("credential permission diagnostic", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kiln-credential-permissions-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it.skipIf(isWindows)("reports credential files readable beyond their owner", async () => {
    await mkdir(join(rootDir, "codex-oauth"), { recursive: true });
    await writeFile(join(rootDir, "codex-oauth", "loose.json"), "{}", "utf8");
    await chmod(join(rootDir, "codex-oauth", "loose.json"), 0o644);
    await writeFile(join(rootDir, "codex-oauth", "tight.json"), "{}", "utf8");
    await chmod(join(rootDir, "codex-oauth", "tight.json"), 0o600);

    const findings = await listOverPermissiveCredentialFiles({ rootDir });

    expect(findings).toEqual([{ relativePath: "codex-oauth/loose.json", mode: "644" }]);
  });

  it.skipIf(isWindows)("ignores health and usage metadata, which carry no credential secrets", async () => {
    await mkdir(join(rootDir, ".health"), { recursive: true });
    await writeFile(join(rootDir, ".health", "codex-oauth.json"), "[]", "utf8");
    await chmod(join(rootDir, ".health", "codex-oauth.json"), 0o644);

    await expect(listOverPermissiveCredentialFiles({ rootDir })).resolves.toEqual([]);
  });

  it("reports nothing on Windows, where POSIX mode bits are not implemented", async () => {
    await mkdir(join(rootDir, "codex-oauth"), { recursive: true });
    await writeFile(join(rootDir, "codex-oauth", "any.json"), "{}", "utf8");

    await expect(listOverPermissiveCredentialFiles({ rootDir, platform: "win32" })).resolves.toEqual([]);
  });

  it("returns nothing when the credential root does not exist", async () => {
    await expect(listOverPermissiveCredentialFiles({ rootDir: join(rootDir, "absent") })).resolves.toEqual([]);
  });

  it.skipIf(isWindows)("repairs a pre-existing loose credential on its next write", async () => {
    const store = new CredentialFileStore<{ api_key: string }>({ rootDir });
    await store.writeCredential({ id: "go-primary", label: "go-primary", providerId: "opencode-api", auth: { api_key: "k" } });
    const filePath = join(rootDir, "opencode-api", "go-primary.json");
    await chmod(filePath, 0o644);
    expect(await listOverPermissiveCredentialFiles({ rootDir })).toHaveLength(1);

    await store.writeCredential({ id: "go-primary", label: "go-primary", providerId: "opencode-api", auth: { api_key: "k2" } });

    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await expect(listOverPermissiveCredentialFiles({ rootDir })).resolves.toEqual([]);
  });

  it.skipIf(isWindows)("creates new credential files owner-only", async () => {
    const store = new CredentialFileStore<{ api_key: string }>({ rootDir });

    await store.writeCredential({ id: "zen-primary", label: "zen-primary", providerId: "opencode-api", auth: { api_key: "k" } });

    expect((await stat(join(rootDir, "opencode-api", "zen-primary.json"))).mode & 0o777).toBe(0o600);
  });
});
