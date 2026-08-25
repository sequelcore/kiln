import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptTrustedExecutionSemanticLimitation,
  OPENCODE_NO_FILESYSTEM_SANDBOX,
} from "@kilnai/core/security";
import {
  readConfigStatusSnapshot as readConfigStatusSnapshotImplementation,
  readConfigStatusView as readConfigStatusViewImplementation,
  type ReadConfigStatusOptions,
  type ReadConfigStatusViewOptions,
} from "../../src/application/config-status.js";
import { readSettingsSnapshot } from "../../src/application/config-settings.js";
import { KilnConfigActivationStatusSchema, type KilnConfigReadView, type KilnConfigStatusSnapshot } from "@kilnai/gateway-contracts";
import { writeRepoShimProjections } from "../../src/application/repo-shim-projection.js";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { ConfigMutationStore, type StoredConfigMutationSettlement } from "../../src/application/config-mutation-store.js";
import { createMcpCredentialAccess, KILN_MCP_SECRET_KEY_ENV } from "../../src/config/mcp-credentials.js";
import { recordMcpDiscovery } from "../../src/config/mcp-runtime-state.js";
import {
  createNativeProjectionFileSnapshot,
  createNativeProjectionSnapshot,
  emptyNativeProjectionInstallState,
  readNativeProjectionInstallState,
  resolveGlobalNativeProjectionStateDir,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "../../src/config/native-projection-state.js";
import { syncNativeSkillProjections } from "../../src/config/native-skill-projection.js";
import { createPermissionProjectionIntegrity } from "../../src/config/translators/permission-projection.js";
import { defaultKilnYaml, type KilnProjectConfig } from "../../src/kiln-yaml.js";
import {
  createRuntimePermissionObservationStore,
  deriveCodexRuntimePermissionRequest,
} from "../../src/wrapper/runtime-permission-observation.js";
import { persistGlobalConfigFixture } from "../config/global-config-fixture.js";
import { makeOperatorSurfaceGlobalConfig } from "../commands/operator-surface-config-fixture.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../../src/application/project-state-root.js";

let tempDir: string;
let projectStateBinding: ProjectStateBinding;

const emptyPluginProvider = () => ({ roots: [], diagnostics: [] });
const readConfigStatusSnapshot = (options: ReadConfigStatusOptions = {}) =>
  readConfigStatusSnapshotImplementation({
    ...options,
    projectStateBinding: options.projectStateBinding ?? projectStateBinding,
    pluginProvider: emptyPluginProvider,
  });
const readConfigStatusView = (
  snapshot: KilnConfigStatusSnapshot,
  view: KilnConfigReadView,
  options: ReadConfigStatusViewOptions = {},
) => readConfigStatusViewImplementation(snapshot, view, {
  ...options,
  projectStateBinding: options.projectStateBinding ?? projectStateBinding,
  pluginProvider: emptyPluginProvider,
});

async function detailedSkillEntries(snapshot: Awaited<ReturnType<typeof readConfigStatusSnapshot>>, userHome?: string) {
  const view = await readConfigStatusView(snapshot, "skills", { userHome });
  return (view.value as { entries: readonly Record<string, unknown>[] }).entries;
}

function writeProjectConfig(_projectPath: string): void {
  mkdirSync(dirname(projectStateBinding.configPath), { recursive: true });
  writeFileSync(projectStateBinding.configPath, [
    'version: "1"',
    "permissions:",
    "  approval: on-request",
    "  sandbox: read-only",
    "",
  ].join("\n"), "utf-8");
  persistGlobalConfigFixture({
    ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "codex-default"),
    permissions: { approval: "on-request", sandbox: "read-only" },
  });
}

function writeProjectConfigFixtureFile(configPath: string, config: KilnProjectConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringifyYaml(config), "utf8");
}

function writeSkill(root: string, name: string, description: string): void {
  writeSkillFile(root, name, "SKILL.md", description);
}

function writeSkillFile(root: string, name: string, fileName: string, description: string): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "tags:",
    "  - test",
    "---",
    "",
    `# ${name}`,
    "",
  ].join("\n"), "utf-8");
}

/** Mirror harness skill install evidence into this project's private projection state. */
function mirrorNativeProjectionState(userHome: string): void {
  writeNativeProjectionInstallState(
    projectStateBinding.projectionsPath,
    readNativeProjectionInstallState(resolveGlobalNativeProjectionStateDir(userHome)),
  );
}

