import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core/engine";
import type {
  KilnConfigReconciliationEffect,
  KilnConfigReconciliationTarget,
  KilnSettingsSnapshot,
} from "@kilnai/gateway-contracts";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
  type RuntimeConfigurationRevisionSnapshot,
} from "@kilnai/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyConfigMutation,
  approveConfigMutation,
  proposeConfigMutation,
} from "../../src/application/config-mutation-authority.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";
import {
  readConfigStatusSnapshot,
  readConfigStatusView,
} from "../../src/application/config-status.js";
import { TranscriptAuthorityAdmissionEvidenceStore } from "../../src/application/authority-admission-evidence-store.js";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../../src/application/project-state-root.js";
import { readRuntimeConfigurationRevision } from "../../src/application/runtime-configuration-revision.js";
import { TranscriptStore } from "../../src/wrapper/session-store.js";
import { persistGlobalConfigFixture } from "../config/global-config-fixture.js";
import { makeOperatorSurfaceGlobalConfig } from "../commands/operator-surface-config-fixture.js";

const READ_AUTHORITY: AuthorityDescriptor = {
  level: 1,
  allowed: true,
  requiresApproval: false,
  reason: "portable activation fixture",
};
const READ_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};
const emptyPluginProvider = () => ({ roots: [], diagnostics: [] });

let projectPath: string;
let projectStateBinding: ProjectStateBinding;

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), "kiln-activation-lifecycle-"));
  vi.stubEnv("XDG_CONFIG_HOME", join(projectPath, "xdg"));
  writeFileSync(join(projectPath, "package.json"), JSON.stringify({ name: "activation-fixture" }), "utf8");
  projectStateBinding = resolveProjectStateBinding(projectPath);
  bootstrapProjectAdoption(projectStateBinding);
  writeFileSync(projectStateBinding.configPath, [
    'version: "1"',
    "permissions:",
    "  approval: on-request",
    "  sandbox: read-only",
    "",
  ].join("\n"), "utf8");
  persistGlobalConfigFixture({
    ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "codex-default"),
    permissions: { approval: "on-request", sandbox: "read-only" },
  });
});

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("configuration activation lifecycle", () => {
  it("proves a hot mutation active through the default owner read-back", async () => {
    const result = await applySetting({
      scope: "global",
      key: "identity.name",
      value: "Fixture Operator",
      reconciliation: "completed",
    });

    expect(result.activationObservation).toMatchObject({ state: "active", boundary: "hot" });
    expect(result.readBackVerified).toBe(true);
    expect((await readSettings()).activationStatus).toMatchObject({
      state: "active",
      boundary: "hot",
      activeRevision: expect.stringMatching(/^sha256:/u),
    });
  });

  it("keeps an admitted turn on R1 while a later turn activates next-turn R2", async () => {
    const r1 = readRuntimeConfigurationRevision(projectPath);
    const evidence = new TranscriptAuthorityAdmissionEvidenceStore(new TranscriptStore(projectPath));
    const inFlight = admissionBundle({ sessionId: "session-turn", turnId: "turn-r1", sessionRevision: r1, turnRevision: r1 });
    await evidence.persist(inFlight);

    const result = await applySetting({
      scope: "global",
      key: "workGovernance.defaultPosture",
      value: "direct",
      reconciliation: "completed",
    });
    expect(result.activationObservation).toMatchObject({ state: "scheduled", boundary: "next-turn" });
    expect((await readSettings()).activationStatus).toMatchObject({ state: "scheduled", boundary: "next-turn" });

    const r2 = readRuntimeConfigurationRevision(projectPath);
    expect(inFlight.configuration.turnRevision).toEqual(r1);
    await evidence.persist(admissionBundle({
      sessionId: "session-turn",
      turnId: "turn-r2",
      sessionRevision: r1,
      turnRevision: r2,
    }));

    expect((await readSettings()).activationStatus).toMatchObject({
      state: "active",
      boundary: "next-turn",
      desiredRevisionSetId: r2.revisionSetId,
    });
    expect(inFlight.configuration.turnRevision).toEqual(r1);
  });

  it("keeps an old session pinned until a fresh session activates next-session R2", async () => {
    const r1 = readRuntimeConfigurationRevision(projectPath);
    const evidence = new TranscriptAuthorityAdmissionEvidenceStore(new TranscriptStore(projectPath));
    await evidence.persist(admissionBundle({ sessionId: "session-r1", turnId: "turn-r1", sessionRevision: r1, turnRevision: r1 }));

    const result = await applySetting({
      scope: "global",
      key: "skills.selection.mode",
      value: "advisory",
      reconciliation: "completed",
    });
    expect(result.activationObservation).toMatchObject({ state: "scheduled", boundary: "next-session" });
    const r2 = readRuntimeConfigurationRevision(projectPath);

    await evidence.persist(admissionBundle({
      sessionId: "session-r1",
      turnId: "turn-r2",
      sessionRevision: r1,
      turnRevision: r2,
    }));
    expect((await readSettings()).activationStatus).toMatchObject({ state: "scheduled", boundary: "next-session" });

    await evidence.persist(admissionBundle({ sessionId: "session-r2", turnId: "turn-r2", sessionRevision: r2, turnRevision: r2 }));
    expect((await readSettings()).activationStatus).toMatchObject({
      state: "active",
      boundary: "next-session",
      desiredRevisionSetId: r2.revisionSetId,
    });
  });

  it("projects failed and superseded reconciliation, then converges rollback as a new lineage", async () => {
    const failed = await applySetting({
      scope: "global",
      key: "activeInstructionProfiles",
      value: ["sequel-engineering"],
      reconciliation: "failed",
    });
    expect(failed.outcome).toBe("committed-reconciliation-failed");
    expect((await readSettings()).activationStatus).toMatchObject({ state: "failed", boundary: "reconcile" });

    const superseded = await applySetting({
      scope: "global",
      key: "activeInstructionProfiles",
      value: ["operator-communication"],
      reconciliation: "superseded",
    });
    expect(superseded.activationObservation).toMatchObject({ state: "superseded", boundary: "reconcile" });
    expect((await readSettings()).activationStatus).toMatchObject({ state: "superseded", boundary: "reconcile" });

    const rollback = await applyStoredMutation("mutation.rollback", { token: superseded.proposalId }, "completed");
    expect(rollback.proposalId).not.toBe(superseded.proposalId);
    expect(rollback.activationObservation).toMatchObject({ state: "active", boundary: "reconcile" });
    expect((await readSettings()).activationStatus).toMatchObject({ state: "active", boundary: "reconcile" });
    expect(readFileSync(join(projectPath, "xdg", "kiln", "config.yaml"), "utf8")).toContain("sequel-engineering");
  });
});

