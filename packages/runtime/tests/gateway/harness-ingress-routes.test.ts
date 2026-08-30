import { describe, expect, it, vi } from "vitest";
import type { UpgradeWebSocket } from "hono/ws";
import { canonicalTurnId } from "@kilnai/core/events";
import {
  createExecutionAccountPolicyId,
  createExecutionAccountRef,
  defineExecutionTargetCatalog,
  type RuntimeTurnTerminalDisposition,
  type ProviderAdapter,
} from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { parseHarnessIngressServerFrame } from "@kilnai/gateway-contracts";
import { createHarnessIngressRoutes } from "../../src/gateway/harness-ingress-routes.js";
import { FixedTargetGatewayAuthorityAdmission, type GatewayAuthorityAdmissionPort } from "../../src/gateway/gateway-authority-admission.js";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import type { AccountCapacityRecord, ExecutionAccountCapacityAuthority } from "../../src/execution-kernel/execution-account-capacity-authority.js";

type MockWebSocket = { readonly send: ReturnType<typeof vi.fn>; readonly readyState: number };
type Handlers = {
  readonly onOpen?: (event: Event, ws: MockWebSocket) => void | Promise<void>;
  readonly onMessage?: (event: MessageEvent, ws: MockWebSocket) => void | Promise<void>;
};
type HandlerFactory = (context: unknown) => Handlers;

function makeUpgrade() {
  let factory: HandlerFactory | undefined;
  // Hono's overload accepts either a context or event factory. The route only
  // uses the event-factory branch; this adapter captures that third-party seam.
  const upgradeWebSocket = ((candidate: unknown) => {
    factory = candidate as HandlerFactory;
    return async (_c: unknown, next: () => Promise<void>) => next();
  }) as UpgradeWebSocket;
  return {
    upgradeWebSocket,
    connect(headers: Record<string, string> = {}) {
      if (!factory) throw new Error("upgrade was not registered");
      const handlers = factory({
        req: { header: (name: string) => headers[name] },
        get: () => ({
          callerId: headers["X-Caller"] ?? "caller-1",
          appName: "app-one",
          userId: headers["X-User"] ?? "user-1",
          tenantId: "tenant-1",
        }),
      });
      const ws: MockWebSocket = { send: vi.fn(), readyState: 1 };
      return { handlers, ws };
    },
  };
}

function frame(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ protocolVersion: "2", type: "turn_start", requestId: "request-1", content: "hello", ...overrides });
}

const convergencePolicy = {
  policyId: "test.runtime.turn-convergence",
  configurationHash: `sha256:${"0".repeat(64)}`,
  providerRequests: 10,
  toolRounds: 8,
  toolCalls: 24,
  cumulativeInputTokens: 256_000,
  elapsedMs: 600_000,
  activeMs: 600_000,
  recoveryAttempts: 3,
  consecutiveNoProgressSteps: 3,
} as const;

const completedDisposition = {
  outcome: "completed",
  dispositionReason: "completion_eligible",
  completion: {
    obligations: [],
    producerEvidence: [],
    eligibility: { status: "eligible" },
  },
  convergence: {
    policy: convergencePolicy,
    progressEvidence: [],
  },
} satisfies RuntimeTurnTerminalDisposition;

const noProgressDisposition = {
  outcome: "paused",
  dispositionReason: "no_progress",
  convergence: {
    policy: convergencePolicy,
    progressEvidence: [{
      kind: "no_progress",
      reason: "repeated_result",
      strategyFingerprint: "strategy:repeated-result",
      supportingToolCallIds: ["tool-call:1"],
    }],
    pause: {
      status: "pause",
      reason: "no_progress",
      metric: "consecutiveNoProgressSteps",
      observed: 3,
      limit: 3,
    },
  },
} satisfies RuntimeTurnTerminalDisposition;

const toolRoundLimitDisposition = {
  outcome: "paused",
  dispositionReason: "tool_round_limit",
  convergence: {
    policy: convergencePolicy,
    progressEvidence: [],
    pause: {
      status: "pause",
      reason: "tool_round_limit",
      metric: "toolRounds",
      observed: 8,
      limit: 8,
    },
  },
} satisfies RuntimeTurnTerminalDisposition;

