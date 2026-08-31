import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineDeliberationLevelId,
  type ManagedAgentAdapterDescriptor,
  type ManagedAgentInvocationRequest,
  type ModelCapabilityRegistry,
  type ProviderAdapter,
  resolveCommunicationIntent,
} from "@kilnai/core/agents";
import { sha256ContentIdentity } from "@kilnai/core/content-addressing";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import {
  runtimeModelRoundEffectIdentity,
  type RuntimeModelRoundActionClaim,
  type RuntimeModelRoundActionClaimPermit,
  type RuntimeModelRoundActionClaimStore,
  type RuntimeModelRoundDispatchContext,
} from "../../src/execution-kernel/runtime-model-round-action-claim.js";
import {
  type AuxiliaryModalityRoute,
  extractText,
  type ModelRouter,
  type RoutingDecision,
  type RoutingRequest,
  textParts,
} from "@kilnai/core/engine";
import { EventBus, type ExecutionSessionRunOptions } from "@kilnai/core/events";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";
import { ManagedRemoteHarnessAdapter } from "../../src/agents/managed-invocation/remote-harness-adapter.js";
import { CliSubscriptionExecutor } from "../../src/execution/cli-subscription-executor.js";
import { processAdmittedTurn, type AdmittedTurnContext } from "../../src/gateway/message-pipeline/process-admitted-turn.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import type {
  ModelRoutingRouteCapabilities,
  RuntimeMultimodalDelegationRoute,
  RuntimeMultimodalTransformRoute,
  PerCallToolConfig,
} from "../../src/session/runtime-session-orchestrator.types.js";
import {
  deriveRuntimeConvergencePolicyInput,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
} from "../../src/session/runtime-execution-envelope.js";
import { externalHarnessDisposition } from "./runtime-terminal-fixture.js";

function makeEventBus(): EventBus {
  const eventBus = new EventBus(100);
  vi.spyOn(eventBus, "emit");
  return eventBus;
}

function emittedEvents(eventBus: EventBus): readonly unknown[][] {
  return vi.mocked(eventBus.emit).mock.calls;
}

function makeDeliberationCapabilities(
  provider: string,
  model: string,
  levels: readonly string[],
  defaultLevel: string,
): ModelRoutingRouteCapabilities {
  return {
    deliberation: {
      provider,
      model,
      levels: levels.map((id) => ({ id: defineDeliberationLevelId(id) })),
      defaultLevel: defineDeliberationLevelId(defaultLevel),
      supportsAdaptive: false,
      evidence: {
        sourceIdentity: "routed/models",
        sourceRevision: "test-r1",
        observedAt: "2026-05-12T00:00:00.000Z",
      },
    },
  };
}

function makeCommunicationCapabilities(
  provider: string,
  model: string,
): ModelRoutingRouteCapabilities {
  return {
    communication: {
      provider,
      model,
      responseDetail: {
        mechanism: "native",
        supported: ["concise", "standard", "detailed"],
        nativeValues: { concise: "low", standard: "medium", detailed: "high" },
      },
      evidence: {
        sourceIdentity: `${provider}/models`,
        sourceRevision: "communication-r1",
        observedAt: "2026-08-13T00:00:00.000Z",
      },
    },
  };
}

function requireRoutingRationale(
  result: { readonly routingDecision?: { readonly rationale?: RoutingDecision["rationale"] } },
): NonNullable<RoutingDecision["rationale"]> {
  const rationale = result.routingDecision?.rationale;
  if (!rationale) throw new Error("Expected the routing decision to include rationale evidence.");
  return rationale;
}

function makeProvider(name = "mock"): ProviderAdapter {
  return {
    name,
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "end_turn",
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

const TEST_HANDOFF_PROVENANCE = {
  delivery: "runtime-generated",
  configuredModelId: "test-model",
  observedModelIds: [],
} as const;

function makeSession(systemPrompt = "You are helpful."): RuntimeSession {
  return new RuntimeSession({ appName: "app", tenantId: "test-tenant", userId: "user-1", systemPrompt });
}

function makeRouter(decision: RoutingDecision): ModelRouter {
  return {
    route: vi.fn().mockReturnValue(decision),
  };
}

function makeManagedAdapter(summary = "Delegated vision summary."): ManagedAgentRuntimeAdapter {
  return {
    descriptor: makeManagedDescriptor(),
    invoke: vi.fn(async ({ request, admission }: {
      readonly request: ManagedAgentInvocationRequest;
      readonly admission: {
        readonly capabilitySnapshot: ReturnType<typeof buildManagedAgentCapabilitySnapshot>;
      };
    }) =>
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: admission.capabilitySnapshot,
        childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
        childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        usage: {
          source: "adapter",
          tokenClasses: [
            { name: "input", value: 7 },
            { name: "output", value: 5 },
            { name: "cache_read", value: 0 },
          ],
          cost: { currency: "unknown", amount: "unknown" },
        },
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary,
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
          structuredResult: {
            version: "structured-execution-result-v1",
            status: "completed",
            summary,
            uncertainty: 0,
            limitations: ["The synthetic vision adapter does not exercise a live provider."],
            operatorDecisions: [],
            evidence: [{
              uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
              kind: "artifact",
            }],
            citations: [],
            warnings: [],
            failures: [],
            approvalRequirements: [],
            residualRisks: ["Live provider behavior remains unverified by this unit test."],
            verificationResults: [],
          },
        },
      })),
  };
}

function makeManagedDescriptor(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:vision-child:harness",
    providerId: "openai",
    adapterKind: "direct",
    supportedAccess: ["read-only"],
    supportedExecutionModes: ["direct-provider"],
    lifecycle: {
      exposesStart: true,
      exposesTerminal: true,
      exposesCleanup: true,
    },
    cancellation: { supported: true },
    timeout: { supported: true, diagnosticArtifactOnTimeout: true },
    transcript: {
      supported: true,
      redactionKnown: true,
      truncationKnown: true,
      persistenceKnown: true,
      retentionKnown: true,
    },
    usage: {
      supported: true,
      preservesProviderTokenClasses: true,
      supportsExplicitUnknowns: true,
      tokenClasses: ["input", "output", "cache_read"],
      semanticSourceGranularity: "unknown",
      evidenceBasis: "adapter",
    },
    resultHandoff: {
      boundedSummary: true,
      resourcePointers: true,
    },
    credentialRoute: { supported: true },
    memoryContext: { governedAdmission: true },
    unsupportedFieldPolicy: "reject",
    cleanup: { supported: true },
    ...overrides,
  });
}

function makeAuxiliaryVisionRoute(): AuxiliaryModalityRoute {
  return {
    routeId: "managed-vision-readonly",
    provider: "openai",
    model: "gpt-4o",
    agentProfile: "vision-describer",
    authorityProfileId: "authority:managed-vision:readonly",
    routeHealth: {
      status: "healthy",
      evidence: "Test managed vision route is configured.",
    },
    capabilities: {
      provider: "openai",
      model: "gpt-4o",
      supportedCapabilities: ["vision"],
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      toolResultModalities: ["text", "image"],
      constraints: {
        supportsBase64: true,
        supportsUrl: true,
        supportsDocuments: false,
      },
      degradationBehavior: [],
    },
  };
}

