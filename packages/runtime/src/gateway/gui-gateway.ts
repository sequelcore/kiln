import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { WSContext } from "hono/ws";
import {
  EventBus,
  defineTurnTemporalContext,
  extractText,
  type ApprovalReceivedEvent,
  type ApprovalRequestedEvent,
  type CanonicalSessionEvent,
  type ContentPart,
  type KilnEvent,
  type ModelRoutedEvent,
  type ToolAuthorizedEvent,
  type DefaultBuiltinToolRegistryOptions,
  type TurnTemporalContext,
  assertScopedExecutionSessionToolEvent,
  type ExecutionSessionEvent,
} from "@kilnai/core";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";
import { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../session/persistence/session-registry.js";
import { ApprovalGateRegistry } from "./approval-registry.js";
import { processAdmittedTurn, sanitizeAssistantEgressText } from "./message-pipeline/index.js";
import { synthesizeVoiceOutputOnDemand } from "./voice-output-synthesizer.js";
import type {
  RuntimeTurnApprovalTransition,
  RuntimeTurnAuthorityDecision,
  RuntimeTurnFileChange,
  RuntimeTurnToolCompletion,
} from "../session/runtime-turn-record.js";
import type { OnContinueSession, OperatorGuiSessionTransportOptions } from "./operator-gateway.js";
import {
  mountGuiStaticAssets,
  resolveGuiDistPath,
} from "./gui-static-assets.js";
import {
  markGuiProviderDiscoveryStale,
  projectGuiProviderModelDiscovery,
  projectGuiOperatorModels,
  resolveGuiOperatorDiscoveryResults,
} from "./gui-provider-models.js";
import { guiOutboundMessageParts } from "./gui-frame-parts.js";
import { createProviderCatalogService } from "./provider-catalog-service.js";
import { startProviderAuthRequest } from "./provider-auth.js";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  resolveAttachedRuntimeToolCallMetadata,
  type AttachedRuntimeBuiltinToolSurface,
  type AttachedRuntimeBuiltinToolSurfaceOptions,
} from "./attached-runtime-tool-surface.js";
import {
  withManagedInvocationService,
  attachManagedInvocationSessionEventSink,
  type ManagedInvocationToolAttachment,
} from "../agents/managed-invocation/runtime-tool/index.js";
import { appendManagedInvocationTerminalSessionEvent } from "../agents/managed-invocation/session-events.js";
import { appendManagedInvocationPromptAdmissionSessionEvent } from "../agents/managed-invocation/prompt-admission.js";
import { createOperatorThemeBridge } from "./operator-theme-bridge.js";
import { toOperatorSessionEventFrame } from "./operator-session-event-frame.js";
import { approvePlanExecutionTransition } from "./plan-approval-transition.js";
import { projectMemoryLatticeInvalidationFrame } from "./gui-memory-lattice-events.js";
import { createGuiMemoryLatticeRoutes } from "./gui-memory-lattice.js";
import { projectInteractiveUseFrameFromToolResult } from "./interactive-use-frame.js";
import { BunPtyAdapter } from "../operator-terminal/bun-pty-adapter.js";
import { handleOperatorTerminalFrame } from "../operator-terminal/operator-terminal-gateway.js";
import {
  OperatorTerminalService,
  type OperatorPtyAdapter,
} from "../operator-terminal/operator-terminal-service.js";
import {
  KilnConfigSetupActionRequestSchema,
  KilnConfigSetupActionResultSchema,
  isGuiExecutableConfigSetupAction,
  OperatorResourceReadRequestSchema,
  buildOperatorToolResultPayload,
  projectOperatorResourceReadResult,
  isGuiProviderModeless,
  isOperatorThemeName,
  type GuiDashboardSnapshot,
  type GuiBrowserOperatorInput,
  type GuiBrowserOperatorInputAckFrame,
  type GuiBrowserSessionState,
  type GuiInboundFrame,
  type GuiManagedAgentControlAction,
  type GuiGoalControlAction,
  type GuiOutboundFrame,
  type GuiProviderDiscoveryResult,
  type GuiProviderModelCapabilities,
  type GuiAuthorityStatus,
  type KilnConfigSetupAction,
  type KilnConfigSetupActionResult,
  type KilnConfigSetupSnapshot,
  type GuiMemoryLatticeScope,
  type GuiSessionDetail,
  type OperatorSessionSummary,
  type OperatorExecutionMode,
  type OperatorWorkspaceError,
  type OperatorWorkspaceErrorCode,
  type OperatorWorkspaceExplorer,
} from "@kilnai/gateway-contracts";
import { toCoreDeliberationIntent, toCoreModelCapabilities } from "./deliberation-projection.js";
import {
  rejectUnavailableExecutionRoute,
  type OperatorExecutionRouteSelectionPort,
} from "./operator-execution-route-selection.js";
import {
  fingerprintOperatorTurnIntent,
  type OperatorTurnDispatchPort,
  type OperatorTurnDispatchResult,
  type OperatorTurnGuiDispatchPayload,
} from "../execution-routing/operator-turn-dispatcher.js";
import type { OperatorSessionCommittedExecution } from "../execution-routing/operator-session-execution-routing-service.js";