describe("config-status", () => {
  it("skips plugin discovery for an unrelated targeted config view", async () => {
    writeProjectConfig(tempDir);
    const pluginProvider = vi.fn(() => ({ roots: [], diagnostics: [] }));

    await readConfigStatusSnapshotImplementation({
      projectPath: tempDir,
      projectStateBinding,
      userHome: join(tempDir, "home"),
      view: "effective",
      pluginProvider,
    });

    expect(pluginProvider).not.toHaveBeenCalled();
  });

  it("reuses one request-scoped catalog discovery for the skills view", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const pluginProvider = vi.fn(() => ({ roots: [], diagnostics: [] }));
    const snapshot = await readConfigStatusSnapshotImplementation({
      projectPath: tempDir, projectStateBinding, userHome, view: "skills", pluginProvider,
    });

    await readConfigStatusViewImplementation(snapshot, "skills", { projectStateBinding, userHome, pluginProvider });

    expect(pluginProvider).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-status-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempDir, "xdg"));
    projectStateBinding = resolveProjectStateBinding(tempDir, { kilnHome: join(tempDir, "xdg", "kiln") });
    bootstrapProjectAdoption(projectStateBinding);
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      name: "status-project",
      scripts: { test: "bun test" },
    }), "utf-8");
    persistGlobalConfigFixture({
      ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "codex-default"),
      permissions: { approval: "on-request", sandbox: "read-only" },
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("reads effective config and projection status from canonical sources", async () => {
    writeProjectConfig(tempDir);

    const snapshot = await readConfigStatusSnapshot({
      projectPath: tempDir,
      userHome: join(tempDir, "home"),
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(snapshot.generatedAt).toBe("2026-05-07T12:00:00.000Z");
    expect(snapshot.project.projectName).toBe("status-project");
    expect(snapshot.project.kilnYaml.status).toBe("valid");
    expect(snapshot.global.status).toBe("valid");
    expect(snapshot.effectiveConfigStatus).toBe("valid");
    expect(snapshot.activationStatus).toMatchObject({ state: "not-started", activeRevision: null });
    expect(snapshot.effectiveConfig?.fields).toContainEqual(expect.objectContaining({
      identity: "/provider",
      value: "codex-oauth",
      source: "global",
      health: "current",
    }));
    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:agents", status: "missing" }),
      expect.objectContaining({ targetId: "repo-shim:claude", status: "missing" }),
    ]));
    expect(snapshot.setup).toMatchObject({
      projectRoot: tempDir,
      projectContext: {
        status: "missing",
        recommendation: "adopt-project-context",
      },
      repoShims: expect.arrayContaining([
        expect.objectContaining({
          target: "agents",
          targetId: "repo-shim:agents",
          status: "missing",
          recommendation: "sync-repo-shims",
        }),
      ]),
      globalInstructionShims: expect.arrayContaining([
        expect.objectContaining({
          targetId: "codex-global-instructions",
          harness: "codex",
          kind: "global-instruction-shim",
          status: "missing",
          recommendation: "sync-global-instruction-shims",
        }),
        expect.objectContaining({
          targetId: "claude-global-instructions",
          harness: "claude-code",
          kind: "global-instruction-shim",
          status: "missing",
          recommendation: "sync-global-instruction-shims",
        }),
        expect.objectContaining({
          targetId: "opencode-global-instructions",
          harness: "opencode",
          kind: "global-instruction-shim",
          status: "missing",
          recommendation: "sync-global-instruction-shims",
        }),
      ]),
      recommendedActions: expect.arrayContaining([
        "adopt-project-context",
        "sync-repo-shims",
        "sync-global-instruction-shims",
      ]),
    });
  });

  it("reads narrow effective config from the composed binding without projection inventory after XDG changes", async () => {
    const binding = resolveProjectStateBinding(tempDir, { kilnHome: join(tempDir, "bound-kiln") });
    const globalConfig = makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "bound-default");
    mkdirSync(binding.kilnHome, { recursive: true });
    writeFileSync(join(binding.kilnHome, "config.yaml"), stringifyYaml(globalConfig), "utf-8");
    writeProjectConfigFixtureFile(binding.configPath, { version: "1" });
    vi.stubEnv("XDG_CONFIG_HOME", join(tempDir, "ambient-xdg-after-composition"));

    const snapshot = await readConfigStatusSnapshotImplementation({
      projectPath: tempDir,
      projectStateBinding: binding,
      view: "effective",
      userHome: join(tempDir, "home"),
      pluginProvider: emptyPluginProvider,
    });

    expect(snapshot.global).toMatchObject({
      path: join(binding.kilnHome, "config.yaml"),
      status: "valid",
    });
    expect(snapshot.effectiveConfigStatus).toBe("valid");
    expect(snapshot.effectiveConfig?.fields).toContainEqual(expect.objectContaining({
      identity: "/model",
      value: { default: "gpt-5.4-mini" },
    }));
    expect(snapshot.projections).toEqual([]);
    expect(snapshot.permissionIntegrity).toEqual([]);
    expect(snapshot.setup.skillDiagnostics).toEqual({
      state: "not_collected",
      reason: "Skill diagnostics are not collected by narrow effective/settings reads.",
    });
  });

  it("derives activation status from the current canonical lineage and settlement evidence", async () => {
    writeProjectConfig(tempDir);
    const projectConfigPath = projectStateBinding.configPath;
    const projectBytes = readFileSync(projectConfigPath, "utf-8");
    const projectRevision = `sha256:${createHash("sha256").update(projectBytes).digest("hex")}`;
    const settlement: StoredConfigMutationSettlement = {
      proposalId: "cfg-status-reconcile",
      approvalId: null,
      scope: "project",
      operation: "setting.set",
      settledAt: "2026-05-07T12:00:00.000Z",
      outcome: "committed",
      baseRevision: "absent",
      committedRevision: projectRevision,
      appliedWrites: [{ path: projectConfigPath, previousHash: null, nextHash: projectRevision }],
      reconciliationEffects: [],
      diagnostics: [],
      rollbackToken: "cfg-status-reconcile",
      activation: "reconcile",
      activationObservation: {
        state: "active",
        boundary: "reconcile",
        committedRevision: projectRevision,
        activeRevision: projectRevision,
        summary: "Projection converged.",
      },
      reconciliationGenerations: [],
      restore: [],
    };
    new ConfigMutationStore(tempDir, { root: projectStateBinding.mutationsPath }).settle(settlement);

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });
    expect(snapshot.activationStatus).toMatchObject({
      state: "active",
      boundary: "reconcile",
      entries: [{ proposalId: "cfg-status-reconcile", evidence: "reconciliation" }],
    });
  });

  it("uses a deterministic schema-valid revision id when activation evidence degrades", async () => {
    writeProjectConfig(tempDir);
    const globalPath = join(tempDir, "xdg", "kiln", "config.yaml");
    writeFileSync(globalPath, "version: [", "utf8");

    const first = await readConfigStatusSnapshot({ projectPath: tempDir });
    const second = await readConfigStatusSnapshot({ projectPath: tempDir });
    const firstStatus = first.activationStatus;

    expect(firstStatus).toMatchObject({ state: "unsupported", boundary: null, activeRevision: null });
    expect(firstStatus?.desiredRevisionSetId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(firstStatus?.desiredRevisionSetId).toBe(second.activationStatus?.desiredRevisionSetId);
    expect(() => KilnConfigActivationStatusSchema.parse(firstStatus)).not.toThrow();
  });

  it("projects the shared settings snapshot with inherited and modified state", async () => {
    writeProjectConfig(tempDir);
    const projectFile = projectStateBinding.configPath;
    writeFileSync(projectFile, [
      "# Preserve this comment",
      'version: "1"',
      "domain: backend",
      "permissions:",
      "  approval: on-request",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, view: "settings" });
    writeFileSync(projectFile, 'version: "1"\ndomain: frontend\n', "utf-8");
    const result = await readConfigStatusView(snapshot, "settings");
    const settings = result.value as {
      readonly activationStatus: KilnConfigStatusSnapshot["activationStatus"];
      readonly sections: readonly { readonly id: string }[];
      readonly entries: readonly {
        readonly key: string;
        readonly modified: boolean;
        readonly inherited: boolean;
        readonly effective: { readonly value?: unknown };
        readonly writeTargets: readonly { readonly document: string; readonly current?: { readonly value?: unknown } }[];
      }[];
    };
    expect(settings.activationStatus).toEqual(snapshot.activationStatus);
    expect(settings.sections.map((section) => section.id)).toEqual([
      "general", "appearance", "providers", "models", "permissions", "tools", "usage-and-limits", "agents", "health", "advanced",
    ]);
    expect(settings.entries.find((entry) => entry.key === "domain")).toMatchObject({
      modified: true,
      inherited: false,
      effective: { value: "backend" },
      writeTargets: [{ current: { value: "backend" } }],
    });
    expect(settings.entries.find((entry) => entry.key === "activeInstructionProfiles")).toMatchObject({ modified: false, inherited: true });
    expect(settings.entries.flatMap((entry) => entry.writeTargets).map((target) => target.document)).not.toContain("C:\\");
    expect(JSON.stringify(settings)).not.toContain(".kiln/kiln.yaml");
  });

  it("projects one secret-free effective value and provenance contract", async () => {
    mkdirSync(dirname(projectStateBinding.configPath), { recursive: true });
    writeFileSync(projectStateBinding.configPath, [
      'version: "1"',
      "permissions:",
      "  sandbox: read-only",
      "mcp:",
      "  servers:",
      "    private:",
      "      admission:",
      "        state: admitted",
      "",
    ].join("\n"), "utf-8");
    persistGlobalConfigFixture({
      ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "codex-default"),
      permissions: { approval: "on-request", sandbox: "read-only" },
      mcp: {
        servers: {
          private: {
            transport: "stdio",
            command: "private-server",
            env: { TOKEN: { fromEnv: "KILN_SUPER_SECRET_TOKEN" } },
            admission: { state: "admitted" },
          },
        },
      },
    });

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome: join(tempDir, "home") });
    const permissions = snapshot.effectiveConfig?.fields.find((field) => field.identity === "/permissions");
    const mcp = snapshot.effectiveConfig?.fields.find((field) => field.identity === "/mcp");

    expect(snapshot.errors).toEqual([]);
    expect(snapshot.effectiveConfig).toMatchObject({ schemaRevision: 1, health: "current" });
    expect(permissions).toMatchObject({
      scope: "effective",
      source: "composed",
      defaultStatus: "explicit",
      activation: "next-session",
      sensitivity: "public",
      overrideChain: [
        expect.objectContaining({ scope: "global", disposition: "contributed" }),
        expect.objectContaining({ scope: "project", disposition: "contributed" }),
      ],
      value: { approval: "on-request", sandbox: "read-only" },
    });
    expect(mcp).toMatchObject({
      source: "composed",
      sensitivity: "secret-reference",
      redacted: { present: true },
    });
    expect(JSON.stringify(snapshot.effectiveConfig)).not.toContain("KILN_SUPER_SECRET_TOKEN");
  });

  it("does not present stale or drifted projection evidence as current", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const codexDir = join(userHome, ".codex");
    const codexConfigPath = join(codexDir, "config.toml");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(codexConfigPath, "model = 'changed'\n", "utf-8");
    const state = emptyNativeProjectionInstallState();
    const drifted = createNativeProjectionSnapshot({
      targetId: "codex-config",
      filePath: codexConfigPath,
      document: { model: "expected" },
      managedFields: ["model"],
      updatedAt: "2026-08-20T00:00:00.000Z",
    });
    writeNativeProjectionInstallState(projectStateBinding.projectionsPath, upsertNativeProjectionTargetState(state, drifted));

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "codex-config", status: expect.stringMatching(/stale|drifted/) }),
    ]));
    expect(snapshot.effectiveConfig?.health).not.toBe("current");
    expect(snapshot.effectiveConfig?.fields.every((field) => field.health !== "current")).toBe(true);
  });

  it("reports the same rejection as runtime admission for a broadening project policy", async () => {
    mkdirSync(dirname(projectStateBinding.configPath), { recursive: true });
    writeFileSync(projectStateBinding.configPath, [
      'version: "1"',
      "permissions:",
      "  approval: on-request",
      "  sandbox: workspace-write",
      "",
    ].join("\n"), "utf-8");
    persistGlobalConfigFixture({
      ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "codex-default"),
      permissions: { approval: "on-request", sandbox: "read-only" },
    });

    const snapshot = await readConfigStatusSnapshot({
      projectPath: tempDir,
      userHome: join(tempDir, "home"),
    });

    expect(snapshot.effectiveConfigStatus).toBe("invalid");
    expect(snapshot.effectiveConfig).toBeUndefined();
    expect(snapshot.errors).toContain(
      "effective config: Project permissions.sandbox cannot broaden global.permissions.",
);

  });

  it("reports the retired global V1 boundary through config health", async () => {
    writeProjectConfig(tempDir);
    const globalDir = join(tempDir, "xdg", "kiln");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "config.yaml"), [
      'version: "1"',
      "managedAgents:",
      "  routes:",
      "    - id: legacy-runtime-selected",
      "      kind: direct",
      "      provider: codex-oauth",
      "      model: test-model",
      "      credentials:",
      "        mode: runtime-selected",
      "        accountPolicyId: legacy-policy",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome: join(tempDir, "home") });
    const health = await readConfigStatusView(snapshot, "health");

    expect(snapshot.global).toMatchObject({ status: "invalid" });
    expect(snapshot.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/Global config version must be "5"/),
    ]));
    expect(health.value).toMatchObject({
      global: { error: expect.stringContaining('Global config version must be "5"') },
    });
  });

  it("fails closed when a pre-Slice-8 status snapshot lacks activation evidence", async () => {
    writeProjectConfig(tempDir);
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, view: "settings" });
    delete (snapshot as { activationStatus?: unknown }).activationStatus;

    expect(() => readSettingsSnapshot(snapshot)).toThrow(
      "Settings projection requires canonical activation status evidence.",
    );
  });

  it("publishes canonical MCP resolution in the shared status and bounded read view", async () => {
    mkdirSync(dirname(projectStateBinding.configPath), { recursive: true });
    writeFileSync(projectStateBinding.configPath, [
      'version: "1"',
      "mcp:",
      "  servers:",
      "    fixture:",
      "      admission:",
      "        state: admitted",
      "        tools:",
      "          allow: [echo]",
      "",
    ].join("\n"), "utf-8");
    persistGlobalConfigFixture((current) => {
      if (!current) throw new Error("expected the fixture global config to exist");
      return {
        ...current,
        mcp: {
          servers: {
            fixture: { transport: "stdio", command: "fixture-mcp.exe", admission: { state: "admitted" } },
          },
        },
      };
    });
    recordMcpDiscovery(tempDir, {
      serverId: "fixture",
      tools: [{ serverId: "fixture", kind: "tool", selector: "mcp:fixture:tool:echo", descriptor: { name: "echo", inputSchema: {} } }],
      resources: [], prompts: [], discoveredAt: "2026-07-19T00:00:00.000Z",
    });

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });
    const view = await readConfigStatusView(snapshot, "mcp");

    expect(snapshot.mcp).toMatchObject({
      servers: [{
        id: "fixture",
        enabled: true,
        source: "overridden",
        transport: "stdio",
        admission: "admitted",
        trust: "untrusted",
        runtimeCompatibility: { status: "compatible" },
        health: { state: "healthy" },
        discovery: {
          state: "current",
          tools: 1,
          resources: 0,
          prompts: 0,
          admitted: 1,
          capabilities: [{
            selector: "mcp:fixture:tool:echo",
            kind: "tool",
            name: "echo",
            admitted: true,
          }],
        },
        projection: { state: "not-synchronized" },
      }],
      diagnostics: [],
    });
    expect(view.value).toEqual(snapshot.mcp);
  });

  it("keeps credential-backed servers valid in status without exposing the secret", async () => {
    const userHome = join(tempDir, "home");
    vi.stubEnv(KILN_MCP_SECRET_KEY_ENV, "status-test-master-key");
    createMcpCredentialAccess(process.env, projectStateBinding.kilnHome).set("docs-token", "super-secret-token");
    mkdirSync(dirname(projectStateBinding.configPath), { recursive: true });
    writeFileSync(projectStateBinding.configPath, [
      'version: "1"',
      "mcp:",
      "  servers:",
      "    docs:",
      "      admission: { state: admitted }",
      "",
    ].join("\n"), "utf-8");
    persistGlobalConfigFixture((current) => {
      if (!current) throw new Error("expected the fixture global config to exist");
      return {
        ...current,
        mcp: {
          servers: {
            docs: {
              transport: "streamable-http",
              url: "https://mcp.example.com/mcp",
              headers: { Authorization: { fromCredential: "docs-token" } },
              admission: { state: "admitted" },
            },
          },
        },
      };
    });

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(snapshot.mcp.servers).toEqual([expect.objectContaining({ id: "docs" })]);
    expect(snapshot.mcp.diagnostics).toEqual([]);
    expect(JSON.stringify(snapshot.mcp)).not.toContain("super-secret-token");
  });

  it("reports a server incompatible when no native harness can preserve its policy", async () => {
    mkdirSync(dirname(projectStateBinding.configPath), { recursive: true });
    writeFileSync(projectStateBinding.configPath, [
      'version: "1"',
      "mcp:",
      "  servers:",
      "    guarded:",
      "      admission: { state: admitted }",
      "",
    ].join("\n"), "utf-8");
    persistGlobalConfigFixture((current) => {
      if (!current) throw new Error("expected the fixture global config to exist");
      return {
        ...current,
        mcp: {
          servers: {
            guarded: { transport: "stdio", command: "guarded-mcp.exe", maxCapabilities: 16, admission: { state: "admitted" } },
          },
        },
      };
    });

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome: join(tempDir, "home") });

    expect(snapshot.mcp.servers[0]).toMatchObject({
      id: "guarded",
      projection: { state: "incompatible" },
      projectionCompatibility: [
        { harness: "codex", status: "incompatible" },
        { harness: "claude", status: "incompatible" },
        { harness: "opencode", status: "incompatible" },
      ],
    });
  });

  it("marks generated repo shims as current", async () => {
    writeProjectConfig(tempDir);
    await writeRepoShimProjections(tempDir);

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:agents", status: "current" }),
      expect.objectContaining({ targetId: "repo-shim:claude", status: "current" }),
      expect.objectContaining({
        targetId: "workflow-snapshot:manifest",
        kind: "workflow-snapshot",
        status: "current",
      }),
    ]));
    expect(snapshot.setup.repoShims).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:agents", status: "current", recommendation: "none" }),
      expect.objectContaining({ targetId: "repo-shim:claude", status: "current", recommendation: "none" }),
    ]));
  });

  it("reports workflow snapshot manifest drift without mutating canonical state", async () => {
    writeProjectConfig(tempDir);
    await writeRepoShimProjections(tempDir);
    const manifestPath = join(projectStateBinding.projectionsPath, "workflow-snapshot-manifest.json");
    const originalManifest = readFileSync(manifestPath, "utf-8");
    const staleManifest = JSON.stringify({
      ...JSON.parse(originalManifest),
      hash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    }, null, 2);
    writeFileSync(manifestPath, `${staleManifest}\n`, "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "workflow-snapshot:manifest",
        kind: "workflow-snapshot",
        status: "stale",
        details: expect.stringContaining("expected sha256:"),
      }),
    ]));
    expect(snapshot.effectiveConfig?.health).toBe("stale");
    expect(snapshot.effectiveConfig?.fields.every((field) => field.health === "stale")).toBe(true);
    expect(readFileSync(manifestPath, "utf-8")).toBe(`${staleManifest}\n`);
  });

  it("returns bounded read views", async () => {
    writeProjectConfig(tempDir);
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    const permissions = await readConfigStatusView(snapshot, "permissions");
    const health = await readConfigStatusView(snapshot, "health");
    const setup = await readConfigStatusView(snapshot, "setup");

    expect(permissions.value).toMatchObject({
      configuration: {
        identity: "/permissions",
        value: { approval: "on-request", sandbox: "read-only" },
      },
      permissionIntegrity: [],
    });
    expect(JSON.stringify(health.value)).toContain("harnessCapabilities");
    expect(health.value).toMatchObject({
      harnessCapabilities: expect.arrayContaining([
        expect.objectContaining({
          harness: "codex",
          nativeProjection: "install-state",
        }),
      ]),
    });
    expect(setup.value).toEqual({ ...snapshot.setup, effectiveConfig: snapshot.effectiveConfig });
  });

  it("reports unresolved native projection decisions for configured agents", async () => {
    writeProjectConfig(tempDir);
    const agentsDir = projectStateBinding.agentsPath;
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "reviewer.md"), [
      "---",
      "name: reviewer",
      "role: Review specialist",
      "goal: Review implementation quality",
      "tier: reasoning",
      "targetId: codex-unconfigured",
      "authorityProfileId: foundation-readonly-plan",
      "---",
      "Review only.",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome: join(tempDir, "home") });
    const agents = await readConfigStatusView(snapshot, "agents");

    expect(JSON.stringify(agents.value)).toContain('"routeId":"codex-unconfigured"');
    expect(JSON.stringify(agents.value)).toContain('"status":"unresolved"');
  });

  it("reports native route default drift through setup projection status", async () => {
    writeProjectConfig(tempDir);
    const codexConfigPath = join(tempDir, "home", ".codex", "config.toml");
    const projected = {
      model: "gpt-5.4-mini",
      approval_policy: "on-request",
      sandbox_mode: "read-only",
    };
    mkdirSync(join(tempDir, "home", ".codex"), { recursive: true });
    writeFileSync(codexConfigPath, stringifyToml({
      ...projected,
      model: "gpt-5.3-codex-spark",
    }), "utf-8");
    writeNativeProjectionInstallState(
      projectStateBinding.projectionsPath,
      upsertNativeProjectionTargetState(
        emptyNativeProjectionInstallState(),
        createNativeProjectionSnapshot({
          targetId: "codex-config",
          filePath: codexConfigPath,
          document: projected,
          managedFields: ["model", "approval_policy", "sandbox_mode"],
          updatedAt: "2026-07-01T12:00:00.000Z",
        }),
      ),
    );
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "codex-config",
        status: "drifted",
        routeIntegrity: expect.objectContaining({
          canonicalRoute: { providerId: "codex-oauth", model: "gpt-5.4-mini" },
          nativeConfiguredDefault: { providerId: "codex-oauth", model: "gpt-5.3-codex-spark" },
          selectedRuntimeRoute: { providerId: "codex-oauth", model: "gpt-5.3-codex-spark" },
          catalogStatus: {
            status: "not-observable",
            providerId: "codex-oauth",
            model: "gpt-5.3-codex-spark",
          },
          explicitProbeStatus: "not-run",
          credentialSource: "none",
          bareProofSupported: false,
          classification: "projection-drift",
          routeStatus: "drifted",
          credentialStatus: "unknown",
        }),
      }),
    ]));
    expect(snapshot.setup.recommendedActions).toContain("review-native-projection-drift");
  });

  it("downgrades permission integrity evidence when native projection drift is detected", async () => {
    writeProjectConfig(tempDir);
    const codexConfigPath = join(tempDir, "home", ".codex", "config.toml");
    const projected = {
      approval_policy: "on-request",
      sandbox_mode: "read-only",
    };
    mkdirSync(join(tempDir, "home", ".codex"), { recursive: true });
    writeFileSync(codexConfigPath, stringifyToml({
      approval_policy: "never",
      sandbox_mode: "danger-full-access",
    }), "utf-8");
    writeNativeProjectionInstallState(
      projectStateBinding.projectionsPath,
      upsertNativeProjectionTargetState(
        emptyNativeProjectionInstallState(),
        createNativeProjectionSnapshot({
          targetId: "codex-config",
          filePath: codexConfigPath,
          document: projected,
          managedFields: ["approval_policy", "sandbox_mode"],
          permissionIntegrity: {
            harness: "codex",
            desired: {
              profile: "restricted",
              source: "operator-local-config",
              observedAt: "2026-07-01T15:00:00.000Z",
              verifiedAt: "2026-07-01T15:00:01.000Z",
              freshness: "current",
              proof: "proven",
            },
            persistedNative: {
              profile: "restricted",
              source: "native-config",
              observedAt: "2026-07-01T15:01:00.000Z",
              verifiedAt: "2026-07-01T15:01:01.000Z",
              freshness: "current",
              proof: "proven",
              projectionOwnership: "kiln-managed",
            },
            enforcement: {
              approvalControl: "enforced",
              filesystemSandbox: "enforced",
              networkBoundary: "enforced",
              strength: "strong",
            },
            authorization: { status: "unavailable", revocable: true },
            semanticLoss: [],
            semanticLimitations: [],
            limitationAcceptances: [],
            classification: "effective-policy-unproven",
            recommendation: "Verify effective runtime authority.",
            remediationRequiresApproval: false,
            lastVerifiedAt: "2026-07-01T15:01:01.000Z",
          },
        }),
      ),
    );

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "codex-config",
        status: "drifted",
        permissionIntegrity: expect.objectContaining({
          classification: "native-projection-drift",
          persistedNative: expect.objectContaining({
            freshness: "stale",
            proof: "contradictory",
          }),
        }),
      }),
    ]));
  });

  it("reports canonical and native route defaults as separate matching evidence", async () => {
    writeProjectConfig(tempDir);
    const codexConfigPath = join(tempDir, "home", ".codex", "config.toml");
    const projected = {
      model: "gpt-5.4-mini",
      approval_policy: "on-request",
      sandbox_mode: "read-only",
    };
    mkdirSync(join(tempDir, "home", ".codex"), { recursive: true });
    writeFileSync(codexConfigPath, stringifyToml(projected), "utf-8");
    writeNativeProjectionInstallState(
      projectStateBinding.projectionsPath,
      upsertNativeProjectionTargetState(
        emptyNativeProjectionInstallState(),
        createNativeProjectionSnapshot({
          targetId: "codex-config",
          filePath: codexConfigPath,
          document: projected,
          managedFields: ["model", "approval_policy", "sandbox_mode"],
          updatedAt: "2026-07-01T12:00:00.000Z",
        }),
      ),
    );

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "codex-config",
        status: "managed",
        routeIntegrity: expect.objectContaining({
          canonicalRoute: { providerId: "codex-oauth", model: "gpt-5.4-mini" },
          nativeConfiguredDefault: { providerId: "codex-oauth", model: "gpt-5.4-mini" },
          selectedRuntimeRoute: { providerId: "codex-oauth", model: "gpt-5.4-mini" },
          explicitProbeStatus: "not-run",
          credentialStatus: "not-tested",
          routeStatus: "matches-canonical",
          classification: "ok",
        }),
      }),
    ]));
  });

  it("reads OpenCode limitation acceptance from the established binding home instead of ambient XDG state", async () => {
    const binding = resolveProjectStateBinding(tempDir, { kilnHome: join(tempDir, "bound-kiln") });
    const userHome = join(tempDir, "native-home");
    const opencodeConfigPath = join(userHome, ".config", "opencode", "opencode.json");
    const now = new Date("2026-08-23T00:00:00.000Z");
    const integrity = createPermissionProjectionIntegrity({
      harness: "opencode",
      policy: { approval: "on-request", sandbox: "workspace-write" },
      translated: {
        backend: "opencode",
        config: { permissionDefault: "ask" },
        nativeRules: { tools: [], commands: [], fileGovernance: { denyGlobs: [], askGlobs: [], allowGlobs: [] } },
        representableRules: [],
        unsupportedRules: [],
        constraintInstructions: [],
        warnings: [],
      },
      enforcement: { approvalControl: "not-enforced", filesystemSandbox: "not-enforced", networkBoundary: "unknown", strength: "rules-only" },
      semanticLimitations: [OPENCODE_NO_FILESYSTEM_SANDBOX],
      now,
    });

    writeProjectConfigFixtureFile(binding.configPath, {
      version: "1",
      permissions: { approval: "on-request", sandbox: "read-only" },
    });
    mkdirSync(dirname(opencodeConfigPath), { recursive: true });
    writeFileSync(opencodeConfigPath, JSON.stringify({ permission: { "*": "ask" } }), "utf-8");
    writeNativeProjectionInstallState(
      binding.projectionsPath,
      upsertNativeProjectionTargetState(
        emptyNativeProjectionInstallState(),
        createNativeProjectionSnapshot({
          targetId: "opencode-config",
          filePath: opencodeConfigPath,
          document: { permission: { "*": "ask" } },
          managedFields: ["permission.*"],
          permissionIntegrity: integrity,
        }),
      ),
    );

    const ambientLimitationDir = join(projectStateBinding.kilnHome, "trust", "semantic-limitations");
    const bindingLimitationDir = join(binding.kilnHome, "trust", "semantic-limitations");
    const acceptanceInput = {
      projectPath: tempDir,
      descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX,
      acceptedAt: "2026-08-13T01:00:00.000Z",
      reviewAfter: OPENCODE_NO_FILESYSTEM_SANDBOX.reviewAfter,
    };
    acceptTrustedExecutionSemanticLimitation({ ...acceptanceInput, acceptedBy: "ambient-home", baseDir: ambientLimitationDir });
    acceptTrustedExecutionSemanticLimitation({ ...acceptanceInput, acceptedBy: "binding-home", baseDir: bindingLimitationDir });

    const snapshot = await readConfigStatusSnapshotImplementation({
      projectPath: tempDir,
      projectStateBinding: binding,
      userHome,
      now,
      pluginProvider: emptyPluginProvider,
    });
    const projection = snapshot.projections.find((item) => item.targetId === "opencode-config");
    expect(projection?.permissionIntegrity).toMatchObject({
      remediationRequiresApproval: false,
      limitationAcceptances: [expect.objectContaining({ acceptedBy: "binding-home" })],
    });
  });

  it("reports native permission integrity from install-state evidence", async () => {
    writeProjectConfig(tempDir);
    const codexConfigPath = join(tempDir, "home", ".codex", "config.toml");
    const projected = {
      approval_policy: "never",
      sandbox_mode: "danger-full-access",
    };
    mkdirSync(join(tempDir, "home", ".codex"), { recursive: true });
    writeFileSync(codexConfigPath, stringifyToml(projected), "utf-8");
    writeNativeProjectionInstallState(
      projectStateBinding.projectionsPath,
      upsertNativeProjectionTargetState(
        emptyNativeProjectionInstallState(),
        createNativeProjectionSnapshot({
          targetId: "codex-config",
          filePath: codexConfigPath,
          document: projected,
          managedFields: ["approval_policy", "sandbox_mode"],
          permissionIntegrity: {
            harness: "codex",
            desired: {
              profile: "trusted-full-access",
              source: "operator-local-config",
              observedAt: "2026-07-01T15:00:00.000Z",
              verifiedAt: "2026-07-01T15:00:01.000Z",
              freshness: "current",
              proof: "proven",
            },
            persistedNative: {
              profile: "trusted-full-access",
              source: "native-config",
              observedAt: "2026-07-01T15:01:00.000Z",
              verifiedAt: "2026-07-01T15:01:01.000Z",
              freshness: "current",
              proof: "proven",
              projectionOwnership: "kiln-managed",
            },
            enforcement: {
              approvalControl: "enforced",
              filesystemSandbox: "enforced",
              networkBoundary: "enforced",
              strength: "strong",
            },
            authorization: { status: "unavailable", revocable: true },
            semanticLoss: [],
            semanticLimitations: [],
            limitationAcceptances: [],
            classification: "effective-policy-unproven",
            recommendation: "Verify effective runtime authority.",
            remediationRequiresApproval: true,
            lastVerifiedAt: "2026-07-01T15:01:01.000Z",
          },
        }),
      ),
    );

    const observedAt = new Date("2026-07-01T15:02:00.000Z");
    const runtimeStore = createRuntimePermissionObservationStore({ projectPath: tempDir, projectStateBinding });
    const requested = await runtimeStore.recordRequested(
      deriveCodexRuntimePermissionRequest({
        sessionId: "portable-test-session",
        approvalMode: "never",
        sandboxMode: "danger-full-access",
        requestedAt: observedAt,
      }),
    );
    await runtimeStore.recordObserved(requested, { observedAt, proof: "inferred" });
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, now: observedAt });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "codex-config",
        permissionIntegrity: expect.objectContaining({
          harness: "codex",
          classification: "partial-observation",
          effectiveRuntime: expect.objectContaining({
            profile: "trusted-full-access",
            source: "runtime-observation",
            proof: "inferred",
            freshness: "current",
          }),
        }),
      }),
    ]));
    expect(snapshot.permissionIntegrity).toEqual([
      expect.objectContaining({
        harness: "codex",
        classification: "partial-observation",
      }),
    ]);
    expect(snapshot.setup.permissionIntegrity).toEqual(snapshot.permissionIntegrity);
    expect(snapshot.effectiveConfig?.health).toBe("unknown");
    expect(snapshot.effectiveConfig?.fields.every((field) => field.health === "unknown")).toBe(true);

    const permissionsView = await readConfigStatusView(snapshot, "permissions");

    expect(permissionsView.value).toMatchObject({
      configuration: {
        identity: "/permissions",
        value: {
          approval: "on-request",
          sandbox: "read-only",
        },
      },
      permissionIntegrity: [
        expect.objectContaining({
          harness: "codex",
          classification: "partial-observation",
        }),
      ],
    });
  });

  it("does not report missing default after an owned stale native default is removed", async () => {
    writeProjectConfig(tempDir);
    const codexConfigPath = join(tempDir, "home", ".codex", "config.toml");
    const projected = {
      approval_policy: "on-request",
      sandbox_mode: "read-only",
    };
    mkdirSync(join(tempDir, "home", ".codex"), { recursive: true });
    writeFileSync(codexConfigPath, stringifyToml(projected), "utf-8");
    writeNativeProjectionInstallState(
      projectStateBinding.projectionsPath,
      upsertNativeProjectionTargetState(
        emptyNativeProjectionInstallState(),
        createNativeProjectionSnapshot({
          targetId: "codex-config",
          filePath: codexConfigPath,
          document: projected,
          managedFields: ["approval_policy", "sandbox_mode"],
          updatedAt: "2026-07-01T12:00:00.000Z",
        }),
      ),
    );

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "codex-config",
        status: "managed",
      }),
    ]));
    const codexProjection = snapshot.projections.find((projection) => projection.targetId === "codex-config");
    expect(codexProjection?.routeIntegrity).toBeUndefined();
  });

  it("reports adapter-supported agents without native projection", async () => {
    writeProjectConfig(tempDir);
    const agentsDir = projectStateBinding.agentsPath;
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "opencode-reviewer.md"), [
      "---",
      "name: opencode-reviewer",
      "role: OpenCode review specialist",
      "goal: Review implementation quality through OpenCode",
      "tier: reasoning",
      "targetId: opencode-review",
      "authorityProfileId: foundation-readonly-plan",
      "---",
      "Review only.",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome: join(tempDir, "home") });
    const agents = await readConfigStatusView(snapshot, "agents");

    expect(JSON.stringify(agents.value)).toContain('"id":"opencode-reviewer"');
    expect(JSON.stringify(agents.value)).toContain('"kind":"route-admission"');
  });

  it("reports content-free communication resolution for native agent projections", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const agentsDir = join(userHome, ".kiln", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "reviewer.md"), [
      "---",
      "name: reviewer",
      "role: Review specialist",
      "goal: Review implementation quality",
      "tier: reasoning",
      "communication:",
      "  locale: es-MX",
      "  requiredContent: [finding, verification]",
      "---",
      "Private agent instructions.",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });
    const agents = await readConfigStatusView(snapshot, "agents", { userHome });
    const value = agents.value as { agents: readonly { id: string; nativeProjections: readonly unknown[] }[] };
    const reviewer = value.agents.find((agent) => agent.id === "reviewer");
    const serialized = JSON.stringify(reviewer);

    expect(reviewer?.nativeProjections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: "codex",
        status: "projected",
        communicationResolution: expect.objectContaining({
          execution: expect.objectContaining({ harness: "codex" }),
          requested: expect.objectContaining({
            intent: expect.objectContaining({ locale: "es-MX", requiredContent: ["finding", "verification"] }),
          }),
        }),
      }),
    ]));
    expect(serialized).not.toContain("Private agent instructions");
  });

  it("reports canonical direct-route admission independently from native projection", async () => {
    writeProjectConfig(tempDir);
    const agentsDir = projectStateBinding.agentsPath;
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "opencode-reviewer.md"), [
      "---",
      "name: opencode-reviewer",
      "role: OpenCode review specialist",
      "goal: Review implementation quality through OpenCode",
      "tier: reasoning",
      "targetId: opencode-review",
      "authorityProfileId: foundation-readonly-plan",
      "---",
      "Review only.",
      "",
    ].join("\n"), "utf-8");
    const admission = {
      status: "admitted" as const,
      route: {
        identity: { routeId: "opencode-review", revision: "v1" },
        target: { providerId: "opencode-go", modelId: "deepseek-v4-flash" },
        adapter: { kind: "direct-provider" as const, capabilityId: "opencode-go-direct", capabilityVersion: "v1" },
        authorityCeiling: "read_only" as const,
        toolNames: [],
        supportsRecursion: false,
        supportsAttachments: false,
        supportsWrite: false,
        proof: { status: "configured" as const, source: "test", provenProfiles: ["foundation-readonly-plan" as const] },
        capacity: { kind: "policy-bound" as const, accountPolicyId: "managed-opencode-go" },
        settlement: { kind: "managed-economic-selection" as const, contractVersion: "managed-economic-v1" as const, policyIds: ["managed-opencode-go"], pendingSettlement: "required" as const, recovery: "required" as const },
      },
      effectiveAuthority: "read_only" as const,
      allowedToolNames: [],
    };

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome: join(tempDir, "home") });
    const agents = await readConfigStatusView(snapshot, "agents", {
      userHome: join(tempDir, "home"),
      createManagedAgentRouteAdmissionResolver: async () => ({ resolve: () => admission }),
    });
    const agent = (agents.value as {
      agents: readonly {
        id: string;
        nativeProjections: readonly unknown[];
        invocationCapabilities: readonly unknown[];
      }[];
    }).agents.find((candidate) => candidate.id === "opencode-reviewer");

    expect(agent?.nativeProjections).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "unavailable", reason: { kind: "route-admission", reasons: [{ code: "capacity-policy-mismatch" }] } }),
    ]));
    expect(agent?.invocationCapabilities).toEqual([
      expect.objectContaining({ target: "claude", status: "admitted" }),
      expect.objectContaining({ target: "codex", status: "admitted" }),
      expect.objectContaining({ target: "opencode", status: "admitted" }),
    ]);
  });

  it("reports configured skill origin, projection state, and project override precedence", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    writeSkill(join(userHome, ".kiln", "skills"), "custom-user", "User skill.");
    writeSkill(join(userHome, ".kiln", "skills"), "tdd-workflow", "User override.");
    writeSkill(projectStateBinding.skillsPath, "tdd-workflow", "Project override.");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });
    const skills = await readConfigStatusView(snapshot, "skills", { userHome });

    expect(skills.value).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          name: "custom-user",
          origin: "user",
          configured: true,
          builtIn: false,
          admission: expect.objectContaining({ state: "available" }),
        }),
        expect.objectContaining({
          name: "tdd-workflow",
          description: "Project override.",
          origin: "project",
          configured: true,
          builtIn: true,
          projections: expect.arrayContaining([
            expect.objectContaining({ target: "codex", status: "missing" }),
          ]),
        }),
      ]),
    });
    expect(snapshot.setup.recommendedActions).toContain("sync-native-projections");
    expect(snapshot.skills).toBeUndefined();
    expect(snapshot.setup.skills).toMatchObject({ complete: expect.any(Boolean), harnesses: expect.any(Array) });
    expect(snapshot.setup.skills?.issues.length).toBeLessThanOrEqual(12);
    expect(snapshot.setup.skills?.issueCount).toBeGreaterThan(12);
    expect(snapshot.setup.skills?.omittedIssueCount).toBe((snapshot.setup.skills?.issueCount ?? 0) - 12);
    expect(snapshot.setup.skills?.issues).toContainEqual(expect.objectContaining({
      skillName: "custom-user", kind: "missing", harness: "codex", projectionState: "missing",
    }));
  });

  it("does not recommend repeating sync for fail-closed OpenCode explicit-only visibility", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    writeSkill(join(userHome, ".kiln", "skills"), "planner", "Plan work.");
    const skillConfig = {
      builtin: { enabled: false },
      visibility: { overrides: { planner: "explicit-only" as const } },
    };

    await syncNativeSkillProjections(tempDir, { userHome, skillConfig, projectStateBinding });
    mirrorNativeProjectionState(userHome);
    writeProjectConfigFixtureFile(projectStateBinding.configPath, defaultKilnYaml("default"));
    const globalDir = join(tempDir, "xdg", "kiln");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "config.yaml"), [
      'version: "5"',
      "permissions:",
      "  approval: on-request",
      "  sandbox: read-only",
      "skills:", "  builtin:", "    enabled: false", "  visibility:", "    overrides:", "      planner: explicit-only", "",
    ].join("\n"), "utf8");
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(snapshot.setup.recommendedActions).not.toContain("sync-native-projections");
    expect(snapshot.setup.skills, JSON.stringify(snapshot.errors)).toBeDefined();
    expect(snapshot.setup.skills?.issues).toContainEqual(expect.objectContaining({
      skillName: "planner", harness: "opencode", kind: "capability", projectionState: "missing",
    }));
  });

  it("reports unmanaged harness-local skills without admitting them", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    writeSkill(join(userHome, ".codex", "skills"), "shadcn", "Codex local skill.");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(await detailedSkillEntries(snapshot, userHome)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "shadcn",
        origin: "native-harness",
        configured: false,
        admission: expect.objectContaining({
          state: "unavailable",
        }),
        omissionReason: "native-harness-local-only",
        projections: [
          expect.objectContaining({
            target: "codex",
            status: "unmanaged-native",
          }),
        ],
      }),
    ]));
    expect(snapshot.setup.recommendedActions).toContain("adopt-or-back-up-native-guidance");
  });

  it("matches native projection status using the canonical skill file casing", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    writeSkillFile(join(userHome, ".kiln", "skills"), "shadcn", "skill.md", "User skill.");

    await syncNativeSkillProjections(tempDir, { userHome, projectStateBinding });
    mirrorNativeProjectionState(userHome);
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(await detailedSkillEntries(snapshot, userHome)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "shadcn",
        origin: "user",
        configured: true,
        projections: expect.arrayContaining([
          expect.objectContaining({ target: "codex", status: "projected" }),
          expect.objectContaining({ target: "claude", status: "projected" }),
          expect.objectContaining({ target: "opencode", status: "projected" }),
        ]),
      }),
    ]));
  });

  it("reports drift when any projected skill file changes", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const skillRoot = join(userHome, ".kiln", "skills");
    writeSkill(skillRoot, "multi-file", "User skill.");
    writeFileSync(join(skillRoot, "multi-file", "notes.md"), "canonical\n", "utf-8");

    await syncNativeSkillProjections(tempDir, { userHome, projectStateBinding });
    mirrorNativeProjectionState(userHome);
    writeFileSync(join(userHome, ".codex", "skills", "multi-file", "notes.md"), "drifted\n", "utf-8");
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(await detailedSkillEntries(snapshot, userHome)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "multi-file",
        projections: expect.arrayContaining([
          expect.objectContaining({ target: "codex", status: "drifted" }),
        ]),
      }),
    ]));
  });

  it("keeps private projection evidence authoritative after global install state changes", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const skillRoot = join(userHome, ".kiln", "skills");
    writeSkill(skillRoot, "private-evidence", "User skill.");

    await syncNativeSkillProjections(tempDir, { userHome, projectStateBinding });
    mirrorNativeProjectionState(userHome);
    const installStatePath = join(userHome, ".kiln", "runtime", "native-projections", "install-state.json");
    const installState = JSON.parse(readFileSync(installStatePath, "utf8")) as {
      targets: Record<string, { contentHash: string; managedFieldHashes: Record<string, string> }>;
    };
    for (const target of Object.values(installState.targets)) {
      if (!target.managedFieldHashes.$file) continue;
      target.contentHash = "historical-snapshot";
      target.managedFieldHashes.$file = "historical-snapshot";
    }
    writeFileSync(installStatePath, JSON.stringify(installState), "utf8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(await detailedSkillEntries(snapshot, userHome)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "private-evidence",
        projections: expect.arrayContaining([
          expect.objectContaining({ target: "claude", status: "projected" }),
          expect.objectContaining({ target: "codex", status: "projected" }),
          expect.objectContaining({ target: "opencode", status: "projected" }),
        ]),
      }),
    ]));
  });

  it("reports an untouched projected skill file as managed, not drifted", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const skillRoot = join(userHome, ".kiln", "skills");
    writeSkill(skillRoot, "untouched", "User skill.");

    await syncNativeSkillProjections(tempDir, { userHome, projectStateBinding });
    mirrorNativeProjectionState(userHome);
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    // Skill projections are written and drift-checked as bytes.  A status
    // reader that re-reads them as UTF-8 hashes a different value and reports
    // every skill as drifted, burying real drift under false positives.
    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "claude-skill:untouched/SKILL.md",
        status: "managed",
      }),
    ]));
  });

  it("reports an unchanged string-written file projection as managed", async () => {
    writeProjectConfig(tempDir);
    const hookPath = join(tempDir, "home", ".claude", "hooks", "autoformat.sh");
    const content = "#!/usr/bin/env bash\necho formatted\n";
    mkdirSync(join(tempDir, "home", ".claude", "hooks"), { recursive: true });
    writeFileSync(hookPath, content, "utf-8");
    writeNativeProjectionInstallState(
      projectStateBinding.projectionsPath,
      upsertNativeProjectionTargetState(
        emptyNativeProjectionInstallState(),
        // Hook, agent and shim projections hash their content as a string,
        // unlike skills which hash bytes.  The status reader sees both through
        // one code path, so it must accept either recorded hash.
        createNativeProjectionFileSnapshot({ targetId: "claude-autoformat-hook", filePath: hookPath, content }),
      ),
    );

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome: join(tempDir, "home") });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "claude-autoformat-hook", status: "managed" }),
    ]));
  });

  it("reports drift when a nested projected skill resource changes", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const skillRoot = join(userHome, ".kiln", "skills");
    writeSkill(skillRoot, "nested-resource", "User skill.");
    const referenceDir = join(skillRoot, "nested-resource", "references");
    mkdirSync(referenceDir, { recursive: true });
    writeFileSync(join(referenceDir, "workflow.md"), "canonical\n", "utf-8");

    await syncNativeSkillProjections(tempDir, { userHome, projectStateBinding });
    mirrorNativeProjectionState(userHome);
    writeFileSync(
      join(userHome, ".codex", "skills", "nested-resource", "references", "workflow.md"),
      "drifted\n",
      "utf-8",
    );
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(await detailedSkillEntries(snapshot, userHome)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "nested-resource",
        projections: expect.arrayContaining([
          expect.objectContaining({ target: "codex", status: "drifted" }),
        ]),
      }),
    ]));
  });

  it("requires review when a configured skill projection is not owned by install state", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    writeSkill(join(userHome, ".kiln", "skills"), "manual-copy", "Configured skill.");
    writeSkill(join(userHome, ".codex", "skills"), "manual-copy", "Manual native copy.");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(await detailedSkillEntries(snapshot, userHome)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "manual-copy",
        projections: expect.arrayContaining([
          expect.objectContaining({ target: "codex", status: "unmanaged-native" }),
        ]),
      }),
    ]));
    expect(snapshot.setup.recommendedActions).toContain("review-native-projection-drift");
  });

  it("rejects registry directories whose frontmatter name does not match their identity", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const skillDir = join(userHome, ".kiln", "skills", "directory-name");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), [
      "---",
      "name: different-name",
      "description: Mismatched identity.",
      "---",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    const entries = await detailedSkillEntries(snapshot, userHome);
    expect(entries.some((entry) => entry.name === "different-name")).toBe(false);
    expect(entries.some((entry) => entry.name === "directory-name")).toBe(false);
  });

  it("projects flat registry skill files and reports convergence", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    const registryRoot = join(userHome, ".kiln", "skills");
    mkdirSync(registryRoot, { recursive: true });
    writeFileSync(join(registryRoot, "flat-skill.md"), [
      "---",
      "name: flat-skill",
      "description: Flat registry skill.",
      "---",
      "",
    ].join("\n"), "utf-8");

    await syncNativeSkillProjections(tempDir, { userHome, projectStateBinding });
    mirrorNativeProjectionState(userHome);
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(await detailedSkillEntries(snapshot, userHome)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "flat-skill",
        projections: expect.arrayContaining([
          expect.objectContaining({ target: "claude", status: "projected" }),
          expect.objectContaining({ target: "codex", status: "projected" }),
          expect.objectContaining({ target: "opencode", status: "projected" }),
        ]),
      }),
    ]));
  });

  it("reports only the global CLI memory path", async () => {
    writeProjectConfig(tempDir);

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });
    const memory = await readConfigStatusView(snapshot, "memory");

    expect(memory.value).toMatchObject({
      configuration: { identity: "/permissions" },
      memoryDbPresent: expect.any(Boolean),
    });
    expect(JSON.stringify(memory.value)).toContain("memory.db");
    expect((memory.value as { memoryDbPath: string }).memoryDbPath).not.toBe(join(projectStateBinding.projectStateRoot, "memory.db"));
    expect(JSON.stringify(memory.value)).not.toContain("legacy");
    expect(JSON.stringify(memory.value)).not.toContain("migration");
  });

  it("reports invalid project context without blocking effective config", async () => {
    writeProjectConfig(tempDir);
    mkdirSync(dirname(projectStateBinding.contextPath), { recursive: true });
    writeFileSync(projectStateBinding.contextPath, "# invalid", "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.project.projectContext.status).toBe("invalid");
    expect(snapshot.effectiveConfigStatus).toBe("valid");
    expect(snapshot.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("project context"),
    ]));
    expect(readFileSync(projectStateBinding.contextPath, "utf-8")).toBe("# invalid");
  });

  it("reports missing global Claude concise projection from canonical communication intent", async () => {
    writeProjectConfig(tempDir);
    persistGlobalConfigFixture((current) => {
      if (!current) throw new Error("expected the fixture global config to exist");
      return {
        ...current,
        communication: { responseDetail: "concise", onUnsupported: "omit" },
      };
    });

    const snapshot = await readConfigStatusSnapshot({
      projectPath: tempDir,
      userHome: join(tempDir, "home"),
    });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "claude-global-output-style",
        kind: "native",
        status: "missing",
      }),
    ]));
    expect(snapshot.setup.recommendedActions).toContain("sync-native-projections");
  });

  it("reports legacy duplicated project context as invalid", async () => {
    writeProjectConfig(tempDir);
    mkdirSync(dirname(projectStateBinding.contextPath), { recursive: true });
    writeFileSync(projectStateBinding.contextPath, [
      "---",
      'version: "1"',
      "source: deterministic-repo-scout",
      "scripts:",
      "  test: bun run stale-test",
      "---",
      "",
      "# Project Context",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.project.projectContext.status).toBe("invalid");
    expect(snapshot.project.projectContext.error).toMatch(/version 2 reviewed-project-context/u);
  });
});
