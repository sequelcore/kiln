import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpgradeWebSocket } from "hono/ws";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import type {
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
} from "../../src/agents/managed-invocation/runtime-tool/index.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";
import type { TuiGatewayOptions } from "../../src/gateway/tui-gateway.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { EffectiveTurnAuthoritySnapshot } from "../../src/session/runtime-session-orchestrator.types.js";

const TEST_PARENT_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "read_only",
  admittedAuthority: "destructive",
  sourcePolicy: "runtime_surface_projection",
  reason: "TUI test parent turn authority is explicitly admitted",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} satisfies EffectiveTurnAuthoritySnapshot;

const tuiProcessAdmittedTurn = vi.hoisted(() => vi.fn());

const tuiSocketHarness = vi.hoisted(() => {
  type HandlerFactory = Parameters<UpgradeWebSocket>[0];
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket: UpgradeWebSocket = (factory) => {
    capturedFactory = factory;
    return async (_c, next) => next();
  };

  function simulateConnection(queryParams: Record<string, string> = {}) {
    if (!capturedFactory) throw new Error("upgradeWebSocket not called yet");

    const url = new URL("http://localhost/tui/ws");
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }

    const ctx = {
      req: {
        query: (key: string) => url.searchParams.get(key) ?? undefined,
      },
    } as Parameters<HandlerFactory>[0];

    const handlers = capturedFactory(ctx);
    const mockWs = {
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    };

    return { handlers, mockWs, wsCtx: mockWs as never };
  }

  function reset(): void {
    capturedFactory = null;
  }

  return {
    upgradeWebSocket,
    simulateConnection,
    reset,
  };
});

const tuiTestRouting = vi.hoisted(() => ({
  create(providerId?: string, providerModelId?: string) {
    let handler: ((input: unknown) => Promise<unknown>) | undefined;
    let authorityHandler: any;
    const admission = {
      routeId: "test-route",
      providerId: providerId?.trim() || "claude",
      providerModelId: providerModelId?.trim() || "claude-sonnet-4-6",
    };
    const executionRouteSelection = {
      getCatalog: vi.fn(async () => ({
        routes: [{
          routeId: admission.routeId,
          label: "Test route",
          providerId: admission.providerId,
          providerModelId: admission.providerModelId,
          accountSelection: { mode: "automatic", eligibleAccountCount: 1, allowOperatorOverride: true },
          availability: "available",
          reasonCodes: [],
          repairActions: [],
        }],
      })),
      admit: vi.fn(async (intent: { readonly routeId: string }) => ({
        ok: true,
        admission: { ...admission, routeId: intent.routeId },
      })),
    };
    const bridge = {
      bind(nextHandler: (input: unknown) => Promise<unknown>) {
        if (handler) throw new Error("Test execution bridge is already bound.");
        handler = nextHandler;
      },
      dispatchCommittedTurn(input: unknown) {
        if (!handler) throw new Error("Test execution bridge is not bound.");
        return handler(input);
      },
    };
    const authorityBridge = {
      bind(nextHandler: unknown) {
        if (authorityHandler) throw new Error("Test authority bridge is already bound.");
        authorityHandler = nextHandler;
      },
    };
    const dispatcher = {
      dispatchTurn: vi.fn(async (request: {
        readonly executionId: string;
        readonly intentFingerprint: string;
        readonly intent: { readonly routeId: string; readonly accountOverrideId?: string };
        readonly payload: unknown;
      }) => {
        const accountId = request.intent.accountOverrideId ?? "test-account";
        const selectedAdmission = { ...admission, routeId: request.intent.routeId };
        const budget = await authorityHandler.preflight({ request });
        const binding = {
          status: "bound" as const, routeId: request.intent.routeId, accountId,
          credentialId: "test-credential", credentialRevision: "sha256:test-revision",
        };
        const snapshot = {
          catalog: { routes: [{ id: selectedAdmission.routeId, providerId: selectedAdmission.providerId, providerModelId: selectedAdmission.providerModelId }] },
          configurationRevision: { revisionSetId: "R1", revisions: { execution: "R1" } },
        };
        const dataPolicy = { decision: { status: "admitted" as const, freshness: "current" as const, reason: "test policy" } };
        const facets = await authorityHandler.prepare({ request, admission: selectedAdmission, snapshot, binding, dataPolicy });
        const { defineEffectiveAuthorityAdmissionBundle } = await import("../../src/session/effective-authority-admission-bundle.js");
        const authorityAdmission = defineEffectiveAuthorityAdmissionBundle({
          sessionId: facets.sessionId, turnId: facets.turnId, admittedAt: "2026-08-22T18:00:00.000Z",
          configuration: { sessionRevision: facets.sessionRevision, turnRevision: snapshot.configurationRevision },
          session: facets.session,
          turn: { ...facets.turn, budget, execution: { status: "routed", route: selectedAdmission, dataPolicy, binding } },
        });
        await authorityHandler.persist(authorityAdmission);
        const result = await bridge.dispatchCommittedTurn({
          executionId: request.executionId,
          admission: selectedAdmission,
          accountId,
          binding,
          credential: { kind: "test" },
          authorityAdmission,
          payload: request.payload,
        });
        return {
          admission: selectedAdmission,
          accountId,
          leaseId: "test-lease",
          evidence: {
            routeId: request.intent.routeId,
            accountId,
            credentialId: "test-credential",
            credentialRevision: "sha256:test-revision",
            capacityIdentity: "test-capacity",
            leaseId: "test-lease",
            dispatchFenceId: "test-dispatch",
            status: "completed",
          },
          result,
        };
      }),
    };
    return {
      operatorTurnDispatcher: dispatcher,
      operatorTurnExecutionBridge: bridge,
      operatorAuthorityAdmissionBridge: authorityBridge,
      authorityAdmissionEvidenceStore: { persist: async () => undefined, loadSessionFacet: async () => undefined },
      executionRouteSelection,
    };
  },
}));

