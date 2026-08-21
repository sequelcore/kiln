import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import { deriveEffectiveKilnYaml } from "../../src/config/config-merger.js";
import { readGlobalExecutionTargetAuthority } from "../../src/config/global-config.js";
import { resolveExecutionRouteCandidates } from "../../src/config/execution-route-resolver.js";
import { writeExecutionTargetEvidenceSnapshot } from "../../src/config/execution-target-evidence-store.js";
import { readKilnYaml } from "../../src/kiln-yaml.js";
import { makeOperatorSurfaceGlobalConfig, makeOperatorSurfaceTargetEvidence } from "../commands/operator-surface-v4-fixture.js";
import { withSyntheticExecutionTargetEvidence } from "../config/execution-target-evidence-fixture.js";
import {
  applyConfigurationOnboarding,
  readConfigurationOnboarding,
} from "../../src/application/configuration-onboarding.js";
import {
  applyConfigMutation,
  approveConfigMutation,
  proposeConfigMutation,
} from "../../src/application/config-mutation-authority.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";

const target = {
  id: "codex-default",
  kind: "direct" as const,
  label: "Codex default",
  providerId: "codex-oauth",
  providerModelId: "gpt-5.6-terra",
};

function globalConfig(defaultTargetId?: string): KilnGlobalConfig {
  return {
    version: "4",
    targetCatalog: {
      evidenceRevision: `sha256:${"a".repeat(64)}`,
      accounts: [],
      accountPolicies: [],
      targets: [target] as never,
    },
    ...(defaultTargetId === undefined ? {} : { targetRouting: { defaultTargetId } }),
  };
}

function globalConfigWithTargets(
  targets: readonly (typeof target)[],
  defaultTargetId?: string,
): KilnGlobalConfig {
  return {
    version: "4",
    targetCatalog: {
      evidenceRevision: `sha256:${"a".repeat(64)}`,
      accounts: [],
      accountPolicies: [],
      targets: targets as never,
    },
    ...(defaultTargetId === undefined ? {} : { targetRouting: { defaultTargetId } }),
  };
}