const requiredProducerNotRunDisposition = {
  outcome: "paused",
  dispositionReason: "required_producer_not_run",
  completion: {
    obligations: [{
      kind: "required_producer",
      obligationId: "required-producer:formal_verify",
      canonicalToolId: "formal_verify",
      acceptedEquivalentToolIds: [],
      sourceAlias: "Dafny",
    }],
    producerEvidence: [],
    eligibility: {
      status: "ineligible",
      unmet: [{
        obligationId: "required-producer:formal_verify",
        canonicalToolId: "formal_verify",
        sourceAlias: "Dafny",
        status: "not_run",
      }],
    },
  },
  convergence: {
    policy: convergencePolicy,
    progressEvidence: [],
  },
} satisfies RuntimeTurnTerminalDisposition;

const runtimeFailureDisposition = {
  outcome: "failed",
  dispositionReason: "runtime_failure",
} satisfies RuntimeTurnTerminalDisposition;

const operatorCancelledDisposition = {
  outcome: "cancelled",
  dispositionReason: "operator_cancelled",
} satisfies RuntimeTurnTerminalDisposition;

const runtimeCancelledDisposition = {
  outcome: "cancelled",
  dispositionReason: "runtime_cancelled",
} satisfies RuntimeTurnTerminalDisposition;

function admittedResult(disposition: RuntimeTurnTerminalDisposition, parts = textParts("safe reply")) {
  return {
    sessionId: "session-canonical",
    parts,
    ...disposition,
  };
}

function makeRuntime() {
  const session = (sessionId: string) => ({ id: sessionId, appName: "app-one", tenantId: "tenant-1", userId: "user-1" });
  const provider = { name: "provider-one", createMessage: vi.fn(), streamMessage: vi.fn() };
  const bindProvider = vi.fn(() => ({ processMessage: vi.fn() }));
  const gatewayAdmission: GatewayAuthorityAdmissionPort = {
    channelEgressActionClaims: {} as never,
    execute: vi.fn(async (request, dispatch) => {
      const admittedSession = session(request.sessionId);
      const revision = { revisionSetId: "harness-r1", revisions: { gateway: "r1" } };
      const bundle = defineEffectiveAuthorityAdmissionBundle({
        sessionId: request.sessionId,
        turnId: canonicalTurnId(request.sessionId, 1),
        admittedAt: "2026-08-22T00:00:00.000Z",
        configuration: { sessionRevision: revision, turnRevision: revision },
        session: {
          skillCatalog: { catalogId: "harness", revision: "r1", skillIds: [] },
          authorityCeiling: { maximumAuthority: "read_only", reason: "Harness fixture", subjectId: request.sessionId },
        },
        turn: {
          capabilityParticipation: { status: "not-requested" },
          authority: {
            executionMode: "execute", requestedAuthority: request.requestedAuthority ?? "auto", admittedAuthority: "fail_closed",
            sourcePolicy: "runtime_surface_projection", reason: "Harness fixture", completeness: "authoritative",
            toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
          },
          workGovernance: { status: "not-required" }, operatorAdoption: { status: "not-required" },
          tools: { allowedToolPermissions: [], deniedToolNames: [] },
          effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
          budget: { status: "not-configured" },
          execution: {
            status: "routed",
            target: { targetId: "route-one", providerId: "provider-one", providerModelId: "model-one", accountSelection: { kind: "operator-override", accountPolicyId: "policy-one", accountId: "account-one" } },
            dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
            binding: { status: "bound", routeId: "route-one", accountId: "account-one", credentialId: "credential-one", credentialRevision: "credential-r1" },
          },
        },
      });
      return dispatch({
        session: admittedSession,
        bundle,
        perCallConfig: { authorityAdmission: bundle },
        provider,
        runtimeModelRoundDispatch: { admission: bundle, attemptId: request.ingressId } as never,
        runtimeToolActionClaims: { admission: bundle, attemptId: request.ingressId } as never,
        runtimeMediaActionClaims: {} as never,
        evidence: { status: "persisted", sessionId: bundle.sessionId, admissionId: bundle.admissionId },
      });
    }),
  };
  return {
    appName: "app-one",
    tenant: { tenantId: "tenant-1" },
    systemPrompt: "system",
    orchestrator: { processMessage: vi.fn(), bindProvider },
    sessionRegistry: {
      getById: vi.fn(async (id: string) => session(id)),
      getOrCreate: vi.fn(async () => session("session-new")),
    },
    gatewayAdmission,
  };
}

