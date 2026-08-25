import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import {
  EventEmitter,
} from "node:events";
import {
  tmpdir,
} from "node:os";
import {
  join,
} from "node:path";
import type {
  Context,
  Next,
} from "hono";
import type {
  WSEvents,
} from "hono/ws";
import type {
  OperatorGuiSessionTransportOptions,
} from "../../src/gateway/operator-gateway.js";
import type {
  OperatorExecutionRouteSelectionPort,
} from "../../src/gateway/operator-execution-route-selection.js";
import {
  afterEach,
  type Mock,
  vi,
} from "vitest";
import {
  buildGuiOperatorDiscoveryResults,
  type GuiCliProviderModelDiscovery,
} from "../../src/gateway/gui-provider-models.js";

type GuiSocketHandlerFactory = (context: Context) => WSEvents<unknown>;
type GuiSocketContext = Parameters<NonNullable<WSEvents<unknown>["onOpen"]>>[1];
type GuiSocketHarness = {
  readonly upgradeWebSocket: (factory: GuiSocketHandlerFactory) => (context: Context, next: Next) => Promise<unknown>;
  readonly simulateConnection: (queryParams?: Record<string, string>) => {
    readonly handlers: WSEvents<unknown>;
    readonly mockWs: {
      readonly send: Mock<(data: string) => void>;
      readonly readyState: number;
      readonly close: Mock<() => void>;
    };
    readonly wsCtx: GuiSocketContext;
  };
  readonly reset: () => void;
};

