import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse as parseToml } from "smol-toml";
import * as fs from "node:fs";
import { join } from "node:path";
import type { KilnYaml } from "../../src/kiln-yaml-types.js";

const syncMocks = vi.hoisted(() => ({
  mockedHomedir: "",
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  const mockedOs = {
    ...actual,
    homedir: () => syncMocks.mockedHomedir || actual.homedir(),
  };
  return {
    ...mockedOs,
    default: mockedOs,
  };
});

import * as os from "node:os";
import { syncNativePermissionProjections } from "../../src/config/native-permission-projection.js";

interface TestPaths {
  rootPath: string;
  projectPath: string;
  homePath: string;
}

const granularPermissions: NonNullable<KilnYaml["permissions"]> = {
  approval: "on-request",
  sandbox: "workspace-write",
  tools: [{ tool: "Read", action: "allow" }],
  commands: [{ pattern: "git status*", action: "allow" }],
  fileGovernance: { denyGlobs: ["**/.env"] },
  dataFirewall: [{ destination: "logs", action: "redact" }],
  agentScopes: [{ agent: "planner", inherit: false }],
};

function buildKilnYaml(): KilnYaml {
  return {
    version: "1",
    permissions: granularPermissions,
  };
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

describe("syncNativePermissionProjections", () => {
  let paths: TestPaths;

  beforeEach(() => {
    const rootPath = fs.mkdtempSync(join(os.tmpdir(), "kiln-native-permission-projection-"));
    const projectPath = join(rootPath, "project");
    const homePath = join(rootPath, "home");
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(homePath, { recursive: true });
    paths = { rootPath, projectPath, homePath };
    syncMocks.mockedHomedir = homePath;
  });

  afterEach(() => {
    syncMocks.mockedHomedir = "";
    try {
      fs.rmSync(paths.rootPath, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("merges Claude settings and writes kiln.permissionSync metadata", { timeout: 10_000 }, async () => {
    const claudeSettingsPath = join(paths.projectPath, ".claude", "settings.json");
    fs.mkdirSync(join(paths.projectPath, ".claude"), { recursive: true });
    fs.writeFileSync(
      claudeSettingsPath,
      JSON.stringify({
        mcpServers: { kiln: { command: "node", args: ["entry.js"] } },
        uiTheme: "dark",
        kiln: { existingKey: "keep-me" },
      }),
      "utf-8",
    );

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

    expect(result.errors).toHaveLength(0);
    expect(result.claude).toBe(true);
    const settings = readJson(claudeSettingsPath);
    expect(settings.mcpServers).toEqual({ kiln: { command: "node", args: ["entry.js"] } });
    expect(settings.uiTheme).toBe("dark");
    expect(settings.permissions).toEqual({ allow: ["Read", "WebFetch"], deny: [] });

    const kiln = asRecord(settings.kiln);
    expect(kiln.existingKey).toBe("keep-me");
    const metadata = asRecord(kiln.permissionSync);
    expect(metadata.backend).toBe("claude");
    expect((metadata.representableRules as unknown[]).length).toBeGreaterThan(0);
    expect((metadata.unsupportedRules as unknown[]).length).toBeGreaterThan(0);
    expect((metadata.constraintInstructions as string[]).length).toBeGreaterThan(0);
  });

  it("merges Codex TOML and writes kiln.permission_sync metadata section", async () => {
    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    fs.mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    fs.writeFileSync(
      codexConfigPath,
      [
        "model = \"gpt-5.4\"",
        "",
        "[projects]",
        "default = \"kiln\"",
        "",
        "[kiln]",
        "legacy = \"keep\"",
      ].join("\n"),
      "utf-8",
    );

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

    expect(result.errors).toHaveLength(0);
    expect(result.codex).toBe(true);
    const config = parseToml(fs.readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    expect(config.model).toBe("gpt-5.4");
    expect(config.approval_policy).toBe("on-request");
    expect(config.sandbox_mode).toBe("workspace-write");

    const projects = asRecord(config.projects);
    expect(projects.default).toBe("kiln");
    const kiln = asRecord(config.kiln);
    expect(kiln.legacy).toBe("keep");
    const metadata = asRecord(kiln.permission_sync);
    expect(metadata.backend).toBe("codex");
    expect((metadata.unsupportedRules as unknown[]).length).toBeGreaterThan(0);
    expect((metadata.constraintInstructions as string[]).length).toBeGreaterThan(0);
  });

  it("merges OpenCode JSON and writes kiln.permissionSync metadata", async () => {
    const opencodeConfigPath = join(paths.homePath, ".config", "opencode", "opencode.json");
    fs.mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    fs.writeFileSync(
      opencodeConfigPath,
      JSON.stringify({
        theme: "ocean",
        permission: { default: "deny" },
        kiln: { legacyFlag: true },
      }),
      "utf-8",
    );

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

    expect(result.errors).toHaveLength(0);
    expect(result.opencode).toBe(true);
    const config = readJson(opencodeConfigPath);
    expect(config.theme).toBe("ocean");
    expect(config.permission).toEqual({ default: "ask" });

    const kiln = asRecord(config.kiln);
    expect(kiln.legacyFlag).toBe(true);
    const metadata = asRecord(kiln.permissionSync);
    expect(metadata.backend).toBe("opencode");
    expect((metadata.representableRules as unknown[]).length).toBeGreaterThan(0);
    expect((metadata.unsupportedRules as unknown[]).length).toBeGreaterThan(0);
  });

  it("writes non-empty translation metadata for granular policy across all backends", async () => {
    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

    expect(result.errors).toHaveLength(0);
    const claudeSettingsPath = join(paths.projectPath, ".claude", "settings.json");
    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    const opencodeConfigPath = join(paths.homePath, ".config", "opencode", "opencode.json");

    const claudeSettings = readJson(claudeSettingsPath);
    const claudeMetadata = asRecord(asRecord(claudeSettings.kiln).permissionSync);
    expect((claudeMetadata.representableRules as unknown[]).length).toBeGreaterThan(0);
    expect((claudeMetadata.unsupportedRules as unknown[]).length).toBeGreaterThan(0);

    const codexConfig = parseToml(fs.readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    const codexMetadata = asRecord(asRecord(codexConfig.kiln).permission_sync);
    expect((codexMetadata.representableRules as unknown[]).length).toBe(0);
    expect((codexMetadata.unsupportedRules as unknown[]).length).toBeGreaterThan(0);
    expect((codexMetadata.constraintInstructions as string[]).length).toBeGreaterThan(0);

    const opencodeConfig = readJson(opencodeConfigPath);
    const opencodeMetadata = asRecord(asRecord(opencodeConfig.kiln).permissionSync);
    expect((opencodeMetadata.representableRules as unknown[]).length).toBeGreaterThan(0);
    expect((opencodeMetadata.unsupportedRules as unknown[]).length).toBeGreaterThan(0);
  });

  it("records native projection install state after permission sync", async () => {
    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

    expect(result.errors).toHaveLength(0);
    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    expect(state.version).toBe(1);
    const targets = asRecord(state.targets);
    expect(Object.keys(targets).sort()).toEqual([
      "claude-settings",
      "codex-config",
      "opencode-config",
    ]);
    expect(asRecord(targets["codex-config"]).managedFields).toEqual([
      "approval_policy",
      "sandbox_mode",
      "kiln.permission_sync",
    ]);
  });

  it("aborts only the target whose managed fields drifted", async () => {
    const first = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(first.errors).toHaveLength(0);

    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    const codexConfig = parseToml(fs.readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(
      codexConfigPath,
      [
        `model = "${codexConfig.model as string}"`,
        "approval_policy = \"never\"",
        `sandbox_mode = "${codexConfig.sandbox_mode as string}"`,
        "",
        "[kiln]",
        "legacy = \"keep\"",
      ].join("\n"),
      "utf-8",
    );

    const second = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

    expect(second.claude).toBe(true);
    expect(second.codex).toBe(false);
    expect(second.opencode).toBe(true);
    expect(second.errors).toEqual([
      "Codex: managed field drift detected: approval_policy, kiln.permission_sync",
    ]);
    const after = parseToml(fs.readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    expect(after.approval_policy).toBe("never");
  });

  it("force overwrites drifted managed fields and refreshes install state", async () => {
    const first = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(first.errors).toHaveLength(0);

    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    fs.writeFileSync(
      codexConfigPath,
      [
        "model = \"gpt-5.4\"",
        "approval_policy = \"never\"",
        "sandbox_mode = \"read-only\"",
        "",
        "[kiln]",
        "legacy = \"keep\"",
      ].join("\n"),
      "utf-8",
    );

    const second = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath, { force: true });

    expect(second.errors).toHaveLength(0);
    expect(second.codex).toBe(true);
    const after = parseToml(fs.readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    expect(after.model).toBe("gpt-5.4");
    expect(after.approval_policy).toBe("on-request");
    expect(after.sandbox_mode).toBe("workspace-write");
    expect(asRecord(after.kiln).legacy).toBe("keep");

    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    const codexTarget = asRecord(asRecord(state.targets)["codex-config"]);
    expect(codexTarget.managedFields).toEqual([
      "approval_policy",
      "sandbox_mode",
      "kiln.permission_sync",
    ]);
  });
});
