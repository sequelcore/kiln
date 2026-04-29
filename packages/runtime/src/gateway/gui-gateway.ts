import { join } from "node:path";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import {
  EventBus,
  extractText,
  textParts,
  type ApprovalReceivedEvent,
  type ApprovalRequestedEvent,
  type KilnEvent,
  type ModelRoutedEvent,
  type ReasoningEffort,
  type ToolAuthorizedEvent,
  type DefaultBuiltinToolRegistryOptions,
} from "@kilnai/core";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";
import type { CliSessionEvent } from "../execution/cli-subscription-executor.js";
import { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../session/session-registry.js";
import { ApprovalGateRegistry } from "./approval-registry.js";
import { processAdmittedTurn } from "./message-pipeline.js";
import type {
  RuntimeTurnApprovalTransition,
  RuntimeTurnAuthorityDecision,
  RuntimeTurnFileChange,
} from "../session/runtime-turn-record.js";
import type { OnProviderSwitch, OnResumeSession, OperatorSessionTransportOptions } from "./operator-gateway.js";
import {
  mountGuiStaticAssetsIfPresent,
  resolveGuiDistCandidates,
  resolveGuiDistPath,
} from "./gui-static-assets.js";
import {
  buildWelcomeProviderDescriptors,
  projectGuiOperatorModels,
  providerRequiresSelectedModelMessage,
  resolveGuiOperatorDiscoveryResults,
  resolveGuiProviderSwitch,
} from "./gui-provider-models.js";
import { createProviderCatalogService } from "./provider-catalog-service.js";
import { startProviderAuthRequest } from "./provider-auth.js";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  type AttachedRuntimeBuiltinToolSurface,
} from "./attached-runtime-tool-surface.js";
import { createOperatorThemeBridge } from "./operator-theme-bridge.js";
import {
  isGuiProviderModeless,
  isOperatorThemeName,
  type GuiDashboardSnapshot,
  type GuiInboundFrame,
  type GuiOutboundFrame,
  type GuiProviderDiscoveryResult,
  type GuiProviderModelCapabilities,
  type GuiProviderReasoningEffort,
  type GuiSessionDetail,
  type GuiSessionSummary,
  type OperatorWorkspaceError,
  type OperatorWorkspaceErrorCode,
  type OperatorWorkspaceExplorer,
} from "@kilnai/gateway-contracts";

export type {
  GuiDashboardSnapshot,
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiProviderDescriptor,
  GuiSessionDetail,
  GuiSessionEvent,
  GuiSessionMeta,
  GuiSessionSummary,
  GuiTelemetrySnapshot,
} from "@kilnai/gateway-contracts";

type BunHonoAdapters = typeof import("hono/bun");
type BunUpgradeWebSocket = ReturnType<BunHonoAdapters["createBunWebSocket"]>["upgradeWebSocket"];

async function loadBunHonoAdapters(): Promise<BunHonoAdapters> {
  return import("hono/bun");
}

export interface StartGuiGatewayOptions {
  readonly port?: number;
  readonly guiDistPath?: string;
  readonly getSnapshot: (context?: {
    readonly operatorModels?: Record<string, string[]>;
    readonly operatorDiscovery?: readonly GuiProviderDiscoveryResult[];
  }) => Promise<GuiDashboardSnapshot>;
  readonly getProviderAvailability?: () => Promise<Record<string, boolean>> | Record<string, boolean>;
  readonly listSessions?: () => Promise<readonly GuiSessionSummary[]>;
  readonly getSessionDetail?: (sessionId: string) => Promise<GuiSessionDetail | null>;
  readonly workingDirectory?: string;
  readonly domainLabel?: string;
  readonly workspaceExplorer?: OperatorWorkspaceExplorer;
  readonly updateThemePreference?: (theme: string) => Promise<void> | void;
  readonly onConnectionCountChange?: (count: number) => void;
  readonly onManagedWindowClose?: () => void;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly operatorTransport?: OperatorSessionTransportOptions;
}

export interface GuiGateway {
  readonly port: number;
  readonly url: string;
  readonly apiUrl: string;
  readonly operatorWsUrl?: string;
  readonly operatorModels?: Record<string, string[]>;
  readonly operatorDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly hasMountedGui: boolean;
  shutdown(): void;
}

const GUI_APP_NAME = "kiln-gui";
const GUI_TENANT_ID = "_gui";

function guiProviderAuthDebug(message: string, context?: Record<string, unknown>): void {
  if (!/^(1|true|yes)$/i.test(process.env.KILN_PROVIDER_AUTH_DEBUG?.trim() ?? "")) {
    return;
  }
  console.warn(`[gui-gateway:provider-auth][debug] ${message}`, context ?? {});
}

const WORKSPACE_ERROR_CODES: ReadonlySet<OperatorWorkspaceErrorCode> = new Set([
  "workspace_unavailable",
  "invalid_path",
  "outside_workspace",
  "not_found",
  "not_a_directory",
  "not_a_file",
  "read_failed",
  "preview_unsupported",
]);

function isWorkspaceErrorCode(value: unknown): value is OperatorWorkspaceErrorCode {
  return typeof value === "string" && WORKSPACE_ERROR_CODES.has(value as OperatorWorkspaceErrorCode);
}

function workspaceErrorResponse(error: unknown): { readonly status: 400 | 403 | 404 | 500; readonly body: OperatorWorkspaceError } {
  const code = typeof error === "object" && error !== null && "code" in error && isWorkspaceErrorCode(error.code)
    ? error.code
    : "read_failed";
  const message = error instanceof Error ? error.message : "Workspace request failed.";
  const path = typeof error === "object" && error !== null && "path" in error && typeof error.path === "string"
    ? error.path
    : undefined;
  const status = code === "outside_workspace"
    ? 403
    : code === "not_found"
      ? 404
      : code === "invalid_path" || code === "not_a_directory" || code === "not_a_file"
        ? 400
        : 500;
  return {
    status,
    body: {
      code,
      message,
      ...(path ? { path } : {}),
    },
  };
}

export function buildGuiPerCallToolConfig(): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: GUI_TENANT_ID,
  });
}

