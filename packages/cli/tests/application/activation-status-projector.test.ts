import { describe, expect, it } from "vitest";
import {
  projectActivationStatus,
  type ActivationStatusProjectionInput,
} from "../../src/application/activation-status-projector.js";
import type { StoredConfigMutationSettlement } from "../../src/application/config-mutation-store.js";

const revision = (letter: string) => `sha256:${letter.repeat(64)}`;

function desired(lineage: {
  readonly proposalId: string;
  readonly committedRevision: string;
  readonly generation?: string;
}) {
  return {
    revisionSetId: revision("d"),
    revisions: {
      global: revision("g"),
      project: lineage.committedRevision,
      "execution-target-evidence": "absent",
    },
    activationLineage: [{
      proposalId: lineage.proposalId,
      scope: "project" as const,
      path: ".kiln/kiln.yaml",
      committedRevision: lineage.committedRevision,
      reconciliationGenerations: lineage.generation === undefined
        ? []
        : [{ target: "native-skills" as const, generation: lineage.generation }],
    }],
  };
}

function settlement(input: {
  readonly proposalId: string;
  readonly committedRevision: string;
  readonly activation: "next-turn" | "next-session" | "reconcile" | "restart-required";
  readonly settledAt?: string;
  readonly generation?: string;
  readonly observation?: StoredConfigMutationSettlement["activationObservation"];
  readonly scope?: "project" | "global";
  readonly path?: string;
}): StoredConfigMutationSettlement {
  const committedRevision = input.committedRevision;
  const generation = input.generation ?? revision("a");
  return {
    proposalId: input.proposalId,
    approvalId: null,
    scope: input.scope ?? "project",
    operation: "setting.set",
    settledAt: input.settledAt ?? "2026-08-22T00:00:01.000Z",
    outcome: input.observation?.state === "failed" ? "committed-reconciliation-failed" : "committed",
    baseRevision: revision("b"),
    committedRevision,
    appliedWrites: [{ path: input.path ?? "C:/project/.kiln/kiln.yaml", previousHash: null, nextHash: committedRevision }],
    reconciliationEffects: [],
    diagnostics: [],
    rollbackToken: input.proposalId,
    activation: input.activation,
    activationObservation: input.observation ?? {
      state: input.activation === "reconcile"
        ? "active"
        : input.activation === "restart-required" ? "unsupported" : "scheduled",
      boundary: input.activation,
      committedRevision,
      activeRevision: input.activation === "reconcile" ? committedRevision : null,
      summary: "fixture",
    },
    reconciliationGenerations: [{ target: "native-skills", generation }],
    restore: [],
  } as StoredConfigMutationSettlement;
}

function input(overrides: Partial<ActivationStatusProjectionInput>): ActivationStatusProjectionInput {
  const lineage = {
    proposalId: "cfg-next-turn",
    committedRevision: revision("p"),
    generation: revision("a"),
  };
  return {
    desiredRevision: desired(lineage),
    settlements: [settlement({ proposalId: lineage.proposalId, committedRevision: lineage.committedRevision, activation: "next-turn", generation: lineage.generation })],
    progress: [],
    admittedBundles: [],
    ...overrides,
  };
}

function boundaryBundle(
  boundary: "turnRevision" | "sessionRevision",
  desiredRevision: ReturnType<typeof desired>,
  admittedAt = "2026-08-22T00:00:02.000Z",
) {
  return {
    sessionId: "session-1",
    turnId: "turn-1",
    admittedAt,
    configuration: {
      sessionRevision: desiredRevision,
      turnRevision: desiredRevision,
    },
    boundary,
  };
}