describe("configuration onboarding application", () => {
  let projectPath: string;
  let globalHome: string;
  let previousXdgConfigHome: string | undefined;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "kiln-onboarding-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-onboarding-global-"));
    mkdirSync(join(globalHome, "kiln"), { recursive: true });
    writeFileSync(join(globalHome, "kiln", "config.yaml"), "version: '4'\n", "utf8");
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  });

  it("reports ready only when a current admitted direct target is available", () => {
    const dependencies = {
      readGlobalConfig: () => globalConfig("codex-default"),
      readTargetAuthority: vi.fn(() => ({ current: true })),
    };

    expect(readConfigurationOnboarding({ projectPath, dependencies })).toEqual({
      schemaVersion: 1,
      status: "ready",
      scope: "project",
      posture: "read-only",
      targets: [{
        id: target.id,
        label: target.label,
        providerId: target.providerId,
        providerModelId: target.providerModelId,
        selected: true,
      }],
      defaultTargetId: target.id,
      blockers: [],
      nextAction: "Apply onboarding to this project.",
    });
  });

  it("blocks without a global admitted direct target", () => {
    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => ({ version: "4" }),
        readTargetAuthority: vi.fn(() => undefined),
      },
    });

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.blockers[0]?.code).toBe("target-unavailable");
    expect(snapshot.nextAction).toContain("target");
  });

  it("does not claim completion when project permissions are inherited from a broad global posture", () => {
    const kilnDir = join(projectPath, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeFileSync(join(kilnDir, "kiln.yaml"), "version: '1'\n", "utf8");
    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => ({ ...globalConfig("codex-default"), permissions: { approval: "never", sandbox: "danger-full-access" } }),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(snapshot.status).toBe("ready");
    expect(snapshot.nextAction).toContain("Apply");
  });

  it("accepts an explicit untrusted project approval when global policy requires it", () => {
    const kilnDir = join(projectPath, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeFileSync(join(kilnDir, "kiln.yaml"), [
      "version: '1'",
      "permissions:",
      "  approval: untrusted",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf8");
    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => ({ ...globalConfig("codex-default"), permissions: { approval: "untrusted", sandbox: "read-only" } }),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(snapshot.status).toBe("complete");
  });

  it("accepts an on-failure project approval as stricter than the safe baseline", () => {
    const kilnDir = join(projectPath, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeFileSync(join(kilnDir, "kiln.yaml"), [
      "version: '1'",
      "permissions:",
      "  approval: on-failure",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf8");
    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => globalConfig("codex-default"),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(snapshot.status).toBe("complete");
  });

  it("blocks a structurally valid project that broadens global work governance", () => {
    const kilnDir = join(projectPath, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeFileSync(join(kilnDir, "kiln.yaml"), [
      "version: '1'",
      "permissions:",
      "  approval: on-request",
      "  sandbox: read-only",
      "workGovernance:",
      "  defaultPosture: direct",
      "",
    ].join("\n"), "utf8");

    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => ({
          ...globalConfig("codex-default"),
          workGovernance: { defaultPosture: "orchestrate" },
        }),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({ code: "project-config-invalid" }));
    expect(snapshot.nextAction).toContain("project configuration");
  });

  it("adopts once and makes a rerun a no-op", async () => {
    const dependencies = {
      readGlobalConfig: () => globalConfig("codex-default"),
      readTargetAuthority: vi.fn(() => ({ current: true })),
    };
    const request = {
      schemaVersion: 1 as const,
      scope: "project" as const,
      posture: "read-only" as const,
      targetId: target.id,
    };

    const first = await applyConfigurationOnboarding({ projectPath, request, dependencies });
    expect(first.status).toBe("committed");
    expect(first.projectAdoption?.outcome).toBe("committed");
    expect(parse(readFileSync(join(projectPath, ".kiln", "kiln.yaml"), "utf8"))).toEqual({
      version: "1",
      permissions: { approval: "on-request", sandbox: "read-only" },
    });

    const second = await applyConfigurationOnboarding({ projectPath, request, dependencies });
    expect(second.status).toBe("committed");
    expect(second.projectAdoption).toBeNull();
    expect(second.targetSelection).toBeNull();
  });

  it("composes a safe first turn onto the exact admitted provider/model route", async () => {
    const admittedGlobal = makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.6-terra", "codex-default");
    const globalPath = join(globalHome, "kiln", "config.yaml");
    writeFileSync(globalPath, stringify(admittedGlobal), "utf8");
    writeExecutionTargetEvidenceSnapshot({
      globalConfigPath: globalPath,
      snapshot: makeOperatorSurfaceTargetEvidence("codex-oauth", "gpt-5.6-terra", "codex-default"),
    });
    const result = await applyConfigurationOnboarding({
      projectPath,
      globalConfigPath: globalPath,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: "codex-default" },
      dependencies: { readGlobalConfig: () => admittedGlobal },
    });

    expect(result.status).toBe("committed");
    const project = readKilnYaml(join(projectPath, ".kiln"));
    const effective = deriveEffectiveKilnYaml(admittedGlobal, project);
    expect(effective?.permissions).toMatchObject({ approval: "on-request", sandbox: "read-only" });
    const authority = readGlobalExecutionTargetAuthority(admittedGlobal, { globalConfigPath: globalPath });
    const routes = resolveExecutionRouteCandidates({ globalConfig: admittedGlobal, executionCatalog: authority?.executionCatalog });
    expect(routes).toEqual([{ routeId: "codex-default", provider: "codex-oauth", model: "gpt-5.6-terra" }]);
  });

  it("rejects before writing when target selection needs approval", async () => {
    const dependencies = {
      readGlobalConfig: () => globalConfig(),
      readTargetAuthority: vi.fn(() => ({ current: true })),
    };

    const result = await applyConfigurationOnboarding({
      projectPath,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: target.id },
      dependencies,
    });

    expect(result.status).toBe("rejected");
    expect(result.projectAdoption).toBeNull();
    expect(result.targetSelection).toBeNull();
    expect(result.nextAction).toContain("approval");
    expect(existsSync(join(projectPath, ".kiln", "kiln.yaml"))).toBe(false);
  });

  it("never approves an implicit first target when no default exists", async () => {
    const costlyTarget = { ...target, id: "costly", label: "Costly route" };
    const safeTarget = { ...target, id: "safe", label: "Safe route" };

    const result = await applyConfigurationOnboarding({
      projectPath,
      approve: true,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: null },
      dependencies: {
        readGlobalConfig: () => globalConfigWithTargets([costlyTarget, safeTarget]),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.nextAction).toContain("Select an admitted direct target");
    expect(existsSync(join(projectPath, ".kiln", "kiln.yaml"))).toBe(false);
  });

  it("retries failed reconciliation on rerun and keeps path-bearing diagnostics secret-free", async () => {
    let reconciliationAttempt = 0;
    const dependencies = {
      readGlobalConfig: () => globalConfig("codex-default"),
      readTargetAuthority: () => ({ current: true }),
      applyMutation: (input: Parameters<typeof import("../../src/application/config-mutation-authority.js").applyConfigMutation>[0]) => {
        reconciliationAttempt += 1;
        return import("../../src/application/config-mutation-authority.js").then(({ applyConfigMutation }) => applyConfigMutation({
          ...input,
          reconcile: async () => reconciliationAttempt === 1
            ? [{
                target: "repo-shims" as const,
                status: "failed" as const,
                summary: "repo-shims reconciliation failed",
                errors: ["EACCES opening C:\\Users\\ExampleUser\\Project Files\\AGENTS.md"],
              }]
            : [{
                target: "repo-shims" as const,
                status: "ok" as const,
                summary: "repo-shims reconciled",
                errors: [],
              }],
        }));
      },
    };
    const request = {
      schemaVersion: 1 as const,
      scope: "project" as const,
      posture: "read-only" as const,
      targetId: "codex-default",
    };

    const first = await applyConfigurationOnboarding({ projectPath, request, dependencies });
    expect(first.status).toBe("partial");
    expect(JSON.stringify(first)).not.toMatch(/Jane|Doe|AGENTS\.md|Users/iu);
    expect(readConfigurationOnboarding({ projectPath, dependencies }).status).toBe("ready");

    const second = await applyConfigurationOnboarding({ projectPath, request, dependencies });
    expect(second.status).toBe("committed");
    expect(second.projectAdoption?.outcome).toBe("committed");
    expect(reconciliationAttempt).toBe(2);
    expect(readConfigurationOnboarding({ projectPath, dependencies }).status).toBe("complete");
  });

  it("does not report complete while the committed configuration is still reconciling", async () => {
    let announceReconciliation!: () => void;
    let finishReconciliation!: () => void;
    const reconciliationStarted = new Promise<void>((resolve) => {
      announceReconciliation = resolve;
    });
    const reconciliationMayFinish = new Promise<void>((resolve) => {
      finishReconciliation = resolve;
    });
    const dependencies = {
      readGlobalConfig: () => globalConfig("codex-default"),
      readTargetAuthority: () => ({ current: true }),
      applyMutation: (input: Parameters<typeof applyConfigMutation>[0]) => applyConfigMutation({
        ...input,
        reconcile: async () => {
          announceReconciliation();
          await reconciliationMayFinish;
          return [{
            target: "repo-shims" as const,
            status: "failed" as const,
            summary: "repo-shims reconciliation failed",
            errors: ["fixture reconciliation failure"],
          }];
        },
      }),
    };
    const request = {
      schemaVersion: 1 as const,
      scope: "project" as const,
      posture: "read-only" as const,
      targetId: "codex-default",
    };

    const pending = applyConfigurationOnboarding({ projectPath, request, dependencies });
    await reconciliationStarted;

    const duringReconciliation = readConfigurationOnboarding({ projectPath, dependencies });
    finishReconciliation();
    const result = await pending;

    expect(duringReconciliation.status).toBe("ready");
    expect(duringReconciliation.nextAction).toContain("reconcile");
    expect(result.status).toBe("partial");
  });

  it("settles the exact content-changing proposal interrupted before settlement", async () => {
    const dependencies = {
      readGlobalConfig: () => globalConfig("codex-default"),
      readTargetAuthority: () => ({ current: true }),
    };
    const request = {
      schemaVersion: 1 as const,
      scope: "project" as const,
      posture: "read-only" as const,
      targetId: "codex-default",
    };
    const orphan = proposeConfigMutation({
      projectPath,
      operation: "project.adopt",
      payload: { scope: "project", posture: "read-only" },
      now: new Date("2026-01-01T00:00:01.000Z"),
    });
    const store = new ConfigMutationStore(projectPath);
    store.saveProposal(orphan);
    const write = orphan.writes[0]!;
    store.writeProgressMarker({
      proposalId: orphan.proposal.proposalId,
      path: write.path,
      intendedRevision: `sha256:${createHash("sha256").update(write.nextContent).digest("hex")}`,
      startedAt: "2026-01-01T00:00:02.000Z",
    });
    mkdirSync(join(projectPath, ".kiln"), { recursive: true });
    writeFileSync(write.path, write.nextContent, "utf8");
    expect(readConfigurationOnboarding({ projectPath, dependencies }).status).toBe("ready");

    expect((await applyConfigurationOnboarding({ projectPath, request, dependencies })).status).toBe("committed");
    expect(store.readProgressMarker(orphan.proposal.proposalId)).toBeNull();
    const settlement = store.readSettlement(orphan.proposal.proposalId);
    expect(settlement).toMatchObject({
      proposalId: orphan.proposal.proposalId,
      baseRevision: "absent",
      restore: [{ path: write.path, previousContent: null }],
    });
    expect(readConfigurationOnboarding({ projectPath, dependencies }).status).toBe("complete");

    const rollback = proposeConfigMutation({
      projectPath,
      operation: "mutation.rollback",
      payload: { token: orphan.proposal.proposalId },
    });
    store.saveProposal(rollback);
    const rollbackApproval = rollback.proposal.approvalRequired
      ? approveConfigMutation({ projectPath, proposalId: rollback.proposal.proposalId })
      : undefined;
    expect((await applyConfigMutation({
      projectPath,
      proposalId: rollback.proposal.proposalId,
      ...(rollbackApproval === undefined ? {} : { approvalId: rollbackApproval.approvalId }),
      requester: "operator",
      reconcile: async () => [],
      readEffectiveState: async () => undefined,
    })).settlement.outcome).toBe("committed");
    expect(existsSync(write.path)).toBe(false);
  });

  it("preserves approval and rollback when target selection crashes before settlement", async () => {
    const base = makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.6-terra", "target-a");
    const targetA = base.targetCatalog!.targets[0]!;
    const admitted = withSyntheticExecutionTargetEvidence({
      ...base,
      targetCatalog: {
        ...base.targetCatalog!,
        targets: [targetA, { ...targetA, id: "target-b", label: "Target B" }],
      },
    });
    const globalPath = join(globalHome, "kiln", "config.yaml");
    const before = stringify(admitted.config);
    writeFileSync(globalPath, before, "utf8");
    writeExecutionTargetEvidenceSnapshot({ globalConfigPath: globalPath, snapshot: admitted.evidence! });
    mkdirSync(join(projectPath, ".kiln"), { recursive: true });
    writeFileSync(join(projectPath, ".kiln", "kiln.yaml"), [
      "version: '1'",
      "permissions:",
      "  approval: on-request",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf8");

    const interrupted = proposeConfigMutation({
      projectPath,
      globalConfigPath: globalPath,
      operation: "target.select",
      payload: { targetId: "target-b" },
      now: new Date("2026-01-01T00:00:01.000Z"),
    });
    const store = new ConfigMutationStore(projectPath);
    store.saveProposal(interrupted);
    const approval = approveConfigMutation({ projectPath, proposalId: interrupted.proposal.proposalId });
    const write = interrupted.writes[0]!;
    store.writeProgressMarker({
      proposalId: interrupted.proposal.proposalId,
      path: write.path,
      intendedRevision: `sha256:${createHash("sha256").update(write.nextContent).digest("hex")}`,
      startedAt: "2026-01-01T00:00:02.000Z",
    });
    writeFileSync(globalPath, write.nextContent, "utf8");

    const result = await applyConfigurationOnboarding({
      projectPath,
      globalConfigPath: globalPath,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: "target-b" },
      dependencies: {
        applyMutation: (input) => applyConfigMutation({ ...input, reconcile: async () => [] }),
      },
    });

    expect(result.status).toBe("committed");
    expect(result.targetSelection?.outcome).toBe("committed");
    const settlement = store.readSettlement(interrupted.proposal.proposalId);
    expect(settlement).toMatchObject({
      proposalId: interrupted.proposal.proposalId,
      approvalId: approval.approvalId,
      baseRevision: interrupted.proposal.baseRevision,
      restore: [{ path: globalPath, previousContent: before }],
    });

    const rollback = proposeConfigMutation({
      projectPath,
      globalConfigPath: globalPath,
      operation: "mutation.rollback",
      payload: { token: interrupted.proposal.proposalId },
    });
    store.saveProposal(rollback);
    const rollbackApproval = rollback.proposal.approvalRequired
      ? approveConfigMutation({ projectPath, proposalId: rollback.proposal.proposalId })
      : undefined;
    expect((await applyConfigMutation({
      projectPath,
      globalConfigPath: globalPath,
      proposalId: rollback.proposal.proposalId,
      ...(rollbackApproval === undefined ? {} : { approvalId: rollbackApproval.approvalId }),
      requester: "operator",
      reconcile: async () => [],
      readEffectiveState: async () => undefined,
    })).settlement.outcome).toBe("committed");
    expect((parse(readFileSync(globalPath, "utf8")) as KilnGlobalConfig).targetRouting?.defaultTargetId).toBe("target-a");
  });

  it("ignores and cleans a marker whose proposal already has terminal settlement", async () => {
    const dependencies = {
      readGlobalConfig: () => globalConfig("codex-default"),
      readTargetAuthority: () => ({ current: true }),
    };
    const request = {
      schemaVersion: 1 as const,
      scope: "project" as const,
      posture: "read-only" as const,
      targetId: "codex-default",
    };
    expect((await applyConfigurationOnboarding({ projectPath, request, dependencies })).status).toBe("committed");
    const store = new ConfigMutationStore(projectPath);
    const settled = store.readLatestSettlement("project.adopt")!;
    const record = store.readProposal(settled.proposalId)!;
    const write = record.writes[0]!;
    if (settled.committedRevision === null) throw new Error("Committed fixture must carry its revision.");
    store.writeProgressMarker({
      proposalId: settled.proposalId,
      path: write.path,
      intendedRevision: settled.committedRevision,
      startedAt: settled.settledAt,
    });

    expect(readConfigurationOnboarding({ projectPath, dependencies }).status).toBe("complete");
    const replay = await applyConfigMutation({
      projectPath,
      proposalId: settled.proposalId,
      requester: "operator",
      readEffectiveState: async () => undefined,
    });
    expect(replay.replayed).toBe(true);
    expect(store.readProgressMarker(settled.proposalId)).toBeNull();
  });

  it("reports an unexpected second-operation rejection as partial after project commit", async () => {
    const result = await applyConfigurationOnboarding({
      projectPath,
      approve: true,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: target.id },
      dependencies: {
        readGlobalConfig: () => globalConfig(),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(result.status).toBe("partial");
    expect(result.projectAdoption?.outcome).toBe("committed");
    expect(result.targetSelection?.outcome).toBe("rejected");
    expect(existsSync(join(projectPath, ".kiln", "kiln.yaml"))).toBe(true);
  });

  it("writes nothing when readiness is blocked", async () => {
    const result = await applyConfigurationOnboarding({
      projectPath,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: null },
      dependencies: {
        readGlobalConfig: () => ({ version: "4" }),
        readTargetAuthority: () => undefined,
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.projectAdoption).toBeNull();
    expect(existsSync(join(projectPath, ".kiln", "kiln.yaml"))).toBe(false);
  });
});
