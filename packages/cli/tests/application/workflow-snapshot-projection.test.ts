import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: vi.fn(),
}));

vi.mock("../../src/application/instruction-profile-loader.js", () => ({
  loadInstructionProfiles: vi.fn(),
}));

import { loadKilnConfig } from "../../src/config/config-merger.js";
import { loadInstructionProfiles } from "../../src/application/instruction-profile-loader.js";
import {
  readWorkflowSnapshotManifestStatus,
  syncWorkflowSnapshotProjection,
} from "../../src/application/workflow-snapshot-projection.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

let fixtureRoot = "";
let projectPath = "";

const loadKilnConfigMock = loadKilnConfig as unknown as ReturnType<typeof vi.fn>;
const loadInstructionProfilesMock = loadInstructionProfiles as unknown as ReturnType<typeof vi.fn>;

function resetProjectFixture(): void {
  fixtureRoot = mkdtempSync(join(tmpdir(), "kiln-workflow-snapshot-projection-"));
  projectPath = join(fixtureRoot, "project");
  mkdirSync(join(projectPath, ".git"), { recursive: true });
  writeFileSync(join(projectPath, "package.json"), JSON.stringify({
    name: "sample-project",
    workspaces: ["packages/*"],
    scripts: { test: "bun run test", typecheck: "bun run typecheck" },
  }), "utf-8");
  writeFileSync(join(projectPath, "bun.lock"), "", "utf-8");
  mkdirSync(join(projectPath, "docs", "architecture"), { recursive: true });
  writeFileSync(join(projectPath, "README.md"), "# Sample", "utf-8");
  writeFileSync(join(projectPath, "docs", "architecture", "README.md"), "# Architecture", "utf-8");
}

function binding() {
  return resolveProjectStateBinding(projectPath, { kilnHome: join(fixtureRoot, "kiln-home") });
}

function snapshotPath(): string {
  return join(binding().projectionsPath, "workflow-snapshot.md");
}

function manifestPath(): string {
  return join(binding().projectionsPath, "workflow-snapshot-manifest.json");
}

