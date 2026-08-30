import { describe, expect, it, vi } from "vitest";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import {
  dispatchRuntimeMediaAction,
  prepareRuntimeMediaActionClaim,
  RuntimeMediaActionClaimedError,
  RuntimeMediaActionPreDispatchCancellationError,
  type RuntimeMediaActionClaim,
  type RuntimeMediaActionClaimContext,
  type RuntimeMediaActionClaimPermit,
  type RuntimeMediaActionClaimSettlement,
  type RuntimeMediaActionClaimStore,
} from "../../src/execution-kernel/runtime-media-action-claim.js";

function bundle(): EffectiveAuthorityAdmissionBundle {
  const revision = { revisionSetId: "runtime-media-test", revisions: { execution: "runtime-media-test" } } as const;
  const turnId = canonicalTurnId("session-1", 1);
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-1",
    turnId,
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "runtime-media-test", revision: "runtime-media-test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "media test", subjectId: "session-1" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed",
        sourcePolicy: "runtime_surface_projection", reason: "media test", completeness: "authoritative",
        toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: {
        status: "admitted",
        decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: "session-1", operatorTurnId: turnId, actorId: "caller-1" }),
      },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "mutate", boundaries: ["network"], reversibility: "irreversible",
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

function storeRecorder(): RuntimeMediaActionClaimStore & {
  readonly claims: RuntimeMediaActionClaim[];
  readonly settlements: Array<{ permit: RuntimeMediaActionClaimPermit; settlement: RuntimeMediaActionClaimSettlement }>;
  readonly consumed: string[];
} {
  const claims: RuntimeMediaActionClaim[] = [];
  const settlements: Array<{ permit: RuntimeMediaActionClaimPermit; settlement: RuntimeMediaActionClaimSettlement }> = [];
  const consumed: string[] = [];
  const states = new WeakMap<object, { claimId: string; consumed: boolean }>();
  return {
    claims,
    settlements,
    consumed,
    claim(input) {
      claims.push(input);
      const state = { claimId: input.claimId, consumed: false };
      const permit = {
        claimId: input.claimId,
        consume: vi.fn(() => {
          if (state.consumed) throw new Error("permit already consumed");
          state.consumed = true;
          consumed.push(input.claimId);
        }),
      // The brand is intentionally process-private; this store validates the
      // permit by object identity before settlement.
      } as unknown as RuntimeMediaActionClaimPermit;
      states.set(permit, state);
      return permit;
    },
    settle(permit, settlement) {
      const state = states.get(permit);
      if (!state || !state.consumed) throw new Error("unknown or unconsumed permit");
      settlements.push({ permit, settlement });
      states.delete(permit);
    },
  };
}

function context(admitted: EffectiveAuthorityAdmissionBundle, store: RuntimeMediaActionClaimStore): RuntimeMediaActionClaimContext {
  return {
    ownerGeneration: "process-1",
    store,
    readAdmission: vi.fn(async () => admitted),
  };
}

const action = {
  attemptId: "attempt-1",
  callerId: "webhook:whatsapp:message-1",
  idempotencyKey: "message-1",
  actionKind: "stt-transcribe" as const,
  sourceIdentity: "artifact:audio-1",
  adapterIdentity: "whatsapp-stt:provider-1:model-1",
  logicalSendSlot: "inbound-stt:0",
  payload: { sourceArtifactUri: "artifact:audio-1", mimeType: "audio/ogg", byteLength: 42 },
} as const;

