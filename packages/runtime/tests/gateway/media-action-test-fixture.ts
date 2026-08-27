import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import type {
  RuntimeMediaActionClaim,
  RuntimeMediaActionClaimContext,
  RuntimeMediaActionClaimPermit,
  RuntimeMediaActionClaimSettlement,
  RuntimeMediaActionClaimStore,
} from "../../src/execution-kernel/runtime-media-action-claim.js";

export function createMediaActionTestContext(): {
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle;
  readonly mediaActionClaims: RuntimeMediaActionClaimContext;
} {
  const revision = { revisionSetId: "media-fixture", revisions: { execution: "media-fixture" } } as const;
  const authorityAdmission = defineEffectiveAuthorityAdmissionBundle({
    sessionId: "media-session",
    turnId: canonicalTurnId("media-session", 1),
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "media-fixture", revision: "media-fixture", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "media fixture", subjectId: "media-session" },
    },
    turn: {
      authority: {
        executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed",
        sourcePolicy: "runtime_surface_projection", reason: "media fixture", completeness: "authoritative",
        toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: {
        status: "admitted",
        decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: "media-session", operatorTurnId: canonicalTurnId("media-session", 1), actorId: "media-user" }),
      },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "mutate", boundaries: ["network"], reversibility: "irreversible", dataEgress: "sensitive-data",
        identityUse: "authenticated", consequences: ["external-state"], idempotency: "non-idempotent",
      },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: { targetId: "media-route", providerId: "media-provider", providerModelId: "media-model", accountSelection: { kind: "operator-override", accountPolicyId: "media-policy", accountId: "media-account" } },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId: "media-route", accountId: "media-account", credentialId: "media-credential", credentialRevision: "media-r1" },
      },
    },
  });
  const claims = new Map<string, RuntimeMediaActionClaim>();
  const permits = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
  const store: RuntimeMediaActionClaimStore = {
    claim(input) {
      const slot = `${input.callerId}\u0000${input.idempotencyKey}\u0000${input.logicalSendSlot}`;
      if (claims.has(slot)) throw new Error("media test claim slot already exists");
      claims.set(slot, input);
      const state = { claimId: input.claimId, consumed: false };
      const permit = {
        claimId: input.claimId,
        consume: () => {
          if (state.consumed) throw new Error("media test permit already consumed");
          state.consumed = true;
        },
      } as RuntimeMediaActionClaimPermit;
      permits.set(permit, state);
      return permit;
    },
    settle(permit: RuntimeMediaActionClaimPermit, _settlement: RuntimeMediaActionClaimSettlement) {
      const state = permits.get(permit);
      if (!state || state.claimId !== permit.claimId || !state.consumed) throw new Error("media test permit invalid");
      permits.delete(permit);
    },
  };
  return {
    authorityAdmission,
    mediaActionClaims: {
      ownerGeneration: "media-fixture",
      store,
      readAdmission: async () => authorityAdmission,
    },
  };
}