type GuiAuthorityStatus = NonNullable<Extract<GuiInboundFrame, { type: "welcome" }>["authorityStatus"]>;

export function deriveGuiAuthorityStatusFromPerCallConfig(
  config: PerCallToolConfig,
): GuiAuthorityStatus {
  const hasAllowlist = config.toolAllowlist !== undefined;
  const allowlistSize = config.toolAllowlist?.size ?? 0;
  const authorityMap = config.toolAuthority;
  const hasAuthorityMap = authorityMap instanceof Map;
  const authoritySize = authorityMap?.size ?? 0;

  if (hasAllowlist && allowlistSize === 0) {
    return { effective: "fail_closed", completeness: "authoritative" };
  }

  if (!hasAuthorityMap) {
    return { effective: "unknown", completeness: "partial" };
  }
  if (authoritySize === 0) {
    return { effective: "unknown", completeness: "partial" };
  }

  let sawReadOnly = false;
  let sawIdempotent = false;
  let sawAudited = false;
  for (const descriptor of authorityMap.values()) {
    if (!descriptor) {
      return { effective: "unknown", completeness: "partial" };
    }
    if (descriptor.level === 4 || descriptor.requiresApproval || !descriptor.allowed) {
      return { effective: "destructive", completeness: "authoritative" };
    }
    if (descriptor.level === 1) sawReadOnly = true;
    else if (descriptor.level === 2) sawIdempotent = true;
    else sawAudited = true;
  }

  if (sawAudited) return { effective: "audited", completeness: "authoritative" };
  if (sawIdempotent) return { effective: "idempotent", completeness: "authoritative" };
  if (sawReadOnly) return { effective: "read_only", completeness: "authoritative" };
  return { effective: "unknown", completeness: "partial" };
}

export async function startGuiGateway(options: StartGuiGatewayOptions): Promise<GuiGateway> {
  const port = options.port ?? 4810;
  const app = new Hono();
  const guiDistPath = resolveGuiDistPath(options.guiDistPath, import.meta.url);
  const hasMountedGui = mountGuiStaticAssetsIfPresent(app, guiDistPath);
  if (!hasMountedGui) {
    const unresolvedGuiDistPath = resolveGuiDistCandidates(options.guiDistPath, import.meta.url)[0] ?? "<unknown>";
    console.warn(`[gui-gateway] GUI bundle missing at ${join(unresolvedGuiDistPath, "index.html")}; skipping /gui mount.`);
  }
  const transportOptions = options.operatorTransport;
  let activeConnections = 0;

  const { upgradeWebSocket, websocket } = (await loadBunHonoAdapters()).createBunWebSocket();
  const operatorCatalog = transportOptions
    ? createProviderCatalogService<readonly GuiProviderDiscoveryResult[]>(
      () => resolveOperatorDiscovery(options.getProviderAvailability),
      [],
    )
    : undefined;
  let operatorDiscovery = operatorCatalog?.snapshot().discovery;
  let operatorModels = operatorDiscovery ? projectGuiOperatorModels(operatorDiscovery) : undefined;
  const refreshOperatorDiscovery = async (
    refreshOptions?: { readonly force?: boolean },
  ): Promise<readonly GuiProviderDiscoveryResult[] | undefined> => {
    if (!operatorCatalog) {
      return undefined;
    }
    operatorDiscovery = (await operatorCatalog.refresh(refreshOptions)).discovery;
    operatorModels = projectGuiOperatorModels(operatorDiscovery);
    return operatorDiscovery;
  };
  const getOperatorDiscoverySnapshot = (): readonly GuiProviderDiscoveryResult[] => {
    operatorDiscovery = operatorCatalog?.snapshot().discovery;
    operatorModels = operatorDiscovery ? projectGuiOperatorModels(operatorDiscovery) : undefined;
    return operatorDiscovery ?? [];
  };

  let operatorWsUrl: string | undefined;
  const updateConnectionCount = (count: number) => {
    options.onConnectionCountChange?.(count);
  };

  app.use("/gui/api/*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type, Accept");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  });

  app.get("/health", (c) => c.json({ status: "ok", channel: "gui", connections: activeConnections }));
  app.get("/gui-api/health", (c) => c.json({ status: "ok", channel: "gui", connections: activeConnections }));

  app.get("/gui/api/dashboard", async (c) => {
    const nextDiscovery = getOperatorDiscoverySnapshot();
    operatorCatalog?.startBackgroundRefresh();
    const snapshot = await options.getSnapshot({
      operatorModels: projectGuiOperatorModels(nextDiscovery),
      operatorDiscovery: nextDiscovery,
    });
    return c.json(snapshot);
  });

  app.get("/gui/api/workspace/tree", async (c) => {
    if (!options.workspaceExplorer) {
      return c.json({
        code: "workspace_unavailable",
        message: "Workspace explorer is not available.",
      } satisfies OperatorWorkspaceError, 404);
    }
    try {
      const path = c.req.query("path");
      return c.json(await options.workspaceExplorer.listDirectory(path));
    } catch (error) {
      const { status, body } = workspaceErrorResponse(error);
      return c.json(body, status);
    }
  });

  app.get("/gui/api/workspace/file", async (c) => {
    if (!options.workspaceExplorer) {
      return c.json({
        code: "workspace_unavailable",
        message: "Workspace explorer is not available.",
      } satisfies OperatorWorkspaceError, 404);
    }
    const path = c.req.query("path");
    if (!path) {
      return c.json({
        code: "invalid_path",
        message: "Workspace file path is required.",
      } satisfies OperatorWorkspaceError, 400);
    }
    try {
      return c.json(await options.workspaceExplorer.readFile(path));
    } catch (error) {
      const { status, body } = workspaceErrorResponse(error);
      return c.json(body, status);
    }
  });

  app.post("/gui/api/preferences/theme", async (c) => {
    if (!options.updateThemePreference) {
      return c.json({ error: "unsupported" }, 404);
    }
    const payload = await c.req.json().catch(() => null) as { theme?: unknown } | null;
    const theme = typeof payload?.theme === "string" ? payload.theme.trim() : "";
    if (!isOperatorThemeName(theme)) {
      return c.json({ error: "invalid_theme" }, 400);
    }
    await options.updateThemePreference(theme);
    return c.json({ ok: true });
  });

  const handleManagedWindowClose = (c: { body: (data: null, status: 204) => Response }) => {
    options.onManagedWindowClose?.();
    return c.body(null, 204);
  };

  app.post("/gui/api/window-closed", handleManagedWindowClose);
  app.post("/gui-api/window-closed", handleManagedWindowClose);

  const listSessions = async (): Promise<readonly GuiSessionSummary[]> => {
    if (!options.listSessions) {
      return [];
    }
    const sessions = await options.listSessions();
    return sessions.slice(0, 20);
  };

  app.get("/sessions", async (c) => {
    const sessions = await listSessions();
    return c.json({ sessions });
  });

  app.get("/gui/api/sessions", async (c) => {
    const sessions = await listSessions();
    return c.json({ sessions });
  });

  app.get("/gui-api/sessions", async (c) => {
    const sessions = await listSessions();
    return c.json({ sessions });
  });

  app.get("/gui/api/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId").trim();
    const sessionDetail = sessionId.length > 0 && options.getSessionDetail
      ? await options.getSessionDetail(sessionId)
      : null;
    if (!sessionDetail) {
      return c.json({
        error: "session_not_found",
        message: `Session '${sessionId || "unknown"}' was not found.`,
      }, 404);
    }
    return c.json(sessionDetail);
  });

  if (transportOptions) {
    wireOperatorTransport(app, upgradeWebSocket, {
      port,
      transport: transportOptions,
      initialDiscovery: operatorDiscovery ?? [],
      getDiscovery: async (discoveryOptions) => (await refreshOperatorDiscovery(discoveryOptions)) ?? [],
      getDiscoverySnapshot: getOperatorDiscoverySnapshot,
      onDiscoveryUpdated: (listener) => operatorCatalog?.subscribe((snapshot) => listener(snapshot.discovery)) ?? (() => {}),
      builtinToolOptions: options.builtinToolOptions,
      onReady: (url) => {
        operatorWsUrl = url;
      },
      onSocketOpen: () => {
        activeConnections += 1;
        updateConnectionCount(activeConnections);
      },
      onSocketClose: () => {
        activeConnections = Math.max(0, activeConnections - 1);
        updateConnectionCount(activeConnections);
      },
    });
  } else {
    // Minimal WebSocket endpoint for environments without an operator transport
    // (e.g. dashboard-only mode, e2e test fixtures). Accepts connections and
    // sends a welcome frame so clients can verify connectivity.
    app.get(
      "/gui/ws",
      upgradeWebSocket(() => ({
        onOpen(_event: Event, ws: WSContext) {
          activeConnections += 1;
          updateConnectionCount(activeConnections);
          const guiAuthorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(buildGuiPerCallToolConfig());
          ws.send(JSON.stringify({
            type: "welcome",
            models: {},
            providers: [],
            activeProvider: undefined,
            activeModel: undefined,
            planMode: false,
            workingDirectory: options.workingDirectory,
            domainLabel: options.domainLabel,
            authorityStatus: guiAuthorityStatus,
          } satisfies GuiInboundFrame));
        },
        onClose() {
          activeConnections = Math.max(0, activeConnections - 1);
          updateConnectionCount(activeConnections);
        },
      })),
    );
  }

  app.get("/gui", (c) => c.redirect("/gui/"));

  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  });
  operatorCatalog?.startBackgroundRefresh({ force: true });

  const boundPort = server.port ?? port;

  return {
    port: boundPort,
    url: `http://localhost:${boundPort}/gui/`,
    apiUrl: `http://localhost:${boundPort}/gui/api/dashboard`,
    operatorWsUrl,
    get operatorModels() {
      const currentDiscovery = operatorCatalog?.snapshot().discovery;
      if (currentDiscovery) {
        operatorDiscovery = currentDiscovery;
        operatorModels = projectGuiOperatorModels(currentDiscovery);
      }
      return operatorModels;
    },
    get operatorDiscovery() {
      const currentDiscovery = operatorCatalog?.snapshot().discovery;
      if (currentDiscovery) {
        operatorDiscovery = currentDiscovery;
        operatorModels = projectGuiOperatorModels(currentDiscovery);
      }
      return operatorDiscovery;
    },
    hasMountedGui,
    shutdown: () => server.stop(),
  };
}