function makeVisionDelegationRoute(adapter: ManagedAgentRuntimeAdapter): RuntimeMultimodalDelegationRoute {
  return {
    route: makeAuxiliaryVisionRoute(),
    adapter,
    access: "read-only",
    requestedAuthority: "read_only",
    providerRoute: {
      providerId: "openai",
      surface: "cli-harness",
      model: "gpt-4o",
    },
    observedRuntimeAuthority: {
      approval: "on-request",
      sandbox: "read-only",
      source: "runtime-observation",
      proof: "proven",
      observedAt: "2026-07-02T08:00:00.000Z",
      validUntil: "2099-01-01T00:00:00.000Z",
    },
    authority: {
      authorityProfileId: "authority:managed-vision:readonly",
      toolAuthority: {
        allowedToolNames: ["read"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "read-only",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: "credential-route:managed-vision",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
  };
}

function makeTransformRoute(
  overrides: Partial<RuntimeMultimodalTransformRoute>,
): RuntimeMultimodalTransformRoute {
  return {
    transform: "ocr",
    sourceModalities: ["image"],
    outputModality: "text",
    provenance: "test-transform",
    degradation: "test transform degradation",
    implementation: "runtime-built-in",
    ...overrides,
  };
}

function makeFixtureModelRoundStore(): RuntimeModelRoundActionClaimStore {
  const rows = new Map<string, RuntimeModelRoundActionClaim>();
  const consumed = new WeakSet<object>();
  return {
    claim: (claim) => {
      const permit = {
        claimId: claim.claimId,
        permitId: `fixture-model-round-permit:${claim.claimId}`,
        consume: () => {
          if (consumed.has(permit)) throw new Error("fixture model-round permit already consumed");
          consumed.add(permit);
        },
      } as unknown as RuntimeModelRoundActionClaimPermit;
      rows.set(claim.claimId, claim);
      return permit;
    },
    settle: (permit, settlement) => {
      const claim = rows.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("fixture model-round permit was not consumed");
      rows.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "unknown" ? { unknownReason: settlement.reason } : { outcome: "success" }),
      });
    },
  };
}

function makeFixtureModelRoundAdmission(
  session: RuntimeSession,
  turnId: string,
  providerId: string,
  providerModelId: string,
) {
  const revision = { revisionSetId: "runtime_surface_projection", revisions: { fixture: "model-routing-test" } } as const;
  const routeId = `fixture:${providerId}:${providerModelId}`;
  const accountId = "fixture-model-round-account";
  const credentialRevision = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: session.id,
    turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "model-routing-test", revision: "1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "Model routing fixture", subjectId: session.id },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection",
        reason: "Model routing fixture",
        completeness: "authoritative",
        toolCount: 0,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "observe",
        boundaries: [],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: routeId,
          providerId,
          providerModelId,
          accountSelection: { kind: "operator-override", accountPolicyId: "fixture-policy", accountId },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId,
          accountId,
          credentialId: "fixture-model-round-credential",
          credentialRevision,
        },
      },
    },
  });
}

function fixtureModelRoundConfig(
  orchestrator: RuntimeSessionOrchestrator,
  session: RuntimeSession,
  config: PerCallToolConfig | undefined,
): { readonly config: PerCallToolConfig; readonly restore: () => void } {
  if (config?.runtimeModelRoundDispatch) return { config, restore: () => undefined };
  const deps = (orchestrator as unknown as { readonly deps: {
    readonly provider: ProviderAdapter;
    readonly model?: string;
    readonly modelRouter?: ModelRouter;
    readonly providerPool?: ReadonlyMap<string, ProviderAdapter>;
  } }).deps;
  if (!deps.model) (deps as { model?: string }).model = "fixture-model";
  const turnId = config?.turnCorrelationId ?? `${session.id}:turn:${Math.max(session.userTurnCount + 1, 1)}`;
  let providerId = deps.provider.name;
  let providerModelId = deps.model ?? "fixture-model";
  const hasExplicitAdmittedRoute = config?.authorityAdmission?.turn.execution.status === "routed";
  if (hasExplicitAdmittedRoute && config?.authorityAdmission?.turn.execution.status === "routed") {
    providerId = config.authorityAdmission.turn.execution.target.providerId;
    providerModelId = config.authorityAdmission.turn.execution.target.providerModelId;
  }
  let admission = makeFixtureModelRoundAdmission(session, turnId, providerId, providerModelId);
  const store = makeFixtureModelRoundStore();
  const context = {
    get admission() { return admission; },
    intentFingerprint: runtimeModelRoundEffectIdentity({ fixture: "model-routing", sessionId: session.id, turnId }),
    attemptId: `fixture-model-round-attempt:${session.id}:${turnId}`,
    get routeId() { return admission.turn.execution.status === "routed" ? admission.turn.execution.binding.routeId : ""; },
    accountId: "fixture-model-round-account",
    credentialRevision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    readAdmission: async () => admission,
    store,
    state: { claimed: false },
  } as unknown as RuntimeModelRoundDispatchContext;
  const router = deps.modelRouter;
  const originalRoute = router?.route;
  if (router && originalRoute) {
    router.route = ((request: RoutingRequest) => {
      const decision = originalRoute.call(router, request);
      // The fixture models route admission at the boundary: an automatic
      // decision only changes the committed route when that provider is
      // actually available in the provider pool. Otherwise the default route
      // remains the exact canonical authority and the decision is diagnostic.
       if (!hasExplicitAdmittedRoute && deps.providerPool?.has(decision.provider)) {
        providerId = decision.provider;
        providerModelId = decision.model;
        admission = makeFixtureModelRoundAdmission(session, turnId, providerId, providerModelId);
      }
      return decision;
    }) as ModelRouter["route"];
  }
  const modelOverride = config?.modelOverride?.source === "operator" ? config.modelOverride : undefined;
  if (modelOverride && !hasExplicitAdmittedRoute) {
    providerId = modelOverride.provider;
    providerModelId = modelOverride.model;
    admission = makeFixtureModelRoundAdmission(session, turnId, providerId, providerModelId);
  }
  return {
    config: {
      ...config,
      // The persisted bundle is the sole Runtime execution authority. A
      // getter keeps the fixture admission aligned with the route selected by
      // the model router before the production route check runs.
      get authorityAdmission() {
        return admission;
      },
      runtimeModelRoundDispatch: context,
    },
    restore: () => {
      if (router && originalRoute) router.route = originalRoute;
    },
  };
}

const canonicalProcessMessage = RuntimeSessionOrchestrator.prototype.processMessage;
RuntimeSessionOrchestrator.prototype.processMessage = function fixtureProcessMessage(
  session: RuntimeSession,
  userParts: Parameters<RuntimeSessionOrchestrator["processMessage"]>[1],
  governedContext?: Parameters<RuntimeSessionOrchestrator["processMessage"]>[2],
  callBuiltinTools?: Parameters<RuntimeSessionOrchestrator["processMessage"]>[3],
  perCallConfig?: PerCallToolConfig,
): ReturnType<RuntimeSessionOrchestrator["processMessage"]> {
  const fixture = fixtureModelRoundConfig(this, session, perCallConfig);
  return canonicalProcessMessage.call(
    this,
    session,
    userParts,
    governedContext,
    callBuiltinTools,
    fixture.config,
  ).finally(fixture.restore);
};