const guiSocketHarness: GuiSocketHarness = vi.hoisted(() => {
  type HandlerFactory = GuiSocketHandlerFactory;
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket = (factory: HandlerFactory) => {
    capturedFactory = factory;
    return async (_c: Context, next: Next) => next();
  };

  function simulateConnection(queryParams: Record<string, string> = {}) {
    if (!capturedFactory) throw new Error("upgradeWebSocket not called yet");

    const url = new URL("http://localhost/gui/ws");
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }

    const ctx = {
      req: {
        query: (key: string) => url.searchParams.get(key) ?? undefined,
      },
    } as Context;

    const handlers = capturedFactory(ctx);
    const mockWs = {
      send: vi.fn<(data: string) => void>(),
      readyState: 1,
      close: vi.fn<() => void>(),
    };

    return { handlers, mockWs, wsCtx: mockWs as unknown as Parameters<NonNullable<typeof handlers.onOpen>>[1] };
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

function getGuiSocketHarness(): GuiSocketHarness {
  return guiSocketHarness;
}

const guiTestRouting = vi.hoisted(() => ({
  create(providerId?: string, providerModelId?: string) {
    let handler: ((input: unknown) => Promise<unknown>) | undefined;
    let authorityHandler: any;
    const persistedAdmissions = new Map<string, import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle>();
    const createActionClaimStore = () => {
      const permits = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
      return {
        claim(claim: { readonly claimId: string }) {
          const state = { claimId: claim.claimId, consumed: false };
          const permit = {
            claimId: claim.claimId,
            permitId: `gui-test:${claim.claimId}`,
            consume: () => {
              if (state.consumed) throw new Error("GUI test action-claim permit already consumed.");
              state.consumed = true;
            },
          };
          permits.set(permit, state);
          return permit;
        },
        settle(permit: { readonly claimId: string }) {
          const state = permits.get(permit);
          if (!state || state.claimId !== permit.claimId || !state.consumed) {
            throw new Error("Unknown or unconsumed GUI test action-claim permit.");
          }
          permits.delete(permit);
        },
      };
    };
    const runtimeModelRoundActionClaims = createActionClaimStore();
    const runtimeToolActionClaims = createActionClaimStore();
    // The permit brand is process-private; this fixture owns the store and only
    // crosses the typed runtime capability seam here.
    const runtimeMediaActionClaims = {
      ownerGeneration: "gui-test-media",
      store: createActionClaimStore(),
      readAdmission: async ({ admissionId, sessionId, turnId }: {
        readonly admissionId: string;
        readonly sessionId: string;
        readonly turnId: string;
      }) => {
        const bundle = persistedAdmissions.get(admissionId);
        return bundle?.sessionId === sessionId && bundle.turnId === turnId ? bundle : undefined;
      },
    } as unknown as import("../../src/execution-kernel/runtime-media-action-claim.js").RuntimeMediaActionClaimContext;
    const admission = {
      routeId: "test-route",
      providerId: providerId?.trim() || "claude",
      providerModelId: providerModelId?.trim() || "claude-sonnet-4-6",
    };
    const executionRouteSelection: OperatorExecutionRouteSelectionPort = {
      getCatalog: vi.fn<OperatorExecutionRouteSelectionPort["getCatalog"]>(async () => ({
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
      admit: vi.fn<OperatorExecutionRouteSelectionPort["admit"]>(async (intent) => ({
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
        let result: unknown;
        try {
           result = await bridge.dispatchCommittedTurn({
             executionId: request.executionId,
             intentFingerprint: request.intentFingerprint,
             admission: selectedAdmission,
            accountId,
            binding,
            credential: { kind: "test" },
            authorityAdmission,
            payload: request.payload,
          });
        } catch (error) {
          await authorityHandler.abort(request.executionId);
          throw error;
        }
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
      authorityAdmissionEvidenceStore: {
        persist: async (bundle: import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle) => {
          persistedAdmissions.set(bundle.admissionId, bundle);
        },
        loadSessionFacet: async () => undefined,
        readAdmission: async ({ admissionId, sessionId, turnId }: {
          readonly admissionId: string;
          readonly sessionId: string;
          readonly turnId: string;
        }) => {
          const bundle = persistedAdmissions.get(admissionId);
          return bundle?.sessionId === sessionId && bundle.turnId === turnId ? bundle : undefined;
        },
      },
      runtimeModelRoundActionClaims,
      runtimeToolActionClaims,
      runtimeMediaActionClaims,
      executionRouteSelection,
    };
  },
}));

const guiOperatorTransportDefaults = (() => {
  const routing = guiTestRouting.create();
  return {
    operatorTurnDispatcher: routing.operatorTurnDispatcher as unknown as OperatorGuiSessionTransportOptions["operatorTurnDispatcher"],
    operatorTurnExecutionBridge: routing.operatorTurnExecutionBridge as unknown as OperatorGuiSessionTransportOptions["operatorTurnExecutionBridge"],
    operatorAuthorityAdmissionBridge: routing.operatorAuthorityAdmissionBridge as unknown as OperatorGuiSessionTransportOptions["operatorAuthorityAdmissionBridge"],
    authorityAdmissionEvidenceStore: routing.authorityAdmissionEvidenceStore,
    runtimeModelRoundActionClaims: routing.runtimeModelRoundActionClaims as unknown as OperatorGuiSessionTransportOptions["runtimeModelRoundActionClaims"],
    runtimeToolActionClaims: routing.runtimeToolActionClaims as unknown as OperatorGuiSessionTransportOptions["runtimeToolActionClaims"],
    runtimeMediaActionClaims: routing.runtimeMediaActionClaims as unknown as OperatorGuiSessionTransportOptions["runtimeMediaActionClaims"],
    createProvider: async ({ admission }) => ({
      name: admission.providerId,
      createMessage: async () => ({
        parts: [{ type: "text", text: "test response" }],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      }),
      async *streamMessage() {
        yield { type: "done" as const, content: "" };
      },
    }),
    persistCanonicalSessionEvent: async () => undefined,
  } satisfies Pick<OperatorGuiSessionTransportOptions, "operatorTurnDispatcher" | "operatorTurnExecutionBridge" | "operatorAuthorityAdmissionBridge" | "authorityAdmissionEvidenceStore" | "runtimeModelRoundActionClaims" | "runtimeToolActionClaims" | "runtimeMediaActionClaims" | "createProvider" | "persistCanonicalSessionEvent">;
})();

vi.mock("hono/bun", () => ({
  createBunWebSocket: () => ({
    upgradeWebSocket: guiSocketHarness.upgradeWebSocket,
    websocket: {},
  }),
}));

vi.mock("../../src/gateway/gui-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/gateway/gui-gateway.js")>();
  return {
    ...actual,
    startGuiGateway: (input: Parameters<typeof actual.startGuiGateway>[0]) => {
      if (!input.operatorTransport) {
        return actual.startGuiGateway(input);
      }
      const routing = guiTestRouting.create(
        input.operatorTransport.sessionManager.getProvider(),
        input.operatorTransport.sessionManager.getModel(),
      );
      return actual.startGuiGateway({
        ...input,
        executionRouteSelection: input.executionRouteSelection ?? routing.executionRouteSelection as never,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          ...input.operatorTransport,
          operatorTurnDispatcher: routing.operatorTurnDispatcher as never,
          operatorTurnExecutionBridge: routing.operatorTurnExecutionBridge as never,
          operatorAuthorityAdmissionBridge: routing.operatorAuthorityAdmissionBridge as never,
          authorityAdmissionEvidenceStore: input.operatorTransport.authorityAdmissionEvidenceStore,
          runtimeModelRoundActionClaims: routing.runtimeModelRoundActionClaims as never,
          runtimeToolActionClaims: routing.runtimeToolActionClaims as never,
          runtimeMediaActionClaims: routing.runtimeMediaActionClaims,
        },
      });
    },
  };
});

vi.mock("../../src/gateway/message-pipeline/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/gateway/message-pipeline/index.js")>();
  return {
    ...actual,
    processAdmittedTurn: vi.fn(),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");

  return {
    ...actual,
    execFileSync: vi.fn(() => ""),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
        kill: () => void;
      };

      proc.stdout = new EventEmitter();
      proc.stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
      proc.kill = () => {
        proc.emit("close");
      };

      queueMicrotask(() => {
        proc.emit("close");
      });

      return proc;
    }),
  };
});

function createGuiDist(): string {
  const distDir = mkdtempSync(join(tmpdir(), "gui-gateway-dist-"));
  mkdirSync(join(distDir, "assets"), { recursive: true });
  writeFileSync(
    join(distDir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/gui/assets/app.js\"></script></head><body><div id=\"app\">GUI Test Build</div></body></html>",
    "utf-8",
  );
  writeFileSync(join(distDir, "assets", "app.js"), "console.log('asset-ok');", "utf-8");
  return distDir;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCondition(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await flushAsyncWork();
  }
  throw new Error(message);
}

async function selectGuiTestExecutionRoute(
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

function makeGuiOperatorDiscoveryFromModels(
  models: Readonly<Record<string, readonly string[]>>,
) {
  const directProviderDiscovery: Record<string, GuiCliProviderModelDiscovery> = Object.fromEntries(
    Object.entries(models).flatMap(([provider, providerModels]) => (
      provider === "claude" || provider === "codex" || provider === "opencode" || providerModels.length === 0
        ? []
        : [[provider, {
            models: [...providerModels],
            status: "available",
            reason: `${provider} models discovered.`,
            authState: "authenticated",
          }]]
    )),
  );
  return buildGuiOperatorDiscoveryResults({
    opencodeModels: models.opencode ?? [],
    codexModels: models.codex ?? [],
    providerAvailability: Object.fromEntries(
      Object.keys(models).map((provider) => [provider, true]),
    ),
    directProviderDiscovery,
    lastCheckedAt: "2026-04-28T12:00:00.000Z",
  });
}

afterEach(() => {
  guiSocketHarness.reset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

export {
  getGuiSocketHarness,
  guiTestRouting,
  guiOperatorTransportDefaults,
  createGuiDist,
  flushAsyncWork,
  waitForCondition,
  selectGuiTestExecutionRoute,
  makeGuiOperatorDiscoveryFromModels,
};
