import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { uninstallNativeTargets } from "../../src/commands/uninstall.js";
import {
  createNativeProjectionFileSnapshot,
  createNativeProjectionSnapshot,
  emptyNativeProjectionInstallState,
  readNativeProjectionInstallState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "../../src/config/native-projection-state.js";

describe("uninstallNativeTargets", () => {
  it("strips only managed TOML fields and removes target install state", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-codex-"));
    const codexConfigPath = join(root, "home", ".codex", "config.toml");
    const kilnDir = join(root, "project", ".kiln");
    const document = {
      model: "gpt-5.4",
      approval_policy: "on-request",
      sandbox_mode: "workspace-write",
      projects: { default: "kiln" },
      kiln: {
        permission_sync: { backend: "codex" },
        legacy: "keep",
      },
    };

    try {
      writeFileSyncRecursive(codexConfigPath, stringifyToml(document), "utf-8");
      writeNativeProjectionInstallState(
        kilnDir,
        upsertNativeProjectionTargetState(
          emptyNativeProjectionInstallState(),
          createNativeProjectionSnapshot({
            targetId: "codex-config",
            filePath: codexConfigPath,
            document,
            managedFields: ["approval_policy", "sandbox_mode", "kiln.permission_sync"],
            updatedAt: "2026-05-06T12:00:00.000Z",
          }),
        ),
      );

      const result = uninstallNativeTargets(join(root, "project"), { target: "codex" });

      expect(result).toEqual({
        removed: ["codex-config"],
        skipped: [],
        errors: [],
      });
      expect(parseToml(readFileSync(codexConfigPath, "utf-8"))).toEqual({
        model: "gpt-5.4",
        projects: { default: "kiln" },
        kiln: { legacy: "keep" },
      });
      expect(readNativeProjectionInstallState(kilnDir).targets).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips drifted managed fields unless force is set", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-drift-"));
    const opencodeConfigPath = join(root, "home", ".config", "opencode", "opencode.json");
    const kilnDir = join(root, "project", ".kiln");
    const projected = {
      permission: { default: "ask" },
      theme: "ocean",
      kiln: { permissionSync: { backend: "opencode" } },
    };
    const drifted = {
      permission: { default: "deny" },
      theme: "ocean",
      kiln: { permissionSync: { backend: "opencode" } },
    };

    try {
      writeFileSyncRecursive(opencodeConfigPath, `${JSON.stringify(drifted, null, 2)}\n`, "utf-8");
      writeNativeProjectionInstallState(
        kilnDir,
        upsertNativeProjectionTargetState(
          emptyNativeProjectionInstallState(),
          createNativeProjectionSnapshot({
            targetId: "opencode-config",
            filePath: opencodeConfigPath,
            document: projected,
            managedFields: ["permission", "kiln.permissionSync"],
            updatedAt: "2026-05-06T12:00:00.000Z",
          }),
        ),
      );

      const result = uninstallNativeTargets(join(root, "project"), { target: "opencode" });

      expect(result.removed).toEqual([]);
      expect(result.skipped).toEqual(["opencode-config"]);
      expect(result.errors).toEqual([
        "opencode-config: managed field drift detected: permission",
      ]);
      expect(JSON.parse(readFileSync(opencodeConfigPath, "utf-8"))).toEqual(drifted);
      expect(Object.keys(readNativeProjectionInstallState(kilnDir).targets)).toEqual(["opencode-config"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("force strips drifted managed fields and keeps unmanaged fields", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-force-"));
    const opencodeConfigPath = join(root, "home", ".config", "opencode", "opencode.json");
    const kilnDir = join(root, "project", ".kiln");
    const projected = {
      permission: { default: "ask" },
      theme: "ocean",
      kiln: { permissionSync: { backend: "opencode" }, legacy: true },
    };
    const drifted = {
      permission: { default: "deny" },
      theme: "ocean",
      kiln: { permissionSync: { backend: "opencode" }, legacy: true },
    };

    try {
      writeFileSyncRecursive(opencodeConfigPath, `${JSON.stringify(drifted, null, 2)}\n`, "utf-8");
      writeNativeProjectionInstallState(
        kilnDir,
        upsertNativeProjectionTargetState(
          emptyNativeProjectionInstallState(),
          createNativeProjectionSnapshot({
            targetId: "opencode-config",
            filePath: opencodeConfigPath,
            document: projected,
            managedFields: ["permission", "kiln.permissionSync"],
            updatedAt: "2026-05-06T12:00:00.000Z",
          }),
        ),
      );

      const result = uninstallNativeTargets(join(root, "project"), { target: "opencode", force: true });

      expect(result).toEqual({
        removed: ["opencode-config"],
        skipped: [],
        errors: [],
      });
      expect(JSON.parse(readFileSync(opencodeConfigPath, "utf-8"))).toEqual({
        theme: "ocean",
        kiln: { legacy: true },
      });
      expect(readNativeProjectionInstallState(kilnDir).targets).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes whole-file managed targets when uninstalling hooks", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-hook-file-"));
    const hookPath = join(root, "project", ".claude", "hooks", "autoformat.sh");
    const kilnDir = join(root, "project", ".kiln");
    const content = "#!/bin/sh\nexit 0\n";

    try {
      writeFileSyncRecursive(hookPath, content, "utf-8");
      writeNativeProjectionInstallState(
        kilnDir,
        upsertNativeProjectionTargetState(
          emptyNativeProjectionInstallState(),
          createNativeProjectionFileSnapshot({
            targetId: "claude-autoformat-hook",
            filePath: hookPath,
            content,
            updatedAt: "2026-05-06T12:00:00.000Z",
          }),
        ),
      );

      const result = uninstallNativeTargets(join(root, "project"), { target: "claude-autoformat-hook" });

      expect(result).toEqual({
        removed: ["claude-autoformat-hook"],
        skipped: [],
        errors: [],
      });
      expect(() => readFileSync(hookPath, "utf-8")).toThrow();
      expect(readNativeProjectionInstallState(kilnDir).targets).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips drifted whole-file managed targets unless force is set", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-hook-file-drift-"));
    const hookPath = join(root, "project", ".claude", "hooks", "autoformat.sh");
    const kilnDir = join(root, "project", ".kiln");
    const projected = "#!/bin/sh\nexit 0\n";
    const drifted = "#!/bin/sh\necho user drift\n";

    try {
      writeFileSyncRecursive(hookPath, drifted, "utf-8");
      writeNativeProjectionInstallState(
        kilnDir,
        upsertNativeProjectionTargetState(
          emptyNativeProjectionInstallState(),
          createNativeProjectionFileSnapshot({
            targetId: "claude-autoformat-hook",
            filePath: hookPath,
            content: projected,
            updatedAt: "2026-05-06T12:00:00.000Z",
          }),
        ),
      );

      const result = uninstallNativeTargets(join(root, "project"), { target: "claude-autoformat-hook" });

      expect(result.removed).toEqual([]);
      expect(result.skipped).toEqual(["claude-autoformat-hook"]);
      expect(result.errors).toEqual([
        "claude-autoformat-hook: managed file drift detected: $file",
      ]);
      expect(readFileSync(hookPath, "utf-8")).toBe(drifted);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function writeFileSyncRecursive(path: string, content: string, encoding: BufferEncoding): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, encoding);
}