async function resolveOperatorDiscovery(
  getProviderAvailability?: () => Promise<Record<string, boolean>> | Record<string, boolean>,
): Promise<GuiProviderDiscoveryResult[]> {
  const providerAvailability = getProviderAvailability
    ? await Promise.resolve(getProviderAvailability()).catch(() => ({}))
    : {};
  return resolveGuiOperatorDiscoveryResults(providerAvailability);
}

function wireOperatorTransport(
  app: Hono,
  upgradeWebSocket: BunUpgradeWebSocket,
  input: {
    port: number;
    transport: OperatorSessionTransportOptions;
    initialDiscovery: readonly GuiProviderDiscoveryResult[];
    getDiscovery: (options?: { readonly force?: boolean }) => Promise<readonly GuiProviderDiscoveryResult[]>;
    getDiscoverySnapshot: () => readonly GuiProviderDiscoveryResult[];
    onDiscoveryUpdated: (listener: (discovery: readonly GuiProviderDiscoveryResult[]) => void) => () => void;
    builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
    onReady: (wsUrl: string) => void;
    onSocketOpen?: () => void;
    onSocketClose?: () => void;
  },
): void {
  const providerLabel = input.transport.sessionManager.getProvider();
  const approvalRegistry = new ApprovalGateRegistry();
  const activityStreamer = new GuiActivityStreamer(approvalRegistry);
  const builtinToolSurface = createAttachedRuntimeBuiltinToolSurface({
    builtinToolOptions: input.builtinToolOptions,
  });
  let activeOperatorSurface: { theme: { setTheme: ReturnType<typeof createOperatorThemeBridge>["request"] } } | undefined;
  const executor = new CliSubscriptionExecutor(
    input.transport.sessionManager.factory,
    providerLabel,
    (event) => activityStreamer.forward(event),
    () => activeOperatorSurface,
  );
  const eventBus = input.transport.eventBus ?? new EventBus(100);
  const orchestrator = new RuntimeSessionOrchestrator({
    provider: executor,
    eventBus,
    builtinTools: builtinToolSurface.callBuiltinTools,
  });
  const sessionRegistry = new SessionRegistry();

  activityStreamer.bindApprovalBridge({
    approve: (sessionId) => orchestrator.continue(sessionId),
    reject: (sessionId, reason) => orchestrator.emitApprovalReceived(false, reason, sessionId),
  });

  app.get(
    "/gui/ws",
    upgradeWebSocket((c) => {
      const userId = c.req.query("userId") ?? crypto.randomUUID();
      let discovery = [...input.initialDiscovery];
      const applyDiscovery = (nextDiscovery: readonly GuiProviderDiscoveryResult[]): readonly GuiProviderDiscoveryResult[] => {
        discovery = [...nextDiscovery];
        return discovery;
      };
      const readDiscovery = (): readonly GuiProviderDiscoveryResult[] => applyDiscovery(input.getDiscoverySnapshot());
      const refreshDiscovery = async (
        options?: { readonly force?: boolean },
      ): Promise<readonly GuiProviderDiscoveryResult[]> => {
        return applyDiscovery(await input.getDiscovery(options).catch(() => []));
      };
      let operatorSocket: WSContext | null = null;
      let unsubscribeDiscovery: (() => void) | undefined;
      const operatorThemeBridge = createOperatorThemeBridge((frame) => {
        operatorSocket?.send(JSON.stringify(frame satisfies GuiInboundFrame));
      });
      activeOperatorSurface = { theme: { setTheme: operatorThemeBridge.request } };

      return {
        async onOpen(_event: Event, ws: WSContext) {
          operatorSocket = ws;
          input.onSocketOpen?.();
          activityStreamer.register(ws, eventBus);
          unsubscribeDiscovery?.();
          unsubscribeDiscovery = input.onDiscoveryUpdated((currentDiscovery) => {
            applyDiscovery(currentDiscovery);
            ws.send(JSON.stringify({
              type: "providers_refreshed",
              models: projectGuiOperatorModels(currentDiscovery),
              providerDiscovery: currentDiscovery,
              providers: buildWelcomeProviderDescriptors(currentDiscovery),
            } satisfies GuiInboundFrame));
          });
          const currentDiscovery = readDiscovery();
          const currentModels = projectGuiOperatorModels(currentDiscovery);
          const storedProvider = input.transport.sessionManager.getProvider();
          const providerModels = currentModels[storedProvider];
          let activeProvider: string | undefined;
          let activeModel: string | undefined;
          if (providerModels && providerModels.length > 0) {
            const storedModel = input.transport.sessionManager.getModel().trim();
            if (storedModel.length > 0 && providerModels.includes(storedModel)) {
              activeProvider = storedProvider;
              activeModel = storedModel;
            } else {
              input.transport.sessionManager.setModel("");
              input.transport.sessionManager.setProvider("");
            }
          } else if (providerModels && isGuiProviderModeless(storedProvider)) {
            activeProvider = storedProvider;
            input.transport.sessionManager.setModel("");
          } else {
            if (currentDiscovery.length > 0) {
              input.transport.sessionManager.setModel("");
              input.transport.sessionManager.setProvider("");
            }
          }
          const activeModelCapabilities = findProviderModelCapabilities(
            currentDiscovery,
            activeProvider,
            activeModel,
          );
          const guiAuthorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(
            buildGuiTurnPerCallConfig(
              activeProvider ?? "",
              activeModel,
              builtinToolSurface,
              activeModelCapabilities,
            ),
          );
          ws.send(JSON.stringify({
            type: "welcome",
            models: currentModels,
            providerDiscovery: currentDiscovery,
            providers: buildWelcomeProviderDescriptors(currentDiscovery),
            activeProvider,
            activeModel,
            planMode: input.transport.planMode ?? false,
            workingDirectory: input.transport.workingDirectory,
            domainLabel: input.transport.domainLabel,
            authorityStatus: guiAuthorityStatus,
          } satisfies GuiInboundFrame));
        },

        async onMessage(event: MessageEvent, ws: WSContext) {
          try {
            const raw = typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer);

            if (raw === "ping") {
              ws.send("pong");
              return;
            }

            const frame = JSON.parse(raw) as GuiOutboundFrame | Record<string, unknown>;

            if (frame.type === "operator_theme_set_result") {
              operatorThemeBridge.resolve(frame as Extract<GuiOutboundFrame, { type: "operator_theme_set_result" }>);
              return;
            }

            if (frame.type === "clear") {
              await sessionRegistry.detachActive(GUI_APP_NAME, userId, GUI_TENANT_ID);
              try {
                await input.transport.onClear?.();
              } catch {
                // fail-open for parity with tui gateway clear behavior
              }
              ws.send(JSON.stringify({ type: "cleared" } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "refresh_providers") {
              const currentDiscovery = await refreshDiscovery({ force: true });
              ws.send(JSON.stringify({
                type: "providers_refreshed",
                models: projectGuiOperatorModels(currentDiscovery),
                providerDiscovery: currentDiscovery,
                providers: buildWelcomeProviderDescriptors(currentDiscovery),
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "provider_auth") {
              guiProviderAuthDebug("received frame", {
                provider: typeof frame.provider === "string" ? frame.provider : null,
                requestId: typeof frame.requestId === "string" ? frame.requestId : null,
              });
              const auth = await startProviderAuthRequest(frame);
              if (!auth.ok) {
                guiProviderAuthDebug("request rejected", {
                  provider: auth.provider,
                  requestId: auth.requestId,
                  error: auth.error,
                });
                ws.send(JSON.stringify({
                  type: "provider_auth_failed",
                  provider: auth.provider,
                  requestId: auth.requestId,
                  message: auth.error,
                } satisfies GuiInboundFrame));
                return;
              }
              if (auth.started) {
                guiProviderAuthDebug("sending started frame", {
                  provider: auth.provider,
                  requestId: auth.requestId,
                  method: auth.method,
                });
                ws.send(JSON.stringify(auth.started satisfies GuiInboundFrame));
              }
              try {
                guiProviderAuthDebug("waiting for completion", {
                  provider: auth.provider,
                  requestId: auth.requestId,
                  method: auth.method,
                });
                await auth.complete();
              } catch (error) {
                guiProviderAuthDebug("completion failed", {
                  provider: auth.provider,
                  requestId: auth.requestId,
                  error: error instanceof Error ? error.message : String(error),
                });
                ws.send(JSON.stringify({
                  type: "provider_auth_failed",
                  provider: auth.provider,
                  requestId: auth.requestId,
                  message: error instanceof Error ? error.message : "Provider authentication failed.",
                } satisfies GuiInboundFrame));
                return;
              }
              guiProviderAuthDebug("completion succeeded; refreshing discovery", {
                provider: auth.provider,
                requestId: auth.requestId,
              });
              const currentDiscovery = await refreshDiscovery({ force: true });
              const providerDiscovery = currentDiscovery.find((entry) => entry.provider === auth.provider);
              guiProviderAuthDebug("discovery refreshed after auth", {
                provider: auth.provider,
                requestId: auth.requestId,
                available: providerDiscovery?.available,
                authState: providerDiscovery?.authState,
                reason: providerDiscovery?.reason,
                modelCount: projectGuiOperatorModels(currentDiscovery)[auth.provider]?.length ?? 0,
              });
              ws.send(JSON.stringify({
                type: "provider_auth_completed",
                provider: auth.provider,
                requestId: auth.requestId,
                models: projectGuiOperatorModels(currentDiscovery),
                providerDiscovery: currentDiscovery,
                providers: buildWelcomeProviderDescriptors(currentDiscovery),
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "provider") {
              const requestId = typeof frame.requestId === "string" && frame.requestId.trim().length > 0
                ? frame.requestId.trim()
                : undefined;
              if (!requestId) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Provider switch requestId is required",
                } satisfies GuiInboundFrame));
                return;
              }
              const currentDiscovery = discovery.length > 0 ? discovery : await refreshDiscovery();
              const resolution = resolveGuiProviderSwitch({
                provider: frame.provider,
                model: frame.model,
                discovery: currentDiscovery,
              });
              if (!resolution.ok) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: resolution.error,
                } satisfies GuiInboundFrame));
                return;
              }

              input.transport.sessionManager.setProvider(resolution.provider);
              input.transport.sessionManager.setModel(resolution.modelForSessionManager);
              fireAndForgetProviderSwitch(input.transport.onProviderSwitch, resolution.provider);
              const providerChangedFrame = {
                type: "provider_changed",
                provider: resolution.provider,
                requestId,
                ...(resolution.modelForAck ? { model: resolution.modelForAck } : {}),
              } satisfies GuiInboundFrame;
              ws.send(JSON.stringify(providerChangedFrame));
              return;
            }

            if (frame.type === "resume") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId.trim() : "";
              if (!sessionId) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume request must include sessionId",
                } satisfies GuiInboundFrame));
                return;
              }
              try {
                await applyResumeSelection(input.transport.onResumeSession, sessionId);
              } catch {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume selection failed",
                } satisfies GuiInboundFrame));
                return;
              }
              ws.send(JSON.stringify({
                type: "resume_selected",
                sessionId,
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "exec") {
              ws.send(JSON.stringify({ type: "exec_confirmed" } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "approve") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
              const result = approvalRegistry.approve(sessionId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Approval failed" } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "reject") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
              const reason = typeof frame.reason === "string" ? frame.reason : "rejected by user";
              const result = approvalRegistry.reject(reason, sessionId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Rejection failed" } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type !== "message") return;

            const userContent = typeof frame.content === "string"
              ? frame.content
              : "";
            const resumeSessionId = typeof frame.resumeSessionId === "string"
              ? frame.resumeSessionId.trim()
              : "";
            if (!userContent.trim()) return;

            if (resumeSessionId && input.transport.onResumeSession) {
              try {
                await applyResumeSelection(
                  input.transport.onResumeSession,
                  resumeSessionId,
                  input.transport.sessionManager.getProvider(),
                );
              } catch {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume selection failed",
                } satisfies GuiInboundFrame));
                return;
              }
            }

            ws.send(JSON.stringify({ type: "thinking" } satisfies GuiInboundFrame));
            let result;
            let turnDiscovery: readonly GuiProviderDiscoveryResult[] = [];
            try {
              const currentDiscovery = await refreshDiscovery();
              turnDiscovery = currentDiscovery;
              const activeProvider = input.transport.sessionManager.getProvider().trim();
              if (activeProvider.length === 0) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "No provider selected. Choose a provider before sending a message.",
                } satisfies GuiInboundFrame));
                return;
              }
              const activeDiscovery = currentDiscovery.find((entry) => entry.provider === activeProvider);
              const providerModels = activeDiscovery?.available ? activeDiscovery.models : undefined;
              if (!providerModels || (providerModels.length === 0 && !isGuiProviderModeless(activeProvider))) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: activeDiscovery?.reason ?? `Provider '${activeProvider}' is unavailable`,
                } satisfies GuiInboundFrame));
                return;
              }
              const storedModel = input.transport.sessionManager.getModel().trim();
              let activeModel = storedModel.length > 0 ? storedModel : undefined;
              if (providerModels.length === 0 && isGuiProviderModeless(activeProvider)) {
                if (activeModel) {
                  input.transport.sessionManager.setModel("");
                }
                activeModel = undefined;
              }
              if (providerModels.length > 0 && !activeModel) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: providerRequiresSelectedModelMessage(activeProvider),
                } satisfies GuiInboundFrame));
                return;
              }
              if (activeModel && !providerModels.includes(activeModel)) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: `Provider '${activeProvider}' does not advertise model '${activeModel}'`,
                } satisfies GuiInboundFrame));
                return;
              }
              const activeModelCapabilities = findProviderModelCapabilities(
                currentDiscovery,
                activeProvider,
                activeModel,
              );
              const reasoningEffort = resolveRequestedReasoningEffort(
                activeModelCapabilities,
                frame.reasoningEffort,
              );
              const turnBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface({
                builtinToolOptions: input.builtinToolOptions,
                operatorSurface: {
                  theme: {
                    setTheme: operatorThemeBridge.request,
                  },
                },
              });
              result = await processAdmittedTurn({
                orchestrator,
                sessionRegistry,
                appName: GUI_APP_NAME,
                tenantId: GUI_TENANT_ID,
                userId,
                sessionId: resumeSessionId || undefined,
                systemPrompt: input.transport.systemPrompt ?? "You are a helpful assistant.",
                userParts: textParts(userContent),
                channel: "gui",
                providerValidation: currentDiscovery,
                contextArtifactCache: input.transport.contextArtifactCache,
                callBuiltinTools: turnBuiltinToolSurface.callBuiltinTools,
                perCallConfig: buildGuiTurnPerCallConfig(
                  activeProvider,
                  activeModel,
                  turnBuiltinToolSurface,
                  activeModelCapabilities,
                  reasoningEffort,
                ),
                turnCapture: {
                  start: (sessionId, nextSequence) => {
                    activityStreamer.beginTurnCapture(sessionId, nextSequence);
                  },
                  finish: (sessionId) => activityStreamer.endTurnCapture(sessionId),
                  abort: (sessionId) => {
                    activityStreamer.endTurnCapture(sessionId);
                  },
                },
              });
            } catch (err) {
              ws.send(JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              } satisfies GuiInboundFrame));
              return;
            }

            if (!result.ok) {
              ws.send(JSON.stringify({
                type: "error",
                message: result.budgetDenied.message,
              } satisfies GuiInboundFrame));
              return;
            }
            const output = result.result;
            const runtimeContinuity = output.runtimeContinuity ?? { strategy: "none" };
            const routedProvider = output.routingDecision?.provider ?? input.transport.sessionManager.getProvider();
            const fallbackRoutedModel = isGuiProviderModeless(routedProvider)
              ? ""
              : input.transport.sessionManager.getModel();
            const routedModel = output.routingDecision?.model ?? fallbackRoutedModel;
            const routedModelCapabilities = findProviderModelCapabilities(
              turnDiscovery.length > 0 ? turnDiscovery : discovery,
              routedProvider,
              routedModel || undefined,
            );

            ws.send(JSON.stringify({
              type: "done",
              content: extractText(output.parts),
              parts: output.parts,
              inputTokens: output.inputTokens,
              outputTokens: output.outputTokens,
              routedProvider,
              routedModel,
              runtimeContinuity,
              authorityStatus: deriveGuiAuthorityStatusFromPerCallConfig(
                buildGuiTurnPerCallConfig(
                  routedProvider,
                  routedModel || undefined,
                  createAttachedRuntimeBuiltinToolSurface({
                    builtinToolOptions: input.builtinToolOptions,
                    operatorSurface: {
                      theme: {
                        setTheme: operatorThemeBridge.request,
                      },
                    },
                  }),
                  routedModelCapabilities,
                ),
              ),
            } satisfies GuiInboundFrame));
          } catch {
            // discard malformed frames
          }
        },

        onClose(_event: CloseEvent, ws: WSContext) {
          if (operatorSocket === ws) {
            operatorSocket = null;
          }
          unsubscribeDiscovery?.();
          unsubscribeDiscovery = undefined;
          if (activeOperatorSurface?.theme.setTheme === operatorThemeBridge.request) {
            activeOperatorSurface = undefined;
          }
          input.onSocketClose?.();
          operatorThemeBridge.rejectAll("Operator surface disconnected before applying the theme.");
          activityStreamer.unregister(ws);
        },
      };
    }),
  );

  input.onReady(`ws://localhost:${input.port}/gui/ws`);
}