export type {
  GuiDashboardSnapshot,
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiProviderDescriptor,
  GuiSessionDetail,
  GuiSessionEvent,
  GuiSessionMeta,
  OperatorSessionSummary,
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
  readonly guiAssetMode?: "bundled" | "external";
  readonly getSnapshot: (context?: {
    readonly operatorModels?: Record<string, string[]>;
    readonly operatorDiscovery?: readonly GuiProviderDiscoveryResult[];
  }) => Promise<GuiDashboardSnapshot>;
  readonly getSetupSnapshot?: () => Promise<KilnConfigSetupSnapshot>;
  readonly executeSetupAction?: (action: KilnConfigSetupAction) => Promise<KilnConfigSetupActionResult>;
  readonly getProviderAvailability?: () => Promise<Record<string, boolean>> | Record<string, boolean>;
  readonly discoverOperatorProviders?: () => Promise<readonly GuiProviderDiscoveryResult[]>;
  readonly initialOperatorDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly initialOperatorDiscoveryFreshness?: "fresh" | "stale";
  readonly onOperatorDiscoveryResolved?: (discovery: readonly GuiProviderDiscoveryResult[]) => void;
  readonly loadOperatorSessionHistory?: () => Promise<readonly OperatorSessionSummary[]>;
  readonly getSessionDetail?: (sessionId: string) => Promise<GuiSessionDetail | null>;
  readonly workingDirectory?: string;
  readonly domainLabel?: string;
  readonly workspaceExplorer?: OperatorWorkspaceExplorer;
  readonly updateThemePreference?: (theme: string) => Promise<void> | void;
  /** Route selection is the only operator execution-selection authority. */
  readonly executionRouteSelection?: OperatorExecutionRouteSelectionPort;
  readonly onConnectionCountChange?: (count: number) => void;
  readonly onManagedWindowClose?: () => void;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly operatorTransport?: OperatorGuiSessionTransportOptions;
  readonly managedInvocation?: ManagedInvocationToolAttachment;
  readonly boundedWork?: AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"];
  readonly memoryLatticeDefaultScope?: GuiMemoryLatticeScope;
  readonly operatorTerminalAdapter?: OperatorPtyAdapter;
  readonly goalController?: GuiGoalController;
}

export interface GuiGoalController {
  control(input: {
    readonly goalRunId: string;
    readonly action: GuiGoalControlAction;
    readonly objective?: string;
    readonly reason?: string;
    readonly requestedBy: string;
  }): Promise<CanonicalSessionEvent>;
}

export interface GuiGateway {
  readonly port: number;
  readonly url: string;
  readonly apiUrl: string;
  readonly operatorWsUrl?: string;
  readonly operatorModels?: Record<string, string[]>;
  readonly operatorDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly hasMountedGui: boolean;
  readonly operatorTerminalCapability?: string;
  shutdown(): void;
}

const GUI_APP_NAME = "kiln-gui";
const GUI_TENANT_ID = "_gui";
type OperatorTurnRequestedAuthority = Extract<GuiOutboundFrame, { type: "message" }>["requestedAuthority"];

interface ActiveGuiTurn {
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  readonly markSettled: () => void;
}

function createActiveGuiTurn(): ActiveGuiTurn {
  const controller = new AbortController();
  let markSettled = (): void => {};
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  return { controller, settled, markSettled };
}

interface BrowserSessionUpdateHandlerConsumer {
  setBrowserSessionUpdateHandler(handler: ((state: Omit<GuiBrowserSessionState, "kilnSessionId">) => void) | undefined): void;
}

interface BrowserSessionControlConsumer {
  requestBrowserSessionControl(request: {
    readonly action: "takeover" | "release";
    readonly gatewayTargetId?: string;
    readonly sessionId?: string;
    readonly operatorId?: string;
    readonly reason?: string;
  }): Promise<Omit<GuiBrowserSessionState, "kilnSessionId">>;
}

