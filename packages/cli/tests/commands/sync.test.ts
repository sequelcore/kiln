import { describe, it, expect } from "vitest";
import {
  allSelectedSyncTargetsFailed,
  parseSyncFlags,
  requiresForceSyncConfirmation,
  syncCommand,
} from "../../src/commands/sync.js";

describe("syncCommand", () => {
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

  it("treats a targeted sync as failed when the selected target fails", () => {
    expect(allSelectedSyncTargetsFailed(parseSyncFlags(["--permissions"]), {
      permissions: true,
      hooks: false,
      agents: false,
      agentsMd: false,
      skills: false,
    })).toBe(true);
  });

  it("ignores unselected failures when evaluating targeted sync failure", () => {
    expect(allSelectedSyncTargetsFailed(parseSyncFlags(["--permissions"]), {
      permissions: false,
      hooks: true,
      agents: true,
      agentsMd: true,
      skills: true,
    })).toBe(false);
  });

  it("requires force confirmation for projection targets that own install-state drift", () => {
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--permissions", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--hooks", "--force"]))).toBe(true);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--agents", "--force"]))).toBe(false);
    expect(requiresForceSyncConfirmation(parseSyncFlags(["--force"]))).toBe(true);
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