function fireAndForgetProviderSwitch(onProviderSwitch: OnProviderSwitch | undefined, provider: string): void {
  if (!onProviderSwitch) return;
  Promise.resolve(onProviderSwitch(provider)).catch(() => {
    // parity with clear behavior: provider switch errors should not tear down transport
  });
}

export function buildGuiTurnPerCallConfig(
  activeProvider: string,
  activeModel: string | undefined,
  builtinToolSurface: AttachedRuntimeBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface(),
  activeModelCapabilities?: GuiProviderModelCapabilities,
  reasoningEffort?: ReasoningEffort,
): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: GUI_TENANT_ID,
    activeProvider,
    activeModel,
    ...(activeModelCapabilities ? { activeModelCapabilities } : {}),
    reasoningEffort,
    builtinToolSurface,
  });
}

function resolveRequestedReasoningEffort(
  activeModelCapabilities: GuiProviderModelCapabilities | undefined,
  requested: unknown,
): ReasoningEffort | undefined {
  if (typeof requested !== "string") return undefined;
  if (
    requested !== "minimal"
    && requested !== "low"
    && requested !== "medium"
    && requested !== "high"
    && requested !== "xhigh"
  ) {
    throw new Error(`Unknown reasoning effort '${requested}'.`);
  }
  const supported = activeModelCapabilities?.supportedReasoningEfforts;
  if (supported && !supported.includes(requested as GuiProviderReasoningEffort)) {
    throw new Error(`Reasoning effort '${requested}' is not supported by the selected model.`);
  }
  return requested as ReasoningEffort;
}

