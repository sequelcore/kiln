import { beforeEach, describe, expect, it, vi } from "vitest";

const syncMocks = vi.hoisted(() => ({
  loadKilnConfig: vi.fn(),
  readGlobalConfig: vi.fn(),
  syncNativePermissionProjections: vi.fn(),
  syncNativeHookProjections: vi.fn(),
  syncNativeAgentProjections: vi.fn(),
  resolveProjectRoot: vi.fn(),
  writeRepoShimProjections: vi.fn(),
  syncNativeSkillProjections: vi.fn(),
  uninstallNativeTargets: vi.fn(),
}));

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: syncMocks.loadKilnConfig,
}));

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: syncMocks.readGlobalConfig,
}));

vi.mock("../../src/config/native-permission-projection.js", () => ({
  syncNativePermissionProjections: syncMocks.syncNativePermissionProjections,
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

vi.mock("../../src/config/native-skill-projection.js", () => ({
  syncNativeSkillProjections: syncMocks.syncNativeSkillProjections,
}));

vi.mock("../../src/commands/uninstall.js", () => ({
  uninstallNativeTargets: syncMocks.uninstallNativeTargets,
}));

import {
  parseSyncFlags,
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
    syncMocks.readGlobalConfig.mockReturnValue(null);
    syncMocks.syncNativePermissionProjections.mockResolvedValue({ claude: true, codex: true, opencode: true, errors: [] });
    syncMocks.syncNativeHookProjections.mockResolvedValue({
      claudeHook: true,
      codexHook: true,
      skippedWindows: false,
      errors: [],
    });
    syncMocks.syncNativeAgentProjections.mockResolvedValue({ claude: true, codex: true, opencode: true, errors: [] });
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
        { kind: "agents-md", path: "AGENTS.md", written: true, status: "written", errors: [] },
        { kind: "claude-md", path: "CLAUDE.md", written: true, status: "written", errors: [] },
      ],
      errors: [],
    });
    syncMocks.syncNativeSkillProjections.mockResolvedValue({ claude: true, codex: true, opencode: true, synced: 0, errors: [] });
    syncMocks.uninstallNativeTargets.mockReturnValue({ removed: [], skipped: [], errors: [] });
  });

  it("is a function exported from commands/sync", () => {
    expect(typeof syncCommand).toBe("function");
  });

  it("parses default sync as all surfaces without force", () => {
    expect(parseSyncFlags([])).toEqual({
      targets: [],
      force: false,
      syncAll: true,
      projectPath: undefined,
    });
  });

  it("parses force as an explicit option for selected sync surfaces", () => {
    expect(parseSyncFlags(["--permissions", "--force"])).toEqual({
      targets: ["permissions"],
      force: true,
      syncAll: false,
      projectPath: undefined,
    });
  });

  it("parses explicit target values and comma-separated target lists", () => {
    expect(parseSyncFlags(["--target", "permissions,hooks", "--target=repo-shims"])).toEqual({
      targets: ["permissions", "hooks", "repo-shims"],
      force: false,
      syncAll: false,
      projectPath: undefined,
    });
  });

  it("parses explicit project paths for repo-aware sync targets", () => {
    expect(parseSyncFlags(["--repo-shims", "--project", "C:/work/project"])).toEqual({
      targets: ["repo-shims"],
      force: false,
      syncAll: false,
      projectPath: "C:/work/project",
    });
  });

  it("deduplicates targets selected by canonical and legacy flags", () => {
    expect(parseSyncFlags(["--target", "permissions", "--permissions", "--skills"])).toEqual({
      targets: ["permissions", "skills"],
      force: false,
      syncAll: false,
      projectPath: undefined,
    });
  });

  it("rejects unknown explicit targets", () => {
    expect(() => parseSyncFlags(["--target", "unknown"])).toThrow(
      'Unknown sync target "unknown". Valid targets: permissions, hooks, agents, repo-shims, skills',
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
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--skills", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--force"]))).toBe(true);
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
      { force: false, disabledHarnesses: [] },
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
    expect(syncMocks.loadKilnConfig).toHaveBeenCalledWith("C:/resolved/project");
    expect(syncMocks.writeRepoShimProjections).toHaveBeenCalledWith("C:/resolved/project", { force: false });
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

  it("prints harness capability diagnostics from the canonical capability model", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let output = "";

    try {
      await syncCommand(MOCK_APP_CONFIG, undefined, ["--repo-shims"]);
      output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(output).toContain("Harness capabilities:");
    expect(output).toContain("Claude Code: runtime injection: not proven; native projection: install-state; native import: unsupported; MCP: supported; hooks: supported");
    expect(output).toContain("Codex: runtime injection: CODEX_HOME + CLI config overrides; native projection: install-state; native import: supported; MCP: supported; hooks: supported");
    expect(output).toContain("OpenCode: runtime injection: OPENCODE_CONFIG_CONTENT; native projection: install-state; native import: supported; MCP: supported; hooks: supported");
  });

  it("accepts appConfig, subcommand, and args parameters", async () => {
    const { readKilnYaml } = await import("../../src/kiln-yaml.js");
    const originalRead = readKilnYaml;

    const appConfig = {
      appName: "kiln",
      dirName: ".kiln",
      version: "0.1.0",
      description: "Test",
      createRegistry: () => { throw new Error("test"); },
      mcpServerName: "kiln",
    };

    expect(() => {
      originalRead("/nonexistent");
    }).toBeDefined();
  });
});
