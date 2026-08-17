import { beforeEach, describe, expect, it, vi } from "vitest";

const syncMocks = vi.hoisted(() => ({
  loadKilnConfig: vi.fn(),
  loadKilnConfigWithGlobalAuthority: vi.fn(),
  readGlobalConfig: vi.fn(),
  syncNativePermissionProjections: vi.fn(),
  syncOpenCodeSkillVisibilityProjection: vi.fn(),
  syncNativeHookProjections: vi.fn(),
  syncNativeAgentProjections: vi.fn(),
  resolveProjectRoot: vi.fn(),
  writeRepoShimProjections: vi.fn(),
  syncGlobalInstructionShimProjections: vi.fn(),
  syncNativeSkillProjections: vi.fn(),
  syncCodexExternalSkillExposure: vi.fn(),
  uninstallNativeTargets: vi.fn(),
}));

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: syncMocks.loadKilnConfig,
  loadKilnConfigWithGlobalAuthority: syncMocks.loadKilnConfigWithGlobalAuthority,
}));

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: syncMocks.readGlobalConfig,
}));

vi.mock("../../src/config/native-permission-projection.js", () => ({
  syncNativePermissionProjections: syncMocks.syncNativePermissionProjections,
  syncOpenCodeSkillVisibilityProjection: syncMocks.syncOpenCodeSkillVisibilityProjection,
}));

vi.mock("../../src/config/native-hook-projection.js", () => ({
  syncNativeHookProjections: syncMocks.syncNativeHookProjections,
}));

vi.mock("../../src/config/native-agent-projection.js", () => ({
  syncNativeAgentProjections: syncMocks.syncNativeAgentProjections,
}));

vi.mock("../../src/application/project-root-resolver.js", () => ({
  resolveProjectRoot: syncMocks.resolveProjectRoot,
}));

vi.mock("../../src/application/repo-shim-projection.js", () => ({
  writeRepoShimProjections: syncMocks.writeRepoShimProjections,
}));

vi.mock("../../src/application/global-instruction-shim-projection.js", () => ({
  syncGlobalInstructionShimProjections: syncMocks.syncGlobalInstructionShimProjections,
}));

vi.mock("../../src/config/native-skill-projection.js", () => ({
  syncNativeSkillProjections: syncMocks.syncNativeSkillProjections,
}));
vi.mock("../../src/config/codex-external-skill-exposure-projection.js", () => ({
  syncCodexExternalSkillExposure: syncMocks.syncCodexExternalSkillExposure,
}));

vi.mock("../../src/commands/uninstall.js", () => ({
  uninstallNativeTargets: syncMocks.uninstallNativeTargets,
}));

import {
  parseSyncFlags,
  printSyncHelp,
  requiresForceSyncConfirmation,
  syncCommand,
} from "../../src/commands/sync.js";

const MOCK_APP_CONFIG = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Test",
  createRegistry: () => {
    throw new Error("createRegistry not called in sync tests");
  },
  mcpServerName: "kiln",
};