function findProviderModelCapabilities(
  discovery: readonly GuiProviderDiscoveryResult[],
  provider: string | undefined,
  model: string | undefined,
): GuiProviderModelCapabilities | undefined {
  if (!provider || !model) return undefined;
  return discovery.find((entry) => entry.provider === provider)?.modelCapabilities?.[model];
}

async function applyResumeSelection(
  onResumeSession: OnResumeSession | undefined,
  sessionId: string,
  provider?: string,
): Promise<void> {
  if (!onResumeSession) {
    throw new Error("resume selection unsupported");
  }
  await onResumeSession(sessionId, provider);
}

class GuiActivityStreamer {
  private readonly pendingApprovals = new Set<string>();
  private capture: {
    sessionId: string;
    nextSequence: number;
    toolOrdinal: number;
    approvalOrdinal: number;
    pendingToolCallIds: Map<string, string[]>;
    pendingApprovalIds: string[];
    assistantMessageId: string;
    fileChanges: RuntimeTurnFileChange[];
    approvalTransitions: RuntimeTurnApprovalTransition[];
    authorityDecisions: RuntimeTurnAuthorityDecision[];
  } | null = null;
  private ws: WSContext | null = null;
  private eventBus: EventBus | null = null;
  private approvalHandler: ((event: KilnEvent) => void) | null = null;
  private receivedHandler: ((event: KilnEvent) => void) | null = null;
  private modelRoutedHandler: ((event: KilnEvent) => void) | null = null;
  private authorizedHandler: ((event: KilnEvent) => void) | null = null;
  private approvalBridge: {
    approve: (sessionId: string) => void;
    reject: (sessionId: string, reason: string) => void;
  } | null = null;