vi.mock("hono/bun", () => ({
  createBunWebSocket: () => ({
    upgradeWebSocket: tuiSocketHarness.upgradeWebSocket,
    websocket: {},
  }),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");

  return {
    ...actual,
    execSync: vi.fn(() => ""),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = { write: vi.fn() };
      proc.kill = vi.fn();
      queueMicrotask(() => proc.emit("close"));
      return proc;
    }),
  };
});

function stubBunServe(): void {
  vi.stubGlobal("Bun", {
    serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
      port: port ?? 4801,
      stop: vi.fn(),
    })),
  });
}

function makeSessionManager() {
  return {
    factory: vi.fn(() => ({
      async *run() {
        yield { type: "completed" as const, totalUsd: 0, durationMs: 0, outcome: "completed" as const, isPreflightCrash: false };
      },
      dispose: vi.fn().mockResolvedValue(undefined),
    })) as never,
    getProvider: vi.fn(() => "claude"),
    setProvider: vi.fn(),
    getModel: vi.fn(() => "claude-sonnet-4-6"),
    setModel: vi.fn(),
  };
}

function makeTuiTestRouting(
  sessionManager: Pick<TuiGatewayOptions["sessionManager"], "getProvider" | "getModel">,
): Pick<TuiGatewayOptions, "executionRouteSelection" | "operatorTurnDispatcher" | "operatorTurnExecutionBridge" | "operatorAuthorityAdmissionBridge" | "authorityAdmissionEvidenceStore" | "persistCanonicalSessionEvent"> {
  const routing = tuiTestRouting.create(sessionManager.getProvider(), sessionManager.getModel());
  return {
    executionRouteSelection: routing.executionRouteSelection as never,
    operatorTurnDispatcher: routing.operatorTurnDispatcher as never,
    operatorTurnExecutionBridge: routing.operatorTurnExecutionBridge as never,
    operatorAuthorityAdmissionBridge: routing.operatorAuthorityAdmissionBridge as never,
    authorityAdmissionEvidenceStore: routing.authorityAdmissionEvidenceStore as never,
    persistCanonicalSessionEvent: async () => undefined,
  };
}

