import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configCommand } from "./config.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { readGlobalConfig, resolveGlobalConfigPath } from "../config/global-config.js";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-config-command-"));
  tempRoots.push(root);
  return root;
}

function writeProjectConfig(root: string): void {
  const kilnDir = join(root, ".kiln");
  mkdirSync(kilnDir, { recursive: true });
  writeFileSync(join(kilnDir, "kiln.yaml"), "version: \"1\"\n", "utf-8");
}

describe("config command", () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLog.mockRestore();
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sets project instruction profiles and work governance keys", async () => {
    const root = createTempRoot();
    writeProjectConfig(root);

    await configCommand({} as never, "set", ["activeInstructionProfiles", "sequel-engineering,project-standards"], root);
    await configCommand({} as never, "set", ["workGovernance.defaultPosture", "orchestrate"], root);
    await configCommand({} as never, "set", ["workGovernance.directExecution.maxFiles", "1"], root);
    await configCommand({} as never, "set", ["workGovernance.directExecution.maxRisk", "low"], root);
    await configCommand({} as never, "set", ["workGovernance.requireDelegationFor", "architecture,config"], root);
    await configCommand({} as never, "set", ["workGovernance.requiredEvidence", "surface-map,plan,tests"], root);
    await configCommand({} as never, "set", ["skills.selection.mode", "auto"], root);

    expect(readKilnYaml(join(root, ".kiln"))).toMatchObject({
      activeInstructionProfiles: ["sequel-engineering", "project-standards"],
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: ["architecture", "config"],
        requiredEvidence: ["surface-map", "plan", "tests"],
      },
      skills: {
        selection: {
          mode: "auto",
        },
      },
    });
  });

  it("sets global identity and operator doctrine keys with --global", async () => {
    const root = createTempRoot();
    process.env.XDG_CONFIG_HOME = join(root, "xdg");

    await configCommand({} as never, "set", ["--global", "identity.name", "Ricardo"], root);
    await configCommand({} as never, "set", ["--global", "identity.timezone", "America/Tijuana"], root);
    await configCommand({} as never, "set", ["--global", "activeInstructionProfiles", "sequel-engineering"], root);
    await configCommand({} as never, "set", ["--global", "skills.selection.mode", "auto"], root);

    expect(readGlobalConfig()).toMatchObject({
      identity: {
        name: "Ricardo",
        timezone: "America/Tijuana",
      },
      activeInstructionProfiles: ["sequel-engineering"],
      skills: {
        selection: {
          mode: "auto",
        },
      },
    });
  });

  it("explicitly resets an invalid global config to V3 and preserves a backup", async () => {
    const root = createTempRoot();
    process.env.XDG_CONFIG_HOME = join(root, "xdg");
    const configPath = resolveGlobalConfigPath();
    mkdirSync(join(root, "xdg", "kiln"), { recursive: true });
    writeFileSync(configPath, 'version: "1"\nidentity:\n  name: Previous\n', "utf-8");

    await configCommand({} as never, "reset", ["--global"], root);

    expect(readGlobalConfig()).toMatchObject({ version: "3" });
    expect(consoleLog.mock.calls.flat().join("\n")).toContain("backed up");
  });
});
