import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { backupNativeProjectionFile } from "../../src/config/native-projection-backup.js";

describe("backupNativeProjectionFile", () => {
  it("backs up an existing native projection file under the project kiln directory", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-"));
    const kilnDir = join(root, "project", ".kiln");
    const nativePath = join(root, "home", ".codex", "skills", "planner", "SKILL.md");

    try {
      writeFileSyncRecursive(nativePath, "# Planner\n", "utf-8");

      const backupPath = backupNativeProjectionFile({
        kilnDir,
        targetId: "codex-skill:planner/SKILL.md",
        filePath: nativePath,
        timestamp: "2026-05-06T12:00:00.000Z",
      });

      expect(backupPath).toBe(join(
        kilnDir,
        "backups",
        "codex-skill_planner_SKILL.md",
        "2026-05-06T12-00-00-000Z-SKILL.md.bak",
      ));
      expect(readFileSync(backupPath!, "utf-8")).toBe("# Planner\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not create a backup when the native projection file does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-missing-"));
    const kilnDir = join(root, "project", ".kiln");

    try {
      const backupPath = backupNativeProjectionFile({
        kilnDir,
        targetId: "codex-config",
        filePath: join(root, "home", ".codex", "config.toml"),
        timestamp: "2026-05-06T12:00:00.000Z",
      });

      expect(backupPath).toBeUndefined();
      expect(() => readdirSync(join(kilnDir, "backups"))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves binary projection content", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-binary-"));
    const kilnDir = join(root, "project", ".kiln");
    const nativePath = join(root, "home", ".codex", "skills", "visual", "assets", "icon.png");
    const content = Uint8Array.from([0, 255, 17, 34]);

    try {
      mkdirSync(dirname(nativePath), { recursive: true });
      writeFileSync(nativePath, content);

      const backupPath = backupNativeProjectionFile({
        kilnDir,
        targetId: "codex-skill:visual/assets/icon.png",
        filePath: nativePath,
        timestamp: "2026-05-06T12:00:00.000Z",
      });

      expect(readFileSync(backupPath!)).toEqual(Buffer.from(content));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function writeFileSyncRecursive(path: string, content: string, encoding: BufferEncoding): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, encoding);
}
