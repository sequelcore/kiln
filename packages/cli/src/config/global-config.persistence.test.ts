import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultGlobalConfig, mutateGlobalConfig, resolveGlobalConfigPath } from "./global-config.js";

describe("global config persistence", () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let fixtureRoot: string | undefined;

  afterEach(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  });

  it("backs up the exact invalid bytes inside the owned mutation before replacement", () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "kiln-global-config-"));
    process.env.XDG_CONFIG_HOME = fixtureRoot;
    const configPath = resolveGlobalConfigPath();
    const invalidBytes = "version: [\n";
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, invalidBytes, "utf-8");

    const result = mutateGlobalConfig(
      () => defaultGlobalConfig(),
      { invalidCurrent: "backup-and-replace" },
    );

    expect(result.invalidBackupPath).toBeDefined();
    expect(readFileSync(result.invalidBackupPath!, "utf-8")).toBe(invalidBytes);
    expect(readFileSync(configPath, "utf-8")).toContain('version: "2"');
  });
});
