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
import { dirname, join } from "node:path";
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
import { syncNativePermissionProjections, syncOpenCodeSkillVisibilityProjection, uninstallOpenCodeSkillVisibilityProjection } from "../../src/config/native-permission-projection.js";
import { uninstallNativeTargets } from "../../src/commands/uninstall.js";
import * as nativeProjectionState from "../../src/config/native-projection-state.js";
import { readSkillCatalogStatus } from "../../src/config/skill-catalog-status.js";

interface TestPaths {
  rootPath: string;
  projectPath: string;
  homePath: string;
}

const granularPermissions: NonNullable<KilnYaml["permissions"]> = {
  approval: "on-request",
  sandbox: "workspace-write",
  tools: [{ tool: "read", action: "allow" }],
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
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY }
  surfaces:
    openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 2 }
    anthropicMessages: { maxBodyBytes: 1024, maxConcurrentRequests: 2 }
  principals:
      - { tokenEnv: CODEX_GATEWAY_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: codex-app, callerId: codex, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget-codex, virtualModelIds: [model-a], nativeHarness: codex }
      - { tokenEnv: OPENCODE_GATEWAY_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: opencode-app, callerId: opencode, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget-opencode, virtualModelIds: [model-a], nativeHarness: opencode }
      - { tokenEnv: ANTHROPIC_AUTH_TOKEN, ingress: anthropic-messages, tenantId: tenant, applicationId: claude-app, callerId: claude, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget-claude, virtualModelIds: [claude-kiln-a], nativeHarness: claude }
  virtualModels:
      - id: model-a
        displayName: Kiln Model A
        contextTokens: 200000
        outputTokens: 8192
        baseInstructions: You are a governed Kiln coding agent.
        executionRouteId: model-a-route
        capabilities: [text, parallel-tool-calls]
        affinity: { continuity: none }
      - id: claude-kiln-a
        displayName: Kiln Claude A
        contextTokens: 200000
        outputTokens: 8192
        executionRouteId: claude-model-a-route
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

  it("plans all permission destinations without creating files, backups, or install state", async () => {
    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath, {
      dryRun: true,
      userHome: paths.homePath,
    });

    expect(readdirSync(paths.projectPath)).toEqual([]);
    expect(readdirSync(paths.homePath)).toEqual([]);
    expect(result.outcomes.map((outcome) => outcome.targetId).sort()).toEqual([
      "claude-settings",
      "codex-config",
      "opencode-config",
    ]);
    expect(result.outcomes.every((outcome) => outcome.status === "planned")).toBe(true);
  });

  it("denies canonical explicit-only skills rediscovered from Claude without rewriting unrelated OpenCode permissions", async () => {
    const source = join(paths.homePath, ".kiln", "skills", "planner");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: planner\ndescription: plan\n---\n", "utf8");
    const target = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ theme: "ocean", permission: { read: "allow", skill: { operator: "ask" } } }), "utf8");
    const result = await syncOpenCodeSkillVisibilityProjection({
      ...buildKilnYaml(), skills: { builtin: { enabled: false }, visibility: { overrides: { planner: "explicit-only" } } },
    }, paths.projectPath, { userHome: paths.homePath });
    expect(result.errors).toEqual([]);
    expect(readJson(target)).toEqual({
      theme: "ocean", permission: { read: "allow", skill: { operator: "ask", planner: "deny" } },
    });
    expect(readJson(join(paths.homePath, ".config", "opencode", ".kiln", "install-state.json")).targets)
      .toHaveProperty("opencode-skill-visibility");
    expect(existsSync(join(paths.projectPath, ".kiln", "install-state.json"))).toBe(false);
    const planner = readSkillCatalogStatus({
      projectPath: paths.projectPath, userHome: paths.homePath,
      skillConfig: { builtin: { enabled: false }, visibility: { overrides: { planner: "explicit-only" } } },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    }).entries.find((entry) => entry.name === "planner");
    expect(planner?.projections).toContainEqual(expect.objectContaining({
      target: "opencode", effectiveVisibility: "disabled", visibilityCapability: "unsupported",
      visibilityReason: expect.stringContaining("observed default merged configuration denies"),
    }));
    expect(uninstallOpenCodeSkillVisibilityProjection({ userHome: paths.homePath }).errors).toEqual([]);
    expect(readJson(target)).toEqual({ theme: "ocean", permission: { read: "allow", skill: { operator: "ask" } } });
  });

  it("leaves an existing operator deny unowned while overriding a weaker same-name rule fail closed", async () => {
    const source = join(paths.homePath, ".kiln", "skills", "planner");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: planner\ndescription: plan\n---\n", "utf8");
    const target = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(dirname(target), { recursive: true });
    const config = { permission: { skill: { planner: "deny", operator: "allow" } } };
    writeFileSync(target, JSON.stringify(config), "utf8");
    const yaml = { ...buildKilnYaml(), skills: { builtin: { enabled: false }, visibility: { overrides: { planner: "explicit-only" as const } } } };
    expect((await syncOpenCodeSkillVisibilityProjection(yaml, paths.projectPath, { userHome: paths.homePath })).errors).toEqual([]);
    expect(existsSync(join(paths.homePath, ".config", "opencode", ".kiln", "install-state.json"))).toBe(false);
    expect(uninstallOpenCodeSkillVisibilityProjection({ userHome: paths.homePath })).toEqual({ removed: [], errors: [] });
    expect(readJson(target)).toEqual(config);

    writeFileSync(target, JSON.stringify({ permission: { skill: { planner: "ask" } } }), "utf8");
    const blocked = await syncOpenCodeSkillVisibilityProjection(yaml, paths.projectPath, { userHome: paths.homePath });
    expect(blocked.errors.join(" ")).toContain("Existing exact OpenCode skill permission conflicts");
    expect(readJson(target)).toEqual({ permission: { skill: { planner: "ask" } } });
  });

  it("keeps a global deny discovered from Claude when syncing a different project and blocks overriding patterns", async () => {
    const claudeSkill = join(paths.homePath, ".claude", "skills", "planner");
    mkdirSync(claudeSkill, { recursive: true });
    writeFileSync(join(claudeSkill, "SKILL.md"), "---\nname: planner\ndescription: plan\ndisable-model-invocation: true\n---\n", "utf8");
    const yaml = { ...buildKilnYaml(), skills: { builtin: { enabled: false } } };
    expect((await syncOpenCodeSkillVisibilityProjection(yaml, join(paths.rootPath, "project-b"), { userHome: paths.homePath })).errors).toEqual([]);
    const target = join(paths.homePath, ".config", "opencode", "opencode.json");
    expect(readJson(target)).toMatchObject({ permission: { skill: { planner: "deny" } } });

    expect(uninstallOpenCodeSkillVisibilityProjection({ userHome: paths.homePath }).errors).toEqual([]);
    writeFileSync(target, JSON.stringify({ permission: { skill: { planner: "deny", "planner*": "allow" } } }), "utf8");
    const blocked = await syncOpenCodeSkillVisibilityProjection(yaml, join(paths.rootPath, "project-b"), { userHome: paths.homePath });
    expect(blocked.errors.join(" ")).toContain("overridden by a later-matching pattern");
    expect(readJson(target)).toEqual({ permission: { skill: { planner: "deny", "planner*": "allow" } } });
  });

  it("preserves operator scalar allow when no OpenCode skill denies are desired", async () => {
    const target = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(dirname(target), { recursive: true });
    const document = { theme: "ocean", permission: { skill: "allow" } };
    writeFileSync(target, JSON.stringify(document), "utf8");
    const result = await syncOpenCodeSkillVisibilityProjection({
      ...buildKilnYaml(), skills: { builtin: { enabled: false } },
    }, paths.projectPath, { userHome: paths.homePath });
    expect(result).toEqual({
      errors: [],
      outcomes: [expect.objectContaining({ targetId: "opencode-skill-visibility", status: "skipped" })],
    });
    expect(readJson(target)).toEqual(document);
    expect(existsSync(join(paths.homePath, ".config", "opencode", ".kiln", "install-state.json"))).toBe(false);
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
    expect(settings.permissions).toEqual({
      allow: ["Read", "WebFetch", "Bash(git status*)"],
      deny: [],
      ask: [],
      defaultMode: "default",
    });

    const kiln = asRecord(settings.kiln);
    expect(kiln.existingKey).toBe("keep-me");
    const metadata = asRecord(kiln.permissionSync);
    expect(metadata.backend).toBe("claude");
    expect((metadata.representableRules as unknown[]).length).toBeGreaterThan(0);
    expect((metadata.unsupportedRules as unknown[]).length).toBeGreaterThan(0);
    expect((metadata.constraintInstructions as string[]).length).toBeGreaterThan(0);
  });

  it.each([
    {
      harness: "Claude Code",
      path: (paths: TestPaths) => join(paths.projectPath, ".claude", "settings.json"),
      content: "{ malformed claude settings\r\n",
    },
    {
      harness: "Codex",
      path: (paths: TestPaths) => join(paths.homePath, ".codex", "config.toml"),
      content: "[malformed codex\r\nvalue =\r\n",
    },
    {
      harness: "OpenCode",
      path: (paths: TestPaths) => join(paths.homePath, ".config", "opencode", "opencode.json"),
      content: "{ malformed opencode\r\n",
    },
  ])("fails closed and preserves malformed $harness configuration byte-for-byte", async ({ harness, path, content }) => {
    const target = path(paths);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining(`${harness}: native configuration is unreadable`)]));
    expect(result.outcomes).toContainEqual(expect.objectContaining({ path: target, status: "failed" }));
    expect(readFileSync(target, "utf8")).toBe(content);
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
    expect(config.permission).toEqual({
      "*": "ask",
      bash: { "git status*": "allow" },
      read: { "*": "allow", "**/.env": "deny" },
      edit: { "**/.env": "deny" },
    });
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
    // Unlike codex, OpenCode can carry Kiln's granular rules natively, so they
    // reach the config instead of degrading to prompt-only constraints.
    expect(opencodeConfig.permission).toEqual({
      "*": "ask",
      bash: { "git status*": "allow" },
      read: { "*": "allow", "**/.env": "deny" },
      edit: { "**/.env": "deny" },
    });
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

  it("adds gateway providers while preserving native picker, search, and provider allowlist state", async () => {
    writeModelGateway(paths.projectPath);
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    writeFileSync(codexPath, [
      "model = \"gpt-5.4\"",
      "model_provider = \"openai\"",
      "model_catalog_json = \"C:/operator/catalog.json\"",
      "web_search = \"live\"",
      "",
      "[model_providers.operator]",
      "base_url = \"https://operator.example/v1\"",
    ].join("\n"), "utf8");
    writeFileSync(opencodePath, JSON.stringify({ theme: "ocean", model: "anthropic/sonnet", enabled_providers: ["anthropic"], provider: { local: { npm: "fixture" } } }), "utf8");

    const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(result.errors).toEqual([]);
    const codex = parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>;
    expect(codex).toMatchObject({
      model: "gpt-5.4",
      model_provider: "openai",
      model_catalog_json: "C:/operator/catalog.json",
      web_search: "live",
    });
    expect(asRecord(codex.model_providers).operator).toEqual({ base_url: "https://operator.example/v1" });
    expect(asRecord(asRecord(codex.model_providers).kiln)).toMatchObject({
      base_url: "http://127.0.0.1:4910/v1", env_key: "CODEX_GATEWAY_TOKEN", wire_api: "responses",
      request_max_retries: 0, stream_max_retries: 0, supports_websockets: false,
    });
    expect(existsSync(join(paths.projectPath, ".kiln", "projections", "codex-model-catalog.json"))).toBe(false);
    expect(readFileSync(codexPath, "utf8")).not.toContain("Bearer");

    const opencode = readJson(opencodePath);
    expect(opencode.theme).toBe("ocean");
    expect(opencode.enabled_providers).toEqual(["anthropic"]);
    expect(opencode.model).toBe("anthropic/sonnet");
    expect(asRecord(opencode.provider).local).toEqual({ npm: "fixture" });
    expect(asRecord(asRecord(opencode.provider).kiln)).toMatchObject({
      npm: "@ai-sdk/openai",
      options: { baseURL: "http://127.0.0.1:4910/v1", apiKey: "{env:OPENCODE_GATEWAY_TOKEN}" },
    });

    const claude = readJson(join(paths.projectPath, ".claude", "settings.json"));
    expect(claude).toMatchObject({
      model: "claude-kiln-a",
      env: {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4910",
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
        CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
        CLAUDE_CODE_DISABLE_THINKING: "1",
        CLAUDE_CODE_MAX_RETRIES: "0",
        MAX_THINKING_TOKENS: "0",
        DISABLE_INTERLEAVED_THINKING: "1",
        DISABLE_PROMPT_CACHING: "1",
      },
    });
    expect(JSON.stringify(claude)).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(asRecord(claude.env).OPERATOR_VALUE).toBeUndefined();
    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    expect(Object.keys(asRecord(state.targets))).not.toContain("codex-model-catalog");
    expect(asRecord(asRecord(state.targets)["claude-settings"]).managedFields).toEqual(expect.arrayContaining([
      "permissions",
      "kiln.permissionSync",
      "env.ANTHROPIC_BASE_URL",
      "env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
      "model",
    ]));
  });

  it("uninstalls gateway providers without removing or rewriting native Codex and OpenCode choices", async () => {
    writeModelGateway(paths.projectPath);
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    writeFileSync(codexPath, [
      "model = \"gpt-5.4\"",
      "model_provider = \"openai\"",
      "model_catalog_json = \"C:/operator/catalog.json\"",
      "web_search = \"live\"",
    ].join("\n"), "utf8");
    writeFileSync(opencodePath, JSON.stringify({
      model: "anthropic/sonnet",
      enabled_providers: ["anthropic", "google"],
      provider: { local: { npm: "fixture" } },
    }), "utf8");

    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    expect(uninstallNativeTargets(paths.projectPath, { target: "codex" }).errors).toEqual([]);
    expect(uninstallNativeTargets(paths.projectPath, { target: "opencode" }).errors).toEqual([]);

    const codex = parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>;
    expect(codex).toMatchObject({
      model: "gpt-5.4",
      model_provider: "openai",
      model_catalog_json: "C:/operator/catalog.json",
      web_search: "live",
    });
    expect(asRecord(codex.model_providers).kiln).toBeUndefined();
    const opencode = readJson(opencodePath);
    expect(opencode.model).toBe("anthropic/sonnet");
    expect(opencode.enabled_providers).toEqual(["anthropic", "google"]);
    expect(asRecord(opencode.provider).local).toEqual({ npm: "fixture" });
    expect(asRecord(opencode.provider).kiln).toBeUndefined();
  });

  it("preserves unmanaged Claude settings and env fields while owning only gateway paths", async () => {
    writeModelGateway(paths.projectPath);
    const claudePath = join(paths.projectPath, ".claude", "settings.json");
    mkdirSync(join(paths.projectPath, ".claude"), { recursive: true });
    writeFileSync(claudePath, JSON.stringify({ theme: "dark", env: { OPERATOR_VALUE: "preserved" } }), "utf8");

    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);

    const claude = readJson(claudePath);
    expect(claude.theme).toBe("dark");
    expect(asRecord(claude.env).OPERATOR_VALUE).toBe("preserved");
    expect(asRecord(claude.env).ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:4910");
  });

  it("reports Claude gateway drift and uninstall removes only Kiln-owned fields", async () => {
    writeModelGateway(paths.projectPath);
    const claudePath = join(paths.projectPath, ".claude", "settings.json");
    mkdirSync(join(paths.projectPath, ".claude"), { recursive: true });
    writeFileSync(claudePath, JSON.stringify({ env: { OPERATOR_VALUE: "preserved" } }), "utf8");
    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const changed = readJson(claudePath);
    asRecord(changed.env).ANTHROPIC_BASE_URL = "http://127.0.0.1:9999";
    writeFileSync(claudePath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");

    const drifted = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);
    expect(drifted.claude).toBe(false);
    expect(drifted.errors).toContain("Claude Code: managed field drift detected: env.ANTHROPIC_BASE_URL");
    expect(asRecord(readJson(claudePath).env).ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9999");

    const uninstall = uninstallNativeTargets(paths.projectPath, { target: "claude", force: true });
    expect(uninstall.errors).toEqual([]);
    const after = readJson(claudePath);
    expect(after.model).toBeUndefined();
    expect(asRecord(after.env).ANTHROPIC_BASE_URL).toBeUndefined();
    expect(asRecord(after.env).OPERATOR_VALUE).toBe("preserved");
  });

  it("fails closed before native writes when Claude tokenEnv cannot be projected safely", async () => {
    writeModelGateway(paths.projectPath);
    const gatewayPath = join(paths.projectPath, ".kiln", "gateway.yaml");
    writeFileSync(gatewayPath, readFileSync(gatewayPath, "utf8").replace("tokenEnv: ANTHROPIC_AUTH_TOKEN", "tokenEnv: CLAUDE_GATEWAY_TOKEN"), "utf8");

    await expect(syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).rejects.toThrow("ANTHROPIC_AUTH_TOKEN");
    expect(existsSync(join(paths.projectPath, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(paths.homePath, ".codex", "config.toml"))).toBe(false);
    expect(existsSync(join(paths.homePath, ".config", "opencode", "opencode.json"))).toBe(false);
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

  it("never changes the OpenCode provider allowlist, including during a subsequent sync", async () => {
    writeModelGateway(paths.projectPath);
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    writeFileSync(opencodePath, JSON.stringify({ enabled_providers: ["anthropic"] }), "utf8");
    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const withOperatorAddition = readJson(opencodePath);
    withOperatorAddition.enabled_providers = ["anthropic", "google"];
    writeFileSync(opencodePath, `${JSON.stringify(withOperatorAddition, null, 2)}\n`, "utf8");

    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    expect(readJson(opencodePath).enabled_providers).toEqual(["anthropic", "google"]);
  });

  it("migrates legacy gateway picker, catalog, and allowlist ownership without removing the safe provider", async () => {
    writeModelGateway(paths.projectPath);
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    const catalogPath = join(paths.projectPath, ".kiln", "projections", "codex-model-catalog.json");
    mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    mkdirSync(join(paths.homePath, ".config", "opencode"), { recursive: true });
    mkdirSync(join(paths.projectPath, ".kiln", "projections"), { recursive: true });
    const codex = {
      model: "model-a",
      model_provider: "kiln",
      model_catalog_json: catalogPath,
      web_search: "disabled",
      model_providers: { kiln: { base_url: "http://127.0.0.1:4910/v1" } },
    };
    const opencode = {
      model: "kiln/model-a",
      enabled_providers: ["anthropic", "kiln"],
      provider: { kiln: { npm: "@ai-sdk/openai" } },
    };
    writeFileSync(codexPath, [
      "model = \"model-a\"",
      "model_provider = \"kiln\"",
      `model_catalog_json = ${JSON.stringify(catalogPath)}`,
      "web_search = \"disabled\"",
      "",
      "[model_providers.kiln]",
      "base_url = \"http://127.0.0.1:4910/v1\"",
    ].join("\n"), "utf8");
    writeFileSync(opencodePath, `${JSON.stringify(opencode, null, 2)}\n`, "utf8");
    writeFileSync(catalogPath, "legacy catalog\n", "utf8");
    nativeProjectionState.writeNativeProjectionInstallState(join(paths.projectPath, ".kiln"), {
      version: 1,
      targets: {
        "codex-config": nativeProjectionState.createNativeProjectionSnapshot({
          targetId: "codex-config", filePath: codexPath, document: codex,
          managedFields: ["model", "model_provider", "model_catalog_json", "web_search", "model_providers.kiln"],
        }),
        "codex-model-catalog": nativeProjectionState.createNativeProjectionFileSnapshot({
          targetId: "codex-model-catalog", filePath: catalogPath, content: "legacy catalog\n",
        }),
        "opencode-config": nativeProjectionState.createNativeProjectionSnapshot({
          targetId: "opencode-config", filePath: opencodePath, document: opencode,
          managedFields: ["model", "enabled_providers", "provider.kiln"],
          managedArrayItems: { enabled_providers: ["kiln"] },
        }),
      },
    });

    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);

    const migratedCodex = parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>;
    expect(migratedCodex.model).toBeUndefined();
    expect(migratedCodex.model_provider).toBeUndefined();
    expect(migratedCodex.model_catalog_json).toBeUndefined();
    expect(migratedCodex.web_search).toBeUndefined();
    expect(asRecord(migratedCodex.model_providers).kiln).toBeDefined();
    expect(existsSync(catalogPath)).toBe(false);
    const migratedOpenCode = readJson(opencodePath);
    expect(migratedOpenCode.model).toBeUndefined();
    expect(migratedOpenCode.enabled_providers).toEqual(["anthropic", "kiln"]);
    expect(asRecord(migratedOpenCode.provider).kiln).toBeDefined();
  });

  it("detaches a drifted legacy Codex catalog without deleting operator-modified content", async () => {
    writeModelGateway(paths.projectPath);
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    const catalogPath = join(paths.projectPath, ".kiln", "projections", "codex-model-catalog.json");
    mkdirSync(join(paths.homePath, ".codex"), { recursive: true });
    mkdirSync(dirname(catalogPath), { recursive: true });
    const codex = {
      model: "model-a",
      model_provider: "kiln",
      model_catalog_json: catalogPath,
      web_search: "disabled",
      model_providers: { kiln: { base_url: "http://127.0.0.1:4910/v1" } },
    };
    writeFileSync(codexPath, [
      "model = \"model-a\"",
      "model_provider = \"kiln\"",
      `model_catalog_json = ${JSON.stringify(catalogPath)}`,
      "web_search = \"disabled\"",
      "",
      "[model_providers.kiln]",
      "base_url = \"http://127.0.0.1:4910/v1\"",
    ].join("\n"), "utf8");
    writeFileSync(catalogPath, "original managed catalog\n", "utf8");
    nativeProjectionState.writeNativeProjectionInstallState(join(paths.projectPath, ".kiln"), {
      version: 1,
      targets: {
        "codex-config": nativeProjectionState.createNativeProjectionSnapshot({
          targetId: "codex-config", filePath: codexPath, document: codex,
          managedFields: ["model", "model_provider", "model_catalog_json", "web_search", "model_providers.kiln"],
        }),
        "codex-model-catalog": nativeProjectionState.createNativeProjectionFileSnapshot({
          targetId: "codex-model-catalog", filePath: catalogPath, content: "original managed catalog\n",
        }),
      },
    });
    writeFileSync(catalogPath, "operator-modified catalog\n", "utf8");

    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);

    const migrated = parseToml(readFileSync(codexPath, "utf8")) as Record<string, unknown>;
    expect(migrated.model_provider).toBeUndefined();
    expect(migrated.model_catalog_json).toBeUndefined();
    expect(readFileSync(catalogPath, "utf8")).toBe("operator-modified catalog\n");
    const state = readJson(join(paths.projectPath, ".kiln", "install-state.json"));
    expect(asRecord(state.targets)["codex-model-catalog"]).toBeUndefined();
  });

  it("rolls back every native projection when install-state persistence fails", async () => {
    writeModelGateway(paths.projectPath);
    expect((await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath)).errors).toEqual([]);
    const claudePath = join(paths.projectPath, ".claude", "settings.json");
    const codexPath = join(paths.homePath, ".codex", "config.toml");
    const opencodePath = join(paths.homePath, ".config", "opencode", "opencode.json");
    const installStatePath = join(paths.projectPath, ".kiln", "install-state.json");
    const before = new Map([claudePath, codexPath, opencodePath, installStatePath].map((path) => [path, readFileSync(path, "utf8")]));
    const gatewayPath = join(paths.projectPath, ".kiln", "gateway.yaml");
    writeFileSync(gatewayPath, readFileSync(gatewayPath, "utf8")
      .replace("port: 4910", "port: 4911")
      .replace("displayName: Kiln Model A", "displayName: Kiln Model Updated"), "utf8");
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

  describe("with OPENCODE_CONFIG_DIR set", () => {
    let savedOpencodeConfigDir: string | undefined;

    beforeEach(() => {
      savedOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
      process.env.OPENCODE_CONFIG_DIR = join(paths.rootPath, "opencode-scratch");
    });

    afterEach(() => {
      if (savedOpencodeConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = savedOpencodeConfigDir;
      }
    });

    it("writes opencode.json under OPENCODE_CONFIG_DIR instead of the OS home directory", async () => {
      const result = await syncNativePermissionProjections(buildKilnYaml(), paths.projectPath);

      expect(result.errors).toHaveLength(0);
      expect(result.opencode).toBe(true);
      const scratchConfigPath = join(paths.rootPath, "opencode-scratch", "opencode.json");
      expect(existsSync(scratchConfigPath)).toBe(true);
      expect(existsSync(join(paths.homePath, ".config", "opencode", "opencode.json"))).toBe(false);
    });
  });
});