  constructor(private readonly approvalRegistry: ApprovalGateRegistry) {}

  bindApprovalBridge(bridge: {
    approve: (sessionId: string) => void;
    reject: (sessionId: string, reason: string) => void;
  }): void {
    this.approvalBridge = bridge;
  }

  beginTurnCapture(sessionId: string, nextSequence: number): void {
    this.capture = {
      sessionId,
      nextSequence,
      toolOrdinal: 0,
      approvalOrdinal: 0,
      pendingToolCallIds: new Map<string, string[]>(),
      pendingApprovalIds: [],
      assistantMessageId: `${sessionId}:live:assistant`,
      fileChanges: [],
      approvalTransitions: [],
      authorityDecisions: [],
    };
  }

  endTurnCapture(sessionId: string): {
    fileChanges: readonly RuntimeTurnFileChange[];
    approvalTransitions: readonly RuntimeTurnApprovalTransition[];
    authorityDecisions: readonly RuntimeTurnAuthorityDecision[];
  } {
    if (!this.capture || this.capture.sessionId !== sessionId) {
      return { fileChanges: [], approvalTransitions: [], authorityDecisions: [] };
    }
    const captured = {
      fileChanges: [...this.capture.fileChanges],
      approvalTransitions: [...this.capture.approvalTransitions],
      authorityDecisions: [...this.capture.authorityDecisions],
    };
    this.capture = null;
    return captured;
  }

