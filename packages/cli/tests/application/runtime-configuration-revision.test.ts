import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConfigMutationStore,
  type StoredConfigMutationSettlement,
} from "../../src/application/config-mutation-store.js";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { type ProjectStateBinding, resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { readRuntimeConfigurationRevision } from "../../src/application/runtime-configuration-revision.js";

const roots: string[] = [];

function lineageSettlement(input: {
  readonly proposalId: string;
  readonly path: string;
  readonly committedRevision: string;
  readonly settledAt: string;
  readonly generation: `sha256:${string}`;
  readonly operation?: StoredConfigMutationSettlement["operation"];
  readonly baseRevision?: string;
  readonly scope?: "project" | "global";
}): StoredConfigMutationSettlement {
  return {
    proposalId: input.proposalId,
    approvalId: null,
    scope: input.scope ?? "project",
    operation: input.operation ?? "skill.upsert",
    settledAt: input.settledAt,
    outcome: "committed",
    baseRevision: input.baseRevision ?? "absent",
    committedRevision: input.committedRevision,
    appliedWrites: [{ path: input.path, previousHash: null, nextHash: input.committedRevision }],
    reconciliationEffects: [],
    diagnostics: [],
    rollbackToken: input.proposalId,
    activation: "reconcile",
    activationObservation: {
      state: "active",
      boundary: "reconcile",
      committedRevision: input.committedRevision,
      activeRevision: input.committedRevision,
      summary: "fixture",
    },
    reconciliationGenerations: [{ target: "native-skills", generation: input.generation }],
    restore: [],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtime configuration revision", () => {
  it("binds exact global, project, and managed-evidence revisions into one secret-free identity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-"));
    const home = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-home-"));
    roots.push(root, home);
    mkdirSync(join(home, "kiln"), { recursive: true });
    const evidenceRevision = `sha256:${"e".repeat(64)}`;
    const globalBytes = `version: "7"\ntargetCatalog:\n  evidenceRevision: ${evidenceRevision}\n  accounts: []\n  accountPolicies: []\n  targets: []\n`;
    const projectBytes = `version: "1"\nprojectName: fixture\n`;
    writeFileSync(join(home, "kiln", "config.yaml"), globalBytes, "utf8");
    const binding = setupPrivateProject(root, join(home, "project-state"), projectBytes);

    const snapshot = readRuntimeConfigurationRevision(root, {
      projectStateBinding: binding,
      globalConfigPath: join(home, "kiln", "config.yaml"),
    });

    expect(snapshot.revisions.global).toBe(`sha256:${createHash("sha256").update(globalBytes).digest("hex")}`);
    expect(snapshot.revisions.project).toBe(`sha256:${createHash("sha256").update(projectBytes).digest("hex")}`);
    expect(snapshot.revisions["execution-target-evidence"]).toBe(evidenceRevision);
    expect(snapshot.revisions["project-state"]).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(snapshot.revisions.adoption).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(snapshot.revisionSetId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(snapshot)).not.toContain(root);
    expect(JSON.stringify(snapshot)).not.toContain(home);
  });

  it("captures the latest path-scoped settlement lineage when a revision reappears after rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-lineage-"));
    const home = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-lineage-home-"));
    const mutationRoot = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-lineage-store-"));
    roots.push(root, home, mutationRoot);
    mkdirSync(join(home, "kiln"), { recursive: true });
    const globalPath = join(home, "kiln", "config.yaml");
    const globalBytes = `version: "7"\ntargetCatalog:\n  evidenceRevision: sha256:${"e".repeat(64)}\n`;
    const projectBytes = 'version: "1"\nprojectName: fixture\n';
    writeFileSync(globalPath, globalBytes, "utf8");
    const binding = setupPrivateProject(root, join(home, "project-state"), projectBytes);
    const projectPath = binding.configPath;
    const projectRevision = `sha256:${createHash("sha256").update(projectBytes).digest("hex")}`;
    const store = new ConfigMutationStore(root, { root: mutationRoot });
    const settlement = lineageSettlement({
      proposalId: "cfg-rollback-project",
      path: projectPath,
      committedRevision: projectRevision,
      settledAt: "2026-08-22T00:00:02.000Z",
      generation: `sha256:${"c".repeat(64)}`,
      operation: "mutation.rollback",
      baseRevision: `sha256:${"b".repeat(64)}`,
    });
    store.settle(settlement);

    const snapshot = readRuntimeConfigurationRevision(root, {
      projectStateBinding: binding,
      globalConfigPath: globalPath,
      mutationStoreRoot: mutationRoot,
    });

    expect(snapshot.activationLineage).toEqual([
      {
        proposalId: "cfg-rollback-project",
        scope: "project",
        path: "config.yaml",
        committedRevision: projectRevision,
        reconciliationGenerations: [{ target: "native-skills", generation: `sha256:${"c".repeat(64)}` }],
      },
    ]);
    expect(snapshot.revisionSetId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(snapshot)).not.toContain(root);
    expect(JSON.stringify(snapshot)).not.toContain(home);
  });

  it("does not report lineage when current bytes resurrect an old revision without a newer rollback settlement", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-resurrection-"));
    const home = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-resurrection-home-"));
    const mutationRoot = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-resurrection-store-"));
    roots.push(root, home, mutationRoot);
    mkdirSync(join(home, "kiln"), { recursive: true });
    const globalPath = join(home, "kiln", "config.yaml");
    const globalBytes = 'version: "7"\n';
    const projectBytesA = 'version: "1"\nprojectName: a\n';
    writeFileSync(globalPath, globalBytes, "utf8");
    const binding = setupPrivateProject(root, join(home, "project-state"), projectBytesA);
    const projectPath = binding.configPath;
    const revisionA = `sha256:${createHash("sha256").update(projectBytesA).digest("hex")}`;
    const revisionB = `sha256:${"b".repeat(64)}`;
    const store = new ConfigMutationStore(root, { root: mutationRoot, globalConfigPath: globalPath });
    store.settle(
      lineageSettlement({
        proposalId: "cfg-resurrection-a",
        path: projectPath,
        committedRevision: revisionA,
        settledAt: "2026-08-22T00:00:00.000Z",
        generation: `sha256:${"a".repeat(64)}`,
      }),
    );
    store.settle(
      lineageSettlement({
        proposalId: "cfg-resurrection-b",
        path: projectPath,
        committedRevision: revisionB,
        settledAt: "2026-08-22T00:00:01.000Z",
        generation: `sha256:${"b".repeat(64)}`,
      }),
    );

    const snapshot = readRuntimeConfigurationRevision(root, {
      projectStateBinding: binding,
      globalConfigPath: globalPath,
      mutationStoreRoot: mutationRoot,
    });

    expect(snapshot.activationLineage).toBeUndefined();
  });

  it("retries capture when settlement lineage changes while canonical bytes remain stable", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-retry-"));
    const home = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-retry-home-"));
    const mutationRoot = mkdtempSync(join(tmpdir(), "kiln-runtime-revision-retry-store-"));
    roots.push(root, home, mutationRoot);
    mkdirSync(join(home, "kiln"), { recursive: true });
    const globalPath = join(home, "kiln", "config.yaml");
    const globalBytes = 'version: "7"\n';
    const projectBytes = 'version: "1"\n';
    writeFileSync(globalPath, globalBytes, "utf8");
    const binding = setupPrivateProject(root, join(home, "project-state"), projectBytes);
    const projectPath = binding.configPath;
    const projectRevision = `sha256:${createHash("sha256").update(projectBytes).digest("hex")}`;
    const store = new ConfigMutationStore(root, { root: mutationRoot });
    const first = lineageSettlement({
      proposalId: "cfg-lineage-first",
      path: projectPath,
      committedRevision: projectRevision,
      settledAt: "2026-08-22T00:00:00.000Z",
      generation: `sha256:${"a".repeat(64)}`,
    });
    const second = {
      ...first,
      proposalId: "cfg-lineage-second",
      settledAt: "2026-08-22T00:00:01.000Z",
      reconciliationGenerations: [{ target: "native-skills", generation: `sha256:${"b".repeat(64)}` }],
    } satisfies StoredConfigMutationSettlement;
    store.settle(first);

    let reads = 0;
    const original = ConfigMutationStore.prototype.readLatestSettlementForPath;
    const readLineage = vi
      .spyOn(ConfigMutationStore.prototype, "readLatestSettlementForPath")
      .mockImplementation(function (this: ConfigMutationStore, path, revision) {
        reads += 1;
        const result = original.call(this, path, revision);
        if (reads === 2) store.settle(second);
        return result;
      });

    let snapshot: ReturnType<typeof readRuntimeConfigurationRevision>;
    try {
      snapshot = readRuntimeConfigurationRevision(root, {
        projectStateBinding: binding,
        globalConfigPath: globalPath,
        mutationStoreRoot: mutationRoot,
      });
    } finally {
      readLineage.mockRestore();
    }

    expect(snapshot.activationLineage?.[0]?.proposalId).toBe("cfg-lineage-second");
    expect(reads).toBeGreaterThan(4);
  });

  it("admits shared global lineage across projects and selects a same-hash rollback", () => {
    const projectA = mkdtempSync(join(tmpdir(), "kiln-runtime-global-a-"));
    const projectB = mkdtempSync(join(tmpdir(), "kiln-runtime-global-b-"));
    const home = mkdtempSync(join(tmpdir(), "kiln-runtime-global-home-"));
    const mutationRoot = mkdtempSync(join(tmpdir(), "kiln-runtime-global-store-"));
    roots.push(projectA, projectB, home, mutationRoot);
    mkdirSync(join(home, "kiln"), { recursive: true });
    const globalPath = join(home, "kiln", "config.yaml");
    const globalBytes = 'version: "7"\n';
    writeFileSync(globalPath, globalBytes, "utf8");
    const bindingB = setupPrivateProject(projectB, join(home, "project-state-b"), 'version: "1"\n');
    const revision = `sha256:${createHash("sha256").update(globalBytes).digest("hex")}`;
    const storeA = new ConfigMutationStore(projectA, { root: mutationRoot, globalConfigPath: globalPath });
    storeA.settle(
      lineageSettlement({
        proposalId: "cfg-global-a",
        path: globalPath,
        scope: "global",
        committedRevision: revision,
        settledAt: "2026-08-22T00:00:00.000Z",
        generation: `sha256:${"a".repeat(64)}`,
      }),
    );
    storeA.settle(
      lineageSettlement({
        proposalId: "cfg-global-rollback-a",
        path: globalPath,
        scope: "global",
        committedRevision: revision,
        settledAt: "2026-08-22T00:00:01.000Z",
        generation: `sha256:${"b".repeat(64)}`,
        operation: "mutation.rollback",
      }),
    );

    const admittedByB = readRuntimeConfigurationRevision(projectB, {
      projectStateBinding: bindingB,
      globalConfigPath: globalPath,
      mutationStoreRoot: mutationRoot,
    });

    expect(admittedByB.activationLineage?.[0]).toMatchObject({
      proposalId: "cfg-global-rollback-a",
      scope: "global",
      path: "config.yaml",
    });
  });
});

function setupPrivateProject(root: string, kilnHome: string, configBytes: string): ProjectStateBinding {
  const binding = resolveProjectStateBinding(root, { kilnHome });
  mkdirSync(binding.projectStateRoot, { recursive: true });
  mkdirSync(binding.agentsPath, { recursive: true });
  mkdirSync(binding.instructionsPath, { recursive: true });
  mkdirSync(binding.skillsPath, { recursive: true });
  writeFileSync(binding.configPath, configBytes, "utf8");
  writeFileSync(binding.contextPath, "# Context\n", "utf8");
  writeFileSync(join(binding.agentsPath, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(binding.instructionsPath, "README.md"), "# Instructions\n", "utf8");
  writeFileSync(join(binding.skillsPath, "README.md"), "# Skills\n", "utf8");
  bootstrapProjectAdoption(binding);
  return binding;
}