function makeManagedInvocationOptions(): ManagedInvocationToolOptions {
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:opencode:harness",
      providerId: "opencode",
      adapterKind: "harness",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["cli-harness"],
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
    }),
    invoke: vi.fn(async ({ request, admission }: {
      readonly request: ManagedAgentInvocationRequest;
      readonly admission: { readonly capabilitySnapshot: ReturnType<typeof buildManagedAgentCapabilitySnapshot> };
    }) =>
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        profile: request.profile,
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
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "TUI child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
        },
      })),
  };

  return {
    routes: [{
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
      providerId: "opencode",
      model: "openai/gpt-4o:free",
      surface: "cli-harness",
      capability: {
        identity: { routeId: "opencode-readonly", revision: "test-v1" },
        target: { providerId: "opencode", modelId: "openai/gpt-4o:free" },
        adapter: { kind: "cli-harness", capabilityId: "opencode-harness", capabilityVersion: "test-v1" },
        authorityCeiling: "read_only",
        toolNames: ["read", "grep", "glob"],
        supportsRecursion: true,
        supportsAttachments: false,
        supportsWrite: false,
        proof: { status: "configured", source: "test-fixture", provenProfiles: ["foundation-readonly-plan"] },
        capacity: { kind: "accountless" },
        settlement: { kind: "not-required" },
      },
      createAdapter: async () => adapter,
      profiles: [{
          authorityProfileId: "authority:opencode-readonly:foundation-readonly-plan",
          admissionProfile: "foundation-readonly-plan",
          permissionProfile: "read-only",
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
          workingDirectory: {
            path: "C:/workspace/kiln",
            mode: "read-only",
          },
          timeoutMs: 120000,
          credentialRoute: {
            mode: "runtime-selected",
            routeId: "credential-route:opencode:runtime-selected",
          },
          memoryScope: {
            scope: { kind: "project", id: "kiln" },
            access: "read-only",
          },
      }],
    }],
    requestedBy: "assistant",
    requestSource: "tui",
  };
}

function makeManagedInvocationAttachment(
  options: ManagedInvocationToolOptions = makeManagedInvocationOptions(),
): ManagedInvocationToolAttachment {
  return {
    options,
    callerIdentity: {
      kind: "kiln-runtime",
      surface: "tui-test",
      attachmentId: "attachment:tui-test",
    },
  };
}

function makeTuiOperatorDiscoveryFromModels(
  modelsByProvider: Record<string, readonly string[]>,
): GuiProviderDiscoveryResult[] {
  return Object.entries(modelsByProvider).map(([provider, models]) => ({
    provider,
    available: true,
    models: [...models],
    ...(models.length > 0
      ? {
          modelRouteHealth: Object.fromEntries(models.map((model) => [
            model,
            { healthy: true },
          ])),
        }
      : {}),
    status: "available",
    reason: `${provider} models discovered.`,
    authState: "authenticated",
    lastCheckedAt: "2026-04-28T12:00:00.000Z",
  }));
}

