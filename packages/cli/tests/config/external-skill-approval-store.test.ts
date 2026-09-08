import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readExternalSkillApprovals,
  writeExternalSkillApproval,
} from "../../src/config/external-skill-approval-store.js";

describe("external skill approval storage", () => {
  const roots: string[] = [];
  const home = () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-approval-"));
    roots.push(root);
    return root;
  };
  const approval = {
    version: 1 as const,
    harness: "codex" as const,
    sourceId: "plugin:one",
    packageDigest: `sha256:${"a".repeat(64)}`,
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("keeps approvals outside config and updates one source without losing another", () => {
    const root = home();
    expect(readExternalSkillApprovals([approval.sourceId], root)).toEqual([]);
    writeExternalSkillApproval(approval, root);
    const other = { ...approval, sourceId: "plugin:two" };
    writeExternalSkillApproval(other, root);
    const changed = { ...approval, packageDigest: `sha256:${"b".repeat(64)}` };
    writeExternalSkillApproval(changed, root);
    expect(readExternalSkillApprovals([approval.sourceId, other.sourceId], root)).toEqual([changed, other]);
    expect(readdirSync(join(root, ".kiln"))).toEqual(["evidence"]);
    expect(readdirSync(join(root, ".kiln", "evidence", "external-skills", "codex"))).toHaveLength(2);
  });

  it("rejects corrupt, mismatched, and unknown evidence fields", () => {
    const root = home();
    writeExternalSkillApproval(approval, root);
    const directory = join(root, ".kiln", "evidence", "external-skills", "codex");
    const filename = readdirSync(directory)[0]!;
    const path = join(directory, filename);
    const original = readFileSync(path, "utf8");
    for (const value of [
      { ...approval, sourceId: "another" },
      { ...approval, version: 2 },
      { ...approval, packageDigest: "bad" },
      { ...approval, extra: true },
    ]) {
      writeFileSync(path, JSON.stringify(value));
      expect(() => readExternalSkillApprovals([approval.sourceId], root)).toThrow("Invalid approval evidence");
    }
    writeFileSync(path, "{");
    expect(() => readExternalSkillApprovals([approval.sourceId], root)).toThrow();
    writeFileSync(path, original);
    expect(readExternalSkillApprovals([approval.sourceId], root)).toEqual([approval]);
  });

  it("uses the configured Kiln home when no test home is supplied", () => {
    const root = home();
    vi.stubEnv("XDG_CONFIG_HOME", root);
    writeExternalSkillApproval(approval);
    expect(readExternalSkillApprovals([approval.sourceId])).toEqual([approval]);
    expect(readdirSync(join(root, "kiln", "evidence", "external-skills", "codex"))).toHaveLength(1);
  });
});