describe("runtime media action claim", () => {
  it("rejects pre-dispatch cancellation before readback, claim, or call", async () => {
    const admitted = bundle();
    const store = storeRecorder();
    const abort = new AbortController();
    abort.abort();
    const call = vi.fn(async () => "unreachable");

    await expect(dispatchRuntimeMediaAction({
      context: context(admitted, store), authorityAdmission: admitted, ...action, abortSignal: abort.signal, call,
    })).rejects.toBeInstanceOf(RuntimeMediaActionPreDispatchCancellationError);
    expect(call).not.toHaveBeenCalled();
    expect(store.claims).toHaveLength(0);
  });

  it("requires complete matching persisted admission readback", async () => {
    const admitted = bundle();
    const mutated = { ...admitted, turnId: "mutated" } as EffectiveAuthorityAdmissionBundle;
    const store = storeRecorder();

    await expect(dispatchRuntimeMediaAction({
      context: context(mutated, store), authorityAdmission: admitted, ...action, call: vi.fn(async () => "unreachable"),
    })).rejects.toThrow(/read-back|bundle|persisted/iu);
    expect(store.claims).toHaveLength(0);
  });

  it("honors cancellation raised during admission readback before claiming", async () => {
    const admitted = bundle();
    const store = storeRecorder();
    const abort = new AbortController();
    const call = vi.fn(async () => "unreachable");
    const claimContext: RuntimeMediaActionClaimContext = {
      ...context(admitted, store),
      readAdmission: vi.fn(async () => {
        abort.abort();
        return admitted;
      }),
    };

    await expect(dispatchRuntimeMediaAction({
      context: claimContext, authorityAdmission: admitted, ...action, abortSignal: abort.signal, call,
    })).rejects.toBeInstanceOf(RuntimeMediaActionPreDispatchCancellationError);
    expect(store.claims).toHaveLength(0);
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps claim identity stable across object key order and changes it with payload semantics", async () => {
    const admitted = bundle();
    const now = () => "2026-08-22T18:00:01.000Z";
    const prepare = (payload: unknown) => prepareRuntimeMediaActionClaim({
      context: context(admitted, storeRecorder()), authorityAdmission: admitted, ...action, payload, now,
    });

    const ordered = await prepare({ sourceArtifactUri: "artifact:audio-1", mimeType: "audio/ogg", byteLength: 42 });
    const reordered = await prepare({ byteLength: 42, mimeType: "audio/ogg", sourceArtifactUri: "artifact:audio-1" });
    const changed = await prepare({ sourceArtifactUri: "artifact:audio-1", mimeType: "audio/ogg", byteLength: 43 });

    expect(reordered.claim.claimId).toBe(ordered.claim.claimId);
    expect(reordered.claim.payloadFingerprint).toBe(ordered.claim.payloadFingerprint);
    expect(changed.claim.payloadFingerprint).not.toBe(ordered.claim.payloadFingerprint);
    expect(changed.claim.effectIdentity).not.toBe(ordered.claim.effectIdentity);
    expect(changed.claim.claimId).not.toBe(ordered.claim.claimId);
  });

  it("consumes immediately before exactly one call and settles success", async () => {
    const admitted = bundle();
    const store = storeRecorder();
    const order: string[] = [];
    const call = vi.fn(async () => {
      order.push("call");
      return "provider-result";
    });
    const originalClaim = store.claim.bind(store);
    store.claim = (input) => {
      const permit = originalClaim(input);
      const consume = permit.consume;
      (permit as { consume: () => void }).consume = () => { order.push("consume"); consume(); };
      return permit;
    };

    await expect(dispatchRuntimeMediaAction({
      context: context(admitted, store), authorityAdmission: admitted, ...action, call,
    })).resolves.toBe("provider-result");
    expect(order).toEqual(["consume", "call"]);
    expect(call).toHaveBeenCalledOnce();
    expect(store.settlements[0]!.settlement).toEqual({ kind: "success" });
  });

  it("settles unknown after provider loss and never retries", async () => {
    const admitted = bundle();
    const store = storeRecorder();
    const providerLoss = new Error("response lost");
    const call = vi.fn().mockRejectedValue(providerLoss);

    await expect(dispatchRuntimeMediaAction({
      context: context(admitted, store), authorityAdmission: admitted, ...action, call,
    })).rejects.toMatchObject({
      name: "RuntimeMediaActionClaimedError",
      retryable: false,
      outcome: "unknown",
      cause: providerLoss,
    });
    expect(call).toHaveBeenCalledOnce();
    expect(store.settlements).toHaveLength(1);
    expect(store.settlements[0]!.settlement).toEqual({ kind: "unknown", reason: "response lost" });
  });

  it("settles unknown when cancellation aborts an in-flight claimed effect", async () => {
    const admitted = bundle();
    const store = storeRecorder();
    const abort = new AbortController();
    const call = vi.fn(() => new Promise<string>((_resolve, reject) => {
      abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true });
    }));

    const dispatched = dispatchRuntimeMediaAction({
      context: context(admitted, store), authorityAdmission: admitted, ...action, abortSignal: abort.signal, call,
    });
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    abort.abort(new Error("turn-cancelled"));

    await expect(dispatched).rejects.toBeInstanceOf(RuntimeMediaActionClaimedError);
    expect(store.settlements[0]!.settlement).toMatchObject({ kind: "unknown", reason: "turn-cancelled" });
    expect(call).toHaveBeenCalledOnce();
  });

  it("keeps settlement failure typed after the effect and never sends again", async () => {
    const admitted = bundle();
    const store = storeRecorder();
    store.settle = vi.fn(() => { throw new Error("settlement unavailable"); });
    const call = vi.fn(async () => "accepted");

    await expect(dispatchRuntimeMediaAction({
      context: context(admitted, store), authorityAdmission: admitted, ...action, call,
    })).rejects.toMatchObject({
      name: "RuntimeMediaActionClaimedError",
      claimId: expect.stringMatching(/^sha256:/u),
      outcome: "unknown",
    });
    expect(call).toHaveBeenCalledOnce();
    expect(store.settle).toHaveBeenCalledOnce();
  });

  it("rejects secret-bearing identity projections before claiming", async () => {
    const admitted = bundle();
    const store = storeRecorder();

    await expect(dispatchRuntimeMediaAction({
      context: context(admitted, store), authorityAdmission: admitted, ...action,
      payload: { sourceArtifactUri: "artifact:audio-1", apiKey: "secret" },
      call: vi.fn(async () => "unreachable"),
    })).rejects.toThrow(/secret-free|credential|apiKey/iu);
    expect(store.claims).toHaveLength(0);
  });

});