async function makeRealAdmissionRuntime() {
  const sessionRegistry = new SessionRegistry();
  const session = new RuntimeSession({
    appName: "app-one", tenantId: "tenant-1", userId: "user-1", systemPrompt: "system", sessionId: "session-real",
  });
  await sessionRegistry.save(session);
  const catalog = defineExecutionTargetCatalog({
    accounts: [{
      id: "account-one", providerId: "provider-one", credentialId: "credential-one", maxConcurrency: 1, reservedAffinitySlots: 0,
      economics: { capacityIdentity: "capacity-one", subscriptionClass: "subscription", quotaClassId: "quota-one", creditPosture: "disabled", overagePosture: "disabled" },
    }],
    accountPolicies: [{ id: "policy-one", accountIds: ["account-one"], strategy: "economic-least-pressure" }],
    targets: [{
      id: "route-one", label: "Harness", providerId: "provider-one", providerModelId: "model-one", dataClassification: "internal",
      dataPolicyEvidence: {
        providerId: "provider-one", providerModelId: "model-one", dataUse: "not-used", trainingPosture: "prohibited",
        retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"],
        sourceIdentity: "fixture", sourceRevision: "r1", sourceDigest: `sha256:${"c".repeat(64)}`,
        observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-01T00:00:00.000Z",
      },
      accountPolicyId: "policy-one",
      economics: {
        adapterCapabilityId: "provider-one", adapterCapabilityVersion: "1", authBillingChannel: "api-key", executionMode: "direct",
        serviceTier: "default", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled", overagePosture: "disabled",
        contextClass: "default", cacheClass: "none",
        priceEvidence: { kind: "subscription", rateCardId: "fixture", rateCardRevision: "r1", evidence: { sourceIdentity: "fixture", sourceRevision: "r1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", validUntil: "2027-08-01T00:00:00.000Z", confidence: "high", authority: "configured" } },
        auxiliaryCharges: [], executionEnvelope: { limits: [] },
      },
    }],
  });
  const capacityRecord = (state: AccountCapacityRecord["state"]): AccountCapacityRecord => ({
    leaseId: "lease-one", runtimeInvocationId: "request-real", accountPolicyId: createExecutionAccountPolicyId("policy-one"),
    accountRef: createExecutionAccountRef("configured:account-one"), route: { providerId: "provider-one", providerModelId: "model-one", scope: "operator-session" },
    capacityIdentity: "capacity-one", credentialRevisionId: "b".repeat(64), state, selectionReason: "least-pressure", candidateRejections: [],
    ...(state === "held" ? {} : { dispatchFenceId: "request-real:dispatch" }),
  });
  const capacity: ExecutionAccountCapacityAuthority = {
    acquireAccountCapacity: vi.fn<ExecutionAccountCapacityAuthority["acquireAccountCapacity"]>(() => ({ status: "acquired", record: capacityRecord("held"), replay: false })),
    releaseAccountCapacityPreFence: vi.fn(() => capacityRecord("held")),
    fenceAccountCapacityDispatch: vi.fn(() => capacityRecord("dispatch-fenced")),
    settleAccountCapacity: vi.fn(() => capacityRecord("released")),
  };
  let persisted: ReturnType<typeof defineEffectiveAuthorityAdmissionBundle> | undefined;
  const persist = vi.fn((bundle) => { persisted = bundle; });
  const modelClaim = vi.fn((claim) => ({ claimId: claim.claimId, permitId: `permit:${claim.claimId}`, consume: vi.fn() }));
  const provider: ProviderAdapter = {
    name: "provider-one",
    createMessage: vi.fn(async () => ({
      parts: textParts("real reply"), inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      toolCalls: [], stopReason: "end_turn",
    })),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
  const gatewayAdmission = new FixedTargetGatewayAuthorityAdmission({
    appName: "app-one", targetId: "route-one",
    snapshot: { catalog, configurationRevision: { revisionSetId: "harness-r1", revisions: { gateway: "r1" } } },
    sessionRegistry,
    candidates: { resolve: async () => [{
      candidate: { accountId: "account-one", safety: "eligible", health: "healthy", quota: "available", capacity: "available", economicCost: { atoms: "0", scale: 0, unit: "request", scheme: { kind: "currency", currency: "USD" } }, pressure: 0 },
      lease: { candidate: { account: createExecutionAccountRef("configured:account-one"), route: { providerId: "provider-one", providerModelId: "model-one", scope: "operator-session" }, health: "healthy", leaseCapacity: "available", pressure: 0, reservedForNewWork: false }, capacityIdentity: "capacity-one", credentialRevisionId: "b".repeat(64), usageEvidence: { health: "healthy", freshness: "fresh", availability: "available" }, capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 } },
    }] },
    accountCapacityAuthority: capacity,
    credentials: { resolve: async () => ({ credential: { token: "secret" }, credentialId: "credential-one", credentialRevisionId: "b".repeat(64) }) },
    evidenceStore: { persist, loadSessionFacet: () => undefined, readAdmission: () => persisted },
    modelRoundActionClaims: { claim: modelClaim as never, settle: vi.fn() },
    toolActionClaims: { claim: vi.fn() as never, settle: vi.fn() },
    channelEgressActionClaims: { ownerGeneration: "harness-real", readAdmission: async () => persisted, store: { claim: vi.fn() as never, settle: vi.fn() } },
    runtimeMediaActionClaims: { ownerGeneration: "harness-real-media", readAdmission: async () => persisted, store: { claim: vi.fn() as never, settle: vi.fn() } },
    persistOperatorAdoptionDecision: async () => undefined,
    createProvider: () => provider,
    now: () => new Date("2026-08-22T00:00:00.000Z"),
  });
  return {
    runtime: {
      appName: "app-one", tenant: { tenantId: "tenant-1", appName: "app-one", name: "Harness tenant", enabled: true, createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z" }, systemPrompt: "system", sessionRegistry, gatewayAdmission,
      orchestrator: new RuntimeSessionOrchestrator({ provider, model: "model-one" }),
    },
    persist, modelClaim, provider, capacity,
  };
}

function createFixture(overrides: Record<string, unknown> = {}) {
  const upgrade = makeUpgrade();
  const processAdmittedTurn = vi.fn().mockResolvedValue({
    ok: true,
    result: admittedResult(completedDisposition),
  });
  const authenticate = vi.fn().mockResolvedValue({ callerId: "caller-1", appName: "app-one", userId: "user-1", tenantId: "tenant-1" });
  const resolveTarget = vi.fn().mockReturnValue(makeRuntime());
  const app = createHarnessIngressRoutes({
    upgradeWebSocket: upgrade.upgradeWebSocket,
    authenticate,
    resolveTarget,
    processAdmittedTurn,
    ...overrides,
  } as never);
  return { app, upgrade, processAdmittedTurn, authenticate, resolveTarget };
}

async function open(handlers: Handlers, ws: MockWebSocket) {
  await handlers.onOpen?.(new Event("open"), ws);
}

async function message(handlers: Handlers, ws: MockWebSocket, payload: string) {
  await handlers.onMessage?.({ data: payload } as MessageEvent, ws);
}

function sent(ws: MockWebSocket) {
  return ws.send.mock.calls.map(([value]) => JSON.parse(value as string));
}

describe("createHarnessIngressRoutes", () => {
  it("authenticates the Authorization bearer value before upgrade and never accepts a query token", async () => {
    const fixture = createFixture();
    const response = await fixture.app.request("http://localhost/harness/v1/ws?token=secret", { headers: { Authorization: "Bearer token-value" } });
    expect(response.status).toBe(404);
    expect(fixture.authenticate).toHaveBeenCalledWith("token-value");

    const noAuth = createFixture();
    await noAuth.app.request("http://localhost/harness/v1/ws?token=secret");
    expect(noAuth.authenticate).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated upgrades before a websocket handler exists", async () => {
    const fixture = createFixture({ authenticate: vi.fn().mockResolvedValue(undefined) });
    const response = await fixture.app.request("http://localhost/harness/v1/ws", { headers: { Authorization: "Bearer invalid" } });
    expect(response.status).toBe(401);
  });

  it("rejects malformed frames without resolving a target or running a turn", async () => {
    const fixture = createFixture();
    const { handlers, ws } = fixture.upgrade.connect({ Authorization: "Bearer ignored-after-upgrade" });
    await open(handlers, ws);
    await message(handlers, ws, "not json");
    expect(fixture.resolveTarget).not.toHaveBeenCalled();
    expect(fixture.processAdmittedTurn).not.toHaveBeenCalled();
    expect(sent(ws)).toEqual([{ protocolVersion: "2", type: "error", requestId: "invalid", code: "invalid_request", redacted: true }]);
  });

  it("rejects an unknown target before session or provider work", async () => {
    const fixture = createFixture({ resolveTarget: vi.fn().mockReturnValue(undefined) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    expect(fixture.processAdmittedTurn).not.toHaveBeenCalled();
    expect(sent(ws).at(-1)).toMatchObject({ type: "error", code: "unsupported", redacted: true });
  });

  it("rejects a transport tenant that does not exactly match the effective runtime tenant", async () => {
    const fixture = createFixture({ resolveTarget: vi.fn().mockReturnValue({ ...makeRuntime(), tenant: undefined }) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    expect(fixture.processAdmittedTurn).not.toHaveBeenCalled();
    expect(sent(ws).at(-1)).toMatchObject({ type: "error", code: "unsupported", redacted: true });
  });

  it("uses the governed admitted-turn pipeline with trusted identity and safe completion", async () => {
    const fixture = createFixture();
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame({
      sessionId: "session-requested",
      requestedAuthority: "audited",
      deliberationIntent: { mode: "fixed", preferredLevel: "high", onUnsupported: "deny" },
      communicationIntent: {
        responseDetail: "concise",
        requiredContent: ["verification"],
        onUnsupported: "deny",
      },
    }));
    const runtime = fixture.resolveTarget.mock.results[0]?.value as ReturnType<typeof makeRuntime>;
    expect(runtime.gatewayAdmission.execute).toHaveBeenCalledWith(expect.objectContaining({
      ingressId: "request-1",
      sessionId: "session-requested",
      requestedAuthority: "audited",
      channel: "harness",
    }), expect.any(Function));
    expect(fixture.processAdmittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      appName: "app-one", tenantId: "tenant-1", userId: "user-1", channel: "harness",
      admittedSession: expect.objectContaining({ id: "session-requested" }),
      authorityAdmission: expect.objectContaining({ sessionId: "session-requested", turnId: "session-requested:turn:1" }),
      perCallConfig: expect.objectContaining({
        authorityAdmission: expect.objectContaining({ sessionId: "session-requested" }),
        runtimeModelRoundDispatch: expect.objectContaining({ attemptId: "request-1" }),
        runtimeToolActionClaims: expect.objectContaining({ attemptId: "request-1" }),
        deliberationIntent: { mode: "fixed", preferredLevel: "high", onUnsupported: "deny" },
        communicationIntent: expect.objectContaining({
          intent: expect.objectContaining({
            responseDetail: "concise",
            requiredContent: ["verification"],
          }),
          authority: expect.objectContaining({ responseDetail: "user" }),
        }),
        abortSignal: expect.any(AbortSignal),
      }),
    }));
    await vi.waitFor(() => expect(sent(ws)).toHaveLength(2));
    expect(sent(ws)).toEqual([
      { protocolVersion: "2", type: "turn_accepted", requestId: "request-1", turnId: "request-1", sessionId: "session-requested" },
      {
        protocolVersion: "2", type: "turn_completed", requestId: "request-1", turnId: "request-1", sessionId: "session-canonical",
        outcome: "completed", dispositionReason: "completion_eligible", completion: completedDisposition.completion,
        convergence: completedDisposition.convergence, content: "safe reply",
      },
    ]);
  });

  it.each([
    ["completed", completedDisposition],
    ["no-progress", noProgressDisposition],
    ["tool-round bound", toolRoundLimitDisposition],
    ["required producer not run", requiredProducerNotRunDisposition],
    ["runtime failure", runtimeFailureDisposition],
    ["operator cancellation", operatorCancelledDisposition],
    ["runtime cancellation", runtimeCancelledDisposition],
  ] as const)("projects the exact %s terminal disposition and evidence", async (_label, disposition) => {
    const fixture = createFixture({
      processAdmittedTurn: vi.fn().mockResolvedValue({ ok: true, result: admittedResult(disposition) }),
    });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await vi.waitFor(() => expect(sent(ws)).toHaveLength(2));

    const completed = parseHarnessIngressServerFrame(sent(ws).at(-1));
    expect(completed).toMatchObject({
      type: "turn_completed",
      requestId: "request-1",
      turnId: "request-1",
      sessionId: "session-canonical",
      ...disposition,
    });
  });

  it("persists real Gateway admission and claims the real Runtime model round before provider dispatch", async () => {
    const admitted = await makeRealAdmissionRuntime();
    const upgrade = makeUpgrade();
    const app = createHarnessIngressRoutes({
      upgradeWebSocket: upgrade.upgradeWebSocket,
      authenticate: async () => ({ callerId: "caller-1", appName: "app-one", userId: "user-1", tenantId: "tenant-1" }),
      resolveTarget: () => admitted.runtime,
      processAdmittedTurn: async (ctx) => {
        const result = await ctx.orchestrator.processMessage(
          ctx.admittedSession!, ctx.userParts, undefined, undefined, ctx.perCallConfig,
        );
        return {
          ok: true,
          result: {
            ...result,
            sessionId: ctx.admittedSession!.id,
            sessionMode: ctx.admittedSession!.sessionMode,
            traceId: "harness-real-trace",
          },
        };
      },
    });
    await app.request("http://localhost/harness/v1/ws", { headers: { Authorization: "Bearer real" } });
    const { handlers, ws } = upgrade.connect();
    await message(handlers, ws, frame({ requestId: "request-real", sessionId: "session-real" }));
    await vi.waitFor(() => expect(sent(ws)).toHaveLength(2));

    expect(sent(ws).at(-1)).toMatchObject({ type: "turn_completed", sessionId: "session-real", content: "real reply" });
    expect(admitted.persist).toHaveBeenCalledOnce();
    expect(admitted.modelClaim).toHaveBeenCalledOnce();
    expect(admitted.provider.createMessage).toHaveBeenCalledOnce();
    expect(admitted.capacity.fenceAccountCapacityDispatch).toHaveBeenCalledOnce();
    expect(admitted.capacity.settleAccountCapacity).toHaveBeenCalledOnce();
  });

  it("prevents duplicate active work and allows only the same trusted identity to cancel it", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const processAdmittedTurn = vi.fn().mockReturnValue(pending);
    const fixture = createFixture({ processAdmittedTurn });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await Promise.resolve();
    await message(handlers, ws, frame({ requestId: "request-2" }));
    await message(handlers, ws, JSON.stringify({ protocolVersion: "2", type: "turn_cancel", requestId: "cancel-1", turnId: "request-1" }));
    const frames = sent(ws);
    expect(frames).toContainEqual(expect.objectContaining({ type: "error", requestId: "request-2", code: "unsupported" }));
    expect(frames).toContainEqual({ protocolVersion: "2", type: "turn_cancel_result", requestId: "cancel-1", turnId: "request-1", status: "accepted" });
    const call = processAdmittedTurn.mock.calls[0]![0] as { perCallConfig: { abortSignal: AbortSignal } };
    expect(call.perCallConfig.abortSignal.aborted).toBe(true);
    finish({ ok: true, result: admittedResult(completedDisposition, []) });
  });

  it("maps a route-level failure to a typed runtime failure without leaking internal details", async () => {
    const fixture = createFixture({ processAdmittedTurn: vi.fn().mockRejectedValue(new Error("provider secret detail")) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await vi.waitFor(() => expect(sent(ws)).toHaveLength(2));
    const frames = sent(ws);
    expect(JSON.stringify(frames)).not.toContain("provider secret detail");
    expect(frames.at(-1)).toEqual({
      protocolVersion: "2", type: "turn_completed", requestId: "request-1", turnId: "request-1", sessionId: "session-new",
      ...runtimeFailureDisposition,
    });
  });

  it("maps an operator cancellation that interrupts route execution to a typed cancellation", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<never>((_resolve, nextReject) => { reject = nextReject; });
    const fixture = createFixture({ processAdmittedTurn: vi.fn().mockReturnValue(pending) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await Promise.resolve();
    await message(handlers, ws, JSON.stringify({
      protocolVersion: "2", type: "turn_cancel", requestId: "cancel-1", turnId: "request-1",
    }));
    reject(new Error("operator cancelled"));
    await vi.waitFor(() => expect(sent(ws)).toHaveLength(3));
    expect(sent(ws).at(-1)).toEqual({
      protocolVersion: "2", type: "turn_completed", requestId: "request-1", turnId: "request-1", sessionId: "session-new",
      ...operatorCancelledDisposition,
    });
  });

  it("projects only validated safe completion parts and never forwards provider/internal parts", async () => {
    const fixture = createFixture({
      processAdmittedTurn: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          sessionId: "session-canonical",
          parts: [
            { type: "text", text: "safe response" },
            { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
            { type: "tool_call", name: "internal_tool", arguments: "secret" },
            { type: "file", mimeType: "text/plain", data: "aGVsbG8=", filename: "output.txt", providerTrace: "private" },
          ],
          ...completedDisposition,
        },
      }),
    });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await vi.waitFor(() => expect(sent(ws)).toHaveLength(2));
    const completion = sent(ws).at(-1);
    expect(completion).toEqual({
      protocolVersion: "2", type: "turn_completed", requestId: "request-1", turnId: "request-1", sessionId: "session-canonical",
      ...completedDisposition,
      parts: [
        { type: "text", text: "safe response" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        { type: "file", mimeType: "text/plain", data: "aGVsbG8=", filename: "output.txt" },
      ],
    });
    expect(JSON.stringify(completion)).not.toContain("internal_tool");
    expect(JSON.stringify(completion)).not.toContain("providerTrace");
  });

  it("maps budget denial to the closed unavailable error frame", async () => {
    const fixture = createFixture({ processAdmittedTurn: vi.fn().mockResolvedValue({ ok: false, budgetDenied: { budgetExhausted: true, message: "private budget detail" } }) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await vi.waitFor(() => expect(sent(ws)).toHaveLength(2));
    expect(sent(ws).at(-1)).toEqual({ protocolVersion: "2", type: "error", requestId: "request-1", code: "unavailable", redacted: true });
  });

  it("keeps admitted work alive when the initiating socket closes before completion", async () => {
    const fixture = createFixture();
    const { handlers, ws } = fixture.upgrade.connect();
    ws.send.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("socket closed"); });
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await vi.waitFor(() => expect(fixture.processAdmittedTurn).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(2));
    expect(fixture.processAdmittedTurn).toHaveBeenCalledOnce();
    expect(ws.send).toHaveBeenCalledTimes(2);
  });

  it("isolates active turns by the trusted caller and user session key", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const processAdmittedTurn = vi.fn().mockReturnValue(pending);
    const fixture = createFixture({ processAdmittedTurn });
    const first = fixture.upgrade.connect();
    const second = fixture.upgrade.connect({ "X-Caller": "caller-2" });
    await open(first.handlers, first.ws);
    await open(second.handlers, second.ws);
    await message(first.handlers, first.ws, frame({ sessionId: "shared-session" }));
    await Promise.resolve();
    await message(second.handlers, second.ws, JSON.stringify({ protocolVersion: "2", type: "turn_cancel", requestId: "cancel-other", sessionId: "shared-session", turnId: "request-1" }));
    expect(sent(second.ws).at(-1)).toEqual({ protocolVersion: "2", type: "turn_cancel_result", requestId: "cancel-other", turnId: "request-1", status: "not_active" });
    const call = processAdmittedTurn.mock.calls[0]![0] as { perCallConfig: { abortSignal: AbortSignal } };
    expect(call.perCallConfig.abortSignal.aborted).toBe(false);
    finish({ ok: true, result: admittedResult(completedDisposition, []) });
  });
});