interface BrowserOperatorInputConsumer {
  requestBrowserOperatorInput(request: {
    readonly requestId: string;
    readonly gatewayTargetId?: string;
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
  return value === "cancel" || value === "join" || value === "prompt";
}

function isGoalControlAction(value: unknown): value is GuiGoalControlAction {
  return value === "pause" || value === "resume" || value === "update_objective" || value === "cancel";
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
  const managedInvocation = options.managedInvocation
    ? {
        ...options.managedInvocation,
        options: withManagedInvocationService(options.managedInvocation.options),
      }
    : undefined;
  const builtinToolOptions = options.builtinToolOptions;
  const memoryLatticeResources = createAttachedRuntimeBuiltinToolSurface({ builtinToolOptions });
  const app = new Hono();
  const hasMountedGui = options.guiAssetMode !== "external";
  if (hasMountedGui) {
    mountGuiStaticAssets(app, resolveGuiDistPath(options.guiDistPath));
  }
  const transportOptions = options.operatorTransport;
  const initialOperatorDiscovery = options.initialOperatorDiscovery
    ? options.initialOperatorDiscoveryFreshness === "fresh"
      ? options.initialOperatorDiscovery
      : markGuiProviderDiscoveryStale(options.initialOperatorDiscovery)
    : undefined;
  const operatorTerminalCapability = transportOptions && options.workingDirectory
    ? crypto.randomUUID()
    : undefined;
  const operatorTerminalService = operatorTerminalCapability && options.workingDirectory
    ? new OperatorTerminalService({
        workspaceRoot: options.workingDirectory,
        adapter: options.operatorTerminalAdapter ?? new BunPtyAdapter(),
      })
    : undefined;
  let activeConnections = 0;

  const { upgradeWebSocket, websocket } = (await loadBunHonoAdapters()).createBunWebSocket();
  const operatorCatalog = transportOptions
    ? createProviderCatalogService<readonly GuiProviderDiscoveryResult[]>(
      () => options.discoverOperatorProviders
        ? options.discoverOperatorProviders()
        : resolveOperatorDiscovery(options.getProviderAvailability),
      [],
      {
        initialDiscovery: initialOperatorDiscovery,
        initialFreshness: options.initialOperatorDiscoveryFreshness,
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
  app.use("/operator/api/*", guiCorsMiddleware);

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
    if (!options.executeSetupAction || !options.getSetupSnapshot) {
      return c.json({ error: "setup_action_unavailable" }, 404);
    }
    const parsed = KilnConfigSetupActionRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_setup_action" }, 400);
    }
    if (!isGuiExecutableConfigSetupAction(parsed.data.action)) {
      const result: KilnConfigSetupActionResult = {
        action: parsed.data.action,
        status: "blocked",
        message: "This setup action is review-only in the GUI.",
        errors: [`GUI setup action '${parsed.data.action}' is not executable.`],
        setup: await options.getSetupSnapshot(),
      };
      return c.json(KilnConfigSetupActionResultSchema.parse(result));
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

  const loadOperatorSessionHistory = async (): Promise<readonly OperatorSessionSummary[]> => {
    if (!options.loadOperatorSessionHistory) {
      return [];
    }
    return options.loadOperatorSessionHistory();
  };

  app.get("/operator/api/sessions", async (c) => {
    const sessions = await loadOperatorSessionHistory();
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
      managedInvocation,
      boundedWork: options.boundedWork,
      executionRouteSelection: options.executionRouteSelection,
      operatorTerminalCapability,
      operatorTerminalService,
      goalController: options.goalController,
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
        async onOpen(_event: Event, ws: WSContext) {
          activeConnections += 1;
          updateConnectionCount(activeConnections);
          const guiAuthorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(buildGuiPerCallToolConfig());
          ws.send(JSON.stringify({
            type: "welcome",
            executionRouteCatalog: await options.executionRouteSelection?.getCatalog() ?? { routes: [] },
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
    operatorTerminalCapability,
    shutdown: () => {
      operatorTerminalService?.closeAll();
      server.stop();
    },
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
    transport: OperatorGuiSessionTransportOptions;
    initialDiscovery: readonly GuiProviderDiscoveryResult[];
    getDiscovery: (options?: { readonly force?: boolean }) => Promise<readonly GuiProviderDiscoveryResult[]>;
    getDiscoverySnapshot: () => readonly GuiProviderDiscoveryResult[];
    onDiscoveryUpdated: (listener: (discovery: readonly GuiProviderDiscoveryResult[]) => void) => () => void;
    builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
    managedInvocation?: ManagedInvocationToolAttachment;
    boundedWork?: AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"];
    executionRouteSelection?: OperatorExecutionRouteSelectionPort;
    onReady: (wsUrl: string) => void;
    onSocketOpen?: () => void;
    onSocketClose?: () => void;
    operatorTerminalCapability?: string;
    operatorTerminalService?: OperatorTerminalService;
    goalController?: GuiGoalController;
  },
): void {
  const providerLabel = input.transport.sessionManager.getProvider();
  const approvalRegistry = new ApprovalGateRegistry();
  const builtinToolSurface = createAttachedRuntimeBuiltinToolSurface({
    builtinToolOptions: input.builtinToolOptions,
    boundedWork: input.boundedWork,
    managedInvocation: input.managedInvocation,
  });
  const resourceSurfaces: AttachedRuntimeBuiltinToolSurface[] = [builtinToolSurface];
  const activityStreamer = new GuiActivityStreamer(approvalRegistry, builtinToolSurface.toolCallMetadata);
  bindBrowserSessionUpdateHandler(input.builtinToolOptions, (state) => activityStreamer.forwardBrowserSessionState(state));
  let activeOperatorSurface: { theme: { setTheme: ReturnType<typeof createOperatorThemeBridge>["request"] } } | undefined;
  const activeTurns = new Map<string, ActiveGuiTurn>();
  const executor = new CliSubscriptionExecutor(
    input.transport.sessionManager.factory,
    providerLabel,
    (event) => activityStreamer.forward(event),
    () => activeOperatorSurface,
    () => input.transport.sessionManager.getDeliberationTransport?.() ?? "none",
  );
  const eventBus = input.transport.eventBus ?? new EventBus(100);
  const orchestrator = new RuntimeSessionOrchestrator({
    provider: executor,
    eventBus,
    builtinTools: builtinToolSurface.callBuiltinTools,
    ...(input.transport.budgetAdmission ? { budgetAdmission: input.transport.budgetAdmission } : {}),
  });
  const sessionRegistry = new SessionRegistry();

  activityStreamer.bindApprovalBridge({
    approve: (approvalId) => orchestrator.continue(approvalId),
    reject: (approvalId, reason) => orchestrator.emitApprovalReceived(false, reason, approvalId),
  });
  input.transport.operatorTurnExecutionBridge.bind(async (committed: OperatorSessionCommittedExecution<unknown, OperatorTurnGuiDispatchPayload>) => {
    const payload = committed.payload;
    input.transport.sessionManager.setProvider(committed.admission.providerId);
    input.transport.sessionManager.setModel(committed.admission.providerModelId);
    if (payload.freshSessionRequested) {
      await sessionRegistry.detachActive(GUI_APP_NAME, payload.userId, GUI_TENANT_ID);
      await input.transport.onClear?.();
    }
    const activeModelCapabilities = findProviderModelCapabilities(
      payload.providerDiscovery,
      committed.admission.providerId,
      committed.admission.providerModelId,
    );
    const deliberationIntent = toCoreDeliberationIntent(payload.message.deliberationIntent);
    const executionMode = resolveExecutionMode(payload.message.executionMode);
    const requestedAuthority = resolveGuiRequestedAuthority(payload.message.requestedAuthority);
    const governedWorkRequirement = resolveGuiGovernedWorkRequirement(payload.message.governedWorkRequirement);
    assertGuiTurnModeCompatibility(executionMode, governedWorkRequirement);
    const turnBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: input.builtinToolOptions,
      boundedWork: input.boundedWork,
      executionMode,
      managedInvocation: attachManagedInvocationSessionEventSink(
        input.managedInvocation,
        { publish: (events) => activityStreamer.forwardSessionEvents(events) },
      ),
      operatorSurface: activeOperatorSurface,
    });
    const perCallConfig = {
      ...buildGuiTurnPerCallConfig(
        committed.admission.providerId,
        committed.admission.providerModelId,
        turnBuiltinToolSurface,
        activeModelCapabilities,
        deliberationIntent,
        executionMode,
        requestedAuthority,
        input.transport.workingDirectory,
        governedWorkRequirement,
        payload.operatorTimeZone
          ? defineTurnTemporalContext({ observedAt: new Date().toISOString(), timeZone: payload.operatorTimeZone })
          : undefined,
      ),
      abortSignal: payload.abortSignal,
      executionBinding: committed.binding,
      executionCredential: committed.credential,
    } satisfies PerCallToolConfig;
    return processAdmittedTurn({
      orchestrator,
      sessionRegistry,
      appName: GUI_APP_NAME,
      tenantId: GUI_TENANT_ID,
      userId: payload.userId,
      sessionId: payload.sessionId,
      systemPrompt: payload.systemPrompt,
      userParts: payload.userParts,
      channel: "gui",
      resumeSessionHydrator: input.transport.resumeSessionHydrator,
      providerValidation: payload.providerDiscovery,
      contextUsageWindow: contextUsageWindowEvidence(
        committed.admission.providerId,
        committed.admission.providerModelId,
        activeModelCapabilities,
        payload.providerDiscovery,
      ),
      executionMode,
      contextArtifactCache: input.transport.contextArtifactCache,
      artifactStore: input.transport.artifactStore,
      voiceConfig: input.transport.voiceConfig,
      sttAdapter: input.transport.sttAdapter,
      ttsAdapter: input.transport.ttsAdapter,
      callBuiltinTools: turnBuiltinToolSurface.callBuiltinTools,
      perCallConfig,
      turnCapture: {
        start: (sessionId, nextSequence) => activityStreamer.beginTurnCapture(sessionId, nextSequence),
        finish: (sessionId) => { activityStreamer.endTurnCapture(sessionId); },
        abort: (sessionId) => { activityStreamer.endTurnCapture(sessionId); },
      },
      publishCanonicalSessionEvents: (events) => activityStreamer.forwardSessionEvents(
        events.filter((event) => event.kind === "context_usage_observed"
          || event.kind === "cost_updated"
          || (event.kind === "turn_completed" && event.outcome === "cancelled")),
      ),
    });
  });

  app.post("/gui/api/resources/read", async (c) => {
    const request = OperatorResourceReadRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!request.success) {
      return c.json({ error: "resource_read_request_invalid" }, 400);
    }
    for (const surface of resourceSurfaces) {
      const result = await surface.readResource(request.data.uri, {
        ...(request.data.target ? { target: request.data.target } : {}),
        ...(request.data.cursor ? { cursor: request.data.cursor } : {}),
        ...(request.data.limit ? { limit: request.data.limit } : {}),
      }).catch(() => undefined);
      if (!result?.contents[0]) {
        continue;
      }
      return c.json(projectOperatorResourceReadResult({
        uri: request.data.uri,
        ...(request.data.target ? { target: request.data.target } : {}),
        readResult: result,
      }));
    }
    return c.json({ error: "resource_not_found" }, 404);
  });

  app.get(
    "/gui/ws",
    upgradeWebSocket((c) => {
      const userId = c.req.query("userId") ?? crypto.randomUUID();
      const terminalOwnerId = crypto.randomUUID();
      const terminalAuthorized = Boolean(
        input.operatorTerminalCapability
        && c.req.query("operatorToken") === input.operatorTerminalCapability,
      );
      let discovery = [...input.initialDiscovery];
      const applyDiscovery = (nextDiscovery: readonly GuiProviderDiscoveryResult[]): readonly GuiProviderDiscoveryResult[] => {
        discovery = [...nextDiscovery];
        return discovery;
      };
      const refreshDiscovery = async (
        options?: { readonly force?: boolean },
      ): Promise<readonly GuiProviderDiscoveryResult[]> => {
        return applyDiscovery(await input.getDiscovery(options).catch(() => []));
      };
      let operatorSocket: WSContext | null = null;
      let unsubscribeDiscovery: (() => void) | undefined;
      let selectedRouteIntent: { readonly routeId: string; readonly accountOverrideId?: string } | undefined;
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
          });
          const catalog = await input.executionRouteSelection?.getCatalog() ?? { routes: [] };
          const guiAuthorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(
            buildGuiTurnPerCallConfig("", undefined, builtinToolSurface),
          );
          ws.send(JSON.stringify({
            type: "welcome",
            executionRouteCatalog: catalog,
            executionMode: input.transport.executionMode ?? "execute",
            workingDirectory: input.transport.workingDirectory,
            domainLabel: input.transport.domainLabel,
            authorityStatus: guiAuthorityStatus,
            operatorTerminalAvailable: Boolean(input.operatorTerminalService && terminalAuthorized),
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

            if (input.operatorTerminalService && await handleOperatorTerminalFrame({
              frame,
              authorized: terminalAuthorized,
              ownerId: terminalOwnerId,
              service: input.operatorTerminalService,
              send: (terminalFrame) => ws.send(JSON.stringify(terminalFrame)),
            })) {
              return;
            }

            if (frame.type === "operator_theme_set_result") {
              operatorThemeBridge.resolve(frame as Extract<GuiOutboundFrame, { type: "operator_theme_set_result" }>);
              return;
            }

            if (frame.type === "clear") {
              const turnToClear = activeTurns.get(userId);
              if (turnToClear) {
                turnToClear.controller.abort("Operator cleared the active GUI session.");
                await turnToClear.settled;
              }
              await sessionRegistry.detachActive(GUI_APP_NAME, userId, GUI_TENANT_ID);
              try {
                await input.transport.onClear?.();
              } catch {
                // fail-open for parity with tui gateway clear behavior
              }
              ws.send(JSON.stringify({ type: "cleared" } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "refresh_execution_routes") {
              const executionRouteCatalog = await input.executionRouteSelection?.getCatalog() ?? { routes: [] };
              ws.send(JSON.stringify({
                type: "execution_routes_refreshed",
                executionRouteCatalog,
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
                providerModelDiscovery: projectGuiProviderModelDiscovery(currentDiscovery),
                models: projectGuiOperatorModels(currentDiscovery),
                providerDiscovery: currentDiscovery,
                executionRouteCatalog: await input.executionRouteSelection?.getCatalog() ?? { routes: [] },
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "execution_route") {
              const selectionFrame = frame as Extract<GuiOutboundFrame, { type: "execution_route" }>;
              const catalog = await input.executionRouteSelection?.getCatalog() ?? { routes: [] };
              const localRejection = rejectUnavailableExecutionRoute(catalog, selectionFrame);
              const admission = localRejection ?? await input.executionRouteSelection?.admit(selectionFrame) ?? {
                ok: false as const, reasonCode: "route-evidence-pending" as const,
                reason: "Execution route admission is unavailable.", repairActions: ["refresh-route-catalog"] as const,
              };
              if (!admission.ok) {
                ws.send(JSON.stringify({ type: "execution_route_change_failed", routeId: selectionFrame.routeId, requestId: selectionFrame.requestId, reasonCode: admission.reasonCode, reason: admission.reason, repairActions: admission.repairActions } satisfies GuiInboundFrame));
                return;
              }
              selectedRouteIntent = { routeId: selectionFrame.routeId, ...(selectionFrame.accountOverrideId ? { accountOverrideId: selectionFrame.accountOverrideId } : {}) };
              ws.send(JSON.stringify({ type: "execution_route_changed", routeId: admission.admission.routeId, requestId: selectionFrame.requestId, providerId: admission.admission.providerId, providerModelId: admission.admission.providerModelId } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "continue") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId.trim() : "";
              if (!sessionId) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume request must include sessionId",
                } satisfies GuiInboundFrame));
                return;
              }
              try {
                await applyContinuationSelection(input.transport.onContinueSession, sessionId);
              } catch {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume selection failed",
                } satisfies GuiInboundFrame));
                return;
              }
              ws.send(JSON.stringify({
                type: "continuation_selected",
                sessionId,
                ...(typeof frame.gatewayTargetId === "string" ? { gatewayTargetId: frame.gatewayTargetId } : {}),
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "turn_cancel") {
              const requestId = typeof frame.requestId === "string" ? frame.requestId.trim() : "";
              if (!requestId) {
                return;
              }
              const activeTurn = activeTurns.get(userId);
              if (!activeTurn) {
                ws.send(JSON.stringify({
                  type: "turn_cancel_result",
                  requestId,
                  status: "not_active",
                  reason: "There is no active GUI turn to cancel.",
                } satisfies GuiInboundFrame));
                return;
              }
              activeTurn.controller.abort(
                typeof frame.reason === "string" && frame.reason.trim().length > 0
                  ? frame.reason.trim()
                  : "Operator cancelled the active GUI turn.",
              );
              ws.send(JSON.stringify({
                type: "turn_cancel_result",
                requestId,
                status: "accepted",
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "goal_control") {
              const requestId = typeof frame.requestId === "string" ? frame.requestId.trim() : "";
              const goalRunId = typeof frame.goalRunId === "string" ? frame.goalRunId.trim() : "";
              const action = frame.action;
              if (!isGoalControlAction(action)) {
                return;
              }
              const respond = (status: "accepted" | "failed", reason?: string): void => {
                ws.send(JSON.stringify({
                  type: "goal_control_result",
                  requestId,
                  goalRunId,
                  action,
                  status,
                  ...(reason ? { reason } : {}),
                } satisfies GuiInboundFrame));
              };
              if (!requestId || !goalRunId || !input.goalController) {
                respond("failed", input.goalController
                  ? "Goal control requires requestId and goalRunId."
                  : "Goal control is unavailable on this gateway.");
                return;
              }
              try {
                const event = await input.goalController.control({
                  goalRunId,
                  action,
                  ...(typeof frame.objective === "string" ? { objective: frame.objective } : {}),
                  ...(typeof frame.reason === "string" ? { reason: frame.reason } : {}),
                  requestedBy: userId,
                });
                ws.send(JSON.stringify(toOperatorSessionEventFrame(event, {
                  eventId: event.eventId,
                  sequence: event.sequence,
                  instanceId: GUI_OPERATOR_COCKPIT_INSTANCE_ID,
                })));
                respond("accepted");
              } catch (error) {
                respond("failed", error instanceof Error ? error.message : "Goal control failed.");
              }
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
                fail("Managed agent control action must be cancel, join, or prompt.");
                return;
              }
              if (!sessionId || !invocationId) {
                fail("Managed agent control requires sessionId and invocationId.");
                return;
              }
              const invocationService = input.managedInvocation?.options.invocationService;
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
                if (action === "prompt") {
                  const prompt = typeof frame.prompt === "string" ? frame.prompt.trim() : "";
                  const deliveryMode = frame.deliveryMode === "steer" || frame.deliveryMode === "queue"
                    ? frame.deliveryMode
                    : undefined;
                  if (prompt.length === 0) {
                    fail("Managed agent prompt control requires prompt.");
                    return;
                  }
                  if (!deliveryMode) {
                    fail("Managed agent prompt control requires deliveryMode steer or queue.");
                    return;
                  }
                  const deliveryState = deliveryMode === "steer" ? "available" : "queued";
                  const promptEvent = appendManagedInvocationPromptAdmissionSessionEvent({
                    session,
                    invocationId,
                    agentId: snapshot.agentId,
                    parentTurnId: snapshot.parentTurnId,
                    prompt,
                    deliveryMode,
                    deliveryState,
                    requestedBy: userId,
                    requestSource: "gui",
                    wakeRequested: typeof frame.wakeRequested === "boolean" ? frame.wakeRequested : deliveryMode === "steer",
                    source: {
                      actor: "runtime",
                      surface: "gui",
                      component: "gui-gateway",
                    },
                  });
                  invocationService.admitPrompt({
                    invocationId,
                    promptAdmissionId: promptEvent.promptAdmissionId,
                    prompt,
                    deliveryMode,
                    wakeRequested: promptEvent.wakeRequested,
                    requestedBy: userId,
                    requestSource: "gui",
                    admittedAt: promptEvent.timestamp,
                  });
                  await sessionRegistry.save(session);
                  await input.managedInvocation?.options.sessionEventSink?.publish([promptEvent], {
                    session,
                    toolCall: {
                      id: requestId ?? `managed-agent-control:${action}:${invocationId}`,
                      name: "managed_agent.prompt",
                      input: {
                        action,
                        sessionId,
                        invocationId,
                        promptAdmissionId: promptEvent.promptAdmissionId,
                        deliveryMode,
                        wakeRequested: promptEvent.wakeRequested,
                      },
                    },
                  });
                  activityStreamer.forwardSessionEvents([promptEvent]);
                  ws.send(JSON.stringify(managedAgentControlResult({
                    action,
                    sessionId,
                    invocationId,
                    status: "accepted",
                    ...(requestId ? { requestId } : {}),
                  })));
                  return;
                }
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
                await input.managedInvocation?.options.sessionEventSink?.publish(terminalEvents, {
                  session,
                  toolCall: {
                    id: requestId ?? `managed-agent-control:${action}:${invocationId}`,
                    name: `managed_agent.${action}`,
                    input: {
                      action,
                      sessionId,
                      invocationId,
                    },
                  },
                });
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
                  ...(typeof frame.gatewayTargetId === "string" ? { gatewayTargetId: frame.gatewayTargetId } : {}),
                  ...(typeof frame.sessionId === "string" ? { sessionId: frame.sessionId } : {}),
                  operatorId: userId,
                  ...(typeof frame.reason === "string" ? { reason: frame.reason } : {}),
                });
                activityStreamer.recordBrowserOperatorEvidence({
                  action,
                  ...(typeof frame.gatewayTargetId === "string" ? { gatewayTargetId: frame.gatewayTargetId } : {}),
                  browserSessionId: state.sessionId,
                  status: "accepted",
                  ...(typeof frame.reason === "string" ? { reason: frame.reason } : {}),
                });
              } catch (error) {
                activityStreamer.recordBrowserOperatorEvidence({
                  action,
                  ...(typeof frame.gatewayTargetId === "string" ? { gatewayTargetId: frame.gatewayTargetId } : {}),
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
                  ...(typeof frame.gatewayTargetId === "string" ? { gatewayTargetId: frame.gatewayTargetId } : {}),
                  sessionId,
                  operatorId: userId,
                  input: operatorInput,
                });
                activityStreamer.recordBrowserOperatorEvidence({
                  action: "operator_input",
                  ...(typeof frame.gatewayTargetId === "string" ? { gatewayTargetId: frame.gatewayTargetId } : {}),
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
                  ...(typeof frame.gatewayTargetId === "string" ? { gatewayTargetId: frame.gatewayTargetId } : {}),
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
              const requestId = typeof frame.requestId === "string" ? frame.requestId : "";
              if (!requestId.trim()) {
                ws.send(JSON.stringify({ type: "error", message: "Approval response requestId is required" } satisfies GuiInboundFrame));
                return;
              }
              const approvalId = typeof frame.approvalId === "string" ? frame.approvalId : "";
              const result = approvalRegistry.approve(approvalId);
              ws.send(JSON.stringify({
                type: "approval_response_result",
                requestId,
                approvalId,
                decision: "approve",
                status: result.ok ? "accepted" : "failed",
                ...(!result.ok ? { reason: result.error ?? "Approval failed" } : {}),
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "reject") {
              const requestId = typeof frame.requestId === "string" ? frame.requestId : "";
              if (!requestId.trim()) {
                ws.send(JSON.stringify({ type: "error", message: "Approval response requestId is required" } satisfies GuiInboundFrame));
                return;
              }
              const approvalId = typeof frame.approvalId === "string" ? frame.approvalId : "";
              const reason = typeof frame.reason === "string" ? frame.reason : "rejected by user";
              const result = approvalRegistry.reject(reason, approvalId);
              ws.send(JSON.stringify({
                type: "approval_response_result",
                requestId,
                approvalId,
                decision: "reject",
                status: result.ok ? "accepted" : "failed",
                ...(!result.ok ? { reason: result.error ?? "Rejection failed" } : {}),
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type !== "message") return;

            if (activeTurns.has(userId)) {
              ws.send(JSON.stringify({
                type: "error",
                message: "A GUI turn is already active. Cancel it before starting another turn.",
              } satisfies GuiInboundFrame));
              return;
            }

            const messageFrame = frame as Extract<GuiOutboundFrame, { type: "message" }>;
            const userContent = typeof messageFrame.content === "string"
              ? messageFrame.content
              : "";
            const userParts = guiOutboundMessageParts(messageFrame);
            const continuationSessionId = typeof messageFrame.continuationSessionId === "string"
              ? messageFrame.continuationSessionId.trim()
              : "";
            const freshSessionRequested = messageFrame.sessionIntent === "fresh";
            if (!userContent.trim() && userParts.length === 0) return;

            const currentTurn = createActiveGuiTurn();
            activeTurns.set(userId, currentTurn);
            try {
            if (freshSessionRequested && continuationSessionId) {
              ws.send(JSON.stringify({
                type: "error",
                message: "Fresh session messages cannot include continuationSessionId",
              } satisfies GuiInboundFrame));
              return;
            }

            if (continuationSessionId && input.transport.onContinueSession) {
              try {
                await applyContinuationSelection(
                  input.transport.onContinueSession,
                  continuationSessionId,
                  selectedRouteIntent?.routeId,
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
            let result: import("./message-pipeline/index.js").ProcessResult;
            let turnProvider: string | undefined;
            let turnModel: string | undefined;
            try {
              const currentDiscovery = await refreshDiscovery();
              if (!selectedRouteIntent) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "No execution route selected. Choose an execution route before sending a message.",
                } satisfies GuiInboundFrame));
                return;
              }
              const dispatcher: OperatorTurnDispatchPort<OperatorTurnGuiDispatchPayload, OperatorTurnDispatchResult> = input.transport.operatorTurnDispatcher;
              if (!dispatcher) {
                ws.send(JSON.stringify({
                  type: "error",
                  code: "route-evidence-pending",
                  message: "Operator execution routing is unavailable.",
                } satisfies GuiInboundFrame));
                return;
              }
              const executionId = crypto.randomUUID();
              const execution = await dispatcher.dispatchTurn({
                executionId,
                intentFingerprint: fingerprintOperatorTurnIntent({ executionId, intent: selectedRouteIntent }),
                intent: selectedRouteIntent,
                payload: {
                  surface: "gui",
                  appName: GUI_APP_NAME,
                  tenantId: GUI_TENANT_ID,
                  userId,
                  userParts,
                  sessionId: continuationSessionId || undefined,
                  systemPrompt: input.transport.systemPrompt ?? "You are a helpful assistant.",
                  message: messageFrame,
                  providerDiscovery: currentDiscovery,
                  freshSessionRequested,
                  abortSignal: currentTurn.controller.signal,
                  operatorTimeZone: input.transport.operatorTimeZone,
                },
              });
              result = execution.result;
              turnProvider = execution.admission.providerId;
              turnModel = execution.admission.providerModelId;
            } catch (err) {
              if (currentTurn.controller.signal.aborted) {
                return;
              }
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
            if (!turnProvider) {
              ws.send(JSON.stringify({
                type: "error",
                message: "Runtime completed without a provider route.",
              } satisfies GuiInboundFrame));
              return;
            }
            const routedProvider = output.routingDecision?.provider ?? turnProvider;
            const fallbackRoutedModel = isGuiProviderModeless(routedProvider)
              ? ""
              : turnModel;
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
              kilnSessionId: output.sessionId,
              sourceMessageId,
              content: extractText(output.parts),
              parts: output.parts,
              ...(output.admittedInput ? { admittedInput: output.admittedInput } : {}),
              inputTokens: output.inputTokens,
              outputTokens: output.outputTokens,
              outcome: output.outcome,
              routedProvider,
              routedModel,
              routingRationale: output.routingDecision?.rationale,
              runtimeContinuity,
              authorityStatus: deriveGuiDoneAuthorityStatus(undefined),
            } satisfies GuiInboundFrame));
            } finally {
              currentTurn.markSettled();
              if (activeTurns.get(userId) === currentTurn) {
                activeTurns.delete(userId);
              }
            }
          } catch {
            // discard malformed frames
          }
        },

        onClose(_event: CloseEvent, ws: WSContext) {
          input.operatorTerminalService?.closeOwner(terminalOwnerId);
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

export function buildGuiTurnPerCallConfig(
  activeProvider: string,
  activeModel: string | undefined,
  builtinToolSurface: AttachedRuntimeBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface(),
  activeModelCapabilities?: GuiProviderModelCapabilities,
  deliberationIntent?: PerCallToolConfig["deliberationIntent"],
  executionMode: OperatorExecutionMode = "execute",
  requestedAuthority?: OperatorTurnRequestedAuthority,
  workingDirectory?: string,
  governedWorkRequirement?: PerCallToolConfig["governedWorkRequirement"],
  temporalContext?: TurnTemporalContext,
): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: GUI_TENANT_ID,
    workingDirectory,
    governedWorkRequirement,
    activeProvider,
    activeModel,
    ...(activeModelCapabilities ? { activeModelCapabilities: toCoreModelCapabilities(activeModelCapabilities) } : {}),
    ...(deliberationIntent ? { deliberationIntent } : {}),
    builtinToolSurface,
    executionMode,
    requestedAuthority,
    ...(temporalContext ? { temporalContext } : {}),
    authorityContext: {
      executionUse: "operator_interactive",
      sessionPolicy: {
        maximumAuthority: "destructive",
        reason: "The attended operator controls authority for this GUI session.",
      },
      tenantPolicy: {
        subjectId: GUI_TENANT_ID,
        maximumAuthority: "destructive",
        reason: "The local GUI tenant permits attended operator execution.",
      },
      routePolicy: {
        subjectId: "gui-runtime",
        maximumAuthority: "destructive",
        reason: "The attached Kiln GUI runtime enforces per-turn authority.",
      },
    },
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

export function resolveGuiGovernedWorkRequirement(
  value: unknown,
): PerCallToolConfig["governedWorkRequirement"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("governedWorkRequirement must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "goal_materialization") {
    throw new Error(`Unknown governed work requirement '${String(record.kind)}'.`);
  }
  if (!Number.isSafeInteger(record.requiredWorkItemCount) || Number(record.requiredWorkItemCount) <= 0) {
    throw new Error("governedWorkRequirement.requiredWorkItemCount must be a positive integer.");
  }
  return {
    kind: "goal_materialization",
    requiredWorkItemCount: Number(record.requiredWorkItemCount),
  };
}

export function assertGuiTurnModeCompatibility(
  executionMode: OperatorExecutionMode,
  governedWorkRequirement: PerCallToolConfig["governedWorkRequirement"] | undefined,
): void {
  if (executionMode === "plan" && governedWorkRequirement) {
    throw new Error("Plan mode cannot be combined with governed goal materialization.");
  }
}

async function applyContinuationSelection(
  onContinueSession: OnContinueSession | undefined,
  sessionId: string,
  routeId?: string,
): Promise<void> {
  if (!onContinueSession) {
    throw new Error("continuation selection unsupported");
  }
  await onContinueSession(sessionId, routeId);
}

function findProviderModelCapabilities(
  discovery: readonly GuiProviderDiscoveryResult[],
  provider: string | undefined,
  model: string | undefined,
): GuiProviderModelCapabilities | undefined {
  if (!provider || !model) return undefined;
  return discovery.find((entry) => entry.provider === provider)?.modelCapabilities?.[model];
}

function contextUsageWindowEvidence(
  providerId: string,
  modelId: string | undefined,
  capabilities: GuiProviderModelCapabilities | undefined,
  discovery: readonly GuiProviderDiscoveryResult[],
) {
  const tokens = capabilities?.contextWindow;
  if (!modelId || !Number.isInteger(tokens) || !tokens || tokens < 1) return undefined;
  const status = discovery.find((entry) => entry.provider === providerId)?.status;
  return {
    providerId,
    modelId,
    tokens,
    authority: "runtime_observed" as const,
    freshness: status === "stale" ? "stale" as const : "fresh" as const,
  };
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
  /**
   * Fallback ordinal for tool_use/tool_result events forwarded outside any active turn capture
   * (e.g. an orphaned event arriving after `endTurnCapture`). Deterministic per connection --
   * never a timestamp or random value -- because nothing in this no-capture path is persisted
   * or replayed; it only feeds the live activity stream to the connected browser.
   */
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
    kind: "assistant_delta" | "provider_routed" | "tool_call_started" | "tool_call_output_delta" | "tool_call_completed" | "approval_requested" | "approval_resolved" | "file_changed" | "browser_operator_evidence";
    timestamp: string;
    payload: Record<string, unknown>;
    parentEventId?: string;
    executionScope?: ExecutionSessionEvent["executionScope"];
  }): void {
    if (!this.ws || !this.capture) {
      return;
    }
    const sequence = this.nextLiveSequence();
    if (sequence === null) {
      return;
    }
    const eventId = `${this.capture.sessionId}:live:${sequence}`;
    const turnId = `${this.capture.sessionId}:turn:live`;
    this.ws.send(JSON.stringify({
      type: "session_event",
      event: {
        eventId,
        kilnSessionId: this.capture.sessionId,
        sequence,
        timestamp: input.timestamp,
        kind: input.kind,
        turnId,
        ...(input.parentEventId ? { parentEventId: input.parentEventId } : {}),
        ...(input.executionScope ? { executionScope: input.executionScope } : {}),
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

  forward(event: ExecutionSessionEvent): void {
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
        ...(event.executionScope ? { executionScope: event.executionScope } : {}),
      });
    } else if (event.type === "tool_use") {
      assertScopedExecutionSessionToolEvent(event);
      this.emitSessionEvent({
        kind: "tool_call_started",
        timestamp: new Date().toISOString(),
        payload: {
          toolCallId: event.toolCallId,
          toolCallScopeId: event.toolCallScopeId,
          toolName: event.toolName ?? "unknown",
          input: (event.input && typeof event.input === "object" ? event.input : {}) as Record<string, unknown>,
          ...resolveAttachedRuntimeToolCallMetadata(this.toolCallMetadata, event.toolName, event.input),
        },
        ...(event.executionScope ? { executionScope: event.executionScope } : {}),
      });
      this.emitActivityPhase({
        phase: "tool_running",
        toolName: event.toolName,
      });
    } else if (event.type === "tool_output_delta") {
      assertScopedExecutionSessionToolEvent(event);
      this.emitSessionEvent({
        kind: "tool_call_output_delta",
        timestamp: new Date().toISOString(),
        payload: {
          toolCallId: event.toolCallId,
          toolCallScopeId: event.toolCallScopeId,
          toolName: event.toolName,
          stream: event.stream,
          delta: event.delta,
          chunkIndex: event.chunkIndex,
        },
        ...(event.executionScope ? { executionScope: event.executionScope } : {}),
      });
    } else if (event.type === "tool_result") {
      assertScopedExecutionSessionToolEvent(event);
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
          toolCallScopeId: event.toolCallScopeId,
          ...buildOperatorToolResultPayload({
            toolCallId: event.toolCallId,
            toolName: event.toolName ?? "unknown",
            output: event.output,
            outputSummary: event.outputSummary,
            isError: event.isError,
            metadata: event.metadata,
            resourceLinks: event.resourceLinks,
            toolUsage: event.toolUsage,
          }),
        },
        ...(event.executionScope ? { executionScope: event.executionScope } : {}),
      });
      const interactiveFrame = projectInteractiveUseFrameFromToolResult({
        ...(this.capture?.sessionId ? { kilnSessionId: this.capture.sessionId } : {}),
        toolCallId: event.toolCallId,
        toolCallScopeId: event.toolCallScopeId,
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
    readonly gatewayTargetId?: string;
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
          ...(input.gatewayTargetId ? { gatewayTargetId: input.gatewayTargetId } : {}),
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
