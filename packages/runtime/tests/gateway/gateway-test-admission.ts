import type { ProviderAdapter } from "@kilnai/core/agents";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import type { GatewayAuthorityAdmissionPort } from "../../src/gateway/gateway-authority-admission.js";
import type { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import type {
  ChannelEgressActionClaim,
  ChannelEgressActionClaimContext,
  ChannelEgressActionClaimPermit,
  ChannelEgressActionClaimSettlement,
} from "../../src/channels/channel-egress-action-claim.js";
import type {
  RuntimeModelRoundActionClaimPermit,
  RuntimeModelRoundActionClaimStore,
} from "../../src/execution-kernel/runtime-model-round-action-claim.js";
import type {
  RuntimeMediaActionClaim,
  RuntimeMediaActionClaimContext,
  RuntimeMediaActionClaimPermit,
  RuntimeMediaActionClaimSettlement,
  RuntimeMediaActionClaimStore,
} from "../../src/execution-kernel/runtime-media-action-claim.js";

function createTestChannelEgressClaims(): {
  readonly context: ChannelEgressActionClaimContext;
  readonly admissions: Map<string, import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle>;
} {
  const admissions = new Map<string, import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle>();
  const claims = new Map<string, ChannelEgressActionClaim>();
  const permits = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
  const store = {
    claim(input: ChannelEgressActionClaim): ChannelEgressActionClaimPermit {
      const slot = `${input.callerId}\u0000${input.idempotencyKey}\u0000${input.logicalSendSlot}`;
      const existing = claims.get(slot);
      if (existing) {
        if (existing.effectIdentity !== input.effectIdentity) throw new Error("Channel egress test slot immutable identity mismatch.");
        throw new Error("Channel egress test action claim already exists; no redispatch.");
      }
      claims.set(slot, input);
      const state = { claimId: input.claimId, consumed: false };
      const permit = {
        permitId: `gateway-test:${input.claimId}`,
        claimId: input.claimId,
        consume: () => {
          if (state.consumed) throw new Error("Channel egress test permit already consumed.");
          state.consumed = true;
        },
      } as ChannelEgressActionClaimPermit;
      permits.set(permit, state);
      return permit;
    },
    settle(permit: ChannelEgressActionClaimPermit, settlement: ChannelEgressActionClaimSettlement): void {
      const state = permits.get(permit);
      if (!state || state.claimId !== permit.claimId || !state.consumed) throw new Error("Unknown or unconsumed channel egress test permit.");
      void settlement;
      permits.delete(permit);
    },
  };
  return {
    admissions,
    context: { ownerGeneration: "gateway-test", store, readAdmission: async ({ admissionId }) => admissions.get(admissionId) },
  };
}

function createTestMediaClaims(): {
  readonly context: RuntimeMediaActionClaimContext;
  readonly admissions: Map<string, import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle>;
} {
  const admissions = new Map<string, import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle>();
  const claims = new Map<string, RuntimeMediaActionClaim>();
  const permits = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
  const store: RuntimeMediaActionClaimStore = {
    claim(input: RuntimeMediaActionClaim): RuntimeMediaActionClaimPermit {
      const slot = `${input.callerId}\u0000${input.idempotencyKey}\u0000${input.logicalSendSlot}`;
      if (claims.has(slot)) throw new Error("Runtime media test action claim already exists; no redispatch.");
      claims.set(slot, input);
      const state = { claimId: input.claimId, consumed: false };
      const permit = {
        claimId: input.claimId,
        consume: () => {
          if (state.consumed) throw new Error("Runtime media test permit already consumed.");
          state.consumed = true;
        },
      } as RuntimeMediaActionClaimPermit;
      permits.set(permit, state);
      return permit;
    },
    settle(permit: RuntimeMediaActionClaimPermit, _settlement: RuntimeMediaActionClaimSettlement): void {
      const state = permits.get(permit);
      if (!state || state.claimId !== permit.claimId || !state.consumed) throw new Error("Unknown or unconsumed media test permit.");
      permits.delete(permit);
    },
  };
  return {
    admissions,
    context: { ownerGeneration: "gateway-test-media", store, readAdmission: async ({ admissionId }) => admissions.get(admissionId) },
  };
}

/** A complete, bundle-owned admission used by route tests. */
export function makeGatewayTestAdmission(
  sessionRegistry: SessionRegistry,
  provider: ProviderAdapter = { name: "gateway-test", createMessage: async () => ({ parts: [], inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: [] }), streamMessage: async function* () {} },
): GatewayAuthorityAdmissionPort {
  const channelEgress = createTestChannelEgressClaims();
  const mediaActionClaims = createTestMediaClaims();
  return {
    channelEgressActionClaims: channelEgress.context,
    runtimeMediaActionClaims: mediaActionClaims.context,
    async execute(request, dispatch) {
      const session = await sessionRegistry.getById(request.sessionId)
        ?? await sessionRegistry.get(request.appName, request.userId, request.tenantId);
      if (!session || session.appName !== request.appName || session.tenantId !== request.tenantId || session.userId !== request.userId) {
        throw new Error("Gateway test admission requires the exact RuntimeSession identified by the request.");
      }
      const turnId = canonicalTurnId(session.id, session.userTurnCount + 1);
      const revision = { revisionSetId: "gateway-test", revisions: { execution: "gateway-test" } } as const;
      const bundle = defineEffectiveAuthorityAdmissionBundle({
        sessionId: session.id,
        turnId,
        admittedAt: "2026-08-22T18:00:00.000Z",
        configuration: { sessionRevision: revision, turnRevision: revision },
        session: {
          skillCatalog: { catalogId: "gateway-test", revision: "gateway-test", skillIds: [] },
          authorityCeiling: { maximumAuthority: "read_only", reason: "gateway route test", subjectId: session.id },
        },
        turn: {
          authority: {
            executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed",
            sourcePolicy: "runtime_surface_projection", reason: "Gateway route test has no admitted tools.",
            completeness: "authoritative", toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
          },
          workGovernance: { status: "not-required" },
          operatorAdoption: {
            status: "admitted",
            decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: session.id, operatorTurnId: turnId, actorId: request.userId }),
          },
          tools: { allowedToolPermissions: [], deniedToolNames: [] },
          effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
          budget: { status: "not-configured" },
          execution: { status: "routed", route: { routeId: "gateway-test", providerId: provider.name, providerModelId: provider.name, accountSelection: { mode: "exact", accountId: "gateway-test", source: "route" } }, dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "gateway test" } }, binding: { status: "bound", routeId: "gateway-test", accountId: "gateway-test", credentialId: "gateway-test", credentialRevision: "gateway-test" } },
        },
      });
      const perCallConfig = { authorityAdmission: bundle, turnId };
      channelEgress.admissions.set(bundle.admissionId, bundle);
      mediaActionClaims.admissions.set(bundle.admissionId, bundle);
      const runtimeModelRoundDispatch = {
        admission: bundle,
        intentFingerprint: "sha256:" + "a".repeat(64),
        attemptId: request.ingressId,
        routeId: "gateway-test",
        accountId: "gateway-test",
        credentialRevision: "gateway-test",
        readAdmission: async () => bundle,
        store: createTestModelRoundStore(),
        state: { claimed: false },
      } as never;
      return dispatch({ session, bundle, perCallConfig, provider, runtimeModelRoundDispatch, runtimeToolActionClaims: undefined as never, runtimeMediaActionClaims: mediaActionClaims.context, evidence: { status: "persisted", sessionId: bundle.sessionId, admissionId: bundle.admissionId } });
    },
  };
}

function createTestModelRoundStore(): RuntimeModelRoundActionClaimStore {
  const permits = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
  return {
    claim(claim) {
      const state = { claimId: claim.claimId, consumed: false };
      const permit = {
        claimId: claim.claimId,
        permitId: `gateway-test:${claim.claimId}`,
        consume: () => {
          if (state.consumed) throw new Error("Gateway test model-round permit already consumed.");
          state.consumed = true;
        },
      } as RuntimeModelRoundActionClaimPermit;
      permits.set(permit, state);
      return permit;
    },
    settle(permit) {
      const state = permits.get(permit);
      if (!state || state.claimId !== permit.claimId || !state.consumed) {
        throw new Error("Unknown or unconsumed gateway test model-round permit.");
      }
      permits.delete(permit);
    },
  };
}
