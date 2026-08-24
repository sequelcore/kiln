import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../src/application/agent-loader.js", () => ({
  loadAgentDefinitions: vi.fn(),
}));

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: vi.fn(),
}));

vi.mock("../../src/application/instruction-profile-loader.js", () => ({
  loadInstructionProfiles: vi.fn(),
  findInstructionProfile: vi.fn((profiles, name) =>
    profiles.find((profile: { name: string }) => profile.name === name)),
}));

import { loadAgentDefinitions } from "../../src/application/agent-loader.js";
import { loadKilnConfig } from "../../src/config/config-merger.js";
import { loadInstructionProfiles } from "../../src/application/instruction-profile-loader.js";
import {
  readRepoShimProjectionStatuses,
  readWorkflowSnapshotManifestStatus,
  writeRepoShimProjections,
} from "../../src/application/repo-shim-projection.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

let fixtureRoot = "";
let PROJECT_PATH = "";

const loadAgentDefinitionsMock = loadAgentDefinitions as unknown as ReturnType<typeof vi.fn>;
const loadKilnConfigMock = loadKilnConfig as unknown as ReturnType<typeof vi.fn>;
const loadInstructionProfilesMock = loadInstructionProfiles as unknown as ReturnType<typeof vi.fn>;
const itWithWindowsJunction = process.platform === "win32" ? it : it.skip;

function privateProjectionPath(filename: string): string {
  return join(resolveProjectStateBinding(PROJECT_PATH).projectionsPath, filename);
}

function privateBackupPath(): string {
  return join(resolveProjectStateBinding(PROJECT_PATH).backupsPath, "repo-shims");
}

