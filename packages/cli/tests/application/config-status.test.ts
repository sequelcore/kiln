import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { readConfigStatusSnapshot, readConfigStatusView } from "../../src/application/config-status.js";
import { writeRepoShimProjections } from "../../src/application/repo-shim-projection.js";
import { syncNativeSkillProjections } from "../../src/config/native-skill-projection.js";
import {
  createNativeProjectionSnapshot,
  emptyNativeProjectionInstallState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "../../src/config/native-projection-state.js";

let tempDir: string;

function writeProjectConfig(projectPath: string): void {
  mkdirSync(join(projectPath, ".kiln"), { recursive: true });
  writeFileSync(join(projectPath, ".kiln", "kiln.yaml"), [
    'version: "1"',
    "provider: codex-oauth",
    "model:",
    "  default: gpt-5.4-mini",
    "permissions:",
    "  approval: on-request",
    "  sandbox: read-only",
    "",
  ].join("\n"), "utf-8");
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

describe("config-status", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-status-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempDir, "xdg"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      name: "status-project",
      scripts: { test: "bun test" },
    }), "utf-8");
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
    expect(snapshot.global.status).toBe("missing");
    expect(snapshot.effectiveConfigStatus).toBe("valid");
    expect(snapshot.effectiveConfig?.provider).toBe("codex-oauth");
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
          kind: "global-instruction-shim",
          status: "missing",
        }),
        expect.objectContaining({
          targetId: "claude-global-instructions",
          kind: "global-instruction-shim",
          status: "missing",
        }),
        expect.objectContaining({
          targetId: "opencode-global-instructions",
          kind: "global-instruction-shim",
          status: "missing",
        }),
      ]),
      recommendedActions: expect.arrayContaining([
        "adopt-project-context",
        "sync-repo-shims",
        "sync-global-instruction-shims",
      ]),
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
    const manifestPath = join(tempDir, ".kiln", "projections", "workflow-snapshot-manifest.json");
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
    expect(readFileSync(manifestPath, "utf-8")).toBe(`${staleManifest}\n`);
  });

  it("returns bounded read views", async () => {
    writeProjectConfig(tempDir);
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    const permissions = await readConfigStatusView(snapshot, "permissions");
    const health = await readConfigStatusView(snapshot, "health");
    const setup = await readConfigStatusView(snapshot, "setup");

    expect(permissions.value).toEqual({
      policy: { approval: "on-request", sandbox: "read-only" },
      permissionIntegrity: [],
    });
    expect(JSON.stringify(health.value)).toContain("harnessCapabilities");
    expect(health.value).toMatchObject({
      harnessCapabilities: expect.arrayContaining([
        expect.objectContaining({
          harness: "codex",
          crossHarnessManagedInvocation: {
            adapterId: "kiln-managed-invocation",
            supportedProviderIds: ["opencode-go", "opencode-zen", "openrouter"],
          },
        }),
      ]),
    });
    expect(setup.value).toEqual(snapshot.setup);
  });

  it("reports native projection decisions for configured agents", async () => {
    writeProjectConfig(tempDir);
    const agentsDir = join(tempDir, ".kiln", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "reviewer.md"), [
      "---",
      "name: reviewer",
      "role: Review specialist",
      "goal: Review implementation quality",
      "tier: reasoning",
      "providerRoute:",
      "  providerId: codex-oauth",
      "  model: gpt-5.5",
      "---",
      "Review only.",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });
    const agents = await readConfigStatusView(snapshot, "agents");

    expect(agents.value).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: "reviewer",
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-5.5",
          },
          nativeProjections: expect.arrayContaining([
            {
              target: "codex",
              status: "projected",
              nativeModel: "gpt-5.5",
            },
            {
              target: "opencode",
              status: "omitted",
              reason: "adapter-required",
            },
          ]),
        }),
      ]),
    });
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
      join(tempDir, ".kiln"),
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
      join(tempDir, ".kiln"),
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
      join(tempDir, ".kiln"),
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
      join(tempDir, ".kiln"),
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
            classification: "effective-policy-unproven",
            recommendation: "Verify effective runtime authority.",
            remediationRequiresApproval: true,
            lastVerifiedAt: "2026-07-01T15:01:01.000Z",
          },
        }),
      ),
    );

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "codex-config",
        permissionIntegrity: expect.objectContaining({
          harness: "codex",
          classification: "effective-policy-unproven",
        }),
      }),
    ]));
    expect(snapshot.permissionIntegrity).toEqual([
      expect.objectContaining({
        harness: "codex",
        classification: "effective-policy-unproven",
      }),
    ]);
    expect(snapshot.setup.permissionIntegrity).toEqual(snapshot.permissionIntegrity);

    const permissionsView = await readConfigStatusView(snapshot, "permissions");

    expect(permissionsView.value).toMatchObject({
      policy: {
        approval: "on-request",
        sandbox: "read-only",
      },
      permissionIntegrity: [
        expect.objectContaining({
          harness: "codex",
          classification: "effective-policy-unproven",
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
      join(tempDir, ".kiln"),
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
    const agentsDir = join(tempDir, ".kiln", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "opencode-reviewer.md"), [
      "---",
      "name: opencode-reviewer",
      "role: OpenCode review specialist",
      "goal: Review implementation quality through OpenCode",
      "tier: reasoning",
      "providerRoute:",
      "  providerId: opencode-go",
      "  model: deepseek-v4-flash",
      "---",
      "Review only.",
      "",
    ].join("\n"), "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });
    const agents = await readConfigStatusView(snapshot, "agents");

    expect(agents.value).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: "opencode-reviewer",
          invocationCapabilities: expect.arrayContaining([
            {
              target: "codex",
              status: "adapter-supported",
              adapterId: "kiln-managed-invocation",
              reason: "cross-harness-managed-invocation",
            },
            {
              target: "opencode",
              status: "native-supported",
              nativeModel: "opencode-go/deepseek-v4-flash",
            },
          ]),
          nativeProjections: expect.arrayContaining([
            {
              target: "codex",
              status: "omitted",
              reason: "adapter-required",
            },
          ]),
        }),
      ]),
    });
  });

  it("reports configured skill origin, projection state, and project override precedence", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    writeSkill(join(userHome, ".kiln", "skills"), "custom-user", "User skill.");
    writeSkill(join(userHome, ".kiln", "skills"), "tdd-workflow", "User override.");
    writeSkill(join(tempDir, ".kiln", "skills"), "tdd-workflow", "Project override.");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });
    const skills = await readConfigStatusView(snapshot, "skills");

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
  });

  it("reports unmanaged harness-local skills without admitting them", async () => {
    writeProjectConfig(tempDir);
    const userHome = join(tempDir, "home");
    writeSkill(join(userHome, ".codex", "skills"), "shadcn", "Codex local skill.");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(snapshot.skills?.entries).toEqual(expect.arrayContaining([
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

    await syncNativeSkillProjections(tempDir, { userHome });
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(snapshot.skills?.entries).toEqual(expect.arrayContaining([
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

    await syncNativeSkillProjections(tempDir, { userHome });
    writeFileSync(join(userHome, ".codex", "skills", "multi-file", "notes.md"), "drifted\n", "utf-8");
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(snapshot.skills?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "multi-file",
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

    expect(snapshot.skills?.entries).toEqual(expect.arrayContaining([
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

    expect(snapshot.skills?.entries.some((entry) => entry.name === "different-name")).toBe(false);
    expect(snapshot.skills?.entries.some((entry) => entry.name === "directory-name")).toBe(false);
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

    await syncNativeSkillProjections(tempDir, { userHome });
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, userHome });

    expect(snapshot.skills?.entries).toEqual(expect.arrayContaining([
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
      permissions: null,
      memoryDbPresent: expect.any(Boolean),
    });
    expect(JSON.stringify(memory.value)).toContain("memory.db");
    expect((memory.value as { memoryDbPath: string }).memoryDbPath).not.toBe(join(tempDir, ".kiln", "memory.db"));
    expect(JSON.stringify(memory.value)).not.toContain("legacy");
    expect(JSON.stringify(memory.value)).not.toContain("migration");
  });

  it("reports invalid project context without blocking effective config", async () => {
    writeProjectConfig(tempDir);
    writeFileSync(join(tempDir, ".kiln", "project-context.md"), "# invalid", "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.project.projectContext.status).toBe("invalid");
    expect(snapshot.effectiveConfigStatus).toBe("valid");
    expect(snapshot.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("project context"),
    ]));
    expect(readFileSync(join(tempDir, ".kiln", "project-context.md"), "utf-8")).toBe("# invalid");
  });
});