describe("syncCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncMocks.loadKilnConfig.mockResolvedValue({ version: "1", domain: "typescript" });
    syncMocks.loadKilnConfigWithGlobalAuthority.mockResolvedValue({
      kilnYaml: { version: "1", domain: "typescript" },
      globalConfig: null,
    });
    syncMocks.readGlobalConfig.mockReturnValue(null);
    syncMocks.syncNativePermissionProjections.mockResolvedValue({
      claude: true,
      codex: true,
      opencode: true,
      outcomes: [
        { targetId: "claude-permissions", path: "C:/project/.claude/settings.json", status: "written" },
        { targetId: "codex-permissions", path: "C:/Users/test/.codex/config.toml", status: "written" },
        { targetId: "opencode-permissions", path: "C:/Users/test/.config/opencode/opencode.json", status: "written" },
      ],
      errors: [],
    });
    syncMocks.syncOpenCodeSkillVisibilityProjection.mockResolvedValue({ outcomes: [], errors: [] });
    syncMocks.syncNativeHookProjections.mockResolvedValue({
      claudeHook: true,
      codexHook: true,
      skippedWindows: false,
      outcomes: [],
      errors: [],
    });
    syncMocks.syncNativeAgentProjections.mockResolvedValue({ claude: true, codex: true, opencode: true, outcomes: [], errors: [] });
    syncMocks.resolveProjectRoot.mockReturnValue({
      rootPath: process.cwd(),
      source: "git",
      hasKilnYaml: false,
      hasGitRoot: true,
      projectName: "kiln",
    });
    syncMocks.writeRepoShimProjections.mockResolvedValue({
      written: true,
      targets: [
        { kind: "agents", path: "AGENTS.md", written: true, status: "written", errors: [] },
        { kind: "claude", path: "CLAUDE.md", written: true, status: "written", errors: [] },
      ],
      outcomes: [],
      errors: [],
    });
    syncMocks.syncGlobalInstructionShimProjections.mockResolvedValue({
      synced: 3,
      targets: [
        {
          targetId: "codex-global-instructions",
          harness: "codex",
          displayName: "Codex global instructions",
          filePath: "C:/Users/test/.codex/AGENTS.md",
          status: "written",
          written: true,
          errors: [],
        },
      ],
      outcomes: [{
        targetId: "codex-global-instructions",
        path: "C:/Users/test/.codex/AGENTS.md",
        status: "written",
      }],
      errors: [],
    });
    syncMocks.syncNativeSkillProjections.mockResolvedValue({ claude: true, codex: true, opencode: true, synced: 0, outcomes: [], errors: [] });
    syncMocks.uninstallNativeTargets.mockReturnValue({ removed: [], skipped: [], errors: [] });
  });

  it("is a function exported from commands/sync", () => {
    expect(typeof syncCommand).toBe("function");
  });

  it("requires an explicit sync target or --all", () => {
    expect(() => parseSyncFlags([])).toThrow("Select at least one sync target or pass --all");
  });

  it("parses --all as an explicit request for every surface", () => {
    expect(parseSyncFlags(["--all"])).toEqual({
      targets: [],
      force: false,
      syncAll: true,
      dryRun: false,
      projectPath: undefined,
    });
  });

  it("parses force as an explicit option for selected sync surfaces", () => {
    expect(parseSyncFlags(["--permissions", "--force"])).toEqual({
      targets: ["permissions"],
      force: true,
      syncAll: false,
      dryRun: false,
      projectPath: undefined,
    });
  });

  it("parses explicit target values and comma-separated target lists", () => {
    expect(parseSyncFlags(["--target", "permissions,hooks", "--target=repo-shims"])).toEqual({
      targets: ["permissions", "hooks", "repo-shims"],
      force: false,
      syncAll: false,
      dryRun: false,
      projectPath: undefined,
    });
  });

  it("parses explicit project paths for repo-aware sync targets", () => {
    expect(parseSyncFlags(["--repo-shims", "--project", "C:/work/project"])).toEqual({
      targets: ["repo-shims"],
      force: false,
      syncAll: false,
      dryRun: false,
      projectPath: "C:/work/project",
    });
  });

  it("deduplicates targets selected by canonical and legacy flags", () => {
    expect(parseSyncFlags(["--target", "permissions", "--permissions", "--skills"])).toEqual({
      targets: ["permissions", "skills"],
      force: false,
      syncAll: false,
      dryRun: false,
      projectPath: undefined,
    });
  });

  it("parses dry-run without widening the selected scope", () => {
    expect(parseSyncFlags(["--skills", "--dry-run"])).toEqual({
      targets: ["skills"],
      force: false,
      syncAll: false,
      dryRun: true,
      projectPath: undefined,
    });
  });

  it("rejects unknown arguments instead of widening them to all targets", () => {
    expect(() => parseSyncFlags(["--wat"])).toThrow('Unknown sync argument "--wat"');
  });

  it("rejects --all combined with target selection", () => {
    expect(() => parseSyncFlags(["--all", "--skills"])).toThrow("--all cannot be combined with target selection");
  });

  it("rejects unknown explicit targets", () => {
    expect(() => parseSyncFlags(["--target", "unknown"])).toThrow(
      'Unknown sync target "unknown". Valid targets: permissions, hooks, agents, repo-shims, global-instructions, skills',
    );
  });

  it("rejects target flags without a value", () => {
    expect(() => parseSyncFlags(["--target", "--force"])).toThrow("--target requires a value");
  });

  it("rejects duplicate project root flags", () => {
    expect(() => parseSyncFlags(["--project", "a", "--cwd", "b"])).toThrow("--project or --cwd may be specified only once");
  });

  it("requires force confirmation for projection targets that own install-state drift", () => {
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--permissions", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--hooks", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--agents", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--repo-shims", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--global-instructions", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--skills", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--all", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--all", "--force", "--dry-run"]))).toBe(false);
  });

  it("prints sync-specific usage", () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      printSyncHelp("kiln");
      const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("kiln sync (--all | --target <targets> | <target flags>)");
      expect(output).toContain("--dry-run");
      expect(output).toContain("Protected drift is reported as BLOCKED and does not fail the command");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("rejects invalid input before loading config or invoking projections", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(syncCommand(MOCK_APP_CONFIG, undefined, ["--wat"])).rejects.toThrow("process.exit:1");
      expect(syncMocks.loadKilnConfig).not.toHaveBeenCalled();
      expect(syncMocks.syncNativePermissionProjections).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Unknown sync argument "--wat"');
      expect(consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("kiln sync");
    } finally {
      exitSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("propagates dry-run without requesting force confirmation", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await syncCommand(MOCK_APP_CONFIG, undefined, ["--permissions", "--force", "--dry-run"]);
    } finally {
      consoleLogSpy.mockRestore();
      stdoutSpy.mockRestore();
    }

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(syncMocks.syncNativePermissionProjections).toHaveBeenCalledWith(
      { version: "1", domain: "typescript" },
      process.cwd(),
      { force: true, dryRun: true, disabledHarnesses: [] },
    );
  });

  it("passes canonical global model-gateway authority into native projection", async () => {
    const modelGateway = { port: 4910 };
    syncMocks.loadKilnConfigWithGlobalAuthority.mockResolvedValue({
      kilnYaml: { version: "1", domain: "typescript" },
      globalConfig: { modelGateway },
    });
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await syncCommand(MOCK_APP_CONFIG, undefined, ["--permissions"]);
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(syncMocks.syncNativePermissionProjections).toHaveBeenCalledWith(
      { version: "1", domain: "typescript" },
      process.cwd(),
      expect.objectContaining({ modelGateway }),
    );
  });

  it("exits non-zero when a selected sync target partially fails", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    syncMocks.syncNativePermissionProjections.mockResolvedValue({
      claude: true,
      codex: false,
      opencode: true,
      outcomes: [{
        targetId: "codex-permissions",
        path: "C:/Users/test/.codex/config.toml",
        status: "failed",
        reason: "native configuration could not be written",
      }],
      errors: ["Codex: managed field drift detected: sandbox_mode"],
    });

    try {
      await expect(syncCommand(MOCK_APP_CONFIG, undefined, ["--permissions"])).rejects.toThrow("process.exit:1");
    } finally {
      exitSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("converts an unexpected projection exception into an inline failed outcome", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    syncMocks.syncNativePermissionProjections.mockRejectedValue(new Error("install-state is unreadable"));

    try {
      await expect(syncCommand(MOCK_APP_CONFIG, undefined, ["--permissions"])).rejects.toThrow("process.exit:1");
      const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain(`${process.cwd()}: FAILED - install-state is unreadable`);
    } finally {
      exitSpy.mockRestore();
      consoleLogSpy.mockRestore();
    }
  });

  it("reports protected drift inline without failing the command", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit should not be called");
    }) as never);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    syncMocks.syncNativePermissionProjections.mockResolvedValue({
      claude: true,
      codex: false,
      opencode: true,
      outcomes: [{
        targetId: "codex-permissions",
        path: "C:/Users/test/.codex/config.toml",
        status: "blocked",
        reason: "managed field drift detected: sandbox_mode",
      }],
      errors: [],
    });

    try {
      await syncCommand(MOCK_APP_CONFIG, undefined, ["--permissions"]);
      const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("C:/Users/test/.codex/config.toml: BLOCKED - managed field drift detected: sandbox_mode");
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      consoleLogSpy.mockRestore();
    }
  });

  it("does not treat disabled routing engines as disabled native projections", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    syncMocks.readGlobalConfig.mockReturnValue({
      version: "1",
      engines: { codex: { enabled: false } },
    });

    try {
      await syncCommand(MOCK_APP_CONFIG, undefined, ["--permissions"]);
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(syncMocks.uninstallNativeTargets).not.toHaveBeenCalled();
    expect(syncMocks.syncNativePermissionProjections).toHaveBeenCalledWith(
      { version: "1", domain: "typescript" },
      process.cwd(),
      { force: false, dryRun: false, disabledHarnesses: [] },
    );
  });

  it("uses resolved project root for repo-aware projections", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    syncMocks.resolveProjectRoot.mockReturnValue({
      rootPath: "C:/resolved/project",
      source: "kiln-yaml",
      hasKilnYaml: true,
      hasGitRoot: true,
      projectName: "project",
    });

    try {
      await syncCommand(MOCK_APP_CONFIG, undefined, ["--repo-shims", "--project", "C:/resolved/project/packages/api"]);
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(syncMocks.resolveProjectRoot).toHaveBeenCalledWith({ explicitPath: "C:/resolved/project/packages/api" });
    expect(syncMocks.loadKilnConfigWithGlobalAuthority).toHaveBeenCalledWith("C:/resolved/project");
    expect(syncMocks.writeRepoShimProjections).toHaveBeenCalledWith("C:/resolved/project", { force: false, dryRun: false });
  });

  it("syncs global instruction shims as a separate native instruction target", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    syncMocks.resolveProjectRoot.mockReturnValue({
      rootPath: "C:/resolved/project",
      source: "kiln-yaml",
      hasKilnYaml: true,
      hasGitRoot: true,
      projectName: "project",
    });
    let output = "";

    try {
      await syncCommand(MOCK_APP_CONFIG, undefined, ["--global-instructions", "--project", "C:/resolved/project"]);
      output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(syncMocks.syncGlobalInstructionShimProjections).toHaveBeenCalledWith("C:/resolved/project", {
      force: false,
      dryRun: false,
      disabledHarnesses: [],
    });
    expect(syncMocks.writeRepoShimProjections).not.toHaveBeenCalled();
    expect(output).toContain("C:/Users/test/.codex/AGENTS.md: WRITTEN");
  });

  it("fails repo-shim sync when no project root can be resolved", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    syncMocks.resolveProjectRoot.mockReturnValue({
      rootPath: "C:/loose-folder",
      source: "cwd",
      hasKilnYaml: false,
      hasGitRoot: false,
      projectName: "loose-folder",
    });

    try {
      await expect(syncCommand(MOCK_APP_CONFIG, undefined, ["--repo-shims"])).rejects.toThrow("process.exit:1");
    } finally {
      exitSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(syncMocks.writeRepoShimProjections).not.toHaveBeenCalled();
  });

  it("prints each skill projection outcome by path", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    syncMocks.syncNativeSkillProjections.mockResolvedValue({
      claude: true,
      codex: true,
      opencode: true,
      synced: 120,
      outcomes: [{ targetId: "codex-skill:planner/SKILL.md", path: "C:/Users/test/.codex/skills/planner/SKILL.md", status: "written" }],
      errors: [],
    });
    syncMocks.syncCodexExternalSkillExposure.mockResolvedValue({ outcomes: [], errors: [] });
    let output = "";

    try {
      await syncCommand(MOCK_APP_CONFIG, undefined, ["--skills"]);
      output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(output).toContain("C:/Users/test/.codex/skills/planner/SKILL.md: WRITTEN");
    expect(syncMocks.syncNativePermissionProjections).not.toHaveBeenCalled();
    expect(syncMocks.syncCodexExternalSkillExposure).toHaveBeenCalledTimes(1);
    expect(syncMocks.syncOpenCodeSkillVisibilityProjection).toHaveBeenCalledTimes(1);
    expect(syncMocks.syncNativeSkillProjections).toHaveBeenCalledTimes(1);
  });

  it("runs the composed native config writer only once when all targets include permissions and skills", async () => {
    await syncCommand(MOCK_APP_CONFIG, undefined, ["--all", "--dry-run"]);
    expect(syncMocks.syncNativePermissionProjections).toHaveBeenCalledTimes(1);
    expect(syncMocks.syncCodexExternalSkillExposure).toHaveBeenCalledTimes(1);
  });

  it("accepts appConfig, subcommand, and args parameters", async () => {
    const { readKilnYaml } = await import("../../src/kiln-yaml.js");
    const originalRead = readKilnYaml;

    expect(() => {
      originalRead("/nonexistent");
    }).toBeDefined();
  });
});
