import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  readWorkflowSnapshotManifestStatus,
  writeRepoShimProjections,
} from "../../src/application/repo-shim-projection.js";

const PROJECT_PATH = join(process.cwd(), ".kiln", "tmp", "repo-shim-projection-test");

const loadAgentDefinitionsMock = loadAgentDefinitions as unknown as ReturnType<typeof vi.fn>;
const loadKilnConfigMock = loadKilnConfig as unknown as ReturnType<typeof vi.fn>;
const loadInstructionProfilesMock = loadInstructionProfiles as unknown as ReturnType<typeof vi.fn>;

function resetProjectFixture(): void {
  if (existsSync(PROJECT_PATH)) {
    rmSync(PROJECT_PATH, { recursive: true, force: true });
  }
  mkdirSync(PROJECT_PATH, { recursive: true });
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
        model: "gpt-5.4",
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
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
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
      path: join(PROJECT_PATH, ".kiln", "projections", "workflow-snapshot-manifest.json"),
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
      generatedFiles: ["AGENTS.md", "CLAUDE.md"],
    });
    expect(result.workflowSnapshot?.manifest.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const manifest = JSON.parse(readFileSync(join(PROJECT_PATH, ".kiln", "projections", "workflow-snapshot-manifest.json"), "utf-8")) as {
      hash: string;
      generatedFiles: string[];
      sourceIds: string[];
    };
    expect(manifest.hash).toBe(result.workflowSnapshot?.manifest.hash);
    expect(manifest.generatedFiles).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(manifest.sourceIds).toContain("work-governance:resolved-kiln-config");
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
    expect(agents).toContain("| planner (global) | Hal | Planning specialist");
    expect(agents).toContain("sequel-engineering (global): ~/.kiln/instructions/sequel-engineering.md");
    expect(claude).toContain("kiln:repo-shim:v1");
    expect(claude).toContain("target: claude");
    expect(claude).toContain("Generated by kiln sync --repo-shims for Claude Code");
  });

  it("is idempotent when signed generated files are unchanged", async () => {
    const first = await writeRepoShimProjections(PROJECT_PATH);
    const firstManifest = readFileSync(join(PROJECT_PATH, ".kiln", "projections", "workflow-snapshot-manifest.json"), "utf-8");
    const second = await writeRepoShimProjections(PROJECT_PATH);
    const secondManifest = readFileSync(join(PROJECT_PATH, ".kiln", "projections", "workflow-snapshot-manifest.json"), "utf-8");

    expect(first.targets.every((target) => target.status === "written")).toBe(true);
    expect(second.targets.every((target) => target.status === "unchanged")).toBe(true);
    expect(second.workflowSnapshotManifest).toMatchObject({
      status: "unchanged",
      written: false,
    });
    expect(secondManifest).toBe(firstManifest);
  });

  it("reports workflow snapshot manifest drift without mutating the manifest", async () => {
    await writeRepoShimProjections(PROJECT_PATH);
    const manifestPath = join(PROJECT_PATH, ".kiln", "projections", "workflow-snapshot-manifest.json");
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

  it("blocks unmanaged guidance files unless force is explicit", async () => {
    writeFileSync(join(PROJECT_PATH, "CLAUDE.md"), "# Hand-written guidance", "utf-8");

    const result = await writeRepoShimProjections(PROJECT_PATH);

    expect(result.errors).toContain("CLAUDE.md: unmanaged guidance file exists; adopt or back up before generating repo shims");
    expect(result.workflowSnapshotManifest).toBeUndefined();
    expect(existsSync(join(PROJECT_PATH, ".kiln", "projections", "workflow-snapshot-manifest.json"))).toBe(false);
    expect(readFileSync(join(PROJECT_PATH, "CLAUDE.md"), "utf-8")).toBe("# Hand-written guidance");
  });

  it("backs up unmanaged guidance files when force is explicit", async () => {
    writeFileSync(join(PROJECT_PATH, "CLAUDE.md"), "# Hand-written guidance", "utf-8");

    const result = await writeRepoShimProjections(PROJECT_PATH, { force: true });

    expect(result.errors).toEqual([]);
    expect(readFileSync(join(PROJECT_PATH, "CLAUDE.md"), "utf-8")).toContain("kiln:repo-shim:v1");
    expect(existsSync(join(PROJECT_PATH, ".kiln", "backups", "repo-shims"))).toBe(true);
  });

  it("projects adopted canonical project context into repo shims", async () => {
    mkdirSync(join(PROJECT_PATH, ".kiln"), { recursive: true });
    writeFileSync(join(PROJECT_PATH, ".kiln", "project-context.md"), [
      "---",
      "version: \"1\"",
      "---",
      "",
      "# Project Context",
      "",
      "Use the modular architecture docs as the active source of truth.",
      "",
    ].join("\n"), "utf-8");

    const result = await writeRepoShimProjections(PROJECT_PATH);
    const agents = readFileSync(join(PROJECT_PATH, "AGENTS.md"), "utf-8");

    expect(result.errors).toEqual([]);
    expect(agents).toContain("## Adopted Project Context");
    expect(agents).toContain("Canonical source: `.kiln/project-context.md`.");
    expect(agents).toContain("Use the modular architecture docs as the active source of truth.");
  });
});