describe("projectActivationStatus", () => {
  it("moves next-turn from scheduled to active only after a matching admitted turn boundary", () => {
    const base = input({});
    expect(projectActivationStatus(base)).toMatchObject({ state: "scheduled", boundary: "next-turn", activeRevision: null });

    const projected = projectActivationStatus({
      ...base,
      admittedBundles: [boundaryBundle("turnRevision", base.desiredRevision)],
    });
    expect(projected).toMatchObject({ state: "active", boundary: "next-turn", activeRevision: base.desiredRevision.revisionSetId });
    expect(projected.entries[0]).toMatchObject({ evidence: "turn-boundary", state: "active" });
  });

  it("uses a new session revision for next-session and does not accept an old session pin", () => {
    const base = input({
      desiredRevision: desired({ proposalId: "cfg-next-session", committedRevision: revision("s"), generation: revision("a") }),
      settlements: [settlement({ proposalId: "cfg-next-session", committedRevision: revision("s"), activation: "next-session", generation: revision("a") })],
    });
    const old = { ...boundaryBundle("sessionRevision", base.desiredRevision), configuration: { ...boundaryBundle("sessionRevision", base.desiredRevision).configuration, sessionRevision: { ...base.desiredRevision, revisionSetId: revision("o") } } };
    expect(projectActivationStatus({ ...base, admittedBundles: [old] }).state).toBe("scheduled");
    expect(projectActivationStatus({ ...base, admittedBundles: [boundaryBundle("sessionRevision", base.desiredRevision)] })).toMatchObject({
      state: "active",
      boundary: "next-session",
    });
  });

  it("requires the latest lineage when a revision returns after A to B to A rollback", () => {
    const desiredA = desired({ proposalId: "cfg-rollback-a", committedRevision: revision("a"), generation: revision("c") });
    const current = settlement({ proposalId: "cfg-rollback-a", committedRevision: revision("a"), activation: "next-turn", generation: revision("c") });
    const stale = boundaryBundle("turnRevision", { ...desiredA, activationLineage: [{ ...desiredA.activationLineage![0]!, proposalId: "cfg-first-a", reconciliationGenerations: [{ target: "native-skills", generation: revision("a") }] }] });
    expect(projectActivationStatus({
      desiredRevision: desiredA,
      settlements: [current],
      progress: [],
      admittedBundles: [stale],
    }).state).toBe("scheduled");
    expect(projectActivationStatus({
      desiredRevision: desiredA,
      settlements: [current],
      progress: [],
      admittedBundles: [boundaryBundle("turnRevision", desiredA)],
    }).state).toBe("active");
  });

  it("does not claim active when settlement generations do not match the desired lineage", () => {
    const base = input({});
    const mismatched = settlement({
      proposalId: "cfg-next-turn",
      committedRevision: base.desiredRevision.revisions.project,
      activation: "reconcile",
      generation: revision("z"),
      observation: {
        state: "active",
        boundary: "reconcile",
        committedRevision: base.desiredRevision.revisions.project,
        activeRevision: base.desiredRevision.revisions.project,
        summary: "mismatched fixture",
      },
    });
    const projected = projectActivationStatus({ ...base, settlements: [mismatched] });
    expect(projected.state).not.toBe("active");
    expect(projected.entries[0]?.evidence).toBe("mismatched-generations");
  });

  it("rejects activation observations whose boundary or revisions do not match the settlement", () => {
    const base = input({});
    const committed = base.desiredRevision.revisions.project;
    const malformed = settlement({
      proposalId: "cfg-next-turn",
      committedRevision: committed,
      activation: "next-turn",
      generation: base.desiredRevision.activationLineage![0]!.reconciliationGenerations[0]!.generation,
      observation: {
        state: "active",
        boundary: "reconcile",
        committedRevision: revision("wrong"),
        activeRevision: revision("other"),
        summary: "forged active observation",
      },
    });

    const projected = projectActivationStatus({ ...base, settlements: [malformed] });
    expect(projected.state).toBe("failed");
    expect(projected.entries[0]).toMatchObject({ state: "failed", activeRevision: null, evidence: "none" });
  });

  it("selects aggregate boundary and summary from an entry in the aggregate state", () => {
    const activeRevision = revision("a");
    const failedRevision = revision("b");
    const generation = revision("g");
    const desiredRevision = {
      revisionSetId: revision("d"),
      revisions: {
        global: revision("h"),
        project: failedRevision,
        "execution-target-evidence": "absent",
      },
      activationLineage: [
        {
          proposalId: "cfg-active",
          scope: "project" as const,
          path: ".kiln/kiln.yaml",
          committedRevision: activeRevision,
          reconciliationGenerations: [{ target: "native-skills" as const, generation }],
        },
        {
          proposalId: "cfg-failed",
          scope: "project" as const,
          path: "config.yaml",
          committedRevision: failedRevision,
          reconciliationGenerations: [{ target: "native-skills" as const, generation }],
        },
      ],
    };
    const projected = projectActivationStatus({
      desiredRevision,
      settlements: [
        settlement({
          proposalId: "cfg-failed",
          committedRevision: failedRevision,
          activation: "next-session",
          settledAt: "2026-08-22T00:00:01.000Z",
          generation,
          observation: {
            state: "failed",
            boundary: "next-session",
            committedRevision: failedRevision,
            activeRevision: null,
            summary: "The session-boundary activation failed.",
          },
          path: "C:/project/config.yaml",
        }),
        settlement({
          proposalId: "cfg-active",
          committedRevision: activeRevision,
          activation: "reconcile",
          settledAt: "2026-08-22T00:00:02.000Z",
          generation,
          observation: {
            state: "active",
            boundary: "reconcile",
            committedRevision: activeRevision,
            activeRevision: activeRevision,
            summary: "The projection converged.",
          },
        }),
      ],
      progress: [],
      admittedBundles: [],
    });

    expect(projected.state).toBe("failed");
    expect(projected.boundary).toBe("next-session");
    expect(projected.summary).toBe("The session-boundary activation failed.");
  });

  it("reports in-flight progress as pending and superseded terminal evidence as superseded", () => {
    const base = input({});
    const pending = projectActivationStatus({
      ...base,
      settlements: [],
      progress: [{ proposalId: "cfg-next-turn", path: "C:/project/.kiln/kiln.yaml", intendedRevision: base.desiredRevision.revisions.project, startedAt: "2026-08-22T00:00:01.000Z" }],
    });
    expect(pending).toMatchObject({ state: "pending", entries: [{ evidence: "progress" }] });

    const supersededSettlement = settlement({
      proposalId: "cfg-next-turn",
      committedRevision: base.desiredRevision.revisions.project,
      activation: "next-turn",
      observation: {
        state: "superseded",
        boundary: "next-turn",
        committedRevision: base.desiredRevision.revisions.project,
        activeRevision: null,
        summary: "newer revision superseded this attempt",
      },
    });
    expect(projectActivationStatus({ ...base, settlements: [supersededSettlement] }).state).toBe("superseded");
  });

  it("surfaces a progress marker whose desired write has not produced a lineage yet", () => {
    const base = input({
      progress: [{
        proposalId: "cfg-in-flight",
        path: "C:/project/.kiln/kiln.yaml",
        intendedRevision: revision("n"),
        startedAt: "2026-08-22T00:00:02.000Z",
      }],
      proposals: [{
        recordVersion: 2,
        proposal: {
          proposalId: "cfg-in-flight",
          createdAt: "2026-08-22T00:00:01.000Z",
          scope: "project",
          operation: "setting.set",
          status: "valid",
          baseRevision: revision("p"),
          normalizedPayload: {},
          affectedOwners: [],
          affectedCanonicalPaths: ["C:/project/.kiln/kiln.yaml"],
          reconciliationTargets: [],
          authorityImpact: "none",
          approvalRequired: false,
          activation: "next-turn",
          diagnostics: [],
          previewDiff: "",
          rollback: { restorable: true, summary: "fixture" },
        },
        proposalHash: revision("h"),
        writes: [],
      }],
    });
    const projected = projectActivationStatus(base);
    expect(projected.state).toBe("pending");
    expect(projected.entries).toContainEqual(expect.objectContaining({
      proposalId: "cfg-in-flight",
      path: ".kiln/kiln.yaml",
      evidence: "progress",
      state: "pending",
    }));
  });

  it("keeps restart-required explicitly unsupported", () => {
    const base = input({
      settlements: [settlement({ proposalId: "cfg-next-turn", committedRevision: revision("p"), activation: "restart-required" })],
    });
    expect(projectActivationStatus(base)).toMatchObject({ state: "unsupported", boundary: "restart-required" });
  });
});
