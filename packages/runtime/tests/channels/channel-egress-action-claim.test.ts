import { describe, expect, it, vi } from "vitest";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import { defineEffectiveAuthorityAdmissionBundle, type EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import {
  ChannelEgressClaimedError,
  ChannelEgressPreDispatchCancellationError,
  dispatchChannelEgress,
  type ChannelEgressActionClaim,
  type ChannelEgressActionClaimPermit,
  type ChannelEgressActionClaimSettlement,
  type ChannelEgressActionClaimStore,
  type ChannelEgressActionClaimContext,
} from "../../src/channels/channel-egress-action-claim.js";

function bundle(): EffectiveAuthorityAdmissionBundle {
  const revision = { revisionSetId: "channel-egress-test", revisions: { execution: "channel-egress-test" } } as const;
  const turnId = canonicalTurnId("session-1", 1);
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-1",
    turnId,
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "channel-egress-test", revision: "channel-egress-test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "channel egress test", subjectId: "session-1" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed",
        sourcePolicy: "runtime_surface_projection", reason: "channel egress test", completeness: "authoritative",
        toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: {
        status: "admitted",
        decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: "session-1", operatorTurnId: turnId, actorId: "caller-1" }),
      },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "mutate", boundaries: ["external-system", "network"], reversibility: "irreversible",
        dataEgress: "sensitive-data", identityUse: "authenticated", consequences: ["external-state"], idempotency: "non-idempotent",
      },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: { targetId: "route-1", providerId: "provider-1", providerModelId: "model-1", accountSelection: { kind: "operator-override", accountPolicyId: "policy-1", accountId: "account-1" } },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId: "route-1", accountId: "account-1", credentialId: "credential-1", credentialRevision: "credential-r1" },
      },
    },
  });
}

function claimStoreRecorder(): ChannelEgressActionClaimStore & {
  readonly claims: ChannelEgressActionClaim[];
  readonly settlements: Array<{ permit: ChannelEgressActionClaimPermit; settlement: ChannelEgressActionClaimSettlement }>;
  readonly consumed: string[];
} {
  const claims: ChannelEgressActionClaim[] = [];
  const settlements: Array<{ permit: ChannelEgressActionClaimPermit; settlement: ChannelEgressActionClaimSettlement }> = [];
  const consumed: string[] = [];
  return {
    claims,
    settlements,
    consumed,
    claim(input) {
      claims.push(input);
      return {
        permitId: `permit-${claims.length}`,
        claimId: input.claimId,
        consume: vi.fn(() => { consumed.push(input.claimId); }),
      // The permit brand is private to the durable claim owner. This fixture
      // intentionally constructs the opaque capability returned by that owner.
      } as unknown as ChannelEgressActionClaimPermit;
    },
    settle(permit, settlement) {
      settlements.push({ permit, settlement });
    },
  };
}

function context(
  admitted: EffectiveAuthorityAdmissionBundle,
  store: ChannelEgressActionClaimStore,
): ChannelEgressActionClaimContext {
  return {
    ownerGeneration: "process-1",
    store,
    readAdmission: vi.fn(async () => admitted),
  };
}

const action = {
  attemptId: "attempt-1",
  callerId: "webhook:whatsapp",
  idempotencyKey: "message-1",
  logicalSendSlot: "assistant-text",
  channel: "whatsapp",
  destination: "whatsapp:phone-1:user-1",
  adapterIdentity: "whatsapp-cloud:v21.0:phone-1",
  payload: { type: "text", text: { body: "hello" } },
} as const;