  private nextLiveSequence(): number | null {
    if (!this.capture) {
      return null;
    }
    const sequence = this.capture.nextSequence;
    this.capture.nextSequence += 1;
    return sequence;
  }

  private emitSessionEvent(input: {
    kind: "assistant_delta" | "provider_routed" | "tool_call_started" | "tool_call_completed" | "approval_requested" | "approval_resolved" | "file_changed" | "cost_updated";
    timestamp: string;
    payload: Record<string, unknown>;
  }): void {
    if (!this.ws || !this.capture) {
      return;
    }
    const sequence = this.nextLiveSequence();
    if (sequence === null) {
      return;
    }
    this.ws.send(JSON.stringify({
      type: "session_event",
      event: {
        eventId: `${this.capture.sessionId}:live:${sequence}`,
        kilnSessionId: this.capture.sessionId,
        sequence,
        timestamp: input.timestamp,
        kind: input.kind,
        turnId: `${this.capture.sessionId}:turn:live`,
        source: {
          actor: input.kind === "assistant_delta" ? "assistant" : input.kind.startsWith("tool_") ? "tool" : "runtime",
          surface: "gui",
          component: "gui-gateway",
        },
        payload: input.payload,
      },
    } satisfies GuiInboundFrame));
  }

  private emitActivityPhase(input: {
    phase: "idle" | "thinking" | "tool_running" | "awaiting_approval" | "streaming";
    sessionId?: string;
    toolName?: string;
    details?: string;
  }): void {
    if (!this.ws) {
      return;
    }
    const sessionId = input.sessionId ?? this.capture?.sessionId;
    if (!sessionId) {
      return;
    }
    this.ws.send(JSON.stringify({
      type: "activity_phase",
      kilnSessionId: sessionId,
      ...(this.capture?.sessionId === sessionId ? { turnId: `${sessionId}:turn:live` } : {}),
      phase: input.phase,
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(input.details ? { details: input.details } : {}),
    } satisfies GuiInboundFrame));
  }

  register(ws: WSContext, eventBus?: EventBus): void {
    this.ws = ws;
    this.eventBus = eventBus ?? null;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.eventBus) return;

    this.approvalHandler = (event: KilnEvent) => {
      if (event.type === "approval_requested") {
        const approvalEvent = event as unknown as ApprovalRequestedEvent;
        const sessionId = approvalEvent.sessionId;
        if (sessionId) {
          this.pendingApprovals.add(sessionId);
          if (this.capture && this.capture.sessionId === sessionId) {
            const approvalId = `${sessionId}:live:approval:${++this.capture.approvalOrdinal}`;
            this.capture.pendingApprovalIds.push(approvalId);
            this.capture.approvalTransitions.push({
              status: "requested",
              sessionId,
              reason: approvalEvent.description,
            });
            this.emitSessionEvent({
              kind: "approval_requested",
              timestamp: approvalEvent.timestamp.toISOString(),
              payload: {
                approvalId,
                action: approvalEvent.description,
                justification: approvalEvent.description,
              },
            });
          }
          this.approvalRegistry.register(sessionId, {
            approve: () => this.approvalBridge?.approve(sessionId),
            reject: (reason: string) => this.approvalBridge?.reject(sessionId, reason),
            status: () => (this.pendingApprovals.has(sessionId) ? "awaiting_approval" : "resolved"),
          });
        }
        this.emitActivityPhase({
          phase: "awaiting_approval",
          sessionId,
          details: approvalEvent.description,
        });
      }
    };
    this.eventBus.onAny(this.approvalHandler);

