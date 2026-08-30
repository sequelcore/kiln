import { describe, expect, it } from "vitest";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core/engine";
import {
  assertPersistableAuthorityAdmissionBundle,
  type AuthorityAdmissionEvidenceStore,
} from "../../src/session/authority-admission-evidence.js";

const READ_AUTHORITY: AuthorityDescriptor = { level: 1, allowed: true, requiresApproval: false, reason: "read-only" };
const READ_EFFECT: ActionEffectEnvelope = { operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: ["local-state"], idempotency: "idempotent" };

function makeBundle() {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-1",
    turnId: "turn-1",
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "R1", revisions: { skills: "sha256:s1" } },
      turnRevision: { revisionSetId: "R2", revisions: { routes: "sha256:r2" } },
    },
    session: {
      skillCatalog: { catalogId: "operator", revision: "sha256:skills-r1", skillIds: ["research"] },
      authorityCeiling: { maximumAuthority: "audited", reason: "operator policy", subjectId: "session-1" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute", requestedAuthority: "audited", admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection", reason: "admitted", completeness: "authoritative",
        toolCount: 1, deniedToolCount: 0, sandboxProjection: "workspace_write",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [{ toolName: "read_file", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT }], deniedToolNames: [] },
      effectCeiling: { operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "metadata", identityUse: "none", consequences: ["local-state"], idempotency: "idempotent" },
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

describe("AuthorityAdmissionEvidenceStore", () => {
  it("requires an immutable validated bundle before persistence", () => {
    const bundle = makeBundle();
    expect(assertPersistableAuthorityAdmissionBundle(bundle)).toEqual(bundle);
    expect(() => assertPersistableAuthorityAdmissionBundle({
      ...bundle,
       admissionId: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    })).toThrow(/digest|admission|bundle/iu);
  });

  it("is a mandatory async persistence contract", async () => {
    const persisted: string[] = [];
    const store: AuthorityAdmissionEvidenceStore = {
      persist(bundle) { persisted.push(bundle.admissionId); },
      loadSessionFacet() { return undefined; },
    };
    await store.persist(makeBundle());
    expect(persisted).toHaveLength(1);
  });

  it("rejects a deep-mutable bundle even when its digest is otherwise valid", () => {
    const bundle = makeBundle();
    const mutable = {
      ...bundle,
      turn: { ...bundle.turn, tools: { ...bundle.turn.tools, allowedToolPermissions: [...bundle.turn.tools.allowedToolPermissions] } },
    } as typeof bundle;
    expect(() => assertPersistableAuthorityAdmissionBundle(mutable)).toThrow(/immutable|frozen/iu);
  });
});