describe("channel egress action claim", () => {
  it("rejects cancellation before claim and performs no readback or send", async () => {
    const store = claimStoreRecorder();
    const admitted = bundle();
    const readAdmission = vi.fn(async () => admitted);
    const abort = new AbortController();
    abort.abort();

    await expect(dispatchChannelEgress({
      context: { ...context(admitted, store), readAdmission },
      authorityAdmission: admitted,
      ...action,
      abortSignal: abort.signal,
      send: vi.fn(async () => "unreachable"),
    })).rejects.toBeInstanceOf(ChannelEgressPreDispatchCancellationError);

    expect(readAdmission).not.toHaveBeenCalled();
    expect(store.claims).toHaveLength(0);
  });

  it("requires a complete matching persisted bundle before claiming", async () => {
    const store = claimStoreRecorder();
    const admitted = bundle();
    const mutated = { ...admitted, turnId: "turn-mutated" } as EffectiveAuthorityAdmissionBundle;

    await expect(dispatchChannelEgress({
      context: context(mutated, store),
      authorityAdmission: admitted,
      ...action,
      send: vi.fn(async () => "unreachable"),
    })).rejects.toThrow(/read-back|persisted|bundle/iu);

    expect(store.claims).toHaveLength(0);
  });

  it("claims once, invokes the adapter once, and settles success with a secret-free identity", async () => {
    const store = claimStoreRecorder();
    const admitted = bundle();
    const send = vi.fn(async () => ({ messageId: "provider-1" }));

    await expect(dispatchChannelEgress({
      context: context(admitted, store),
      authorityAdmission: admitted,
      ...action,
      payload: { ...action.payload },
      send,
    })).resolves.toEqual({ messageId: "provider-1" });

    expect(send).toHaveBeenCalledOnce();
    expect(store.consumed).toEqual([store.claims[0]!.claimId]);
    expect(store.claims).toHaveLength(1);
    expect(store.claims[0]).toMatchObject({
      callerId: action.callerId,
      idempotencyKey: action.idempotencyKey,
      logicalSendSlot: action.logicalSendSlot,
      destination: action.destination,
      adapterIdentity: action.adapterIdentity,
    });
    expect(store.claims[0]!.payloadFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(store.claims[0])).not.toContain("accessToken");
    expect(store.settlements).toHaveLength(1);
    expect(store.settlements[0]!.settlement).toEqual({ kind: "success" });
  });

  it("rejects a payload identity that contains credential-shaped fields", async () => {
    const store = claimStoreRecorder();
    const admitted = bundle();

    await expect(dispatchChannelEgress({
      context: context(admitted, store),
      authorityAdmission: admitted,
      ...action,
      payload: { type: "text", accessToken: "must-not-cross-the-boundary" },
      send: vi.fn(async () => "unreachable"),
    })).rejects.toThrow(/secret-free|credential|accessToken/iu);

    expect(store.claims).toHaveLength(0);
  });

  it("settles unknown after transport/response loss and never retries or falls back", async () => {
    const store = claimStoreRecorder();
    const admitted = bundle();
    const send = vi.fn().mockRejectedValue(new Error("response lost"));

    await expect(dispatchChannelEgress({
      context: context(admitted, store),
      authorityAdmission: admitted,
      ...action,
      send,
    })).rejects.toBeInstanceOf(ChannelEgressClaimedError);

    expect(send).toHaveBeenCalledOnce();
    expect(store.settlements).toHaveLength(1);
    expect(store.settlements[0]!.settlement).toMatchObject({ kind: "unknown", reason: expect.stringContaining("response lost") });
  });

  it("treats cancellation observed after claim as unknown, not pre-dispatch cancellation", async () => {
    const store = claimStoreRecorder();
    const admitted = bundle();
    const abort = new AbortController();
    const send = vi.fn(async () => {
      abort.abort();
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await expect(dispatchChannelEgress({
      context: context(admitted, store),
      authorityAdmission: admitted,
      ...action,
      abortSignal: abort.signal,
      send,
    })).rejects.toBeInstanceOf(ChannelEgressClaimedError);

    expect(store.settlements[0]!.settlement).toMatchObject({ kind: "unknown" });
  });

  it("keeps provider-success settlement failure typed and never attempts a contradictory settlement", async () => {
    const store = claimStoreRecorder();
    store.settle = vi.fn(() => {
      throw new Error("durable success settlement unavailable");
    });
    const admitted = bundle();
    const send = vi.fn(async () => "provider-accepted");

    await expect(dispatchChannelEgress({
      context: context(admitted, store),
      authorityAdmission: admitted,
      ...action,
      send,
    })).rejects.toMatchObject({
      name: "ChannelEgressClaimedError",
      claimId: expect.stringMatching(/^sha256:/u),
      outcome: "unknown",
    });

    expect(send).toHaveBeenCalledOnce();
    expect(store.settle).toHaveBeenCalledOnce();
  });

  it("wraps unknown-settlement failure as a claimed outcome after provider loss", async () => {
    const store = claimStoreRecorder();
    store.settle = vi.fn(() => {
      throw new Error("durable unknown settlement unavailable");
    });
    const admitted = bundle();
    const send = vi.fn().mockRejectedValue(new Error("response lost"));

    await expect(dispatchChannelEgress({
      context: context(admitted, store),
      authorityAdmission: admitted,
      ...action,
      send,
    })).rejects.toMatchObject({
      name: "ChannelEgressClaimedError",
      claimId: expect.stringMatching(/^sha256:/u),
      outcome: "unknown",
    });

    expect(send).toHaveBeenCalledOnce();
    expect(store.settle).toHaveBeenCalledOnce();
  });
});