function createDirectoryLink(target: string, linkPath: string): boolean {
  try {
    symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
}

function resetProjectFixture(): void {
  fixtureRoot = mkdtempSync(join(tmpdir(), "kiln-repo-shim-projection-"));
  PROJECT_PATH = join(fixtureRoot, "project");
  vi.stubEnv("XDG_CONFIG_HOME", join(fixtureRoot, "xdg"));
  mkdirSync(PROJECT_PATH, { recursive: true });
  mkdirSync(join(PROJECT_PATH, ".git"), { recursive: true });
  writeFileSync(join(PROJECT_PATH, "package.json"), JSON.stringify({
    name: "sample-project",
    workspaces: ["packages/*"],
    scripts: {
      test: "bun run test",
      typecheck: "bun run typecheck",
    },
  }, null, 2), "utf-8");
  writeFileSync(join(PROJECT_PATH, "bun.lock"), "", "utf-8");
  mkdirSync(join(PROJECT_PATH, "docs", "architecture"), { recursive: true });
  writeFileSync(join(PROJECT_PATH, "README.md"), "# Sample", "utf-8");
  writeFileSync(join(PROJECT_PATH, "docs", "architecture", "README.md"), "# Architecture", "utf-8");
}

describe("repo-shim-projection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectFixture();
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "planner",
        displayName: "Hal",
        role: "Planning specialist",
        goal: "Plan implementation",
        tier: "reasoning",
        tools: ["read", "grep"],
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4",
        },
        skills: ["planning"],
        instructionProfiles: ["sequel-engineering"],
        scope: "global",
      },
    ]);
    loadKilnConfigMock.mockResolvedValue({
      version: "1",
      domain: "typescript",
      provider: "codex-oauth",
      model: { default: "gpt-5.4-mini" },
      maxDepth: 3,
      parallelWorkers: 1,
      activeInstructionProfiles: ["sequel-engineering"],
      workGovernance: {
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture", "ui"],
        requiredEvidence: ["surface-map", "residual-risk"],
      },
    });
    loadInstructionProfilesMock.mockReturnValue([{
      name: "sequel-engineering",
      scope: "global",
      filePath: "C:/Users/test/.kiln/instructions/sequel-engineering.md",
      instructions: "No dead code.",
      doctrine: {
        principles: ["No dead code."],
        workflow: ["Scout first."],
      },
    }]);
  });

  it("generates signed AGENTS.md and CLAUDE.md repo shims from real repo evidence", async () => {
    const result = await writeRepoShimProjections(PROJECT_PATH);
    const agents = readFileSync(join(PROJECT_PATH, "AGENTS.md"), "utf-8");
    const claude = readFileSync(join(PROJECT_PATH, "CLAUDE.md"), "utf-8");

    expect(result.errors).toEqual([]);
    expect(result.targets).toHaveLength(2);
    expect(result.workflowSnapshotManifest).toMatchObject({
      path: privateProjectionPath("workflow-snapshot-manifest.json"),
      status: "written",
      written: true,
      errors: [],
    });
    expect(result.workflowSnapshotProjection).toMatchObject({
      path: privateProjectionPath("workflow-snapshot.md"),
      status: "written",
      written: true,
      errors: [],
    });
    expect(result.workflowSnapshot?.manifest).toMatchObject({
      generator: "workflow-snapshot-export-v1",
      sourceIds: [
        "project-context:sample-project",
        "instruction-profile:sequel-engineering",
        "work-governance:resolved-kiln-config",
        "model-policy:resolved-kiln-config",
        "workflow-profiles:static",
      ],
      generatedFiles: ["AGENTS.md", "CLAUDE.md", "private:projections/workflow-snapshot.md"],
    });
    expect(result.workflowSnapshot?.manifest.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const workflowSnapshotMarkdown = readFileSync(privateProjectionPath("workflow-snapshot.md"), "utf-8");
    const manifest = JSON.parse(readFileSync(privateProjectionPath("workflow-snapshot-manifest.json"), "utf-8")) as {
      hash: string;
      generatedFiles: string[];
      sourceIds: string[];
    };
    expect(manifest.hash).toBe(result.workflowSnapshot?.manifest.hash);
    expect(manifest.generatedFiles).toEqual(["AGENTS.md", "CLAUDE.md", "private:projections/workflow-snapshot.md"]);
    expect(manifest.sourceIds).toContain("work-governance:resolved-kiln-config");
    expect(workflowSnapshotMarkdown).toContain("kiln:workflow-snapshot:v1");
    expect(workflowSnapshotMarkdown).toContain("# Kiln Workflow Snapshot");
    expect(workflowSnapshotMarkdown).toContain("- Project: sample-project");
    expect(workflowSnapshotMarkdown).toContain("- Default posture: orchestrate");
    expect(workflowSnapshotMarkdown).toContain("- Default model: gpt-5.4-mini");
    expect(workflowSnapshotMarkdown).toContain("| small-fix | low | tests, typecheck, residual-risk |");
    expect(agents).toContain("kiln:repo-shim:v1");
    expect(agents).toContain("target: agents");
    expect(agents).toContain("Generated by kiln sync --repo-shims for Codex CLI and OpenCode");
    expect(agents).toContain("- Name: sample-project");
    expect(agents).toContain("- Package manager: bun");
    expect(agents).toContain("- Script `test`: `bun run test`");
    expect(agents).toContain("- Workspace package: `packages/*`");
    expect(agents).toContain("- docs/architecture/README.md");
    expect(agents).toContain("## Work Governance");
    expect(agents).toContain("- Orchestrate/delegate for: architecture, ui");
    expect(agents).toContain("Projection is not authority");
    expect(agents).toContain("Record missing harness/tool/route capability as a `capability` pause requirement");
    expect(agents).not.toContain("| planner (global) | Hal | Planning specialist");
    expect(agents).not.toContain("| Name | Display | Role | Tools | Provider Route | Skills | Instruction Profiles |");
    expect(agents).not.toContain("codex-oauth/gpt-5.4");
    expect(agents).toContain("sequel-engineering (global): ~/.kiln/instructions/sequel-engineering.md");
    expect(claude).toContain("kiln:repo-shim:v1");
    expect(claude).toContain("target: claude");
    expect(claude).toContain("Generated by kiln sync --repo-shims for Claude Code");
    expect(claude).toContain("Projection is not authority");
    expect(claude).toContain("Record missing harness/tool/route capability as a `capability` pause requirement");
  });

  it("plans both shims, workflow snapshot, and manifest without mutating the fixture", async () => {
    const result = await writeRepoShimProjections(PROJECT_PATH, { dryRun: true });

    expect(existsSync(join(PROJECT_PATH, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(PROJECT_PATH, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(PROJECT_PATH, ".kiln"))).toBe(false);
    expect(existsSync(resolveProjectStateBinding(PROJECT_PATH).projectStateRoot)).toBe(false);
    expect(result.outcomes.map((outcome) => outcome.targetId)).toEqual([
      "repo-shim:agents",
      "repo-shim:claude",
      "workflow-snapshot",
      "workflow-snapshot-manifest",
    ]);
    expect(result.outcomes.every((outcome) => outcome.status === "planned")).toBe(true);
  });

  it("keeps per-path outcomes when one repo shim cannot be read", async () => {
    mkdirSync(join(PROJECT_PATH, "AGENTS.md"));

    const result = await writeRepoShimProjections(PROJECT_PATH);

    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:agents", path: join(PROJECT_PATH, "AGENTS.md"), status: "failed" }),
      expect.objectContaining({ targetId: "repo-shim:claude", path: join(PROJECT_PATH, "CLAUDE.md"), status: "written" }),
      expect.objectContaining({ targetId: "workflow-snapshot", status: "skipped" }),
      expect.objectContaining({ targetId: "workflow-snapshot-manifest", status: "skipped" }),
    ]));
  });

  it("reports workflow projection write failures by path", async () => {
    const binding = resolveProjectStateBinding(PROJECT_PATH);
    mkdirSync(binding.projectStateRoot, { recursive: true });
    writeFileSync(binding.projectionsPath, "not a directory", "utf-8");

    const result = await writeRepoShimProjections(PROJECT_PATH);

    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "workflow-snapshot",
        path: privateProjectionPath("workflow-snapshot.md"),
        status: "failed",
        reason: expect.any(String),
      }),
      expect.objectContaining({
        targetId: "workflow-snapshot-manifest",
        path: privateProjectionPath("workflow-snapshot-manifest.json"),
        status: "failed",
        reason: expect.any(String),
      }),
    ]));
    expect(result.errors).toHaveLength(2);
  });

  it("is idempotent when signed generated files are unchanged", async () => {
    const first = await writeRepoShimProjections(PROJECT_PATH);
    const firstManifest = readFileSync(privateProjectionPath("workflow-snapshot-manifest.json"), "utf-8");
    const firstSnapshot = readFileSync(privateProjectionPath("workflow-snapshot.md"), "utf-8");
    const second = await writeRepoShimProjections(PROJECT_PATH);
    const secondManifest = readFileSync(privateProjectionPath("workflow-snapshot-manifest.json"), "utf-8");
    const secondSnapshot = readFileSync(privateProjectionPath("workflow-snapshot.md"), "utf-8");

    expect(first.targets.every((target) => target.status === "written")).toBe(true);
    expect(second.targets.every((target) => target.status === "unchanged")).toBe(true);
    expect(second.workflowSnapshotProjection).toMatchObject({
      status: "unchanged",
      written: false,
    });
    expect(second.workflowSnapshotManifest).toMatchObject({
      status: "unchanged",
      written: false,
    });
    expect(secondSnapshot).toBe(firstSnapshot);
    expect(secondManifest).toBe(firstManifest);
  });

  it("reports workflow snapshot manifest drift without mutating the manifest", async () => {
    await writeRepoShimProjections(PROJECT_PATH);
    const manifestPath = privateProjectionPath("workflow-snapshot-manifest.json");
    const currentManifest = readFileSync(manifestPath, "utf-8");

    expect(await readWorkflowSnapshotManifestStatus(PROJECT_PATH)).toMatchObject({
      path: manifestPath,
      status: "current",
    });

    const staleManifest = JSON.stringify({
      ...JSON.parse(currentManifest),
      hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }, null, 2);
    writeFileSync(manifestPath, `${staleManifest}\n`, "utf-8");

    expect(await readWorkflowSnapshotManifestStatus(PROJECT_PATH)).toMatchObject({
      path: manifestPath,
      status: "stale",
      expectedHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      currentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });
    expect(readFileSync(manifestPath, "utf-8")).toBe(`${staleManifest}\n`);

    writeFileSync(manifestPath, "{not json", "utf-8");
    expect(await readWorkflowSnapshotManifestStatus(PROJECT_PATH)).toMatchObject({
      path: manifestPath,
      status: "drifted",
      details: "workflow snapshot manifest is not valid JSON",
    });
  });

  it("keeps repo and workflow status reads on the composed binding after XDG changes", async () => {
    const binding = resolveProjectStateBinding(PROJECT_PATH, { kilnHome: join(fixtureRoot, "bound-kiln") });
    await writeRepoShimProjections(PROJECT_PATH, { projectStateBinding: binding });
    vi.stubEnv("XDG_CONFIG_HOME", join(fixtureRoot, "ambient-xdg-after-composition"));

    const shims = await readRepoShimProjectionStatuses(PROJECT_PATH, { projectStateBinding: binding });
    const workflow = await readWorkflowSnapshotManifestStatus(PROJECT_PATH, { projectStateBinding: binding });

    expect(shims).toEqual(expect.arrayContaining([
      { target: "agents", path: join(PROJECT_PATH, "AGENTS.md"), status: "current" },
      { target: "claude", path: join(PROJECT_PATH, "CLAUDE.md"), status: "current" },
    ]));
    expect(workflow).toMatchObject({
      path: join(binding.projectionsPath, "workflow-snapshot-manifest.json"),
      status: "current",
    });
  });

  it("rejects a repository shim symlink before external bytes can spoof current status", async () => {
    await writeRepoShimProjections(PROJECT_PATH);
    const shimPath = join(PROJECT_PATH, "AGENTS.md");
    const outsideShim = join(fixtureRoot, "outside-agents.md");
    const sentinel = readFileSync(shimPath, "utf-8");
    writeFileSync(outsideShim, sentinel, "utf-8");
    rmSync(shimPath, { force: true });
    try {
      symlinkSync(outsideShim, shimPath, "file");
    } catch {
      return;
    }

    await expect(readRepoShimProjectionStatuses(PROJECT_PATH))
      .rejects.toThrow(/unsafe|regular|canonical root/iu);
    expect(readFileSync(outsideShim, "utf-8")).toBe(sentinel);
  });

  it("rejects a repository shim symlink before force writes can overwrite external bytes", async () => {
    await writeRepoShimProjections(PROJECT_PATH);
    const shimPath = join(PROJECT_PATH, "AGENTS.md");
    const outsideShim = join(fixtureRoot, "outside-agents-force.md");
    const sentinel = "external sentinel\n";
    writeFileSync(outsideShim, sentinel, "utf-8");
    rmSync(shimPath, { force: true });
    try {
      symlinkSync(outsideShim, shimPath, "file");
    } catch {
      return;
    }

    const result = await writeRepoShimProjections(PROJECT_PATH, { force: true });

    expect(result.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "agents", status: "failed" }),
    ]));
    expect(readFileSync(outsideShim, "utf-8")).toBe(sentinel);
  });

  itWithWindowsJunction("rejects an established repository-root junction swap before external status or writes", async () => {
    const binding = resolveProjectStateBinding(PROJECT_PATH, { kilnHome: join(fixtureRoot, "bound-kiln") });
    await writeRepoShimProjections(PROJECT_PATH, { projectStateBinding: binding });

    const physicalProject = join(fixtureRoot, "physical-project");
    const outsideProject = join(fixtureRoot, "outside-repo");
    const outsideAgents = join(outsideProject, "AGENTS.md");
    const outsideClaude = join(outsideProject, "CLAUDE.md");
    const agentsSentinel = "external agents sentinel\n";
    const claudeSentinel = "external claude sentinel\n";
    renameSync(PROJECT_PATH, physicalProject);
    mkdirSync(outsideProject, { recursive: true });
    writeFileSync(outsideAgents, agentsSentinel, "utf-8");
    writeFileSync(outsideClaude, claudeSentinel, "utf-8");
    symlinkSync(outsideProject, PROJECT_PATH, "junction");

    try {
      await expect(readRepoShimProjectionStatuses(PROJECT_PATH, { projectStateBinding: binding }))
        .rejects.toThrow(/canonical|root|unsafe|inspect/iu);

      const result = await writeRepoShimProjections(PROJECT_PATH, {
        projectStateBinding: binding,
        force: true,
      });
      expect(result.written).toBe(false);
      expect(result.errors.join("\n")).toMatch(/canonical|root|unsafe|inspect/iu);
      expect(readFileSync(outsideAgents, "utf-8")).toBe(agentsSentinel);
      expect(readFileSync(outsideClaude, "utf-8")).toBe(claudeSentinel);
    } finally {
      rmSync(PROJECT_PATH, { recursive: true, force: true });
      renameSync(physicalProject, PROJECT_PATH);
    }
  });

  it("rejects a workflow projection junction before external bytes can spoof current status", async () => {
    const binding = resolveProjectStateBinding(PROJECT_PATH, { kilnHome: join(fixtureRoot, "bound-kiln") });
    await writeRepoShimProjections(PROJECT_PATH, { projectStateBinding: binding });
    const manifestPath = join(binding.projectionsPath, "workflow-snapshot-manifest.json");
    const outsideProjection = join(fixtureRoot, "outside-projection");
    mkdirSync(outsideProjection, { recursive: true });
    writeFileSync(join(outsideProjection, "workflow-snapshot-manifest.json"), readFileSync(manifestPath, "utf-8"), "utf-8");
    rmSync(binding.projectionsPath, { recursive: true, force: true });
    if (!createDirectoryLink(outsideProjection, binding.projectionsPath)) return;

    await expect(readWorkflowSnapshotManifestStatus(PROJECT_PATH, { projectStateBinding: binding }))
      .rejects.toThrow(/unsafe|regular|private/iu);

    const result = await writeRepoShimProjections(PROJECT_PATH, { projectStateBinding: binding });
    expect(result.workflowSnapshotProjection).toMatchObject({ status: "failed" });
    expect(result.workflowSnapshotManifest).toMatchObject({ status: "failed" });
    expect(readFileSync(join(outsideProjection, "workflow-snapshot-manifest.json"), "utf-8"))
      .toContain('"hash"');
  });

  it("rejects a symlinked workflow manifest before returning current", async () => {
    const binding = resolveProjectStateBinding(PROJECT_PATH, { kilnHome: join(fixtureRoot, "bound-kiln") });
    await writeRepoShimProjections(PROJECT_PATH, { projectStateBinding: binding });
    const manifestPath = join(binding.projectionsPath, "workflow-snapshot-manifest.json");
    const outsideManifest = join(fixtureRoot, "outside-manifest.json");
    writeFileSync(outsideManifest, readFileSync(manifestPath, "utf-8"), "utf-8");
    rmSync(manifestPath, { force: true });
    try {
      symlinkSync(outsideManifest, manifestPath, "file");
    } catch {
      return;
    }

    await expect(readWorkflowSnapshotManifestStatus(PROJECT_PATH, { projectStateBinding: binding }))
      .rejects.toThrow(/unsafe|regular|private/iu);
  });

  it("blocks unmanaged guidance files unless force is explicit", async () => {
    writeFileSync(join(PROJECT_PATH, "CLAUDE.md"), "# Hand-written guidance", "utf-8");

    const result = await writeRepoShimProjections(PROJECT_PATH);

    expect(result.errors).toContain("CLAUDE.md: unmanaged guidance file exists; adopt or back up before generating repo shims");
    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:claude", status: "blocked" }),
      expect.objectContaining({ targetId: "workflow-snapshot", status: "skipped", reason: expect.stringContaining("unmanaged guidance file exists") }),
      expect.objectContaining({ targetId: "workflow-snapshot-manifest", status: "skipped", reason: expect.stringContaining("unmanaged guidance file exists") }),
    ]));
    expect(result.workflowSnapshotProjection).toBeUndefined();
    expect(result.workflowSnapshotManifest).toBeUndefined();
    expect(existsSync(privateProjectionPath("workflow-snapshot.md"))).toBe(false);
    expect(existsSync(privateProjectionPath("workflow-snapshot-manifest.json"))).toBe(false);
    expect(readFileSync(join(PROJECT_PATH, "CLAUDE.md"), "utf-8")).toBe("# Hand-written guidance");
  });

  it("backs up unmanaged guidance files when force is explicit", async () => {
    writeFileSync(join(PROJECT_PATH, "CLAUDE.md"), "# Hand-written guidance", "utf-8");

    const result = await writeRepoShimProjections(PROJECT_PATH, { force: true });

    expect(result.errors).toEqual([]);
    expect(readFileSync(join(PROJECT_PATH, "CLAUDE.md"), "utf-8")).toContain("kiln:repo-shim:v1");
    expect(existsSync(privateBackupPath())).toBe(true);
  });

  it("projects adopted canonical project context into repo shims", async () => {
    const binding = resolveProjectStateBinding(PROJECT_PATH);
    mkdirSync(binding.projectStateRoot, { recursive: true });
    writeFileSync(binding.contextPath, [
      "---",
      "version: \"2\"",
      "source: reviewed-project-context",
      "---",
      "",
      "# Project Context",
      "",
      "Repository facts are derived from executable repository evidence.",
      "",
      "## Agent Review Notes",
      "",
      "Use the modular architecture docs as the active source of truth.",
      "",
    ].join("\n"), "utf-8");

    const result = await writeRepoShimProjections(PROJECT_PATH);
    const agents = readFileSync(join(PROJECT_PATH, "AGENTS.md"), "utf-8");

    expect(result.errors).toEqual([]);
    expect(agents).toContain("## Adopted Project Context");
    expect(agents).toContain("Canonical source: private project state `context`.");
    expect(agents).toContain("Use the modular architecture docs as the active source of truth.");
    expect(agents).toContain("- Script `test`: `bun run test`");
    expect(agents).not.toContain("Repository facts are derived from executable repository evidence.");
  });
});
