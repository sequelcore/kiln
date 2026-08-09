import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readSkillCatalogStatus } from "../../src/config/skill-catalog-status.js";
import {
  createNativeProjectionFileSnapshot,
  emptyNativeProjectionInstallState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "../../src/config/native-projection-state.js";

describe("skill catalog status path safety", () => {
  it("does not admit an unsafe flat skill name", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectSkills = join(root, "project", ".kiln", "skills");
    mkdirSync(projectSkills, { recursive: true });
    writeFileSync(join(projectSkills, "unsafe.md"), "---\nname: ../escape\ndescription: invalid\n---\n", { encoding: "utf8", flag: "w" });

    const snapshot = readSkillCatalogStatus({
      projectPath: join(root, "project"),
      userHome: join(root, "user"),
      skillConfig: { builtin: { enabled: false } },
    });

    expect(snapshot.entries).toEqual([]);
  });

  it("reports identity mismatch as drift instead of blessing canonical bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = join(root, "project");
    const userHome = join(root, "user");
    const sourceDir = join(userHome, ".kiln", "skills", "planner");
    const targetPath = join(userHome, ".codex", "skills", "planner", "SKILL.md");
    const content = "---\nname: planner\ndescription: valid\n---\n";
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(join(userHome, ".codex", "skills", "planner"), { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), content, { encoding: "utf8", flag: "w" });
    writeFileSync(targetPath, content, { encoding: "utf8", flag: "w" });
    const target = createNativeProjectionFileSnapshot({
      targetId: "codex-skill:planner/SKILL.md",
      filePath: join(root, "outside", "SKILL.md"),
      content,
      harness: "codex",
      sourceIdentity: "skill:planner/SKILL.md",
    });
    writeNativeProjectionInstallState(
      join(projectPath, ".kiln"),
      upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), target),
    );

    const snapshot = readSkillCatalogStatus({
      projectPath,
      userHome,
      skillConfig: { builtin: { enabled: false } },
    });
    const planner = snapshot.entries.find((entry) => entry.name === "planner");

    expect(planner?.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "codex", status: "drifted" }),
    ]));
  });

  it("reports a legacy snapshot with canonical bytes as projected", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = join(root, "project");
    const userHome = join(root, "user");
    const sourceDir = join(userHome, ".kiln", "skills", "planner");
    const targetPath = join(userHome, ".codex", "skills", "planner", "SKILL.md");
    const content = "---\nname: planner\ndescription: valid\n---\n";
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(join(userHome, ".codex", "skills", "planner"), { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), content, { encoding: "utf8", flag: "w" });
    writeFileSync(targetPath, content, { encoding: "utf8", flag: "w" });
    const current = createNativeProjectionFileSnapshot({
      targetId: "codex-skill:planner/SKILL.md",
      filePath: targetPath,
      content: "historical\n",
    });
    const canonical = createNativeProjectionFileSnapshot({
      targetId: "codex-skill:planner/SKILL.md",
      filePath: targetPath,
      content,
    });
    const legacy = {
      ...current,
      projectionKind: undefined,
      harness: undefined,
      sourceIdentity: undefined,
      installedContentHash: canonical.contentHash,
    };
    writeNativeProjectionInstallState(
      join(projectPath, ".kiln"),
      upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), legacy),
    );

    const snapshot = readSkillCatalogStatus({
      projectPath,
      userHome,
      skillConfig: { builtin: { enabled: false } },
    });
    const planner = snapshot.entries.find((entry) => entry.name === "planner");

    expect(planner?.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "codex", status: "projected" }),
    ]));
  });
});
