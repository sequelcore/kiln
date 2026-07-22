import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

import { tmpdir } from "node:os";
import { syncNativePermissionProjections } from "../../src/config/native-permission-projection.js";
import { uninstallNativeTargets } from "../../src/commands/uninstall.js";
import * as nativeProjectionState from "../../src/config/native-projection-state.js";

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
  return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function writeModelGateway(projectPath: string): void {
  mkdirSync(join(projectPath, ".kiln"), { recursive: true });
  writeFileSync(join(projectPath, ".kiln", "gateway.yaml"), `
port: 4800
apps: []
modelGateway:
  port: 4910
  accounts:
    - { id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0 }
  openAIResponses:
    enabled: true
    maxBodyBytes: 1024
    maxConcurrentRequests: 2
    replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY }
    principals:
      - { tokenEnv: CODEX_GATEWAY_TOKEN, tenantId: tenant, applicationId: codex-app, callerId: codex, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget-codex, virtualModelIds: [model-a], nativeHarness: codex }
      - { tokenEnv: OPENCODE_GATEWAY_TOKEN, tenantId: tenant, applicationId: opencode-app, callerId: opencode, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget-opencode, virtualModelIds: [model-a], nativeHarness: opencode }
    virtualModels:
      - id: model-a
        displayName: Kiln Model A
        contextTokens: 200000
        outputTokens: 8192
        baseInstructions: You are a governed Kiln coding agent.
        providerId: codex-oauth
        providerModelId: upstream-a
        accountIds: [account]
        capabilities: [text, parallel-tool-calls]
        affinity: { continuity: none }
`, "utf8");
}

