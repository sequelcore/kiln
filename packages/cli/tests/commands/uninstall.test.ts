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

      const result = uninstallNativeTargets(join(root, "project"), { target: "codex", userHome: join(root, "home") });

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

  it("uninstalls every managed entry for a harness target", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-codex-group-"));
    const codexConfigPath = join(root, "home", ".codex", "config.toml");
    const codexAgentPath = join(root, "home", ".codex", "agents", "planner.md");
    const codexSkillPath = join(root, "home", ".codex", "skills", "planner", "SKILL.md");
    const opencodeAgentPath = join(root, "home", ".config", "opencode", "agents", "planner.md");
    const kilnDir = join(root, "project", ".kiln");
    const document = {
      model: "gpt-5.4",
      sandbox_mode: "workspace-write",
      mcp_servers: { fixture: { command: "node", args: ["fixture.mjs"] } },
    };
    const codexAgent = "# Planner\n";
    const codexSkill = "# Skill\n";
    const opencodeAgent = "# OpenCode Planner\n";

    try {
      writeFileSyncRecursive(codexConfigPath, stringifyToml(document), "utf-8");
      writeFileSyncRecursive(codexAgentPath, codexAgent, "utf-8");
      writeFileSyncRecursive(codexSkillPath, codexSkill, "utf-8");
      writeFileSyncRecursive(opencodeAgentPath, opencodeAgent, "utf-8");

      let state = emptyNativeProjectionInstallState();
      state = upsertNativeProjectionTargetState(
        state,
        createNativeProjectionSnapshot({
          targetId: "codex-config",
          filePath: codexConfigPath,
          document,
          managedFields: ["sandbox_mode"],
          updatedAt: "2026-05-06T12:00:00.000Z",
        }),
      );
      state = upsertNativeProjectionTargetState(
        state,
        createNativeProjectionSnapshot({
          targetId: "mcp:codex",
          filePath: codexConfigPath,
          document,
          managedFields: ["/mcp_servers/fixture"],
          updatedAt: "2026-05-06T12:00:00.000Z",
        }),
      );
      state = upsertNativeProjectionTargetState(
        state,
        createNativeProjectionFileSnapshot({
          targetId: "codex-agent:planner",
          filePath: codexAgentPath,
          content: codexAgent,
          updatedAt: "2026-05-06T12:00:00.000Z",
        }),
      );
      state = upsertNativeProjectionTargetState(
        state,
        createNativeProjectionFileSnapshot({
          targetId: "codex-skill:planner/SKILL.md",
          filePath: codexSkillPath,
          content: codexSkill,
          updatedAt: "2026-05-06T12:00:00.000Z",
        }),
      );
      state = upsertNativeProjectionTargetState(
        state,
        createNativeProjectionFileSnapshot({
          targetId: "opencode-agent:planner",
          filePath: opencodeAgentPath,
          content: opencodeAgent,
          updatedAt: "2026-05-06T12:00:00.000Z",
        }),
      );
      writeNativeProjectionInstallState(kilnDir, state);

      const result = uninstallNativeTargets(join(root, "project"), { target: "codex" });

      expect(result).toEqual({
        removed: ["codex-config", "mcp:codex", "codex-agent:planner", "codex-skill:planner/SKILL.md"],
        skipped: [],
        errors: [],
      });
      expect(parseToml(readFileSync(codexConfigPath, "utf-8"))).toEqual({
        model: "gpt-5.4",
      });
      expect(() => readFileSync(codexAgentPath, "utf-8")).toThrow();
      expect(() => readFileSync(codexSkillPath, "utf-8")).toThrow();
      expect(readFileSync(opencodeAgentPath, "utf-8")).toBe(opencodeAgent);
      expect(Object.keys(readNativeProjectionInstallState(kilnDir).targets)).toEqual(["opencode-agent:planner"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats harness uninstall with no recorded targets as a no-op", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-empty-harness-"));

    try {
      const result = uninstallNativeTargets(join(root, "project"), { target: "codex" });

      expect(result).toEqual({
        removed: [],
        skipped: [],
        errors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats global instruction group uninstall as a no-op when no shims are recorded", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-empty-instructions-"));

    try {
      const result = uninstallNativeTargets(join(root, "project"), { target: "global-instructions" });

      expect(result).toEqual({
        removed: [],
        skipped: [],
        errors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uninstalls only recorded global instruction shims for the group target", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-instructions-"));
    const codexPath = join(root, "home", ".codex", "AGENTS.md");
    const kilnDir = join(root, "project", ".kiln");
    const content = "# Codex global instructions\n";

    try {
      writeFileSyncRecursive(codexPath, content, "utf-8");
      writeNativeProjectionInstallState(
        kilnDir,
        upsertNativeProjectionTargetState(
          emptyNativeProjectionInstallState(),
          createNativeProjectionFileSnapshot({
            targetId: "codex-global-instructions",
            filePath: codexPath,
            content,
            updatedAt: "2026-07-04T00:00:00.000Z",
          }),
        ),
      );

      const result = uninstallNativeTargets(join(root, "project"), { target: "instructions" });

      expect(result).toEqual({
        removed: ["codex-global-instructions"],
        skipped: [],
        errors: [],
      });
      expect(() => readFileSync(codexPath, "utf-8")).toThrow();
      expect(readNativeProjectionInstallState(kilnDir).targets).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports exact global instruction aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-uninstall-codex-instructions-"));
    const codexPath = join(root, "home", ".codex", "AGENTS.md");
    const kilnDir = join(root, "project", ".kiln");
    const content = "# Codex global instructions\n";

    try {
      writeFileSyncRecursive(codexPath, content, "utf-8");
      writeNativeProjectionInstallState(
        kilnDir,
        upsertNativeProjectionTargetState(
          emptyNativeProjectionInstallState(),
          createNativeProjectionFileSnapshot({
            targetId: "codex-global-instructions",
            filePath: codexPath,
            content,
            updatedAt: "2026-07-04T00:00:00.000Z",
          }),
        ),
      );

      const result = uninstallNativeTargets(join(root, "project"), { target: "codex-instructions" });

      expect(result).toEqual({
        removed: ["codex-global-instructions"],
        skipped: [],
        errors: [],
      });
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
    };
    const drifted = {
      permission: { default: "deny" },
      theme: "ocean",
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
            managedFields: ["permission"],
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
    };
    const drifted = {
      permission: { default: "deny" },
      theme: "ocean",
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
            managedFields: ["permission"],
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