describe("RuntimeSessionOrchestrator model routing", () => {
  let defaultProvider: ProviderAdapter;

  beforeEach(() => {
    defaultProvider = makeProvider("default");
  });

  it("without modelRouter, uses default provider", async () => {
    const orchestrator = new RuntimeSessionOrchestrator({ provider: defaultProvider });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    expect(defaultProvider.createMessage).toHaveBeenCalled();
    expect(result.routingDecision).toBeUndefined();
  });

  it("with modelRouter, uses routed provider from pool", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Test rule matched",
      confidence: 1.0,
      routingTier: "rule",
    });

    const providerPool = new Map<string, ProviderAdapter>([["routed", routedProvider]]);

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    expect(routedProvider.createMessage).toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision!.provider).toBe("routed");
    expect(result.routingDecision!.model).toBe("routed-model");
    expect(result.routingDecision!.routingTier).toBe("rule");
    expect(result.routingDecision!.reasoning).toBe("Test rule matched");
    expect(result.routingDecision!.selectionMode).toBe("automatic");
    expect(result.routingDecision!.rationale).toMatchObject({
      selectedProvider: "routed",
      selectedModel: "routed-model",
      selectionMode: "automatic",
      routingReason: "Test rule matched",
    });
  });

  it("scores routing against the projected completed turn depth", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Depth-aware route",
      confidence: 1.0,
      routingTier: "rule",
    });
    const providerPool = new Map<string, ProviderAdapter>([["routed", routedProvider]]);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();

    await orchestrator.processMessage(session, textParts("hello"));
    await orchestrator.processMessage(session, textParts("second turn"));

    const firstRequest = (router.route as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as RoutingRequest;
    const secondRequest = (router.route as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as RoutingRequest;
    expect(firstRequest.complexity.signals.turnDepth).toBe(2);
    expect(secondRequest.complexity.signals.turnDepth).toBe(4);
  });

  it("passes deliberation intent into routing policy inputs and reports its resolution", async () => {
    const routedProvider = { ...makeProvider("routed"), deliberationTransport: "native-level" as const };
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Effort-aware route",
      confidence: 0.8,
      routingTier: "rule",
    });
    const providerPool = new Map<string, ProviderAdapter>([["routed", routedProvider]]);

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "configured-model",
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();

    const result = await orchestrator.processMessage(session, textParts("analyze the boundary\n```ts\nclass Boundary {}\n```"), undefined, undefined, {
      deliberationIntent: { mode: "fixed", preferredLevel: defineDeliberationLevelId("high"), onUnsupported: "deny" },
      deliberationSource: "operator",
      modelRoutingPolicy: {
        routeCapabilities: new Map([["routed/routed-model", makeDeliberationCapabilities("routed", "routed-model", ["low", "medium", "high"], "medium")]]),
      },
    });

    expect(router.route).toHaveBeenCalledWith(expect.objectContaining({
      deliberationIntent: { mode: "fixed", preferredLevel: defineDeliberationLevelId("high"), onUnsupported: "deny" },
    }));
    expect(result.routingDecision?.deliberationResolution).toMatchObject({ status: "exact", selectedLevel: "high" });
    expect(requireRoutingRationale(result).inputsUsed).toMatchObject({
      deliberationIntent: { mode: "fixed", preferredLevel: defineDeliberationLevelId("high"), onUnsupported: "deny" },
      hasTools: false,
      toolCount: 0,
      tenantId: "default",
      complexityClass: "simple",
    });
    expect(requireRoutingRationale(result).inputsUsed.complexityScore).toBeGreaterThan(0.2);
  });

  it("rejects undeclared deliberation transport before direct provider I/O", async () => {
    const routedProvider = makeProvider("routed");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "configured-model",
      modelRouter: makeRouter({
        provider: "routed",
        model: "routed-model",
        reasoning: "Deliberation route",
        confidence: 1,
        routingTier: "rule",
      }),
      providerPool: new Map([["routed", routedProvider]]),
    });

    await expect(orchestrator.processMessage(makeSession(), textParts("analyze"), undefined, undefined, {
      deliberationIntent: { mode: "fixed", preferredLevel: defineDeliberationLevelId("high"), onUnsupported: "deny" },
      deliberationSource: "operator",
      modelRoutingPolicy: {
        routeCapabilities: new Map([["routed/routed-model", makeDeliberationCapabilities("routed", "routed-model", ["high"], "high")]]),
      },
    })).rejects.toThrow("cannot transport the resolved deliberation level");
    expect(routedProvider.createMessage).not.toHaveBeenCalled();
  });

  it("resolves communication after route selection and attributes it to the provider request", async () => {
    const routedProvider = { ...makeProvider("routed"), communicationTransport: "native" as const };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "configured-model",
      modelRouter: makeRouter({
        provider: "routed",
        model: "routed-model",
        reasoning: "Communication-capable route",
        confidence: 1,
        routingTier: "rule",
      }),
      providerPool: new Map([["routed", routedProvider]]),
    });
    const communicationIntent = resolveCommunicationIntent([{
      source: "user",
      intent: {
        responseDetail: "concise",
        locale: "es-MX",
        requiredContent: ["warning", "verification"],
        onUnsupported: "deny",
      },
    }]);

    const result = await orchestrator.processMessage(makeSession(), textParts("summarize"), undefined, undefined, {
      communicationIntent,
      modelRoutingPolicy: {
        routeCapabilities: new Map([[
          "routed/routed-model",
          makeCommunicationCapabilities("routed", "routed-model"),
        ]]),
      },
    });

    expect(result.communicationResolution?.responseDetail).toMatchObject({
      status: "exact",
      mechanism: "native",
      nativeValue: "low",
    });
    expect(routedProvider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      communicationResolution: result.communicationResolution,
      system: expect.stringContaining("--- Kiln Communication Contract ---"),
    }));
    const request = vi.mocked(routedProvider.createMessage).mock.calls[0]?.[0];
    expect(request?.system).toContain("locale 'es-MX'");
    expect(request?.system).toContain("verification, warning");
    expect(result.providerRequests?.[0]?.effectivePrompt?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: sha256ContentIdentity("runtime-communication-contract"),
        revision: sha256ContentIdentity(result.communicationResolution!.identity),
        provenance: { source: sha256ContentIdentity("runtime-communication-policy") },
      }),
    ]));
    expect(result.providerRequests?.[0]?.communicationResolution?.identity)
      .toBe(result.communicationResolution?.identity);
  });

  it("dispatches native communication through the shared subscription executor", async () => {
    const run = vi.fn((_options: ExecutionSessionRunOptions) => (async function* () {
      yield { type: "text_delta" as const, content: "concise response" };
      yield {
        type: "completed" as const,
        totalUsd: 0,
        durationMs: 1,
        disposition: externalHarnessDisposition("codex", "completed"),
        isPreflightCrash: false,
      };
    })());
    const executor = new CliSubscriptionExecutor(
      vi.fn().mockReturnValue({ run, dispose: vi.fn().mockResolvedValue(undefined) }),
      "codex-oauth",
    );
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: executor,
      model: "gpt-5.6-terra",
    });
    const session = makeSession();
    const communicationIntent = resolveCommunicationIntent([{
      source: "global",
      intent: { responseDetail: "concise", onUnsupported: "omit" },
    }]);

    const result = await orchestrator.processMessage(session, textParts("summarize"), undefined, undefined, {
      authorityAdmission: makeFixtureModelRoundAdmission(
        session,
        `${session.id}:turn:1`,
        "codex-oauth",
        "gpt-5.6-terra",
      ),
      communicationIntent,
      modelRoutingPolicy: {
        routeCapabilities: new Map([[
          "codex-oauth/gpt-5.6-terra",
          makeCommunicationCapabilities("codex-oauth", "gpt-5.6-terra"),
        ]]),
      },
    });

    expect(extractText(result.parts)).toBe("concise response");
    expect(run.mock.calls[0]?.[0]?.communicationIntent).toBe(communicationIntent);
  });

  it("rejects unsupported communication policy before provider I/O", async () => {
    const provider = makeProvider("routed");
    const orchestrator = new RuntimeSessionOrchestrator({ provider, model: "routed-model" });

    await expect(orchestrator.processMessage(makeSession(), textParts("summarize"), undefined, undefined, {
      communicationIntent: resolveCommunicationIntent([{
        source: "user",
        intent: { responseDetail: "concise", onUnsupported: "deny" },
      }]),
    })).rejects.toThrow("Communication intent is unsupported");
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("fails closed before provider execution when selected route cannot preserve deliberation intent", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Unsupported effort route",
      confidence: 1.0,
      routingTier: "rule",
    });
    const providerPool = new Map<string, ProviderAdapter>([["routed", routedProvider]]);

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, textParts("do hard work"), undefined, undefined, {
      deliberationIntent: { mode: "fixed", preferredLevel: defineDeliberationLevelId("xhigh"), onUnsupported: "deny" },
      deliberationSource: "operator",
      modelRoutingPolicy: {
        routeCapabilities: new Map([
          ["routed/routed-model", makeDeliberationCapabilities("routed", "routed-model", ["low", "medium", "high"], "medium")],
        ]),
      },
    })).rejects.toThrow("preferred-level-unsupported");

    expect(routedProvider.createMessage).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
  });

  it("fails closed before provider execution when the active route cannot accept image input", async () => {
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ])).rejects.toThrow("unsupported_modality");

    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
  });

  it("does not keep rejected multimodal input in session history", async () => {
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ])).rejects.toThrow("unsupported_modality");

    const result = await orchestrator.processMessage(session, textParts("Continue with text only."));

    expect(extractText(result.parts)).toBe("mock response");
    expect(session.conversationHistory[0]).toEqual({ role: "user", parts: textParts("Continue with text only.") });
    expect(defaultProvider.createMessage).toHaveBeenCalledTimes(1);
  });

  it("allows native provider execution when the active route supports image input", async () => {
    const visionProvider = makeProvider("openai");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: visionProvider,
      model: "gpt-4o",
    });
    const session = makeSession();

    await orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);

    expect(visionProvider.createMessage).toHaveBeenCalledTimes(1);
    const createMessageMock = visionProvider.createMessage as ReturnType<typeof vi.fn>;
    expect(createMessageMock.mock.calls[0]?.[0].messages.at(-1)?.parts).toEqual([
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);
  });

  it("emits multimodal routing evidence for native image admission", async () => {
    const eventBus = makeEventBus();
    const visionProvider = makeProvider("openai");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: visionProvider,
      model: "gpt-4o",
      eventBus,
    });
    const session = makeSession();

    await orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);

    const multimodalEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "multimodal_routed",
    );
    expect(multimodalEvents).toHaveLength(1);
    expect(multimodalEvents[0]?.[0]).toMatchObject({
      type: "multimodal_routed",
      provider: "openai",
      model: "gpt-4o",
      strategy: "native",
      reasonCode: "native_supported",
      requestedCapability: "vision",
      requiredModalities: ["text", "image"],
      artifactUris: ["kiln://runtime/session-artifact/0"],
    });
  });

  it("uses persisted artifact URIs for native multimodal routing evidence", async () => {
    const artifactUri = "kiln://artifacts/uploads/artifact_1/content";
    const eventBus = makeEventBus();
    const visionProvider = makeProvider("openai");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: visionProvider,
      model: "gpt-4o",
      eventBus,
    });
    const session = makeSession();

    await orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=", artifactUri },
    ]);

    const multimodalEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "multimodal_routed",
    );
    expect(multimodalEvents).toHaveLength(1);
    expect(multimodalEvents[0]?.[0]).toMatchObject({
      type: "multimodal_routed",
      strategy: "native",
      artifactUris: [artifactUri],
    });
  });

  it("emits multimodal routing evidence for rejected image admission", async () => {
    const eventBus = makeEventBus();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      eventBus,
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ])).rejects.toThrow("unsupported_modality");

    const multimodalEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "multimodal_routed",
    );
    expect(multimodalEvents).toHaveLength(1);
    expect(multimodalEvents[0]?.[0]).toMatchObject({
      type: "multimodal_routed",
      provider: "default",
      model: "deepseek-chat",
      strategy: "unsupported",
      reasonCode: "unsupported_modality",
      requestedCapability: "vision",
      requiredModalities: ["text", "image"],
      artifactUris: ["kiln://runtime/session-artifact/0"],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "native_route_missing_capability" }),
      ]),
    });
  });

  it("uses persisted artifact URIs for managed multimodal delegation resources", async () => {
    const artifactUri = "kiln://artifacts/uploads/artifact_2/content";
    const managedAdapter = makeManagedAdapter();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      multimodalDelegationRoutes: [{
        route: makeAuxiliaryVisionRoute(),
        adapter: managedAdapter,
        access: "read-only",
        requestedAuthority: "read_only",
        providerRoute: {
          providerId: "openai",
          surface: "cli-harness",
          model: "gpt-4o",
        },
        observedRuntimeAuthority: {
          approval: "on-request",
          sandbox: "read-only",
          source: "runtime-observation",
          proof: "proven",
          observedAt: "2026-07-02T08:00:00.000Z",
          validUntil: "2099-01-01T00:00:00.000Z",
        },
        authority: {
          authorityProfileId: "authority:managed-vision:readonly",
          toolAuthority: {
            allowedToolNames: ["read"],
            writeAllowed: false,
            networkAllowed: false,
          },
          workingDirectory: {
            path: "C:/workspace/kiln",
            mode: "read-only",
          },
          timeoutMs: 120000,
          credentialRoute: {
            mode: "runtime-selected",
            routeId: "credential-route:managed-vision",
          },
          memoryScope: {
            scope: { kind: "project", id: "kiln" },
            access: "read-only",
          },
        },
      }],
    });
    const session = makeSession();

    await orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=", artifactUri },
    ]);

    const request = (managedAdapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    expect(request.input.resourceUris).toEqual([artifactUri]);
    expect(request.executionIntent).toEqual({
      attendance: "unattended",
      lifecycle: "automation",
    });
  });

  it("passes normalized phase, uncertainty, verification, and cost signals to the route owner", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Phase-aware route",
      confidence: 0.9,
      routingTier: "cascade",
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool: new Map<string, ProviderAdapter>([["routed", routedProvider]]),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("verify the change"), undefined, undefined, {
      modelRoutingPolicy: {
        task: "verified-change",
        phase: "verify",
        uncertainty: 0.7,
        verificationNeed: 1,
        retryRisk: 0.2,
        cacheInvalidationCostUsd: 0.01,
        verifierCostUsd: 0.03,
      },
    });

    expect(router.route).toHaveBeenCalledWith(expect.objectContaining({
      task: "verified-change",
      phase: "verify",
      uncertainty: 0.7,
      verificationNeed: 1,
      retryRisk: 0.2,
      cacheInvalidationCostUsd: 0.01,
      verifierCostUsd: 0.03,
    }));
    expect(requireRoutingRationale(result).inputsUsed).toMatchObject({
      task: "verified-change",
      phase: "verify",
      uncertainty: 0.7,
      verificationNeed: 1,
      retryRisk: 0.2,
      cacheInvalidationCostUsd: 0.01,
      verifierCostUsd: 0.03,
    });
  });

  it("rejects invalid phase-aware route signals before routing or provider execution", async () => {
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Invalid route",
      confidence: 1,
      routingTier: "cascade",
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
    });

    await expect(orchestrator.processMessage(makeSession(), textParts("verify"), undefined, undefined, {
      modelRoutingPolicy: { uncertainty: 1.1 },
    })).rejects.toThrow("Model routing uncertainty must be between 0 and 1");
    expect(router.route).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
  });

  it("delegates image admission to a managed auxiliary route when the active route lacks vision", async () => {
    const eventBus = makeEventBus();
    const managedAdapter = makeManagedAdapter();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      eventBus,
      multimodalDelegationRoutes: [{
        route: makeAuxiliaryVisionRoute(),
        adapter: managedAdapter,
        access: "read-only",
        requestedAuthority: "read_only",
        providerRoute: {
          providerId: "openai",
          surface: "cli-harness",
          model: "gpt-4o",
        },
        observedRuntimeAuthority: {
          approval: "on-request",
          sandbox: "read-only",
          source: "runtime-observation",
          proof: "proven",
          observedAt: "2026-07-02T08:00:00.000Z",
          validUntil: "2099-01-01T00:00:00.000Z",
        },
        authority: {
          authorityProfileId: "authority:managed-vision:readonly",
          toolAuthority: {
            allowedToolNames: ["read"],
            writeAllowed: false,
            networkAllowed: false,
          },
          workingDirectory: {
            path: "C:/workspace/kiln",
            mode: "read-only",
          },
          timeoutMs: 120000,
          credentialRoute: {
            mode: "runtime-selected",
            routeId: "credential-route:managed-vision",
          },
          memoryScope: {
            scope: { kind: "project", id: "kiln" },
            access: "read-only",
          },
        },
      }],
    });
    const session = makeSession();

    const result = await orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);

    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    expect(managedAdapter.invoke).toHaveBeenCalledTimes(1);
    const request = (managedAdapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    expect(request.requestSource).toBe("runtime-multimodal-delegation");
    expect(request.requestedAuthority).toBe("read_only");
    expect(request.executionIntent).toEqual({
      attendance: "unattended",
      lifecycle: "automation",
    });
    expect(request.input.resourceUris).toEqual(["kiln://runtime/session-artifact/0"]);
    expect(request.input.context).toMatchObject({
      mode: "resources",
      agentProfile: "vision-describer",
    });
    expect(extractText(result.parts)).toBe("Delegated vision summary.");
    expect(result.inputTokens).toBe(7);
    expect(result.outputTokens).toBe(5);
    expect(result.toolExecutions?.[0]).toMatchObject({
      toolName: "managed_agent.invoke",
      success: true,
      resultSummary: "Delegated vision summary.",
    });

    const multimodalEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "multimodal_routed",
    );
    expect(multimodalEvents).toHaveLength(1);
    expect(multimodalEvents[0]?.[0]).toMatchObject({
      type: "multimodal_routed",
      provider: "openai",
      model: "gpt-4o",
      strategy: "delegated",
      reasonCode: "delegation_route_available",
      requestedCapability: "vision",
      artifactUris: ["kiln://runtime/session-artifact/0"],
      delegation: {
        routeId: "managed-vision-readonly",
        provider: "openai",
        model: "gpt-4o",
        agentProfile: "vision-describer",
        authorityProfileId: "authority:managed-vision:readonly",
        artifactUris: ["kiln://runtime/session-artifact/0"],
      },
    });
  });

  it("does not treat delegated multimodal execution as evidence for a distinct required producer", async () => {
    const managedAdapter = makeManagedAdapter();
    const formalVerify = {
      name: "formal_verify",
      description: "Run the formal verifier.",
      inputSchema: {},
      tags: new Set<string>(),
    };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      multimodalDelegationRoutes: [makeVisionDelegationRoute(managedAdapter)],
    });

    const result = await orchestrator.processMessage(makeSession(), [
      { type: "text", text: "Use Dafny to verify this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ], undefined, undefined, { additionalTools: [formalVerify] });

    expect(managedAdapter.invoke).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "failed",
      dispositionReason: "required_producer_unavailable",
      parts: textParts("formal_verify: unavailable"),
      completion: {
        eligibility: {
          status: "ineligible",
          unmet: [{ canonicalToolId: "formal_verify", status: "unavailable" }],
        },
      },
      convergence: {
        policy: expect.objectContaining({ toolRounds: expect.any(Number) }),
        progressEvidence: expect.arrayContaining([
          expect.objectContaining({ kind: "progress" }),
        ]),
      },
    });
  });

  it("returns a terminal failure without invoking a denied multimodal delegation", async () => {
    const eventBus = makeEventBus();
    const managedAdapter = makeManagedAdapter();
    const sessionTurnBudget = {
      admit: vi.fn().mockResolvedValue({
        status: "denied",
        reason: "observed-at-or-above-limit",
        action: "stop",
        message: "Delegation denied by the session limit.",
      }),
    };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      eventBus,
      sessionTurnBudget,
      multimodalDelegationRoutes: [makeVisionDelegationRoute(managedAdapter)],
    });
    const session = makeSession();

    const result = await orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);

    expect(result).toMatchObject({
      outcome: "failed",
      inputTokens: 0,
      outputTokens: 0,
      parts: textParts("Delegation denied by the session limit."),
    });
    expect(result.routingDecision).toBeUndefined();
    expect(sessionTurnBudget.admit).toHaveBeenCalledTimes(1);
    expect(managedAdapter.invoke).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    expect(emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string; message?: string }).type === "error"
        && (call[0] as { message?: string }).message === "Delegation denied by the session limit.",
    )).toHaveLength(1);
    expect(session.conversationHistory[0]?.role).toBe("user");
  });

  it("fails closed before an external multimodal adapter when no full claim context is supplied", async () => {
    const transport = {
      invoke: vi.fn(),
      cancel: vi.fn(),
    };
    const managedAdapter = new ManagedRemoteHarnessAdapter({
      providerId: "openai",
      model: "gpt-4o",
      transport,
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      multimodalDelegationRoutes: [makeVisionDelegationRoute(managedAdapter)],
    });

    await expect(orchestrator.processMessage(makeSession(), [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ])).rejects.toThrow(/external action claim context/i);

    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it("admits a multimodal delegation exactly once immediately before invoking it", async () => {
    const managedAdapter = makeManagedAdapter();
    const sessionTurnBudget = {
      admit: vi.fn().mockResolvedValue({
        status: "admitted",
        reason: "observed-below-limit",
        observation: { observedTokens: 1, source: "test" },
      }),
    };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      sessionTurnBudget,
      multimodalDelegationRoutes: [makeVisionDelegationRoute(managedAdapter)],
    });

    const result = await orchestrator.processMessage(makeSession(), [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);

    expect(sessionTurnBudget.admit).toHaveBeenCalledTimes(1);
    expect(managedAdapter.invoke).toHaveBeenCalledTimes(1);
    expect(sessionTurnBudget.admit.mock.invocationCallOrder[0])
      .toBeLessThan((managedAdapter.invoke as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolExecutions?.[0]).toMatchObject({
      toolName: "managed_agent.invoke",
      durationMs: expect.any(Number),
      success: true,
    });
    expect("convergence" in result ? result.convergence.progressEvidence : undefined).toEqual([
      expect.objectContaining({ kind: "progress", reason: "new_material_result" }),
    ]);
  });

  it("propagates turn cancellation through delegation and refuses a late completed result", async () => {
    let markAdapterStarted!: () => void;
    const adapterStarted = new Promise<void>((resolve) => {
      markAdapterStarted = resolve;
    });
    let releaseAdapter!: () => void;
    const adapterRelease = new Promise<void>((resolve) => {
      releaseAdapter = resolve;
    });
    let releaseCancellation!: () => void;
    const cancellationRelease = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const parentAbort = new AbortController();
    const managedAdapter = makeManagedAdapter();
    const originalInvoke = vi.mocked(managedAdapter.invoke).getMockImplementation();
    if (!originalInvoke) throw new Error("Expected the synthetic managed adapter implementation.");
    let observedAdapterSignal: AbortSignal | undefined;
    vi.mocked(managedAdapter.invoke).mockImplementation(async (input) => {
      observedAdapterSignal = input.abortSignal;
      markAdapterStarted();
      await adapterRelease;
      return originalInvoke(input);
    });
    const cancellableAdapter: ManagedAgentRuntimeAdapter = {
      ...managedAdapter,
      cancel: vi.fn().mockReturnValue(cancellationRelease),
    };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      multimodalDelegationRoutes: [makeVisionDelegationRoute(cancellableAdapter)],
    });
    const session = makeSession();
    const turnId = `${session.id}:turn:1`;
    const authorityAdmission = makeFixtureModelRoundAdmission(session, turnId, defaultProvider.name, "deepseek-chat");
    const modelRoundConfig = fixtureModelRoundConfig(orchestrator, session, {
      authorityAdmission,
      turnCorrelationId: turnId,
      abortSignal: parentAbort.signal,
    });
    const sessionRegistry = {
      save: vi.fn().mockResolvedValue(undefined),
      getOrCreate: vi.fn().mockResolvedValue(session),
    } as unknown as SessionRegistry;

    const resultPromise = processAdmittedTurn({
      orchestrator,
      admittedSession: session,
      sessionRegistry,
      appName: session.appName,
      tenantId: session.tenantId,
      userId: session.userId,
      systemPrompt: session.systemPrompt,
      userParts: [
        { type: "text", text: "Describe this image." },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      ],
      channel: "api",
      authorityAdmission,
      perCallConfig: modelRoundConfig.config,
    } satisfies AdmittedTurnContext);
    await adapterStarted;
    parentAbort.abort("operator cancelled during multimodal delegation");
    releaseAdapter();

    try {
      await expect(resultPromise).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    } finally {
      releaseCancellation();
      modelRoundConfig.restore();
    }

    expect(cancellableAdapter.cancel).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(observedAdapterSignal?.aborted).toBe(true));
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    expect(session.conversationHistory).toEqual([]);
    expect(session.sessionEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "cancelled",
      dispositionReason: "operator_cancelled",
    });
  });

  it("denies delegated multimodal effects at the elapsed convergence boundary", async () => {
    const managedAdapter = makeManagedAdapter();
    let reads = 0;
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      monotonicNow: () => (reads++ === 0 ? 0 : 5),
      executionEnvelope: {
        convergence: deriveRuntimeConvergencePolicyInput({
          ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
          policyId: "test.runtime.multimodal-elapsed-delegation",
          elapsedMs: 5,
        }),
      },
      multimodalDelegationRoutes: [makeVisionDelegationRoute(managedAdapter)],
    });

    const result = await orchestrator.processMessage(makeSession(), [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);

    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "elapsed_time_limit",
      convergence: {
        pause: {
          status: "pause",
          reason: "elapsed_time_limit",
          metric: "elapsedMs",
          observed: 5,
          limit: 5,
        },
      },
    });
    expect(managedAdapter.invoke).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    expect(result.toolExecutions ?? []).toEqual([]);
  });

  it("denies multimodal transforms at the elapsed convergence boundary", async () => {
    const provider = makeProvider("deepseek");
    const ocrTransform = makeTransformRoute({
      transform: "ocr",
      sourceModalities: ["image"],
      outputModality: "text",
    });
    let reads = 0;
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "deepseek-chat",
      monotonicNow: () => (reads++ === 0 ? 0 : 5),
      executionEnvelope: {
        convergence: deriveRuntimeConvergencePolicyInput({
          ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
          policyId: "test.runtime.multimodal-elapsed-transform",
          elapsedMs: 5,
        }),
      },
      multimodalTransformRoutes: [ocrTransform],
    });

    const result = await orchestrator.processMessage(makeSession(), [
      { type: "text", text: "Read this sign." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);

    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "elapsed_time_limit",
      convergence: {
        pause: {
          status: "pause",
          reason: "elapsed_time_limit",
          metric: "elapsedMs",
          observed: 5,
          limit: 5,
        },
      },
    });
    expect(provider.createMessage).not.toHaveBeenCalled();
    expect(result.toolExecutions ?? []).toEqual([]);
  });

  it("fails closed before a built-in OCR command without a media action claim", async () => {
    const provider = makeProvider("deepseek");
    const ocrTransform = makeTransformRoute({
      transform: "ocr",
      sourceModalities: ["image"],
      outputModality: "text",
      provenance: "test-ocr",
      degradation: "extracts visible text only",
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "deepseek-chat",
      multimodalTransformRoutes: [ocrTransform],
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, [
      { type: "text", text: "Read this sign." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ])).rejects.toThrow(/media action claim/i);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("fails closed when the built-in document transform cannot process malformed input", async () => {
    const provider = makeProvider("deepseek");
    const documentTransform = makeTransformRoute({
      transform: "document-extraction",
      sourceModalities: ["document"],
      outputModality: "text",
      provenance: "test-unpdf",
      degradation: "extracts PDF text only",
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "deepseek-chat",
      multimodalTransformRoutes: [documentTransform],
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, [
      { type: "text", text: "Summarize this PDF." },
      { type: "file", mimeType: "application/pdf", data: "JVBERi0xLjQ=", filename: "report.pdf" },
    ])).rejects.toThrow(/document-extraction.*failed closed/i);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("applies downsample before invoking a constrained vision provider", async () => {
    const provider = makeProvider("openai");
    const registry = {
      modalityCapabilities: vi.fn().mockReturnValue({
        provider: "openai",
        model: "gpt-4o",
        supportedCapabilities: ["vision"],
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        toolResultModalities: ["text", "image"],
        constraints: {
          supportsBase64: true,
          supportsUrl: true,
          supportsDocuments: false,
          maxBytesPerArtifact: 4,
        },
        degradationBehavior: [],
      }),
    } as unknown as ModelCapabilityRegistry;
    const downsampleTransform = makeTransformRoute({
      transform: "downsample",
      sourceModalities: ["image"],
      outputModality: "image",
      provenance: "test-sharp",
      degradation: "reduces image size",
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "gpt-4o",
      modelCapabilityRegistry: registry,
      multimodalTransformRoutes: [downsampleTransform],
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" },
    ])).rejects.toThrow(/downsample.*failed closed/i);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("allows native provider execution for provider-qualified vision model ids", async () => {
    const openrouterProvider = makeProvider("openrouter");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: openrouterProvider,
      model: "openrouter/google/gemma-3-27b-it:free",
    });
    const session = makeSession();

    await orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);

    expect(openrouterProvider.createMessage).toHaveBeenCalledTimes(1);
  });

  it("allows native provider execution when Anthropic can serialize document input", async () => {
    const anthropicProvider = makeProvider("anthropic");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: anthropicProvider,
      model: "claude-sonnet-4-6",
    });
    const session = makeSession();

    await orchestrator.processMessage(session, [
      { type: "text", text: "Summarize this document." },
      { type: "file", mimeType: "application/pdf", data: "JVBERi0xLjQ=", filename: "brief.pdf" },
    ]);

    expect(anthropicProvider.createMessage).toHaveBeenCalledTimes(1);
    const createMessageMock = anthropicProvider.createMessage as ReturnType<typeof vi.fn>;
    expect(createMessageMock.mock.calls[0]?.[0].messages.at(-1)?.parts).toEqual([
      { type: "text", text: "Summarize this document." },
      { type: "file", mimeType: "application/pdf", data: "JVBERi0xLjQ=", filename: "brief.pdf" },
    ]);
  });

  it("checks the applied router-selected route before provider execution", async () => {
    const routedProvider = makeProvider("deepseek");
    const router = makeRouter({
      provider: "deepseek",
      model: "deepseek-chat",
      reasoning: "Text route selected",
      confidence: 1.0,
      routingTier: "rule",
    });
    const providerPool = new Map<string, ProviderAdapter>([["deepseek", routedProvider]]);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "gpt-5.4",
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ])).rejects.toThrow("unsupported_modality");

    expect(routedProvider.createMessage).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
  });

  it("enforces multimodal routing for reinjected tool-result history", async () => {
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
    });
    const session = makeSession();
    session.addAssistantMessage([
      {
        type: "tool_use",
        id: "call_view_image",
        name: "view_image",
        input: { path: "evidence.png" },
      },
    ]);
    session.addUserMessage([
      {
        type: "tool_result",
        toolUseId: "call_view_image",
        content: "Loaded image artifact.",
        contentParts: [
          { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
        ],
      },
    ]);

    await expect(orchestrator.processMessage(session, textParts("Now describe the evidence.")))
      .rejects
      .toThrow("unsupported_modality");

    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
  });

  it("fails closed when a transform would target reinjected tool-result history", async () => {
    const ocrTransform = makeTransformRoute({
      transform: "ocr",
      sourceModalities: ["image"],
      outputModality: "text",
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "deepseek-chat",
      multimodalTransformRoutes: [ocrTransform],
    });
    const session = makeSession();
    session.addAssistantMessage([
      {
        type: "tool_use",
        id: "call_view_image",
        name: "view_image",
        input: { path: "evidence.png" },
      },
    ]);
    session.addUserMessage([
      {
        type: "tool_result",
        toolUseId: "call_view_image",
        content: "Loaded image artifact.",
        contentParts: [
          { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
        ],
      },
    ]);

    await expect(orchestrator.processMessage(session, textParts("Now describe the evidence.")))
      .rejects
      .toThrow("persisted history transform replay is not implemented");

    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
  });

  it("fails closed when a vision route cannot serialize multimodal tool results", async () => {
    const openaiProvider = makeProvider("openai");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: openaiProvider,
      model: "gpt-4o",
    });
    const session = makeSession();
    session.addAssistantMessage([
      {
        type: "tool_use",
        id: "call_view_image",
        name: "view_image",
        input: { path: "evidence.png" },
      },
    ]);
    session.addUserMessage([
      {
        type: "tool_result",
        toolUseId: "call_view_image",
        content: "Loaded image artifact.",
        contentParts: [
          { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
        ],
      },
    ]);

    await expect(orchestrator.processMessage(session, textParts("Now describe the evidence.")))
      .rejects
      .toThrow("native_route_missing_tool_result_modality");

    expect(openaiProvider.createMessage).not.toHaveBeenCalled();
  });

  it("does not emit successful model_routed telemetry for rejected multimodal input", async () => {
    const eventBus = makeEventBus();
    const routedProvider = makeProvider("deepseek");
    const router = makeRouter({
      provider: "deepseek",
      model: "deepseek-chat",
      reasoning: "Text route selected",
      confidence: 1.0,
      routingTier: "rule",
    });
    const providerPool = new Map<string, ProviderAdapter>([["deepseek", routedProvider]]);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "gpt-4o",
      modelRouter: router,
      providerPool,
      eventBus,
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ])).rejects.toThrow("unsupported_modality");

    const modelRoutedEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "model_routed",
    );
    expect(modelRoutedEvents).toEqual([]);
  });

  it("injects routed execution identity when router-selected provider is applied", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Test route",
      confidence: 1.0,
      routingTier: "rule",
    });

    const providerPool = new Map<string, ProviderAdapter>([["routed", routedProvider]]);

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "configured-model",
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();
    await orchestrator.processMessage(session, textParts("hello"));

    const routedCall = (routedProvider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
    } | undefined;

    expect(routedCall?.system).toContain("[KILN EXECUTION IDENTITY]");
    expect(routedCall?.system).toContain("provider: routed");
    expect(routedCall?.system).toContain("model: routed-model");
    expect(routedCall?.system).toContain("source: runtime-routed");
    expect(routedCall?.system).not.toContain("model: configured-model");
  });

  it("with modelRouter but unknown provider, falls back to default provider", async () => {
    const router = makeRouter({
      provider: "unknown-provider",
      model: "unknown-model",
      reasoning: "No pool match",
      confidence: 1.0,
      routingTier: "default",
    });

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool: new Map(),
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    // Falls back to default provider since unknown-provider isn't in pool
    expect(defaultProvider.createMessage).toHaveBeenCalled();
    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision!.provider).toBe("unknown-provider");
  });

  it("keeps configured execution identity when routed provider cannot be applied", async () => {
    const router = makeRouter({
      provider: "unknown-provider",
      model: "unknown-model",
      reasoning: "No pool match",
      confidence: 1.0,
      routingTier: "default",
    });

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "configured-model",
      modelRouter: router,
      providerPool: new Map(),
    });
    const session = makeSession();
    await orchestrator.processMessage(session, textParts("hello"));

    const defaultCall = (defaultProvider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
    } | undefined;

    expect(defaultCall?.system).toContain("[KILN EXECUTION IDENTITY]");
    expect(defaultCall?.system).toContain("provider: default");
    expect(defaultCall?.system).toContain("model: configured-model");
    expect(defaultCall?.system).toContain("source: configured");
    expect(defaultCall?.system).not.toContain("provider: unknown-provider");
  });

  it("modelOverride in perCallConfig takes precedence over router", async () => {
    const routedProvider = makeProvider("routed");
    const overrideProvider = makeProvider("override");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Should not be used",
      confidence: 1.0,
      routingTier: "rule",
    });

    const providerPool = new Map<string, ProviderAdapter>([
      ["routed", routedProvider],
      ["override", overrideProvider],
    ]);

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      modelOverride: { provider: "override", model: "override-model", source: "operator" },
    });

    // Override provider should be used, not the routed one
    expect(overrideProvider.createMessage).toHaveBeenCalled();
    expect(routedProvider.createMessage).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    // Router should not have been called
    expect(router.route).not.toHaveBeenCalled();
    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision!.provider).toBe("override");
    expect(result.routingDecision!.model).toBe("override-model");
    expect(result.routingDecision!.selectionMode).toBe("explicit-operator-only");
    expect(result.routingDecision!.rationale).toMatchObject({
      selectedProvider: "override",
      selectedModel: "override-model",
      selectionMode: "explicit-operator-only",
      overrideSource: "operator",
      routingReason: "Explicit model override",
    });
  });

  it("rejects an operator model override that differs from the admitted execution target before provider dispatch", async () => {
    const overrideProvider = makeProvider("override");
    const session = makeSession();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "default-model",
      providerPool: new Map([["override", overrideProvider]]),
    });

    await expect(orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      modelOverride: { provider: "override", model: "override-model", source: "operator" },
      authorityAdmission: makeFixtureModelRoundAdmission(session, `${session.id}:turn:1`, "default", "default-model"),
      turnCorrelationId: `${session.id}:turn:1`,
    })).rejects.toThrow("does not match admitted execution target");
    expect(overrideProvider.createMessage).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
  });

  it("rejects an automatic routed provider that differs from the admitted execution target before provider dispatch", async () => {
    const routedProvider = makeProvider("routed");
    const session = makeSession();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      model: "default-model",
      modelRouter: makeRouter({
        provider: "routed",
        model: "routed-model",
        reasoning: "synthetic mismatch",
        confidence: 1,
        routingTier: "rule",
      }),
      providerPool: new Map([["routed", routedProvider]]),
    });

    await expect(orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      authorityAdmission: makeFixtureModelRoundAdmission(session, `${session.id}:turn:1`, "default", "default-model"),
      turnCorrelationId: `${session.id}:turn:1`,
    })).rejects.toThrow("does not match admitted execution target");
    expect(routedProvider.createMessage).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
  });

  it("ignores modelOverride without explicit operator provenance and falls back to automatic routing", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Default automatic route",
      confidence: 1.0,
      routingTier: "rule",
    });
    const overrideProvider = makeProvider("override");
    const providerPool = new Map<string, ProviderAdapter>([
      ["routed", routedProvider],
      ["override", overrideProvider],
    ]);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      // No `source: "operator"` provenance: the override must fail closed.
      modelOverride: { provider: "override", model: "override-model" },
    });

    // The override is not honored; automatic routing drives the turn.
    expect(routedProvider.createMessage).toHaveBeenCalled();
    expect(overrideProvider.createMessage).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    expect(router.route).toHaveBeenCalled();
    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision!.provider).toBe("routed");
    expect(result.routingDecision!.model).toBe("routed-model");
    expect(result.routingDecision!.selectionMode).toBe("automatic");
    expect(result.routingDecision!.rationale).toMatchObject({
      selectedProvider: "routed",
      selectedModel: "routed-model",
      selectionMode: "automatic",
      routingReason: "Default automatic route",
    });
    // No override provenance is recorded for a non-honored override.
    expect(result.routingDecision!.rationale?.overrideSource).toBeUndefined();
  });

  it("ignores modelOverride whose source is not the operator provenance literal", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Default automatic route",
      confidence: 1.0,
      routingTier: "rule",
    });
    const overrideProvider = makeProvider("override");
    const providerPool = new Map<string, ProviderAdapter>([
      ["routed", routedProvider],
      ["override", overrideProvider],
    ]);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();
    // A malformed/non-operator source must fail closed even if it reaches the
    // override path. The public type only admits `"operator"`, so cast to
    // exercise the runtime fail-closed guard against adversarial input.
    const result = await orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      modelOverride: {
        provider: "override",
        model: "override-model",
        source: "scheduler" as "operator",
      },
    });

    expect(routedProvider.createMessage).toHaveBeenCalled();
    expect(overrideProvider.createMessage).not.toHaveBeenCalled();
    expect(result.routingDecision!.selectionMode).toBe("automatic");
    expect(result.routingDecision!.rationale?.overrideSource).toBeUndefined();
  });

  it("records stale ranking evidence as diagnostics without making it authoritative", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Rule still selects route",
      confidence: 1.0,
      routingTier: "rule",
    });
    const providerPool = new Map<string, ProviderAdapter>([["routed", routedProvider]]);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();

    const result = await orchestrator.processMessage(session, textParts("implement a backend change"), undefined, undefined, {
      modelRoutingPolicy: {
        task: "backend-coding",
        rankingEvidence: [
          {
            source: "internal-eval",
            task: "backend-coding",
            provider: "routed",
            model: "routed-model",
            rank: 1,
            sampleSize: 20,
            confidence: 0.72,
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        now: new Date("2026-05-12T00:00:00.000Z"),
      },
    });

    expect(requireRoutingRationale(result).rankingEvidence).toEqual([]);
    expect(requireRoutingRationale(result).diagnostics).toContainEqual(expect.objectContaining({
      code: "stale_ranking_evidence",
      severity: "warning",
    }));
  });

  it("uses modelOverride for execution identity and cost telemetry even without a provider pool", async () => {
    const eventBus = makeEventBus();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      eventBus,
    });
    const session = makeSession();

    await orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      modelOverride: { provider: "openai", model: "gpt-4o-mini", source: "operator" },
    });

    const defaultCall = (defaultProvider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
    } | undefined;

    expect(defaultCall?.system).toContain("[KILN EXECUTION IDENTITY]");
    expect(defaultCall?.system).toContain("provider: openai");
    expect(defaultCall?.system).toContain("model: gpt-4o-mini");
    expect(defaultCall?.system).toContain("source: runtime-routed");

    const modelRoutedEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "model_routed",
    );
    expect(modelRoutedEvents.length).toBe(1);
    expect(modelRoutedEvents[0]?.[0]).toMatchObject({
      type: "model_routed",
      provider: "openai",
      model: "gpt-4o-mini",
      canonicalModel: "gpt-4o-mini",
      billingMode: "metered",
    });

    const costUpdateEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "cost_update",
    );
    expect(costUpdateEvents.length).toBe(1);
    expect(costUpdateEvents[0]?.[0]).toMatchObject({
      type: "cost_update",
      provider: "openai",
      model: "gpt-4o-mini",
      canonicalModel: "gpt-4o-mini",
      billingMode: "metered",
      byRoleModel: {
        "assistant:gpt-4o-mini": {
          model: "gpt-4o-mini",
          canonicalModel: "gpt-4o-mini",
          billingMode: "metered",
          calls: 1,
        },
      },
    });
    expect((costUpdateEvents[0]?.[0] as { totalCostUsd: number }).totalCostUsd).toBeGreaterThan(0);
  });

  it("accepts provider-qualified free-tier runtime model ids without missing-pricing warnings", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eventBus = makeEventBus();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      eventBus,
    });
    const session = makeSession();

    await orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      modelOverride: { provider: "opencode", model: "opencode/minimax-m2.5-free", source: "operator" },
    });

    const costUpdateEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "cost_update",
    );
    expect(costUpdateEvents.length).toBe(1);
    expect(costUpdateEvents[0]?.[0]).toMatchObject({
      type: "cost_update",
      provider: "opencode",
      model: "opencode/minimax-m2.5-free",
      canonicalModel: "minimax-m2.5-free",
      billingMode: "free",
      costEvidence: {
        kind: "free",
        currency: "USD",
        amountUsd: 0,
        comparable: true,
      },
      byRoleModel: {
        "assistant:opencode/minimax-m2.5-free": {
          model: "opencode/minimax-m2.5-free",
          canonicalModel: "minimax-m2.5-free",
          billingMode: "free",
          calls: 1,
          costUsd: 0,
          costEvidence: {
            kind: "free",
            currency: "USD",
            amountUsd: 0,
            comparable: true,
          },
        },
      },
      totalCostUsd: 0,
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Model "opencode/minimax-m2.5-free" not found in MODEL_PRICING'),
    );
  });

  it("accepts provider-qualified nemotron runtime model ids without missing-pricing warnings", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eventBus = makeEventBus();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      eventBus,
    });
    const session = makeSession();

    await orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      modelOverride: { provider: "opencode", model: "opencode/nemotron-3-super-free", source: "operator" },
    });

    const costUpdateEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "cost_update",
    );
    expect(costUpdateEvents.length).toBe(1);
    expect(costUpdateEvents[0]?.[0]).toMatchObject({
      type: "cost_update",
      provider: "opencode",
      model: "opencode/nemotron-3-super-free",
      canonicalModel: "nemotron-3-super-free",
      billingMode: "free",
      costEvidence: {
        kind: "free",
        currency: "USD",
        amountUsd: 0,
        comparable: true,
      },
      byRoleModel: {
        "assistant:opencode/nemotron-3-super-free": {
          model: "opencode/nemotron-3-super-free",
          canonicalModel: "nemotron-3-super-free",
          billingMode: "free",
          calls: 1,
          costUsd: 0,
          costEvidence: {
            kind: "free",
            currency: "USD",
            amountUsd: 0,
            comparable: true,
          },
        },
      },
      totalCostUsd: 0,
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Model "opencode/nemotron-3-super-free" not found in MODEL_PRICING'),
    );
  });

  it("emits non-comparable cost evidence for unpriced subscription and metered routes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eventBus = makeEventBus();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      eventBus,
    });
    const session = makeSession();

    await orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      modelOverride: { provider: "codex-oauth", model: "gpt-5.5", source: "operator" },
    });

    const costUpdateEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "cost_update",
    );
    expect(costUpdateEvents[0]?.[0]).toMatchObject({
      type: "cost_update",
      provider: "codex-oauth",
      model: "gpt-5.5",
      billingMode: "subscription",
      totalCostUsd: 0,
      costEvidence: {
        kind: "subscription",
        currency: "USD",
        amountUsd: 0,
        comparable: false,
      },
      byRoleModel: {
        "assistant:gpt-5.5": {
          costUsd: 0,
          costEvidence: {
            kind: "subscription",
            currency: "USD",
            amountUsd: 0,
            comparable: false,
          },
        },
      },
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("No metered pricing found"),
    );

    vi.mocked(eventBus.emit).mockClear();
    await orchestrator.processMessage(makeSession(), textParts("hello"), undefined, undefined, {
      modelOverride: { provider: "openai", model: "unknown-metered-model", source: "operator" },
    });

    const unknownCostUpdateEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "cost_update",
    );
    expect(unknownCostUpdateEvents[0]?.[0]).toMatchObject({
      type: "cost_update",
      provider: "openai",
      model: "unknown-metered-model",
      billingMode: "metered",
      totalCostUsd: 0,
      costEvidence: {
        kind: "unknown",
        currency: "unknown",
        amountUsd: 0,
        comparable: false,
      },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("routingDecision is included in OrchestrateResult", async () => {
    const router = makeRouter({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      reasoning: "Budget saving rule",
      confidence: 1.0,
      routingTier: "rule",
    });

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    expect(result.routingDecision).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      canonicalModel: "claude-haiku-4-5-20251001",
      billingMode: "metered",
      routingTier: "rule",
      reasoning: "Budget saving rule",
      selectionMode: "automatic",
      rationale: expect.objectContaining({
        selectedProvider: "anthropic",
        selectedModel: "claude-haiku-4-5-20251001",
        selectionMode: "automatic",
        routingReason: "Budget saving rule",
      }),
    });
  });

  it("emits model_routed event via eventBus", async () => {
    const eventBus = makeEventBus();
    const router = makeRouter({
      provider: "openai",
      model: "gpt-4o-mini",
      reasoning: "Cost optimization",
      confidence: 1.0,
      routingTier: "complexity",
    });

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      eventBus,
    });
    const session = makeSession();
    await orchestrator.processMessage(session, textParts("hello"));

    const modelRoutedEvents = emittedEvents(eventBus).filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "model_routed",
    );
    expect(modelRoutedEvents.length).toBe(1);
    const firstModelRoutedEvent = modelRoutedEvents[0];
    if (!firstModelRoutedEvent) throw new Error("Expected a model_routed event.");
    expect(firstModelRoutedEvent[0]).toMatchObject({
      type: "model_routed",
      model: "gpt-4o-mini",
      provider: "openai",
      canonicalModel: "gpt-4o-mini",
      billingMode: "metered",
      routingTier: "complexity",
      reason: "Cost optimization",
    });
  });

  it("fails open when router throws", async () => {
    const router: ModelRouter = {
      route: vi.fn().mockImplementation(() => {
        throw new Error("Router failed");
      }),
    };

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    // Should fall back to default provider
    expect(defaultProvider.createMessage).toHaveBeenCalled();
    expect(result.routingDecision).toBeUndefined();
  });
});