    this.receivedHandler = (event: KilnEvent) => {
      if (event.type === "approval_received") {
        const receivedEvent = event as unknown as ApprovalReceivedEvent;
        const sessionId = receivedEvent.sessionId;
        if (sessionId) {
          this.pendingApprovals.delete(sessionId);
          if (this.capture && this.capture.sessionId === sessionId) {
            const approvalId = this.capture.pendingApprovalIds.shift() ?? `${sessionId}:live:approval:${++this.capture.approvalOrdinal}`;
            this.capture.approvalTransitions.push({
              status: receivedEvent.approved ? "approved" : "rejected",
              sessionId,
              reason: receivedEvent.reason,
            });
            this.emitSessionEvent({
              kind: "approval_resolved",
              timestamp: receivedEvent.timestamp.toISOString(),
              payload: {
                approvalId,
                resolution: {
                  decision: receivedEvent.approved ? "approved" : "denied",
                  resolvedBy: "operator",
                  reason: receivedEvent.reason,
                },
              },
            });
          }
          this.approvalRegistry.unregister(sessionId);
        }
        this.emitActivityPhase({ phase: "idle", sessionId });
      }
    };
    this.eventBus.onAny(this.receivedHandler);

    this.modelRoutedHandler = (event: KilnEvent) => {
      if (event.type === "model_routed") {
        const routedEvent = event as unknown as ModelRoutedEvent;
        const sessionId = routedEvent.sessionId;
        if (this.capture && sessionId === this.capture.sessionId) {
          this.emitSessionEvent({
            kind: "provider_routed",
            timestamp: routedEvent.timestamp.toISOString(),
            payload: {
              provider: {
                provider: routedEvent.provider,
                model: routedEvent.model,
              },
              reason: routedEvent.reason,
            },
          });
        }
      }
    };
    this.eventBus.onAny(this.modelRoutedHandler);

    this.authorizedHandler = (event: KilnEvent) => {
      if (event.type === "tool_authorized") {
        const authorizedEvent = event as ToolAuthorizedEvent;
        const sessionId = authorizedEvent.sessionId;
        if (sessionId && this.capture && this.capture.sessionId === sessionId) {
          this.capture.authorityDecisions.push({
            toolName: authorizedEvent.toolName,
            level: authorizedEvent.level,
            allowed: authorizedEvent.allowed,
            reason: authorizedEvent.reason,
          });
        }
      }
    };
    this.eventBus.onAny(this.authorizedHandler);
  }

  unregister(ws: WSContext): void {
    if (this.ws === ws) {
      this.ws = null;
    }
    if (this.eventBus && this.approvalHandler) {
      this.eventBus.offAny(this.approvalHandler);
      this.approvalHandler = null;
    }
    if (this.eventBus && this.receivedHandler) {
      this.eventBus.offAny(this.receivedHandler);
      this.receivedHandler = null;
    }
    if (this.eventBus && this.modelRoutedHandler) {
      this.eventBus.offAny(this.modelRoutedHandler);
      this.modelRoutedHandler = null;
    }
    if (this.eventBus && this.authorizedHandler) {
      this.eventBus.offAny(this.authorizedHandler);
      this.authorizedHandler = null;
    }
    this.eventBus = null;
    this.capture = null;
  }

  forward(event: CliSessionEvent): void {
    if (!this.ws) return;

    if (event.type === "text_delta") {
      if (event.isThinking) {
        this.emitActivityPhase({
          phase: "thinking",
          details: event.content,
        });
        return;
      }
      this.emitSessionEvent({
        kind: "assistant_delta",
        timestamp: new Date().toISOString(),
        payload: {
          messageId: this.capture?.assistantMessageId ?? "assistant-live",
          delta: event.content,
        },
      });
    } else if (event.type === "tool_use") {
      const toolCallId = this.capture
        ? `${this.capture.sessionId}:live:tool:${++this.capture.toolOrdinal}`
        : `${event.toolName ?? "tool"}_${Date.now()}`;
      if (this.capture) {
        const pending = this.capture.pendingToolCallIds.get(event.toolName) ?? [];
        pending.push(toolCallId);
        this.capture.pendingToolCallIds.set(event.toolName, pending);
      }
      this.emitSessionEvent({
        kind: "tool_call_started",
        timestamp: new Date().toISOString(),
        payload: {
          toolCallId,
          toolName: event.toolName ?? "unknown",
          input: (event.input && typeof event.input === "object" ? event.input : {}) as Record<string, unknown>,
        },
      });
      this.emitActivityPhase({
        phase: "tool_running",
        toolName: event.toolName,
      });
    } else if (event.type === "tool_result") {
      const pending = this.capture?.pendingToolCallIds.get(event.toolName);
      const toolCallId = pending?.shift()
        ?? (this.capture ? `${this.capture.sessionId}:live:tool:${++this.capture.toolOrdinal}` : `${event.toolName ?? "tool"}_${Date.now()}`);
      if (pending && pending.length === 0 && this.capture) {
        this.capture.pendingToolCallIds.delete(event.toolName);
      }
      this.emitSessionEvent({
        kind: "tool_call_completed",
        timestamp: new Date().toISOString(),
        payload: {
          toolCallId,
          toolName: event.toolName ?? "unknown",
          outputSummary: event.output ?? "",
          status: {
            state: "succeeded",
          },
        },
      });
      this.emitActivityPhase({ phase: "idle" });
    } else if (event.type === "file_changed") {
      if (this.capture) {
        this.capture.fileChanges.push({
          path: event.path,
          changeType: event.changeType,
          linesAdded: event.linesAdded,
          linesRemoved: event.linesRemoved,
          diffPreview: event.diffPreview,
          diffTruncated: event.diffTruncated,
        });
      }
      this.emitSessionEvent({
        kind: "file_changed",
        timestamp: new Date().toISOString(),
        payload: {
          change: {
            path: event.path,
            changeType: event.changeType === "modified" ? "updated" : event.changeType,
            linesAdded: event.linesAdded,
            linesRemoved: event.linesRemoved,
            diffPreview: event.diffPreview,
            diffTruncated: event.diffTruncated,
          },
        },
      });
    } else if (event.type === "cost_update") {
      this.emitSessionEvent({
        kind: "cost_updated",
        timestamp: new Date().toISOString(),
        payload: {
          provider: {
            provider: event.provider ?? "unknown",
            model: event.model ?? event.canonicalModel ?? "unknown",
            canonicalModel: event.canonicalModel,
            billingMode: event.billingMode,
          },
          usage: {
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
            cacheReadTokens: event.cacheReadTokens ?? 0,
          },
          cost: {
            deltaUsd: event.usd,
            currency: "USD",
          },
        },
      });
    }
  }
}
