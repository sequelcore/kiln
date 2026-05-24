import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { WSContext } from "hono/ws";
import {
  createSessionBuiltinToolOptions,
  EventBus,
  extractText,
  type ApprovalReceivedEvent,
  type ApprovalRequestedEvent,
  type CanonicalSessionEvent,
  type ContentPart,
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
import { processAdmittedTurn, sanitizeAssistantEgressText } from "./message-pipeline.js";
import { synthesizeVoiceOutputOnDemand } from "./voice-output-synthesizer.js";
import type {
  RuntimeTurnApprovalTransition,
  RuntimeTurnAuthorityDecision,
  RuntimeTurnFileChange,
  RuntimeTurnToolCompletion,
} from "../session/runtime-turn-record.js";
import type { OnProviderSwitch, OnResumeSession, OperatorSessionTransportOptions } from "./operator-gateway.js";
import {
  mountGuiStaticAssets,
  resolveGuiDistPath,
} from "./gui-static-assets.js";
import {
  buildWelcomeProviderDescriptors,
  markGuiProviderDiscoveryStale,
  projectGuiOperatorModels,
  providerRequiresSelectedModelMessage,
  resolveGuiOperatorDiscoveryResults,
  resolveGuiProviderSwitch,
} from "./gui-provider-models.js";
import { guiOutboundMessageParts } from "./gui-frame-parts.js";
import { createProviderCatalogService } from "./provider-catalog-service.js";
import { startProviderAuthRequest } from "./provider-auth.js";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  resolveAttachedRuntimeToolCallMetadata,
  type AttachedRuntimeBuiltinToolSurface,
} from "./attached-runtime-tool-surface.js";
import {
  attachManagedInvocationSessionEventSink,
  type ManagedInvocationToolOptions,
} from "../agents/managed-invocation/runtime-tool.js";
import { appendManagedInvocationTerminalSessionEvent } from "../agents/managed-invocation/session-events.js";
import { createOperatorThemeBridge } from "./operator-theme-bridge.js";
import { toOperatorSessionEventFrame } from "./operator-session-event-frame.js";
import { approvePlanExecutionTransition } from "./plan-approval-transition.js";
import { projectMemoryLatticeInvalidationFrame } from "./gui-memory-lattice-events.js";
import { createGuiMemoryLatticeRoutes } from "./gui-memory-lattice.js";
import { projectInteractiveUseFrameFromToolResult } from "./interactive-use-frame.js";
import {
  KilnConfigSetupActionRequestSchema,
  KilnConfigSetupActionResultSchema,
  isGuiProviderModeless,
  isOperatorThemeName,
  type GuiDashboardSnapshot,
  type GuiBrowserOperatorInput,
  type GuiBrowserOperatorInputAckFrame,
  type GuiBrowserSessionState,
  type GuiInboundFrame,
  type GuiManagedAgentControlAction,
  type GuiOutboundFrame,
  type GuiProviderDiscoveryResult,
  type GuiProviderModelCapabilities,
  type GuiProviderModelRouteHealth,
  type GuiProviderReasoningEffort,
  type GuiAuthorityStatus,
  type KilnConfigSetupAction,
  type KilnConfigSetupActionResult,
  type KilnConfigSetupSnapshot,
  type GuiMemoryLatticeScope,
  type GuiSessionDetail,
  type GuiSessionSummary,
  type OperatorExecutionMode,
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
const GUI_OPERATOR_COCKPIT_INSTANCE_ID = "local-gui";

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
  readonly getSetupSnapshot?: () => Promise<KilnConfigSetupSnapshot>;
  readonly executeSetupAction?: (action: KilnConfigSetupAction) => Promise<KilnConfigSetupActionResult>;
  readonly getProviderAvailability?: () => Promise<Record<string, boolean>> | Record<string, boolean>;
  readonly initialOperatorDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly onOperatorDiscoveryResolved?: (discovery: readonly GuiProviderDiscoveryResult[]) => void;
  readonly listSessions?: () => Promise<readonly GuiSessionSummary[]>;
  readonly getSessionDetail?: (sessionId: string) => Promise<GuiSessionDetail | null>;
  readonly workingDirectory?: string;
  readonly domainLabel?: string;
  readonly workspaceExplorer?: OperatorWorkspaceExplorer;
  readonly updateThemePreference?: (theme: string) => Promise<void> | void;
  readonly resolveProviderPreference?: () => OperatorProviderPreference | null | undefined;
  readonly updateProviderPreference?: (selection: OperatorProviderPreference) => Promise<void> | void;
  readonly onConnectionCountChange?: (count: number) => void;
  readonly onManagedWindowClose?: () => void;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly operatorTransport?: OperatorSessionTransportOptions;
  readonly managedInvocation?: ManagedInvocationToolOptions;
  readonly memoryLatticeDefaultScope?: GuiMemoryLatticeScope;
}