async function readSettings(): Promise<KilnSettingsSnapshot> {
  const snapshot = await readConfigStatusSnapshot({ projectPath, view: "settings", pluginProvider: emptyPluginProvider, projectStateBinding });
  const view = await readConfigStatusView(snapshot, "settings", { pluginProvider: emptyPluginProvider, projectStateBinding });
  return view.value as KilnSettingsSnapshot;
}

async function applySetting(input: {
  readonly scope: "project" | "global";
  readonly key: string;
  readonly value: unknown;
  readonly reconciliation: ReconciliationOutcome;
}) {
  return applyStoredMutation("setting.set", {
    scope: input.scope,
    key: input.key,
    value: input.value,
  }, input.reconciliation);
}

type ReconciliationOutcome = "completed" | "failed" | "superseded";

async function applyStoredMutation(
  operation: "setting.set" | "mutation.rollback",
  payload: Record<string, unknown>,
  reconciliation: ReconciliationOutcome,
) {
  const record = proposeConfigMutation({ projectPath, projectStateBinding, operation, payload });
  expect(record.proposal.status).toBe("valid");
  const store = new ConfigMutationStore(projectPath, { root: projectStateBinding.mutationsPath });
  store.saveProposal(record);
  const approval = record.proposal.approvalRequired
    ? approveConfigMutation({ projectPath, proposalId: record.proposal.proposalId })
    : undefined;
  const result = await applyConfigMutation({
    projectPath,
    projectStateBinding,
    proposalId: record.proposal.proposalId,
    requester: "operator",
    ...(approval === undefined ? {} : { approvalId: approval.approvalId }),
    reconcile: async (_root, targets) => reconcile(targets, reconciliation),
  });
  return {
    ...result.settlement,
    readBackVerified: result.readBackVerified,
  };
}

function reconcile(
  targets: readonly KilnConfigReconciliationTarget[],
  outcome: ReconciliationOutcome,
): readonly KilnConfigReconciliationEffect[] {
  return targets.map((target) => {
    if (outcome === "failed") {
      return { target, status: "failed", summary: `${target} failed.`, errors: ["portable failure"] };
    }
    if (outcome === "superseded") {
      return { target, status: "skipped", summary: `${target} was superseded.`, errors: [] };
    }
    return {
      target,
      status: "ok",
      summary: `${target} converged.`,
      errors: [],
      generation: `sha256:${target.length.toString(16).padStart(64, "0")}`,
    };
  });
}

function admissionBundle(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly sessionRevision: RuntimeConfigurationRevisionSnapshot;
  readonly turnRevision: RuntimeConfigurationRevisionSnapshot;
}): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: input.sessionId,
    turnId: input.turnId,
    admittedAt: new Date().toISOString(),
    configuration: {
      sessionRevision: input.sessionRevision,
      turnRevision: input.turnRevision,
    },
    session: {
      skillCatalog: { catalogId: "portable", revision: "skills-r1", skillIds: ["repo-review"] },
      authorityCeiling: {
        maximumAuthority: "audited",
        reason: "portable activation fixture",
        subjectId: input.sessionId,
      },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: "audited",
        admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection",
        reason: "portable activation fixture",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "workspace_write",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{ toolName: "read_file", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT }],
        deniedToolNames: [],
      },
      effectCeiling: READ_EFFECT,
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}