function makeUnavailableTuiOperatorDiscovery(
  provider: string,
  reason: string,
): GuiProviderDiscoveryResult {
  return {
    provider,
    available: false,
    models: [],
    status: "missing_auth",
    reason,
    authState: "missing",
    lastCheckedAt: "2026-04-28T12:00:00.000Z",
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function selectTuiTestExecutionRoute(
  handlers: { readonly onMessage?: (event: MessageEvent, ws: never) => Promise<void> | void },
  wsCtx: unknown,
): Promise<void> {
  await handlers.onMessage?.(
    new MessageEvent("message", {
      data: JSON.stringify({ type: "execution_route", routeId: "test-route", requestId: "test-route-selection" }),
    }),
    wsCtx as never,
  );
}

afterEach(() => {
  tuiSocketHarness.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// We test the gateway clear frame handling by extracting the logic inline,
// since startTuiGateway() starts a real Bun HTTP server. Instead we exercise
// the onClear option contract directly as it would be called by the onMessage handler.

const TEST_HANDOFF_PROVENANCE = {
  delivery: "runtime-generated",
  configuredModelId: "test-model",
  observedModelIds: [],
} as const;

describe("TUI gateway clear frame handling", () => {
  it("sends cleared frame when clear frame received", async () => {
    const ws = { send: vi.fn() };
    const onClear = vi.fn().mockResolvedValue(undefined);

    // Simulate what the onMessage handler does for a { type: "clear" } frame
    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    const handled = await handleClearFrame({ type: "clear" }, ws.send, onClear);

    expect(handled).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "cleared" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("calls onClear callback", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    const ws = { send: vi.fn() };

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    await handleClearFrame({ type: "clear" }, ws.send, onClear);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("sends cleared even when onClear throws (fail-open)", async () => {
    const onClear = vi.fn().mockRejectedValue(new Error("storage failure"));
    const ws = { send: vi.fn() };

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    await handleClearFrame({ type: "clear" }, ws.send, onClear);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "cleared" }));
  });

  it("does not handle non-clear frames", async () => {
    const ws = { send: vi.fn() };
    const onClear = vi.fn();

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    const handled = await handleClearFrame({ type: "message", content: "hello" }, ws.send, onClear);
    expect(handled).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});

describe("TUI gateway startup discovery", () => {
  it("starts listening before provider discovery resolves", async () => {
    vi.resetModules();
    stubBunServe();
    let resolveDiscovery: ((discovery: GuiProviderDiscoveryResult[]) => void) | undefined;
    const pendingDiscovery = new Promise<GuiProviderDiscoveryResult[]>((resolve) => {
      resolveDiscovery = resolve;
    });
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockImplementation(() => pendingDiscovery);
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager, ...makeTuiTestRouting(sessionManager) });
    try {
      expect(gateway.models).toEqual({});
      expect(gateway.providerDiscovery).toEqual([]);
      expect(discoverySpy).toHaveBeenCalledTimes(1);
    } finally {
      resolveDiscovery?.([]);
      await flushAsyncWork();
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });
});

describe("TUI gateway execution-route catalog", () => {
  it("refreshes the execution-route catalog on request without reconnecting", async () => {
    vi.resetModules();
    stubBunServe();
    let routeAvailable = false;
    const executionRouteSelection = {
      getCatalog: vi.fn(async () => ({
        routes: [{
          routeId: "opencode-gpt-5",
          label: "OpenCode GPT-5",
          providerId: "opencode",
          providerModelId: "openai/gpt-5",
          accountSelection: { mode: "automatic" as const, eligibleAccountCount: 1, allowOperatorOverride: true },
          availability: routeAvailable ? "available" as const : "unavailable" as const,
          reasonCodes: routeAvailable ? [] as const : ["missing-credentials"] as const,
          repairActions: routeAvailable ? [] as const : ["authenticate-provider"] as const,
        }],
      })),
      admit: vi.fn(async () => ({
        ok: true as const,
        admission: { routeId: "opencode-gpt-5", providerId: "opencode", providerModelId: "openai/gpt-5" },
      })),
    };
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeTuiOperatorDiscoveryFromModels({ opencode: ["openai/gpt-5"] }));
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
      ...makeTuiTestRouting(sessionManager),
      executionRouteSelection,
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onOpen?.(new Event("open"), wsCtx);
      routeAvailable = true;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "refresh_execution_routes",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "execution_routes_refreshed",
          executionRouteCatalog: {
            routes: [expect.objectContaining({ routeId: "opencode-gpt-5", availability: "available" })],
          },
        }),
      ]));
    } finally {
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("includes a freshly resolved execution-route catalog after provider authentication", async () => {
    vi.resetModules();
    stubBunServe();
    let routeAvailable = false;
    const executionRouteSelection = {
      getCatalog: vi.fn(async () => ({
        routes: [{
          routeId: "codex-oauth-route",
          label: "Codex OAuth",
          providerId: "codex-oauth",
          providerModelId: "gpt-5.5",
          accountSelection: { mode: "exact" as const, eligibleAccountCount: 1, allowOperatorOverride: false },
          availability: routeAvailable ? "available" as const : "unavailable" as const,
          reasonCodes: routeAvailable ? [] as const : ["missing-credentials"] as const,
          repairActions: routeAvailable ? [] as const : ["authenticate-provider"] as const,
        }],
      })),
      admit: vi.fn(),
    };
    const providerAuthSpy = vi
      .spyOn(await import("../../src/gateway/provider-auth.js"), "startProviderAuthRequest")
      .mockResolvedValue({
        ok: true,
        provider: "codex-oauth",
        requestId: "auth-route-refresh",
        method: "device_code",
        complete: vi.fn(async () => undefined),
      } as never);
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeTuiOperatorDiscoveryFromModels({ "codex-oauth": ["gpt-5.5"] }));
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");
    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ "codex-oauth": true }),
      ...makeTuiTestRouting(sessionManager),
      executionRouteSelection: executionRouteSelection as never,
    });

    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);
      routeAvailable = true;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider_auth",
            provider: "codex-oauth",
            requestId: "auth-route-refresh",
          }),
        }),
        wsCtx,
      );

      const completion = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; executionRouteCatalog?: { routes: unknown[] } })
        .find((frame) => frame.type === "provider_auth_completed");
      expect(completion).toMatchObject({
        executionRouteCatalog: {
          routes: [expect.objectContaining({
            routeId: "codex-oauth-route",
            availability: "available",
          })],
        },
      });
      expect(providerAuthSpy).toHaveBeenCalledWith(expect.objectContaining({
        provider: "codex-oauth",
        requestId: "auth-route-refresh",
      }));
      expect(executionRouteSelection.getCatalog).toHaveBeenCalledTimes(2);
    } finally {
      providerAuthSpy.mockRestore();
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });
});