export interface OperatorProviderPreference {
  readonly provider: string;
  readonly model?: string | null;
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
type OperatorTurnRequestedAuthority = Extract<GuiOutboundFrame, { type: "message" }>["requestedAuthority"];

interface BrowserSessionUpdateHandlerConsumer {
  setBrowserSessionUpdateHandler(handler: ((state: Omit<GuiBrowserSessionState, "kilnSessionId">) => void) | undefined): void;
}

interface BrowserSessionControlConsumer {
  requestBrowserSessionControl(request: {
    readonly action: "takeover" | "release";
    readonly sessionId?: string;
    readonly operatorId?: string;
    readonly reason?: string;
  }): Promise<Omit<GuiBrowserSessionState, "kilnSessionId">>;
}

interface BrowserOperatorInputConsumer {
  requestBrowserOperatorInput(request: {
    readonly requestId: string;
    readonly sessionId: string;
    readonly operatorId?: string;
    readonly input: GuiBrowserOperatorInput;
  }): Promise<Omit<GuiBrowserOperatorInputAckFrame, "type">>;
}

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

export function deriveGuiAuthorityStatusFromPerCallConfig(
  config: PerCallToolConfig,
): GuiAuthorityStatus {
  if (config.effectiveTurnAuthority) {
    const authority = config.effectiveTurnAuthority;
    return {
      effective: authority.admittedAuthority,
      admittedAuthority: authority.admittedAuthority,
      requestedAuthority: authority.requestedAuthority,
      executionMode: authority.executionMode,
      ...(authority.sandboxProjection ? { sandboxProjection: authority.sandboxProjection } : {}),
      reason: authority.reason,
      toolCount: authority.toolCount,
      deniedToolCount: authority.deniedToolCount,
      ...(authority.policyInputs ? { policyInputs: authority.policyInputs } : {}),
      completeness: authority.completeness,
    };
  }
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

function bindBrowserSessionUpdateHandler(
  builtinToolOptions: DefaultBuiltinToolRegistryOptions | undefined,
  handler: (state: Omit<GuiBrowserSessionState, "kilnSessionId">) => void,
): void {
  const provider = builtinToolOptions?.browserUse?.provider;
  if (!isBrowserSessionUpdateHandlerConsumer(provider)) {
    return;
  }
  provider.setBrowserSessionUpdateHandler(handler);
}

function isBrowserSessionUpdateHandlerConsumer(value: unknown): value is BrowserSessionUpdateHandlerConsumer {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as { setBrowserSessionUpdateHandler?: unknown }).setBrowserSessionUpdateHandler === "function",
  );
}

function getBrowserSessionControlConsumer(
  builtinToolOptions: DefaultBuiltinToolRegistryOptions | undefined,
): BrowserSessionControlConsumer | undefined {
  const provider = builtinToolOptions?.browserUse?.provider;
  return isBrowserSessionControlConsumer(provider) ? provider : undefined;
}

function getBrowserOperatorInputConsumer(
  builtinToolOptions: DefaultBuiltinToolRegistryOptions | undefined,
): BrowserOperatorInputConsumer | undefined {
  const provider = builtinToolOptions?.browserUse?.provider;
  return isBrowserOperatorInputConsumer(provider) ? provider : undefined;
}

function isBrowserSessionControlConsumer(value: unknown): value is BrowserSessionControlConsumer {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as { requestBrowserSessionControl?: unknown }).requestBrowserSessionControl === "function",
  );
}

function isBrowserOperatorInputConsumer(value: unknown): value is BrowserOperatorInputConsumer {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as { requestBrowserOperatorInput?: unknown }).requestBrowserOperatorInput === "function",
  );
}

function isManagedAgentControlAction(value: unknown): value is GuiManagedAgentControlAction {
  return value === "cancel" || value === "join";
}

function findManagedInvocationTerminalSessionEvents(
  events: readonly CanonicalSessionEvent[],
  invocationId: string,
): readonly CanonicalSessionEvent[] {
  const terminal = [...events]
    .reverse()
    .find((event) =>
      "invocationId" in event &&
      event.invocationId === invocationId &&
      (
        event.kind === "agent_invocation_completed" ||
        event.kind === "agent_invocation_failed" ||
        event.kind === "agent_invocation_cancelled"
      )
    );
  return terminal ? [terminal] : [];
}

function managedAgentControlResult(input: {
  readonly action: GuiManagedAgentControlAction;
  readonly sessionId: string;
  readonly invocationId: string;
  readonly status: "accepted" | "failed";
  readonly reason?: string;
  readonly requestId?: string;
}): GuiInboundFrame {
  return {
    type: "managed_agent_control_result",
    action: input.action,
    sessionId: input.sessionId,
    invocationId: input.invocationId,
    status: input.status,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    handledAt: new Date().toISOString(),
  };
}

export function deriveGuiDoneAuthorityStatus(
  turnPerCallConfig: PerCallToolConfig | undefined,
  fallbackPerCallConfig: PerCallToolConfig = buildGuiPerCallToolConfig(),
): GuiAuthorityStatus {
  return deriveGuiAuthorityStatusFromPerCallConfig(turnPerCallConfig ?? fallbackPerCallConfig);
}

