import { describe, expect, it } from "vitest";
import { defineManagedAgentInvocationRequest, type ManagedAgentInvocationRequest } from "@kilnai/core/agents";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core/engine";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import {
  createManagedExternalInvocationPermit,
  defineManagedExternalInvocationActionClaim,
  managedExternalInvocationDigest,
  prepareManagedExternalInvocationActionClaim,
  type ManagedExternalInvocationActionClaim,
  type ManagedExternalInvocationActionClaimContext,
  type ManagedExternalInvocationClaimSettlement,
} from "../../src/agents/managed-invocation/external-invocation-action-claim.js";

const READ_AUTHORITY: AuthorityDescriptor = {
  level: 1,
  allowed: true,
  requiresApproval: false,
  reason: "read-only external child",
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

function request(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "external-claim-1",
    agentId: "remote:foundation-readonly-plan",
    parentSessionId: "parent-session",
    parentTurnId: "parent-session:turn:1",
    profile: "foundation-readonly-plan",
    requestedBy: "assistant",
    requestSource: "test",
    providerRoute: { providerId: "remote", surface: "remote-harness", model: "remote-model" },
    adapterKind: "harness",
    executionMode: "remote-harness",
    authority: {
      authorityProfileId: "authority:read-only",
      permissionProfile: "read-only",
      toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false },
      workingDirectory: { path: "C:/repo", mode: "read-only" },
      timeoutMs: 5_000,
      credentialRoute: { mode: "credentialless" },
      memoryScope: { scope: { kind: "project", id: "repo" }, access: "read-only" },
    },
    input: { summary: "Inspect the admitted external child." },
  });
}

function bundle(routeRevision = "r1"): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "parent-session",
    turnId: "parent-session:turn:1",
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "session-r1", revisions: { routes: routeRevision } },
      turnRevision: { revisionSetId: "turn-r1", revisions: { routes: routeRevision } },
    },
    session: {
      skillCatalog: { catalogId: "operator-skills", revision: "s1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "audited", reason: "test" },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "audited",
        admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection",
        reason: "test",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{ toolName: "managed_agent.invoke", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT }],
        deniedToolNames: [],
      },
      effectCeiling: READ_EFFECT,
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

function admission(requestValue: ManagedAgentInvocationRequest) {
  return {
    capabilitySnapshot: { routeId: "remote-route" },
    invocationId: requestValue.invocationId,
  } as const;
}

function context(
  admitted: EffectiveAuthorityAdmissionBundle,
  claims: ManagedAgentActionClaimRecorder,
): ManagedExternalInvocationActionClaimContext {
  return {
    ownerGeneration: "owner-generation-1",
    readAdmission: async () => admitted,
    store: claims,
  };
}

class ManagedAgentActionClaimRecorder {
  readonly claims: ManagedExternalInvocationActionClaim[] = [];
  readonly settlements: ManagedExternalInvocationClaimSettlement[] = [];

  close(): void {}

  claim(input: ManagedExternalInvocationActionClaim) {
    this.claims.push(input);
    return createManagedExternalInvocationPermit(input.claimId, `permit:${this.claims.length}`);
  }

  settle(
    permit: ReturnType<typeof createManagedExternalInvocationPermit>,
    settlement: ManagedExternalInvocationClaimSettlement,
  ): void {
    void permit;
    this.settlements.push(settlement);
  }
}

describe("managed external invocation action claim contract", () => {
  it("reads the complete persisted bundle before claiming and binds the route/effect identity", async () => {
    const childRequest = request();
    const admitted = bundle();
    const recorder = new ManagedAgentActionClaimRecorder();
    const handle = await prepareManagedExternalInvocationActionClaim({
      context: context(admitted, recorder),
      request: childRequest,
      admission: admission(childRequest),
      authorityAdmission: admitted,
      effectKind: "remote-invoke",
      effect: { operation: "transport.invoke" },
      now: () => "2026-08-22T18:00:01.000Z",
    });

    expect(recorder.claims).toHaveLength(1);
    expect(recorder.claims[0]).toMatchObject({
      admissionId: admitted.admissionId,
      sessionId: admitted.sessionId,
      turnId: admitted.turnId,
      attemptId: childRequest.invocationId,
      round: 0,
      effectKind: "remote-invoke",
    });
    expect(recorder.claims[0]!.claimId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    handle.permit.consume();
    recorder.settle(handle.permit, { kind: "success" });
    expect(recorder.settlements).toEqual([{ kind: "success" }]);
  });

  it("rejects a mutated read-back bundle before any action claim", async () => {
    const childRequest = request();
    const admitted = bundle();
    const mutated = bundle("r2");
    const recorder = new ManagedAgentActionClaimRecorder();
    await expect(prepareManagedExternalInvocationActionClaim({
      context: {
        ...context(admitted, recorder),
        readAdmission: async () => mutated,
      },
      request: childRequest,
      admission: admission(childRequest),
      authorityAdmission: admitted,
      effectKind: "cli-run",
      effect: { operation: "session.run" },
    })).rejects.toThrow(/read-back does not match/iu);
    expect(recorder.claims).toHaveLength(0);
  });

  it("uses canonical digests and exposes no second permit after consumption", () => {
    const claim = defineManagedExternalInvocationActionClaim({
      admissionId: managedExternalInvocationDigest("admission"),
      sessionId: "session",
      turnId: "turn",
      invocationId: "invocation",
      attemptId: "attempt",
      round: 0,
      ownerGeneration: "owner",
      routeAck: "route:provider:surface:model",
      intentFingerprint: managedExternalInvocationDigest("intent"),
      effectIdentity: managedExternalInvocationDigest("effect"),
      effectKind: "cli-run",
    });
    const permit = createManagedExternalInvocationPermit(claim.claimId, "permit");
    permit.consume();
    expect(() => permit.consume()).toThrow(/already been consumed/iu);
  });
});