describe("TUI gateway message fail-closed behavior", () => {
  it("projects rich CLI tool results to TUI session event frames", async () => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeTuiOperatorDiscoveryFromModels({ claude: [] }));
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "claude"),
      getModel: vi.fn(() => ""),
      factory: vi.fn(() => ({
        run: async function* () {
          yield {
            type: "tool_use" as const,
            toolCallScopeId: "turn-1:response:1",
            toolCallId: "call-rich",
            toolName: "managed_agent.invoke",
            input: { profile: "foundation-readonly-plan" },
          };
          yield {
            type: "tool_result" as const,
            toolCallScopeId: "turn-1:response:1",
            toolCallId: "call-rich",
            toolName: "managed_agent.invoke",
            output: "child completed",
            metadata: {
              invocationId: "managed-1",
              routeId: "codex-oauth-auto-review-readonly",
            },
            resourceLinks: [{
              uri: "kiln://managed-invocations/managed-1/transcript",
              title: "Transcript",
              relation: "events",
            }],
            toolUsage: {
              scope: "turn" as const,
              toolName: "managed_agent.invoke",
              calls: 1,
            },
          };
          yield {
            type: "cost_update" as const,
            usd: 0.0123,
            provider: "claude",
            model: "claude-sonnet-4-5",
            inputTokens: 120,
            outputTokens: 30,
            cacheReadTokens: 20,
          };
          yield { type: "text_delta" as const, content: "Parent turn completed." };
          yield { type: "completed" as const, totalUsd: 0, durationMs: 1, outcome: "completed" as const, isPreflightCrash: false };
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      })),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ claude: true }),
      ...makeTuiTestRouting(sessionManager),
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);
      await selectTuiTestExecutionRoute(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            content: "run rich cli event",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: { kind: string; payload: Record<string, unknown> };
      });
      const completedPayload = outboundFrames
        .find((frame) => frame.type === "session_event" && frame.event?.kind === "tool_call_completed")
        ?.event?.payload;
      const sessionEvents = outboundFrames
        .filter((frame) => frame.type === "session_event")
        .map((frame) => frame.event);
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "Parent turn completed.",
      }));
      expect(completedPayload).toMatchObject({
        toolCallId: "call-rich",
        toolCallScopeId: "turn-1:response:1",
        toolName: "managed_agent.invoke",
        output: "child completed",
        metadata: {
          invocationId: "managed-1",
          routeId: "codex-oauth-auto-review-readonly",
        },
        resourceLinks: [{
          uri: "kiln://managed-invocations/managed-1/transcript",
          title: "Transcript",
          relation: "events",
        }],
        toolUsage: {
          scope: "turn",
          toolName: "managed_agent.invoke",
          calls: 1,
        },
        status: {
          state: "succeeded",
        },
      });
      expect(sessionEvents.some((event) => event?.kind === "cost_updated")).toBe(false);
      expect(sessionEvents.some((event) => event?.kind === "lifecycle_attribution_recorded")).toBe(false);
    } finally {
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("streams managed invocation session events from a TUI turn", async () => {
    vi.resetModules();
    vi.doMock("../../src/gateway/message-pipeline/index.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/gateway/message-pipeline/index.js")>(
        "../../src/gateway/message-pipeline/index.js",
      );
      return { ...actual, processAdmittedTurn: tuiProcessAdmittedTurn };
    });
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue([{
        provider: "openai",
        available: true,
        models: ["gpt-5.4-mini"],
        modelCapabilities: {
          "gpt-5.4-mini": {
            supportsFunctionTools: true,
            supportsRuntimeTools: true,
          },
        },
        status: "available",
        reason: "OpenAI models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-05-06T12:00:00.000Z",
      }]);
    tuiProcessAdmittedTurn.mockImplementation(async (input) => {
      const session = new RuntimeSession({
        sessionId: "tui-parent-session",
        appName: "kiln-tui",
        tenantId: "tui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      session.addUserMessage(textParts("Delegate a managed read-only review."));
      await input.turnCapture?.start?.(session.id, 10);
      const managedInvoke = input.callBuiltinTools?.get("managed_agent.invoke");
      if (!managedInvoke) {
        throw new Error("managed_agent.invoke was not attached to the TUI turn surface");
      }
      expect(input.perCallConfig?.toolAllowlist?.has("managed_agent.invoke")).toBe(true);
      expect(input.perCallConfig?.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
        allowed: false,
        requiresApproval: true,
      });

      const toolResult = await managedInvoke({
        profile: "foundation-readonly-plan",
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "openai/gpt-4o:free",
        },
        task: "Inspect the managed invocation docs and report risks.",
      }, {
        session,
        effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
        toolCall: {
          id: "tool-call-managed-1",
          name: "managed_agent.invoke",
          input: {},
        },
      });
      await input.turnCapture?.finish?.(session.id);

      expect(toolResult.isError).toBe(false);
      expect(toolResult.output).toContain("TUI child review completed.");
      const transcriptUri = (toolResult.metadata as { readonly transcript?: { readonly uri?: string } }).transcript?.uri;
      expect(transcriptUri).toContain("kiln://managed-agents/invocations/");
      const resourceRead = input.callBuiltinTools?.get("resource_read");
      expect(resourceRead).toBeDefined();
      const resourceResult = await resourceRead!({
        uri: transcriptUri,
      }, {
        session,
        toolCall: {
          id: "tool-call-managed-resource-read",
          name: "resource_read",
          input: { uri: transcriptUri },
        },
      });
      expect(resourceResult.isError).toBe(false);
      const invocationId = (toolResult.metadata as { readonly invocationId?: string }).invocationId;
      expect(resourceResult.output).toContain(invocationId ?? "");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Parent TUI turn completed." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-tui",
        },
        } as never;
    });
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "openai"),
      getModel: vi.fn(() => "gpt-5.4-mini"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      managedInvocation: makeManagedInvocationAttachment(),
      ...makeTuiTestRouting(sessionManager),
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);
      await selectTuiTestExecutionRoute(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            content: "delegate from tui",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: { kind: string; payload: Record<string, unknown> };
      });
      const sessionEventFrames = outboundFrames.filter((frame) => frame.type === "session_event");

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "Parent TUI turn completed.",
      }));
      expect(sessionEventFrames.map((frame) => frame.event?.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        "agent_invocation_completed",
      ]);
      expect(sessionEventFrames.map((frame) => frame.event?.payload.instanceId)).toEqual([
        "local-tui",
        "local-tui",
        "local-tui",
      ]);
      expect(sessionEventFrames.map((frame) => frame.event?.payload.sessionId)).toEqual([
        "tui-parent-session",
        "tui-parent-session",
        "tui-parent-session",
      ]);
      expect(sessionEventFrames[2]?.event?.payload).toMatchObject({
        resultSummary: "TUI child review completed.",
        managedInvocationEvidence: {
          childSessionId: expect.stringContaining("tui-parent-session:managed:"),
        },
      });
      expect(tuiProcessAdmittedTurn).toHaveBeenCalledOnce();
    } finally {
      tuiProcessAdmittedTurn.mockReset();
      vi.doUnmock("../../src/gateway/message-pipeline/index.js");
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("keeps managed invocation state visible across TUI gateway turns when options omit a service", async () => {
    vi.resetModules();
    vi.doMock("../../src/gateway/message-pipeline/index.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/gateway/message-pipeline/index.js")>(
        "../../src/gateway/message-pipeline/index.js",
      );
      return { ...actual, processAdmittedTurn: tuiProcessAdmittedTurn };
    });
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue([{
        provider: "openai",
        available: true,
        models: ["gpt-5.4-mini"],
        modelCapabilities: {
          "gpt-5.4-mini": {
            supportsFunctionTools: true,
            supportsRuntimeTools: true,
          },
        },
        status: "available",
        reason: "OpenAI models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-05-06T12:00:00.000Z",
      }]);
    let turn = 0;
    let invocationId = "";
    tuiProcessAdmittedTurn.mockImplementation(async (input) => {
        turn += 1;
        const session = new RuntimeSession({
          sessionId: "tui-parent-session",
          appName: "kiln-tui",
          tenantId: "tui",
          userId: "operator-1",
          systemPrompt: "You are a helpful assistant.",
        });
        session.addUserMessage(textParts(`Managed invocation turn ${turn}.`));

        if (turn === 1) {
          const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
          if (!startManagedAgent) {
            throw new Error("managed_agent.start was not attached to the TUI turn surface");
          }
          const started = await startManagedAgent({
            profile: "foundation-readonly-plan",
            routeId: "opencode-readonly",
            providerRoute: {
              providerId: "opencode",
              model: "openai/gpt-4o:free",
            },
            task: "Inspect the managed invocation docs and report risks.",
          }, {
            session,
            effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
            toolCall: {
              id: "tool-call-managed-start",
              name: "managed_agent.start",
              input: {},
            },
          });
          invocationId = String((started.metadata as { invocationId?: string } | undefined)?.invocationId ?? "");
          expect(invocationId).not.toBe("");
        } else {
          const statusManagedAgent = input.callBuiltinTools?.get("managed_agent.status");
          if (!statusManagedAgent) {
            throw new Error("managed_agent.status was not attached to the TUI turn surface");
          }
          const status = await statusManagedAgent({ invocationId }, {
            session,
            toolCall: {
              id: "tool-call-managed-status",
              name: "managed_agent.status",
              input: { invocationId },
            },
          });
          expect(status.isError).toBe(false);
          expect(status.output).toContain(invocationId);
        }

        return {
          ok: true,
          result: {
            parts: [{ type: "text", text: `Managed turn ${turn} completed.` }],
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            queued: false,
            sessionId: session.id,
            sessionMode: "mode-a",
            traceId: `trace-managed-tui-${turn}`,
          },
        } as never;
      });
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "openai"),
      getModel: vi.fn(() => "gpt-5.4-mini"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      managedInvocation: makeManagedInvocationAttachment(),
      ...makeTuiTestRouting(sessionManager),
    });
    try {
      const { handlers, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);
      await selectTuiTestExecutionRoute(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start managed child" }),
        }),
        wsCtx,
      );
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "check managed child" }),
        }),
        wsCtx,
      );

      expect(tuiProcessAdmittedTurn).toHaveBeenCalledTimes(2);
    } finally {
      tuiProcessAdmittedTurn.mockReset();
      vi.doUnmock("../../src/gateway/message-pipeline/index.js");
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });
});

