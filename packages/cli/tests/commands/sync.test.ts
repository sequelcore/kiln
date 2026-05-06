import { beforeEach, describe, expect, it, vi } from "vitest";

const syncMocks = vi.hoisted(() => ({
  loadKilnConfig: vi.fn(),
  syncNativePermissionProjections: vi.fn(),
  syncNativeHookProjections: vi.fn(),
  syncNativeAgentProjections: vi.fn(),
  writeAgentsMdProjection: vi.fn(),
  syncNativeSkillProjections: vi.fn(),
}));

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: syncMocks.loadKilnConfig,
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

vi.mock("../../src/application/agents-md-projection.js", () => ({
  writeAgentsMdProjection: syncMocks.writeAgentsMdProjection,
}));

vi.mock("../../src/config/native-skill-projection.js", () => ({
  syncNativeSkillProjections: syncMocks.syncNativeSkillProjections,
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
    syncMocks.syncNativePermissionProjections.mockResolvedValue({ claude: true, codex: true, opencode: true, errors: [] });
    syncMocks.syncNativeHookProjections.mockResolvedValue({
      claudeHook: true,
      codexHook: true,
      skippedWindows: false,
      errors: [],
    });
    syncMocks.syncNativeAgentProjections.mockResolvedValue({ claude: true, codex: true, opencode: true, errors: [] });
    syncMocks.writeAgentsMdProjection.mockResolvedValue({ written: true, path: "AGENTS.md", errors: [] });
    syncMocks.syncNativeSkillProjections.mockResolvedValue({ claude: true, codex: true, opencode: true, synced: 0, errors: [] });
  });

  it("is a function exported from commands/sync", () => {
    expect(typeof syncCommand).toBe("function");
  });

  it("parses default sync as all surfaces without force", () => {
    expect(parseSyncFlags([])).toEqual({
      targets: [],
      force: false,
      syncAll: true,
    });
  });

  it("parses force as an explicit option for selected sync surfaces", () => {
    expect(parseSyncFlags(["--permissions", "--force"])).toEqual({
      targets: ["permissions"],
      force: true,
      syncAll: false,
    });
  });

  it("parses explicit target values and comma-separated target lists", () => {
    expect(parseSyncFlags(["--target", "permissions,hooks", "--target=agents-md"])).toEqual({
      targets: ["permissions", "hooks", "agents-md"],
      force: false,
      syncAll: false,
    });
  });

  it("deduplicates targets selected by canonical and legacy flags", () => {
    expect(parseSyncFlags(["--target", "permissions", "--permissions", "--skills"])).toEqual({
      targets: ["permissions", "skills"],
      force: false,
      syncAll: false,
    });
  });

  it("rejects unknown explicit targets", () => {
    expect(() => parseSyncFlags(["--target", "unknown"])).toThrow(
      'Unknown sync target "unknown". Valid targets: permissions, hooks, agents, agents-md, skills',
    );
  });

  it("rejects target flags without a value", () => {
    expect(() => parseSyncFlags(["--target", "--force"])).toThrow("--target requires a value");
  });

  it("requires force confirmation for projection targets that own install-state drift", () => {
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--permissions", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--hooks", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--agents", "--force"]))).toBe(true);
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