describe("syncNativePermissionProjections", () => {
  let paths: TestPaths;

  beforeEach(() => {
    const rootPath = mkdtempSync(join(tmpdir(), "kiln-native-permission-projection-"));
    const projectPath = join(rootPath, "project");
    const homePath = join(rootPath, "home");
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(homePath, { recursive: true });
    paths = { rootPath, projectPath, homePath };
    syncMocks.mockedHomedir = homePath;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    syncMocks.mockedHomedir = "";
    try {
      rmSync(paths.rootPath, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("merges Claude settings and writes kiln.permissionSync metadata", { timeout: 10_000 }, async () => {
    const claudeSettingsPath = join(paths.projectPath, ".claude", "settings.json");
    mkdirSync(join(paths.projectPath, ".claude"), { recursive: true });
    writeFileSync(
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

  it("merges Codex TOML, removes unsupported service tier values, and writes kiln.permission_sync metadata section", async () => {
    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    writeFileSync(
      codexConfigPath,
      [
        "model = \"gpt-5.4\"",
        "service_tier = \"default\"",
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
    const backupDir = join(paths.projectPath, ".kiln", "backups", "codex-config");
    const backupFiles = readdirSync(backupDir);
    expect(backupFiles).toHaveLength(1);
    expect(readFileSync(join(backupDir, backupFiles[0]!), "utf-8")).toContain("service_tier = \"default\"");
    const config = parseToml(readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    expect(config.model).toBe("gpt-5.4");
    expect(config.service_tier).toBeUndefined();
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

  it("merges OpenCode JSON without writing schema-invalid Kiln metadata", async () => {
    const opencodeConfigPath = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    writeFileSync(
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
    expect(config.kiln).toBeUndefined();
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

    const codexConfig = parseToml(readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    const codexMetadata = asRecord(asRecord(codexConfig.kiln).permission_sync);
    expect((codexMetadata.representableRules as unknown[]).length).toBe(0);
    expect((codexMetadata.unsupportedRules as unknown[]).length).toBeGreaterThan(0);
    expect((codexMetadata.constraintInstructions as string[]).length).toBeGreaterThan(0);

    const opencodeConfig = readJson(opencodeConfigPath);
    expect(opencodeConfig.permission).toEqual({ default: "ask" });
    expect(opencodeConfig.kiln).toBeUndefined();
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
    expect(asRecord(asRecord(targets["codex-config"]).permissionIntegrity)).toMatchObject({
      harness: "codex",
      classification: "unsupported-semantic-translation",
      persistedNative: {
        source: "native-config",
        projectionOwnership: "kiln-managed",
      },
    });
    expect(asRecord(asRecord(targets["opencode-config"]).permissionIntegrity)).toMatchObject({
      harness: "opencode",
      classification: "unsupported-semantic-translation",
      enforcement: {
        filesystemSandbox: "not-enforced",
        strength: "rules-only",
      },
    });
  });

  it("composes gateway providers and catalog into native config without persisting secrets", async () => {
    writeModelGateway(paths.projectPath);
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    writeFileSync(opencodePath, JSON.stringify({ theme: "ocean", enabled_providers: ["anthropic"], provider: { local: { npm: "fixture" } } }), "utf8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(result.errors).toEqual([]);
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    const codex = parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>;
    expect(codex).toMatchObject({ model: "model-a", model_provider: "kiln" });
    expect(asRecord(asRecord(codex.model_providers).kiln)).toMatchObject({
      base_url: "http://127.0.0.1:4910/v1", env_key: "CODEX_GATEWAY_TOKEN", wire_api: "responses",
      request_max_retries: 0, stream_max_retries: 0, supports_websockets: false,
    });
    const catalogPath = String(codex.model_catalog_json);
    expect(readJson(catalogPath)).toEqual({ models: [expect.objectContaining({ slug: "model-a", display_name: "Kiln Model A", context_window: 200000 })] });
    expect(readFileSync(codexPath, "utf8")).not.toContain("Bearer");

    const opencode = readJson(opencodePath);
    expect(opencode.theme).toBe("ocean");
    expect(opencode.enabled_providers).toEqual(["anthropic", "kiln"]);
    expect(asRecord(opencode.provider).local).toEqual({ npm: "fixture" });
    expect(asRecord(asRecord(opencode.provider).kiln)).toMatchObject({
      npm: "@ai-sdk/openai",
      options: { baseURL: "http://127.0.0.1:4910/v1", apiKey: "{env:OPENCODE_GATEWAY_TOKEN}" },
    });
    expect(opencode.model).toBe("kiln/model-a");
    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    expect(Object.keys(asRecord(state.targets))).toContain("codex-model-catalog");
  });

  it("uses a unique temporary file when a legacy same-process temp path already exists", async () => {
    writeModelGateway(paths.projectPath);
    const projectionsDir = join(paths.projectPath, ".kiln", "projections");
    const catalogPath = join(projectionsDir, "codex-model-catalog.json");
    const legacyTemporaryPath = `${catalogPath}.${process.pid}.tmp`;
    mkdirSync(projectionsDir, { recursive: true });
    writeFileSync(legacyTemporaryPath, "stale temporary file\n", "utf8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

    expect(result.errors).toEqual([]);
    expect(existsSync(catalogPath)).toBe(true);
    expect(readFileSync(legacyTemporaryPath, "utf8")).toBe("stale temporary file\n");
    expect(readdirSync(projectionsDir).filter((entry) => entry.endsWith(".tmp"))).toEqual([
      `codex-model-catalog.json.${process.pid}.tmp`,
    ]);
  });

  it("removes only previously owned gateway fields and catalog when canonical gateway config disappears", async () => {
    writeModelGateway(paths.projectPath);
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    writeFileSync(opencodePath, JSON.stringify({ enabled_providers: ["anthropic"] }), "utf8");
    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    const catalogPath = String((parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>).model_catalog_json);
    rmSync(join(paths.projectPath, ".kiln", "gateway.yaml"));

    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const codex = parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>;
    expect(codex.model_provider).toBeUndefined();
    expect(codex.model_catalog_json).toBeUndefined();
    expect(asRecord(codex.model_providers).kiln).toBeUndefined();
    expect(existsSync(catalogPath)).toBe(false);
    const opencode = readJson(opencodePath);
    expect(opencode.enabled_providers).toEqual(["anthropic"]);
    expect(asRecord(opencode.provider).kiln).toBeUndefined();
    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    expect(asRecord(state.targets)["codex-model-catalog"]).toBeUndefined();
  });

  it("reports gateway provider drift without overwriting unmanaged native config", async () => {
    writeModelGateway(paths.projectPath);
    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    const opencode = readJson(opencodePath);
    const provider = asRecord(opencode.provider);
    provider.kiln = { ...asRecord(provider.kiln), name: "operator-change" };
    writeFileSync(opencodePath, `${JSON.stringify(opencode, null, 2)}\n`, "utf8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(result.opencode).toBe(false);
    expect(result.errors).toContain("OpenCode: managed field drift detected: provider.kiln");
    expect(asRecord(asRecord(readJson(opencodePath).provider).kiln).name).toBe("operator-change");
  });

  it("owns only the kiln enabled-provider membership through additive sync and uninstall", async () => {
    writeModelGateway(paths.projectPath);
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    writeFileSync(opencodePath, JSON.stringify({ enabled_providers: ["anthropic"] }), "utf8");
    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const withOperatorAddition = readJson(opencodePath);
    withOperatorAddition.enabled_providers = ["anthropic", "kiln", "google"];
    writeFileSync(opencodePath, `${JSON.stringify(withOperatorAddition, null, 2)}\n`, "utf8");

    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    expect(readJson(opencodePath).enabled_providers).toEqual(["anthropic", "kiln", "google"]);
    const uninstall = uninstallNativeTargets(paths.projectPath, { target: "opencode" });
    expect(uninstall.errors).toEqual([]);
    expect(readJson(opencodePath).enabled_providers).toEqual(["anthropic", "google"]);
  });

  it("reports model catalog drift instead of deleting or replacing it", async () => {
    writeModelGateway(paths.projectPath);
    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    const catalogPath = String((parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>).model_catalog_json);
    writeFileSync(catalogPath, "operator catalog\n", "utf8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(result.codex).toBe(false);
    expect(result.errors).toContain("Codex: managed model catalog drift detected");
    expect(readFileSync(catalogPath, "utf8")).toBe("operator catalog\n");
  });

  it("refuses an unmanaged fixed-path Codex catalog without overwriting it", async () => {
    writeModelGateway(paths.projectPath);
    const catalogPath = join(paths.projectPath, ".kiln", "projections", "codex-model-catalog.json");
    mkdirSync(join(paths.projectPath, ".kiln", "projections"), { recursive: true });
    writeFileSync(catalogPath, "operator catalog\n", "utf8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(result.codex).toBe(false);
    expect(result.errors).toContain("Codex: model catalog path already exists without Kiln install-state ownership");
    expect(readFileSync(catalogPath, "utf8")).toBe("operator catalog\n");
    expect(existsSync(join(paths.homePath, ".codex", "config.toml"))).toBe(false);
  });

  it("leaves Codex config untouched when the catalog cannot be staged", async () => {
    writeModelGateway(paths.projectPath);
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    writeFileSync(codexPath, "model = \"operator-model\"\n", "utf8");
    writeFileSync(join(paths.projectPath, ".kiln", "projections"), "blocks directory creation", "utf8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(result.codex).toBe(false);
    expect(result.errors).toContain("Codex: managed model catalog could not be updated safely");
    expect(readFileSync(codexPath, "utf8")).toBe("model = \"operator-model\"\n");
  });

  it("rolls back every native projection when install-state persistence fails", async () => {
    writeModelGateway(paths.projectPath);
    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const claudePath = join(paths.projectPath, ".claude", "settings.json");
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    const catalogPath = String((parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>).model_catalog_json);
    const installStatePath = join(paths.projectPath, ".kiln", "install-state.json");
    const before = new Map([claudePath, codexPath, opencodePath, catalogPath, installStatePath].map((path) => [path, readFileSync(path, "utf8")]));
    const gatewayPath = join(paths.projectPath, ".kiln", "gateway.yaml");
    writeFileSync(gatewayPath, readFileSync(gatewayPath, "utf8").replace("displayName: Kiln Model A", "displayName: Kiln Model Updated"), "utf8");
    vi.spyOn(nativeProjectionState, "writeNativeProjectionInstallState").mockImplementationOnce(() => {
      throw new Error("synthetic install-state failure");
    });

    await expect(syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).rejects.toThrow("synthetic install-state failure");
    for (const [path, content] of before) expect(readFileSync(path, "utf8"), path).toBe(content);
  });

  it("projects the canonical Codex OAuth default model into Codex native config", async () => {
    const result = await syncNativePermissionProjections({
      ...buildKilnYaml(),
      provider: "codex-oauth",
      model: { default: "gpt-5.4-mini" },
    }, paths.projectPath);

    expect(result.errors).toHaveLength(0);
    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    const config = parseToml(readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    expect(config.model).toBe("gpt-5.4-mini");

    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    const target = asRecord(asRecord(state.targets)["codex-config"]);
    expect(target.managedFields).toEqual([
      "approval_policy",
      "sandbox_mode",
      "kiln.permission_sync",
      "model",
    ]);
  });

  it("projects the canonical OpenCode Go default model into OpenCode native config syntax", async () => {
    const result = await syncNativePermissionProjections({
      ...buildKilnYaml(),
      provider: "opencode-go",
      model: { default: "deepseek-v4-flash" },
    }, paths.projectPath);

    expect(result.errors).toHaveLength(0);
    const opencodeConfigPath = join(paths.homePath, ".config", "opencode", "opencode.json");
    const config = readJson(opencodeConfigPath);
    expect(config.model).toBe("opencode-go/deepseek-v4-flash");
  });

  it("removes stale managed Codex defaults when canonical routing targets OpenCode", async () => {
    const first = await syncNativePermissionProjections({
      ...buildKilnYaml(),
      provider: "codex-oauth",
      model: { default: "gpt-5.4-mini" },
    }, paths.projectPath);
    expect(first.errors).toHaveLength(0);

    const second = await syncNativePermissionProjections({
      ...buildKilnYaml(),
      provider: "opencode-go",
      model: { default: "deepseek-v4-flash" },
    }, paths.projectPath);

    expect(second.errors).toHaveLength(0);
    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    const config = parseToml(readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    expect(config.model).toBeUndefined();
    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    const target = asRecord(asRecord(state.targets)["codex-config"]);
    expect(target.managedFields).toEqual([
      "approval_policy",
      "sandbox_mode",
      "kiln.permission_sync",
    ]);
  });

  it("preserves first-sync unmanaged native defaults when canonical routing targets another harness", async () => {
    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    writeFileSync(codexConfigPath, "model = \"gpt-5.4\"\n", "utf-8");

    const result = await syncNativePermissionProjections({
      ...buildKilnYaml(),
      provider: "opencode-go",
      model: { default: "deepseek-v4-flash" },
    }, paths.projectPath);

    expect(result.errors).toHaveLength(0);
    const config = parseToml(readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    expect(config.model).toBe("gpt-5.4");
    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    const target = asRecord(asRecord(state.targets)["codex-config"]);
    expect(target.managedFields).toEqual([
      "approval_policy",
      "sandbox_mode",
      "kiln.permission_sync",
    ]);
  });

  it("reports managed default drift instead of overwriting a native model change", async () => {
    const first = await syncNativePermissionProjections({
      ...buildKilnYaml(),
      provider: "opencode-go",
      model: { default: "deepseek-v4-flash" },
    }, paths.projectPath);
    expect(first.errors).toHaveLength(0);

    const opencodeConfigPath = join(paths.homePath, ".config", "opencode", "opencode.json");
    const config = readJson(opencodeConfigPath);
    writeFileSync(opencodeConfigPath, `${JSON.stringify({
      ...config,
      model: "opencode-go/deepseek-v4-flash-free",
    }, null, 2)}\n`, "utf-8");

    const second = await syncNativePermissionProjections({
      ...buildKilnYaml(),
      provider: "opencode-go",
      model: { default: "deepseek-v4-flash" },
    }, paths.projectPath);

    expect(second.opencode).toBe(false);
    expect(second.errors).toEqual([
      "OpenCode: managed field drift detected: model",
    ]);
  });

  it("does not project disabled harness permission targets", async () => {
    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    writeFileSync(codexConfigPath, "model = \"gpt-5.4\"\n", "utf-8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath, {
      disabledHarnesses: ["codex"],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.codex).toBe(true);
    expect(readFileSync(codexConfigPath, "utf-8")).toBe("model = \"gpt-5.4\"\n");
    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    expect(Object.keys(asRecord(state.targets))).not.toContain("codex-config");
  });

  it("aborts only the target whose managed fields drifted", async () => {
    const first = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(first.errors).toHaveLength(0);

    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    const codexConfig = parseToml(readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    writeFileSync(
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
    const after = parseToml(readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
    expect(after.approval_policy).toBe("never");
  });

  it("force overwrites drifted managed fields and refreshes install state", async () => {
    const first = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(first.errors).toHaveLength(0);

    const codexConfigPath = join(paths.homePath, ".codex", "config.toml");
    writeFileSync(
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
    const after = parseToml(readFileSync(codexConfigPath, "utf-8")) as Record<string, unknown>;
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