export async function startGuiGateway(options: StartGuiGatewayOptions): Promise<GuiGateway> {
  const port = options.port ?? 4810;
  const builtinToolOptions = createSessionBuiltinToolOptions(options.builtinToolOptions);
  const memoryLatticeResources = createAttachedRuntimeBuiltinToolSurface({ builtinToolOptions });
  const app = new Hono();
  const guiDistPath = resolveGuiDistPath(options.guiDistPath);
  mountGuiStaticAssets(app, guiDistPath);
  const hasMountedGui = true;
  const transportOptions = options.operatorTransport;
  let activeConnections = 0;

  const { upgradeWebSocket, websocket } = (await loadBunHonoAdapters()).createBunWebSocket();
  const operatorCatalog = transportOptions
    ? createProviderCatalogService<readonly GuiProviderDiscoveryResult[]>(
      () => resolveOperatorDiscovery(options.getProviderAvailability),
      [],
      {
        initialDiscovery: options.initialOperatorDiscovery
          ? markGuiProviderDiscoveryStale(options.initialOperatorDiscovery)
          : undefined,
        onDiscoveryResolved: options.onOperatorDiscoveryResolved,
      },
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

  const guiCorsMiddleware = async (c: Context, next: Next): Promise<Response | void> => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type, Accept");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  };

  app.use("/health", guiCorsMiddleware);
  app.use("/gui-api/*", guiCorsMiddleware);
  app.use("/gui/api/*", guiCorsMiddleware);

  app.get("/health", (c) => c.json({ status: "ok", channel: "gui", connections: activeConnections }));
  app.get("/gui-api/health", (c) => c.json({ status: "ok", channel: "gui", connections: activeConnections }));
  app.route("/gui/api", createGuiMemoryLatticeRoutes({
    resources: memoryLatticeResources,
    ...(options.memoryLatticeDefaultScope ? { defaultScope: options.memoryLatticeDefaultScope } : {}),
  }));

  app.get("/gui/api/dashboard", async (c) => {
    const nextDiscovery = getOperatorDiscoverySnapshot();
    operatorCatalog?.startBackgroundRefresh();
    const snapshot = await options.getSnapshot({
      operatorModels: projectGuiOperatorModels(nextDiscovery),
      operatorDiscovery: nextDiscovery,
    });
    return c.json(snapshot);
  });

  app.get("/gui/api/config/setup", async (c) => {
    if (!options.getSetupSnapshot) {
      return c.json({ error: "setup_status_unavailable" }, 404);
    }
    return c.json(await options.getSetupSnapshot());
  });

  app.post("/gui/api/config/setup/actions", async (c) => {
    if (!options.executeSetupAction) {
      return c.json({ error: "setup_action_unavailable" }, 404);
    }
    const parsed = KilnConfigSetupActionRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_setup_action" }, 400);
    }
    const result = await options.executeSetupAction(parsed.data.action);
    return c.json(KilnConfigSetupActionResultSchema.parse(result));
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
      builtinToolOptions,
      managedInvocation: options.managedInvocation,
      resolveProviderPreference: options.resolveProviderPreference,
      updateProviderPreference: options.updateProviderPreference,
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
            executionMode: "execute",
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

function resolveOperatorActiveProviderSelection(input: {
  readonly transport: OperatorSessionTransportOptions;
  readonly discovery: readonly GuiProviderDiscoveryResult[];
  readonly preference?: OperatorProviderPreference | null;
}): { readonly provider?: string; readonly model?: string } {
  const currentProvider = input.transport.sessionManager.getProvider().trim();
  const currentModel = input.transport.sessionManager.getModel().trim();
  if (currentProvider.length > 0) {
    const currentResolution = resolveGuiProviderSwitch({
      provider: currentProvider,
      model: currentModel.length > 0 ? currentModel : undefined,
      discovery: input.discovery,
    });
    if (currentResolution.ok) {
      return {
        provider: currentResolution.provider,
        ...(currentResolution.modelForAck ? { model: currentResolution.modelForAck } : {}),
      };
    }
  }

  const preferredProvider = input.preference?.provider?.trim();
  const preferredModel = typeof input.preference?.model === "string" ? input.preference.model.trim() : "";
  if (preferredProvider) {
    const preferredResolution = resolveGuiProviderSwitch({
      provider: preferredProvider,
      model: preferredModel.length > 0 ? preferredModel : undefined,
      discovery: input.discovery,
    });
    if (preferredResolution.ok) {
      input.transport.sessionManager.setProvider(preferredResolution.provider);
      input.transport.sessionManager.setModel(preferredResolution.modelForSessionManager);
      return {
        provider: preferredResolution.provider,
        ...(preferredResolution.modelForAck ? { model: preferredResolution.modelForAck } : {}),
      };
    }
  }

  if (input.discovery.length > 0) {
    input.transport.sessionManager.setModel("");
    input.transport.sessionManager.setProvider("");
  }
  return {};
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
    managedInvocation?: ManagedInvocationToolOptions;
    resolveProviderPreference?: () => OperatorProviderPreference | null | undefined;
    updateProviderPreference?: (selection: OperatorProviderPreference) => Promise<void> | void;
    onReady: (wsUrl: string) => void;
    onSocketOpen?: () => void;
    onSocketClose?: () => void;
  },
): void {
  const providerLabel = input.transport.sessionManager.getProvider();
  const approvalRegistry = new ApprovalGateRegistry();
  const builtinToolSurface = createAttachedRuntimeBuiltinToolSurface({
    builtinToolOptions: input.builtinToolOptions,
    managedInvocation: input.managedInvocation,
  });
  const resourceSurfaces: AttachedRuntimeBuiltinToolSurface[] = [builtinToolSurface];
  const rememberToolSurface = (surface: AttachedRuntimeBuiltinToolSurface): void => {
    resourceSurfaces.unshift(surface);
    resourceSurfaces.splice(8);
  };
  const activityStreamer = new GuiActivityStreamer(approvalRegistry, builtinToolSurface.toolCallMetadata);
  bindBrowserSessionUpdateHandler(input.builtinToolOptions, (state) => activityStreamer.forwardBrowserSessionState(state));
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
    approve: (approvalId) => orchestrator.continue(approvalId),
    reject: (approvalId, reason) => orchestrator.emitApprovalReceived(false, reason, approvalId),
  });

  app.get("/gui/api/resources/content", async (c) => {
    const uri = c.req.query("uri");
    if (!uri) {
      return c.json({ error: "resource_uri_required" }, 400);
    }
    for (const surface of resourceSurfaces) {
      const result = await surface.readResource(uri).catch(() => undefined);
      const content = result?.contents[0];
      if (!content) {
        continue;
      }
      if ("blob" in content) {
        return c.json({
          uri: content.uri,
          mimeType: content.mimeType,
          dataUrl: `data:${content.mimeType ?? "application/octet-stream"};base64,${content.blob}`,
        });
      }
      return c.json({
        uri: content.uri,
        mimeType: content.mimeType,
        text: content.text,
      });
    }
    return c.json({ error: "resource_not_found" }, 404);
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
      const voiceSynthesisSources = new Map<string, { readonly parts: readonly ContentPart[]; readonly sessionId: string }>();
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
          const activeSelection = resolveOperatorActiveProviderSelection({
            transport: input.transport,
            discovery: currentDiscovery,
            preference: input.resolveProviderPreference?.() ?? null,
          });
          const activeProvider = activeSelection.provider;
          const activeModel = activeSelection.model;
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
            executionMode: input.transport.executionMode ?? "execute",
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
              await input.updateProviderPreference?.({
                provider: resolution.provider,
                model: resolution.modelForAck ?? null,
              });
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

            if (frame.type === "execution_mode_transition") {
              const toMode = resolveExecutionMode(frame.toMode);
              if (toMode === "execute") {
                const transition = await approvePlanExecutionTransition({
                  surfaces: resourceSurfaces,
                  planId: typeof frame.planId === "string" ? frame.planId : undefined,
                  sessionRegistry,
                  appName: GUI_APP_NAME,
                  tenantId: GUI_TENANT_ID,
                  userId,
                  sourceSurface: "gui",
                  component: "gui-gateway",
                  residualRiskAcknowledged: typeof frame.residualRiskAcknowledged === "boolean"
                    ? frame.residualRiskAcknowledged
                    : true,
                  residualRiskAcknowledgement: typeof frame.residualRiskAcknowledgement === "string"
                    ? frame.residualRiskAcknowledgement
                    : "Operator requested execute mode from the GUI after reviewing the current plan.",
                });
                if (!transition.ok) {
                  ws.send(JSON.stringify({
                    type: "error",
                    code: transition.code,
                    message: transition.message,
                  } satisfies GuiInboundFrame));
                  return;
                }
                activityStreamer.forwardSessionEvents([transition.event]);
                ws.send(JSON.stringify(transition.frame satisfies GuiInboundFrame));
                return;
              }
              ws.send(JSON.stringify({
                type: "execution_mode_transitioned",
                executionMode: toMode,
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "managed_agent_control") {
              const action = isManagedAgentControlAction(frame.action) ? frame.action : undefined;
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId.trim() : "";
              const invocationId = typeof frame.invocationId === "string" ? frame.invocationId.trim() : "";
              const requestId = typeof frame.requestId === "string" && frame.requestId.trim().length > 0
                ? frame.requestId.trim()
                : undefined;
              const reason = typeof frame.reason === "string" && frame.reason.trim().length > 0
                ? frame.reason.trim()
                : "Operator cancelled the managed child from the GUI cockpit.";
              const fail = (failureReason: string): void => {
                ws.send(JSON.stringify(managedAgentControlResult({
                  action: action ?? "cancel",
                  sessionId: sessionId || "unknown-session",
                  invocationId: invocationId || "unknown-invocation",
                  status: "failed",
                  reason: failureReason,
                  ...(requestId ? { requestId } : {}),
                })));
              };

              if (!action) {
                fail("Managed agent control action must be cancel or join.");
                return;
              }
              if (!sessionId || !invocationId) {
                fail("Managed agent control requires sessionId and invocationId.");
                return;
              }
              const invocationService = input.managedInvocation?.invocationService;
              if (!invocationService) {
                fail("Managed agent control requires a live invocation service.");
                return;
              }
              const snapshot = invocationService.status(invocationId);
              if (!snapshot) {
                fail("Managed agent invocation is not registered in the live runtime.");
                return;
              }
              if (snapshot.parentSessionId !== sessionId) {
                fail("Managed agent invocation does not belong to the requested session.");
                return;
              }
              const session = await sessionRegistry.getById(sessionId);
              if (!session) {
                fail("Managed agent control requires an active runtime session.");
                return;
              }

              try {
                if (action === "cancel") {
                  await invocationService.cancel(invocationId, reason);
                }
                const terminalResult = await invocationService.join(invocationId);
                if (terminalResult.status !== "completed") {
                  fail(`Managed agent ${action} did not produce terminal evidence.`);
                  return;
                }
                const terminalSnapshot = invocationService.status(invocationId);
                const events = appendManagedInvocationTerminalSessionEvent({
                  session,
                  request: snapshot.request,
                  record: terminalResult.record,
                  durationMs: terminalSnapshot?.durationMs ?? snapshot.durationMs,
                });
                const terminalEvents = events.length > 0
                  ? events
                  : findManagedInvocationTerminalSessionEvents(session.sessionEvents, invocationId);
                await sessionRegistry.save(session);
                activityStreamer.forwardSessionEvents(terminalEvents);
                ws.send(JSON.stringify(managedAgentControlResult({
                  action,
                  sessionId,
                  invocationId,
                  status: "accepted",
                  ...(requestId ? { requestId } : {}),
                })));
              } catch (error) {
                fail(error instanceof Error ? error.message : `Managed agent ${action} failed.`);
              }
              return;
            }

            if (frame.type === "browser_session_control") {
              const action = frame.action === "takeover" || frame.action === "release" ? frame.action : undefined;
              if (!action) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Browser session control action must be takeover or release.",
                } satisfies GuiInboundFrame));
                return;
              }
              const provider = getBrowserSessionControlConsumer(input.builtinToolOptions);
              if (!provider) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Browser session control is not available for the configured provider.",
                } satisfies GuiInboundFrame));
                return;
              }
              try {
                const state = await provider.requestBrowserSessionControl({
                  action,
                  ...(typeof frame.sessionId === "string" ? { sessionId: frame.sessionId } : {}),
                  operatorId: userId,
                  ...(typeof frame.reason === "string" ? { reason: frame.reason } : {}),
                });
                activityStreamer.recordBrowserOperatorEvidence({
                  action,
                  browserSessionId: state.sessionId,
                  status: "accepted",
                  ...(typeof frame.reason === "string" ? { reason: frame.reason } : {}),
                });
              } catch (error) {
                activityStreamer.recordBrowserOperatorEvidence({
                  action,
                  ...(typeof frame.sessionId === "string" ? { browserSessionId: frame.sessionId } : {}),
                  status: "failed",
                  reason: error instanceof Error ? error.message : "Browser session control failed.",
                });
                ws.send(JSON.stringify({
                  type: "error",
                  message: error instanceof Error ? error.message : "Browser session control failed.",
                } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "browser_operator_input") {
              const requestId = typeof frame.requestId === "string" ? frame.requestId : "";
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : "";
              const operatorInput = frame.input as GuiBrowserOperatorInput;
              const provider = getBrowserOperatorInputConsumer(input.builtinToolOptions);
              if (!provider) {
                ws.send(JSON.stringify({
                  type: "browser_operator_input_ack",
                  requestId,
                  sessionId,
                  status: "failed",
                  reason: "Browser operator input is not available for the configured provider.",
                  handledAt: new Date().toISOString(),
                } satisfies GuiInboundFrame));
                return;
              }
              try {
                const ack = await provider.requestBrowserOperatorInput({
                  requestId,
                  sessionId,
                  operatorId: userId,
                  input: operatorInput,
                });
                activityStreamer.recordBrowserOperatorEvidence({
                  action: "operator_input",
                  browserSessionId: ack.sessionId ?? sessionId,
                  input: operatorInput,
                  acknowledgement: ack,
                });
                ws.send(JSON.stringify({
                  type: "browser_operator_input_ack",
                  ...ack,
                } satisfies GuiInboundFrame));
              } catch (error) {
                activityStreamer.recordBrowserOperatorEvidence({
                  action: "operator_input",
                  browserSessionId: sessionId,
                  input: operatorInput,
                  acknowledgement: {
                    status: "failed",
                    reason: error instanceof Error ? error.message : "Browser operator input failed.",
                    handledAt: new Date().toISOString(),
                  },
                });
                ws.send(JSON.stringify({
                  type: "browser_operator_input_ack",
                  requestId,
                  sessionId,
                  status: "failed",
                  reason: error instanceof Error ? error.message : "Browser operator input failed.",
                  handledAt: new Date().toISOString(),
                } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "voice_synthesis_request") {
              const requestId = typeof frame.requestId === "string" ? frame.requestId.trim() : "";
              const sourceMessageId = typeof frame.sourceMessageId === "string" ? frame.sourceMessageId.trim() : "";
              const source = sourceMessageId ? voiceSynthesisSources.get(sourceMessageId) : undefined;
              if (!requestId || !sourceMessageId || !source) {
                ws.send(JSON.stringify({
                  type: "voice_synthesis_failed",
                  requestId: requestId || crypto.randomUUID(),
                  sourceMessageId: sourceMessageId || "unknown",
                  message: "Voice synthesis source message is no longer available.",
                  code: "VOICE_SOURCE_NOT_FOUND",
                } satisfies GuiInboundFrame));
                return;
              }
              try {
                const voiceSynthesis = await synthesizeVoiceOutputOnDemand(
                  source.parts,
                  input.transport.voiceConfig,
                  input.transport.ttsAdapter,
                  {
                    artifactStore: input.transport.artifactStore,
                    appName: GUI_APP_NAME,
                    tenantId: GUI_TENANT_ID,
                    userId,
                    channel: "gui",
                    sessionId: source.sessionId,
                    model: input.transport.sessionManager.getModel() || "gateway-transform",
                    retentionMaxArtifacts: input.transport.voiceConfig?.policy?.artifacts?.retentionMaxArtifacts,
                  },
                );
                if (!voiceSynthesis.voiceOutput) {
                  ws.send(JSON.stringify({
                    type: "voice_synthesis_failed",
                    requestId,
                    sourceMessageId,
                    message: "On-demand voice synthesis is not enabled for the GUI surface.",
                    code: "VOICE_SYNTHESIS_NOT_ENABLED",
                  } satisfies GuiInboundFrame));
                  return;
                }
                voiceSynthesisSources.set(sourceMessageId, {
                  parts: voiceSynthesis.parts,
                  sessionId: source.sessionId,
                });
                ws.send(JSON.stringify({
                  type: "voice_synthesis_completed",
                  requestId,
                  sourceMessageId,
                  parts: voiceSynthesis.parts,
                } satisfies GuiInboundFrame));
              } catch (error) {
                ws.send(JSON.stringify({
                  type: "voice_synthesis_failed",
                  requestId,
                  sourceMessageId,
                  message: error instanceof Error ? error.message : String(error),
                  code: "VOICE_SYNTHESIS_FAILED",
                } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "approve") {
              const approvalId = typeof frame.approvalId === "string" ? frame.approvalId : undefined;
              const result = approvalRegistry.approve(approvalId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Approval failed" } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "reject") {
              const approvalId = typeof frame.approvalId === "string" ? frame.approvalId : undefined;
              const reason = typeof frame.reason === "string" ? frame.reason : "rejected by user";
              const result = approvalRegistry.reject(reason, approvalId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Rejection failed" } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type !== "message") return;

            const messageFrame = frame as Extract<GuiOutboundFrame, { type: "message" }>;
            const userContent = typeof messageFrame.content === "string"
              ? messageFrame.content
              : "";
            const userParts = guiOutboundMessageParts(messageFrame);
            const resumeSessionId = typeof messageFrame.resumeSessionId === "string"
              ? messageFrame.resumeSessionId.trim()
              : "";
            if (!userContent.trim() && userParts.length === 0) return;

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
            let turnPerCallConfig: PerCallToolConfig | undefined;
            try {
              const currentDiscovery = await refreshDiscovery();
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
              const activeModelRouteHealth = findProviderModelRouteHealth(
                currentDiscovery,
                activeProvider,
                activeModel,
              );
              if (activeModelRouteHealth && !activeModelRouteHealth.healthy) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: activeModelRouteHealth.reason ?? `Provider '${activeProvider}' model '${activeModel}' is cooling down`,
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
                messageFrame.reasoningEffort,
              );
              const executionMode = resolveExecutionMode(messageFrame.executionMode);
              const requestedAuthority = resolveGuiRequestedAuthority(messageFrame.requestedAuthority);
              const turnBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface({
                builtinToolOptions: input.builtinToolOptions,
                executionMode,
                managedInvocation: attachManagedInvocationSessionEventSink(
                  input.managedInvocation,
                  { publish: (events) => activityStreamer.forwardSessionEvents(events) },
                ),
                operatorSurface: {
                  theme: {
                    setTheme: operatorThemeBridge.request,
                  },
                },
              });
              rememberToolSurface(turnBuiltinToolSurface);
              turnPerCallConfig = buildGuiTurnPerCallConfig(
                activeProvider,
                activeModel,
                turnBuiltinToolSurface,
                activeModelCapabilities,
                reasoningEffort,
                executionMode,
                requestedAuthority,
              );
              result = await processAdmittedTurn({
                orchestrator,
                sessionRegistry,
                appName: GUI_APP_NAME,
                tenantId: GUI_TENANT_ID,
                userId,
                sessionId: resumeSessionId || undefined,
                systemPrompt: input.transport.systemPrompt ?? "You are a helpful assistant.",
                userParts,
                channel: "gui",
                resumeSessionHydrator: input.transport.resumeSessionHydrator,
                providerValidation: currentDiscovery,
                executionMode,
                contextArtifactCache: input.transport.contextArtifactCache,
                artifactStore: input.transport.artifactStore,
                voiceConfig: input.transport.voiceConfig,
                sttAdapter: input.transport.sttAdapter,
                ttsAdapter: input.transport.ttsAdapter,
                callBuiltinTools: turnBuiltinToolSurface.callBuiltinTools,
                perCallConfig: turnPerCallConfig,
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
            const sourceMessageId = crypto.randomUUID();
            voiceSynthesisSources.set(sourceMessageId, {
              parts: output.parts,
              sessionId: output.sessionId,
            });
            if (voiceSynthesisSources.size > 50) {
              const oldest = voiceSynthesisSources.keys().next().value;
              if (oldest) {
                voiceSynthesisSources.delete(oldest);
              }
            }

            ws.send(JSON.stringify({
              type: "done",
              sourceMessageId,
              content: extractText(output.parts),
              parts: output.parts,
              ...(output.admittedInput ? { admittedInput: output.admittedInput } : {}),
              inputTokens: output.inputTokens,
              outputTokens: output.outputTokens,
              routedProvider,
              routedModel,
              routingRationale: output.routingDecision?.rationale,
              runtimeContinuity,
              authorityStatus: deriveGuiDoneAuthorityStatus(turnPerCallConfig),
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
  executionMode: OperatorExecutionMode = "execute",
  requestedAuthority?: OperatorTurnRequestedAuthority,
): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: GUI_TENANT_ID,
    activeProvider,
    activeModel,
    ...(activeModelCapabilities ? { activeModelCapabilities } : {}),
    reasoningEffort,
    builtinToolSurface,
    executionMode,
    requestedAuthority,
  });
}

function resolveExecutionMode(value: unknown): OperatorExecutionMode {
  return value === "plan" ? "plan" : "execute";
}

export function resolveGuiRequestedAuthority(value: unknown): OperatorTurnRequestedAuthority | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "auto" || value === "read_only" || value === "audited" || value === "destructive") {
    return value;
  }
  throw new Error(`Unknown requested authority '${String(value)}'.`);
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

function findProviderModelRouteHealth(
  discovery: readonly GuiProviderDiscoveryResult[],
  provider: string | undefined,
  model: string | undefined,
): GuiProviderModelRouteHealth | undefined {
  if (!provider || !model) return undefined;
  return discovery.find((entry) => entry.provider === provider)?.modelRouteHealth?.[model];
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

function summarizeBrowserOperatorInput(input: GuiBrowserOperatorInput): Record<string, unknown> {
  switch (input.kind) {
    case "pointer":
      return {
        kind: input.kind,
        phase: input.phase,
        x: input.x,
        y: input.y,
        ...(input.button ? { button: input.button } : {}),
        ...(input.clickCount ? { clickCount: input.clickCount } : {}),
      };
    case "wheel":
      return {
        kind: input.kind,
        x: input.x,
        y: input.y,
        deltaX: input.deltaX,
        deltaY: input.deltaY,
      };
    case "key":
      return {
        kind: input.kind,
        phase: input.phase,
        key: input.key,
        ...(input.code ? { code: input.code } : {}),
        ...(input.text ? { textLength: input.text.length } : {}),
      };
    case "text":
      return {
        kind: input.kind,
        textLength: input.text.length,
      };
    default:
      return { kind: "unknown" };
  }
}

class GuiActivityStreamer {
  private readonly pendingApprovals = new Set<string>();
  private capture: {
    sessionId: string;
    nextSequence: number;
    toolOrdinal: number;
    pendingToolCallIds: Map<string, string[]>;
    assistantMessageId: string;
    fileChanges: RuntimeTurnFileChange[];
    approvalTransitions: RuntimeTurnApprovalTransition[];
    authorityDecisions: RuntimeTurnAuthorityDecision[];
    toolCompletions: RuntimeTurnToolCompletion[];
  } | null = null;
  private ws: WSContext | null = null;
  private eventBus: EventBus | null = null;
  private approvalHandler: ((event: KilnEvent) => void) | null = null;
  private receivedHandler: ((event: KilnEvent) => void) | null = null;
  private modelRoutedHandler: ((event: KilnEvent) => void) | null = null;
  private authorizedHandler: ((event: KilnEvent) => void) | null = null;
  private memoryLatticeHandler: ((event: KilnEvent) => void) | null = null;
  private lastKnownKilnSessionId: string | undefined;
  private outOfTurnBrowserEvidenceSequence = 0;
  private approvalBridge: {
    approve: (approvalId: string) => void;
    reject: (approvalId: string, reason: string) => void;
  } | null = null;

  constructor(
    private readonly approvalRegistry: ApprovalGateRegistry,
    private readonly toolCallMetadata: NonNullable<PerCallToolConfig["toolCallMetadata"]> = new Map(),
  ) {}

  bindApprovalBridge(bridge: {
    approve: (approvalId: string) => void;
    reject: (approvalId: string, reason: string) => void;
  }): void {
    this.approvalBridge = bridge;
  }

  beginTurnCapture(sessionId: string, nextSequence: number): void {
    this.lastKnownKilnSessionId = sessionId;
    this.capture = {
      sessionId,
      nextSequence,
      toolOrdinal: 0,
      pendingToolCallIds: new Map<string, string[]>(),
      assistantMessageId: `${sessionId}:live:assistant`,
      fileChanges: [],
      approvalTransitions: [],
      authorityDecisions: [],
      toolCompletions: [],
    };
  }

  endTurnCapture(sessionId: string): {
    fileChanges: readonly RuntimeTurnFileChange[];
    approvalTransitions: readonly RuntimeTurnApprovalTransition[];
    authorityDecisions: readonly RuntimeTurnAuthorityDecision[];
    toolCompletions: readonly RuntimeTurnToolCompletion[];
  } {
    if (!this.capture || this.capture.sessionId !== sessionId) {
      return { fileChanges: [], approvalTransitions: [], authorityDecisions: [], toolCompletions: [] };
    }
    const captured = {
      fileChanges: [...this.capture.fileChanges],
      approvalTransitions: [...this.capture.approvalTransitions],
      authorityDecisions: [...this.capture.authorityDecisions],
      toolCompletions: [...this.capture.toolCompletions],
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
    kind: "assistant_delta" | "provider_routed" | "tool_call_started" | "tool_call_completed" | "approval_requested" | "approval_resolved" | "file_changed" | "cost_updated" | "browser_operator_evidence";
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
        const approvalId = approvalEvent.approvalId;
        if (sessionId && approvalId) {
          this.pendingApprovals.add(approvalId);
          if (this.capture && this.capture.sessionId === sessionId) {
            this.capture.approvalTransitions.push({
              approvalId,
              status: "requested",
              sessionId,
              reason: approvalEvent.description,
            });
            this.emitSessionEvent({
              kind: "approval_requested",
              timestamp: approvalEvent.timestamp.toISOString(),
              payload: {
                approvalId,
                sessionId,
                action: approvalEvent.description,
                justification: approvalEvent.description,
              },
            });
          }
          this.approvalRegistry.register(approvalId, {
            approve: () => this.approvalBridge?.approve(approvalId),
            reject: (reason: string) => this.approvalBridge?.reject(approvalId, reason),
            status: () => (this.pendingApprovals.has(approvalId) ? "awaiting_approval" : "resolved"),
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
        const approvalId = receivedEvent.approvalId;
        if (sessionId && approvalId) {
          this.pendingApprovals.delete(approvalId);
          if (this.capture && this.capture.sessionId === sessionId) {
            this.capture.approvalTransitions.push({
              approvalId,
              status: receivedEvent.approved ? "approved" : "rejected",
              sessionId,
              reason: receivedEvent.reason,
            });
            this.emitSessionEvent({
              kind: "approval_resolved",
              timestamp: receivedEvent.timestamp.toISOString(),
              payload: {
                approvalId,
                sessionId,
                resolution: {
                  decision: receivedEvent.approved ? "approved" : "denied",
                  resolvedBy: "operator",
                  reason: receivedEvent.reason,
                },
              },
            });
          }
          this.approvalRegistry.unregister(approvalId);
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
              routingRationale: routedEvent.rationale,
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

    this.memoryLatticeHandler = (event: KilnEvent) => {
      const frame = projectMemoryLatticeInvalidationFrame(event);
      if (frame) {
        this.ws?.send(JSON.stringify(frame satisfies GuiInboundFrame));
      }
    };
    this.eventBus.onAny(this.memoryLatticeHandler);
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
    if (this.eventBus && this.memoryLatticeHandler) {
      this.eventBus.offAny(this.memoryLatticeHandler);
      this.memoryLatticeHandler = null;
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
      const sanitizedDelta = sanitizeAssistantEgressText(event.content);
      if (sanitizedDelta.length === 0) {
        return;
      }
      this.emitSessionEvent({
        kind: "assistant_delta",
        timestamp: new Date().toISOString(),
        payload: {
          messageId: this.capture?.assistantMessageId ?? "assistant-live",
          delta: sanitizedDelta,
        },
      });
    } else if (event.type === "tool_use") {
      const toolCallId = event.toolCallId ?? (this.capture
        ? `${this.capture.sessionId}:live:tool:${++this.capture.toolOrdinal}`
        : `${event.toolName ?? "tool"}_${Date.now()}`);
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
          ...resolveAttachedRuntimeToolCallMetadata(this.toolCallMetadata, event.toolName, event.input),
        },
      });
      this.emitActivityPhase({
        phase: "tool_running",
        toolName: event.toolName,
      });
    } else if (event.type === "tool_result") {
      const pending = this.capture?.pendingToolCallIds.get(event.toolName);
      let toolCallId: string;
      if (event.toolCallId) {
        toolCallId = event.toolCallId;
        const pendingIndex = pending?.indexOf(event.toolCallId) ?? -1;
        if (pending && pendingIndex >= 0) {
          pending.splice(pendingIndex, 1);
        }
      } else {
        toolCallId = pending?.shift()
          ?? (this.capture ? `${this.capture.sessionId}:live:tool:${++this.capture.toolOrdinal}` : `${event.toolName ?? "tool"}_${Date.now()}`);
      }
      if (pending && pending.length === 0 && this.capture) {
        this.capture.pendingToolCallIds.delete(event.toolName);
      }
      if (this.capture) {
        this.capture.toolCompletions.push({
          toolName: event.toolName ?? "unknown",
          success: !event.isError,
          output: event.output ?? "",
          resultSummary: event.outputSummary ?? event.output ?? "",
          ...(event.metadata ? { metadata: event.metadata } : {}),
        });
      }
      this.emitSessionEvent({
        kind: "tool_call_completed",
        timestamp: new Date().toISOString(),
        payload: {
          toolCallId,
          toolName: event.toolName ?? "unknown",
          output: event.output ?? "",
          outputSummary: event.outputSummary ?? event.output ?? "",
          ...(event.metadata ? { metadata: event.metadata } : {}),
          ...(event.resourceLinks ? { resourceLinks: event.resourceLinks } : {}),
          status: {
            state: event.isError ? "failed" : "succeeded",
          },
        },
      });
      const interactiveFrame = projectInteractiveUseFrameFromToolResult({
        ...(this.capture?.sessionId ? { kilnSessionId: this.capture.sessionId } : {}),
        toolCallId,
        toolName: event.toolName ?? "unknown",
        timestamp: new Date().toISOString(),
        status: event.isError ? "failed" : "succeeded",
        metadata: event.metadata,
        ...(event.isError ? { error: event.output ?? event.outputSummary } : {}),
      });
      if (interactiveFrame) {
        this.ws.send(JSON.stringify(interactiveFrame));
      }
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

  forwardSessionEvents(events: readonly CanonicalSessionEvent[]): void {
    if (!this.ws) return;
    for (const event of events) {
      const sequence = this.nextLiveSequence() ?? event.sequence;
      this.ws.send(JSON.stringify(toOperatorSessionEventFrame(event, {
        eventId: `${event.eventId}:live`,
        sequence,
        instanceId: GUI_OPERATOR_COCKPIT_INSTANCE_ID,
      }) satisfies GuiInboundFrame));
    }
  }

  recordBrowserOperatorEvidence(input: {
    readonly action: "takeover" | "release" | "operator_input";
    readonly browserSessionId?: string;
    readonly input?: GuiBrowserOperatorInput;
    readonly acknowledgement?: Pick<GuiBrowserOperatorInputAckFrame, "status" | "reason" | "handledAt">;
    readonly reason?: string;
    readonly status?: "accepted" | "failed";
  }): void {
    if (!this.ws) return;
    const kilnSessionId = this.capture?.sessionId ?? this.lastKnownKilnSessionId;
    if (!kilnSessionId) return;
    const sequence = this.nextLiveSequence() ?? ++this.outOfTurnBrowserEvidenceSequence;
    this.ws.send(JSON.stringify({
      type: "session_event",
      event: {
        eventId: `${kilnSessionId}:browser-operator:${sequence}`,
        kilnSessionId,
        sequence,
        timestamp: input.acknowledgement?.handledAt ?? new Date().toISOString(),
        kind: "browser_operator_evidence",
        ...(this.capture?.sessionId === kilnSessionId ? { turnId: `${kilnSessionId}:turn:live` } : {}),
        source: {
          actor: "runtime",
          surface: "gui",
          component: "gui-gateway",
        },
        payload: {
          action: input.action,
          ...(input.browserSessionId ? { browserSessionId: input.browserSessionId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.input ? { input: summarizeBrowserOperatorInput(input.input) } : {}),
          ...(input.acknowledgement
            ? {
                acknowledgement: {
                  status: input.acknowledgement.status,
                  ...(input.acknowledgement.reason ? { reason: input.acknowledgement.reason } : {}),
                },
              }
            : {}),
        },
      },
    } satisfies GuiInboundFrame));
  }

  forwardBrowserSessionState(state: Omit<GuiBrowserSessionState, "kilnSessionId">): void {
    if (!this.ws) return;
    const kilnSessionId = this.capture?.sessionId ?? this.lastKnownKilnSessionId;
    this.ws.send(JSON.stringify({
      type: "browser_session_updated",
      browserSession: {
        ...state,
        ...(kilnSessionId ? { kilnSessionId } : {}),
      },
    } satisfies GuiInboundFrame));
    if (
      state.viewMode === "live"
      && state.stream.status === "live"
      && state.sessionId
      && state.latestCapture?.uri
      && state.latestCapture.width
      && state.latestCapture.height
    ) {
      this.ws.send(JSON.stringify({
        type: "browser_live_viewport_frame",
        sessionId: state.sessionId,
        ...(kilnSessionId ? { kilnSessionId } : {}),
        frameId: `${state.sessionId}:${state.updatedAt}`,
        transport: state.latestCapture.transport ?? "snapshot-polling",
        format: state.latestCapture.mimeType === "image/jpeg" ? "jpeg" : "png",
        artifactUri: state.latestCapture.uri,
        width: state.latestCapture.width,
        height: state.latestCapture.height,
        capturedAt: state.updatedAt,
      } satisfies GuiInboundFrame));
    }
  }
}
