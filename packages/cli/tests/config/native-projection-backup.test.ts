import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  backupNativeProjectionFile,
  DEFAULT_NATIVE_PROJECTION_BACKUP_RETENTION,
} from "../../src/config/native-projection-backup.js";

describe("backupNativeProjectionFile", () => {
  it("backs up an existing native projection file under the project kiln directory", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-"));
    const kilnDir = join(root, "private-project-state");
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
    const kilnDir = join(root, "private-project-state");

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

  it("prunes to the default retention so a caller cannot grow backups without bound", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-retain-default-"));
    const kilnDir = join(root, "private-project-state");
    const nativePath = join(root, "home", ".codex", "config.toml");

    try {
      writeFileSyncRecursive(nativePath, "model = 'a'\n", "utf-8");
      for (const day of ["01", "02", "03", "04", "05"]) {
        backupNativeProjectionFile({
          kilnDir,
          targetId: "codex-config",
          filePath: nativePath,
          timestamp: `2026-05-${day}T12:00:00.000Z`,
        });
      }

      expect(readdirSync(join(kilnDir, "backups", "codex-config")).sort()).toEqual([
        "2026-05-03T12-00-00-000Z-config.toml.bak",
        "2026-05-04T12-00-00-000Z-config.toml.bak",
        "2026-05-05T12-00-00-000Z-config.toml.bak",
      ]);
      expect(DEFAULT_NATIVE_PROJECTION_BACKUP_RETENTION).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a retention that would discard the backup it was asked to write", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-retain-invalid-"));
    const kilnDir = join(root, "private-project-state");
    const nativePath = join(root, "home", ".codex", "config.toml");

    try {
      writeFileSyncRecursive(nativePath, "model = 'a'\n", "utf-8");
      for (const retain of [0, -1, 1.5]) {
        expect(() => backupNativeProjectionFile({
          kilnDir,
          targetId: "codex-config",
          filePath: nativePath,
          timestamp: "2026-05-06T12:00:00.000Z",
          retain,
        })).toThrow(/positive integer/i);
      }
      expect(() => readdirSync(join(kilnDir, "backups"))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prunes oldest backups beyond the retention limit, keeping the newest", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-retain-"));
    const kilnDir = join(root, "private-project-state");
    const nativePath = join(root, "home", ".codex", "auth.json");

    try {
      writeFileSyncRecursive(nativePath, "{}\n", "utf-8");
      for (const day of ["01", "02", "03", "04", "05"]) {
        backupNativeProjectionFile({
          kilnDir,
          targetId: "codex-native-auth",
          filePath: nativePath,
          timestamp: `2026-05-${day}T12:00:00.000Z`,
          retain: 2,
        });
      }

      expect(readdirSync(join(kilnDir, "backups", "codex-native-auth")).sort()).toEqual([
        "2026-05-04T12-00-00-000Z-auth.json.bak",
        "2026-05-05T12-00-00-000Z-auth.json.bak",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scopes pruning per source file so unrelated backups in one target never prune each other", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-scope-"));
    const kilnDir = join(root, "private-project-state");
    const authPath = join(root, "home", ".codex", "auth.json");
    const configPath = join(root, "home", ".codex", "config.toml");

    try {
      writeFileSyncRecursive(authPath, "{}\n", "utf-8");
      writeFileSyncRecursive(configPath, "model = 'a'\n", "utf-8");
      for (const day of ["01", "02", "03"]) {
        backupNativeProjectionFile({
          kilnDir, targetId: "shared", filePath: authPath, timestamp: `2026-05-${day}T12:00:00.000Z`, retain: 1,
        });
        backupNativeProjectionFile({
          kilnDir, targetId: "shared", filePath: configPath, timestamp: `2026-05-${day}T12:00:00.000Z`, retain: 1,
        });
      }

      expect(readdirSync(join(kilnDir, "backups", "shared")).sort()).toEqual([
        "2026-05-03T12-00-00-000Z-auth.json.bak",
        "2026-05-03T12-00-00-000Z-config.toml.bak",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // POSIX-only: Windows ignores mode bits and protects these paths through the
  // user-profile ACL instead. CI runs Linux, so the invariant is enforced there.
  it.skipIf(process.platform === "win32")("writes secret-bearing backups owner-only", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-mode-"));
    const kilnDir = join(root, "private-project-state");
    const nativePath = join(root, "home", ".codex", "auth.json");

    try {
      writeFileSyncRecursive(nativePath, "{}\n", "utf-8");

      const backupPath = backupNativeProjectionFile({
        kilnDir,
        targetId: "codex-native-auth",
        filePath: nativePath,
        timestamp: "2026-05-06T12:00:00.000Z",
        mode: 0o600,
      });

      expect(statSync(backupPath!).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves binary projection content", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-backup-binary-"));
    const kilnDir = join(root, "private-project-state");
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