describe("workflow-snapshot-projection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectFixture();
    loadKilnConfigMock.mockResolvedValue({
      version: "1",
      provider: "codex-oauth",
      model: { default: "gpt-5.4-mini" },
      maxDepth: 3,
      parallelWorkers: 1,
      activeInstructionProfiles: ["sequel-engineering"],
      workGovernance: {
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["tests", "typecheck"],
      },
    });
    loadInstructionProfilesMock.mockReturnValue([{
      name: "sequel-engineering",
      scope: "global",
      filePath: "C:/Users/test/.kiln/instructions/sequel-engineering.md",
      instructions: "No dead code.",
      doctrine: { principles: ["No dead code."] },
    }]);
  });

  it("writes only the private snapshot and manifest, never repository instructions", async () => {
    const result = await syncWorkflowSnapshotProjection(projectPath, {
      projectStateBinding: binding(),
    });

    expect(result.errors).toEqual([]);
    expect(result.workflowSnapshotProjection).toMatchObject({ status: "written", written: true });
    expect(result.workflowSnapshotManifest).toMatchObject({ status: "written", written: true });
    expect(result.outcomes.map((outcome) => outcome.targetId)).toEqual([
      "workflow-snapshot",
      "workflow-snapshot-manifest",
    ]);
    expect(existsSync(join(projectPath, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(projectPath, "CLAUDE.md"))).toBe(false);
    expect(readFileSync(snapshotPath(), "utf-8")).toContain("kiln:workflow-snapshot:v2");
    expect(JSON.parse(readFileSync(manifestPath(), "utf-8"))).toMatchObject({
      version: "2",
      generator: "workflow-snapshot-export-v2",
      generatedAt: "1970-01-01T00:00:00.000Z",
      generatedFiles: ["private:projections/workflow-snapshot.md"],
    });
  });

  it("is byte-idempotent across distinct wall-clock times", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const first = await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: binding() });
    const firstSnapshot = readFileSync(snapshotPath(), "utf-8");
    const firstManifest = readFileSync(manifestPath(), "utf-8");

    vi.setSystemTime(new Date("2026-08-28T00:00:00.000Z"));
    const second = await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: binding() });

    expect(first.workflowSnapshot?.manifest.hash).toBe(second.workflowSnapshot?.manifest.hash);
    expect(second.workflowSnapshotProjection).toMatchObject({ status: "unchanged", written: false });
    expect(second.workflowSnapshotManifest).toMatchObject({ status: "unchanged", written: false });
    expect(readFileSync(snapshotPath(), "utf-8")).toBe(firstSnapshot);
    expect(readFileSync(manifestPath(), "utf-8")).toBe(firstManifest);
    vi.useRealTimers();
  });

  it("does not couple private workflow state to project instruction presence", async () => {
    const first = await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: binding() });
    const firstSnapshot = readFileSync(snapshotPath(), "utf-8");
    const firstManifest = readFileSync(manifestPath(), "utf-8");

    writeFileSync(join(projectPath, "AGENTS.md"), "# Hand-written instructions\n", "utf-8");
    writeFileSync(join(projectPath, "CLAUDE.md"), "# Hand-written Claude instructions\n", "utf-8");
    const second = await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: binding() });

    expect(second.workflowSnapshot?.manifest.hash).toBe(first.workflowSnapshot?.manifest.hash);
    expect(second.workflowSnapshotProjection).toMatchObject({ status: "unchanged" });
    expect(second.workflowSnapshotManifest).toMatchObject({ status: "unchanged" });
    expect(readFileSync(snapshotPath(), "utf-8")).toBe(firstSnapshot);
    expect(readFileSync(manifestPath(), "utf-8")).toBe(firstManifest);
  });

  it("reports missing and tampered workflow markdown without repairing it during status reads", async () => {
    await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: binding() });
    expect(await readWorkflowSnapshotManifestStatus(projectPath, { projectStateBinding: binding() }))
      .toMatchObject({ status: "current" });

    const original = readFileSync(snapshotPath(), "utf-8");
    rmSync(snapshotPath());
    expect(await readWorkflowSnapshotManifestStatus(projectPath, { projectStateBinding: binding() }))
      .toMatchObject({ status: "missing", details: "workflow snapshot markdown is missing" });

    writeFileSync(snapshotPath(), `${original}\nOperator tamper\n`, "utf-8");
    const tampered = readFileSync(snapshotPath(), "utf-8");
    expect(await readWorkflowSnapshotManifestStatus(projectPath, { projectStateBinding: binding() }))
      .toMatchObject({ status: "drifted", details: "workflow snapshot markdown content hash is invalid" });
    expect(readFileSync(snapshotPath(), "utf-8")).toBe(tampered);
  });

  it("reports and repairs same-hash manifest metadata tampering", async () => {
    await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: binding() });
    const current = JSON.parse(readFileSync(manifestPath(), "utf-8")) as Record<string, unknown>;
    const tampered = {
      ...current,
      sourceIds: ["tampered-source"],
      generatedFiles: ["tampered.md"],
      generator: "tampered-generator",
      version: "tampered-version",
      generatedAt: "2026-08-28T00:00:00.000Z",
      hash: current.hash,
    };
    writeFileSync(manifestPath(), `${JSON.stringify(tampered, null, 2)}\n`, "utf-8");

    expect(await readWorkflowSnapshotManifestStatus(projectPath, { projectStateBinding: binding() }))
      .toMatchObject({
        status: "stale",
        expectedHash: current.hash,
        currentHash: current.hash,
        details: "workflow snapshot manifest metadata is stale",
      });

    const repaired = await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: binding() });
    expect(repaired.workflowSnapshotManifest).toMatchObject({ status: "written", written: true });
    expect(JSON.parse(readFileSync(manifestPath(), "utf-8"))).toEqual(current);
  });

  it("fails closed when the private projection directory is replaced by a link", async () => {
    const projectBinding = binding();
    await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: projectBinding });
    const outside = join(fixtureRoot, "outside-projections");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "workflow-snapshot.md"), "outside snapshot\n", "utf-8");
    writeFileSync(join(outside, "workflow-snapshot-manifest.json"), readFileSync(manifestPath(), "utf-8"), "utf-8");
    rmSync(projectBinding.projectionsPath, { recursive: true, force: true });
    try {
      symlinkSync(outside, projectBinding.projectionsPath, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }

    await expect(readWorkflowSnapshotManifestStatus(projectPath, { projectStateBinding: projectBinding }))
      .rejects.toThrow(/unsafe|regular|private/iu);
    const result = await syncWorkflowSnapshotProjection(projectPath, { projectStateBinding: projectBinding });
    expect(result.workflowSnapshotProjection).toMatchObject({ status: "failed" });
    expect(result.workflowSnapshotManifest).toMatchObject({ status: "failed" });
    expect(readFileSync(join(outside, "workflow-snapshot-manifest.json"), "utf-8")).toContain('"hash"');
  });
});
