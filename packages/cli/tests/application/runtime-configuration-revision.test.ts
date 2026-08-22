import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeConfigurationRevision } from "../../src/application/runtime-configuration-revision.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtime configuration revision", () => {
  it("binds exact global, project, and managed-evidence revisions into one secret-free identity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-"));
    const home = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-home-"));
    roots.push(root, home);
    mkdirSync(join(root, ".kiln"), { recursive: true });
    mkdirSync(join(home, "kiln"), { recursive: true });
    const evidenceRevision = `sha256:${"e".repeat(64)}`;
    const globalBytes = `version: "4"\ntargetCatalog:\n  evidenceRevision: ${evidenceRevision}\n  accounts: []\n  accountPolicies: []\n  targets: []\n`;
    const projectBytes = `version: "1"\nprojectName: fixture\n`;
    writeFileSync(join(home, "kiln", "config.yaml"), globalBytes, "utf8");
    writeFileSync(join(root, ".kiln", "kiln.yaml"), projectBytes, "utf8");

    const snapshot = readRuntimeConfigurationRevision(root, { globalConfigPath: join(home, "kiln", "config.yaml") });

    expect(snapshot.revisions).toEqual({
      global: `sha256:${createHash("sha256").update(globalBytes).digest("hex")}`,
      project: `sha256:${createHash("sha256").update(projectBytes).digest("hex")}`,
      "execution-target-evidence": evidenceRevision,
    });
    expect(snapshot.revisionSetId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(snapshot)).not.toContain(root);
    expect(JSON.stringify(snapshot)).not.toContain(home);
  });
});
