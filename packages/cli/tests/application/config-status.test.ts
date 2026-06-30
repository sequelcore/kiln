import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfigStatusSnapshot, readConfigStatusView } from "../../src/application/config-status.js";
import { writeRepoShimProjections } from "../../src/application/repo-shim-projection.js";
import { syncNativeSkillProjections } from "../../src/config/native-skill-projection.js";

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

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, now: new Date("2026-05-07T12:00:00.000Z") });

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
      recommendedActions: expect.arrayContaining([
        "adopt-project-context",
        "sync-repo-shims",
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

    expect(permissions.value).toEqual({ approval: "on-request", sandbox: "read-only" });
    expect(JSON.stringify(health.value)).toContain("harnessCapabilities");
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
              reason: "unsupported-provider",
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
