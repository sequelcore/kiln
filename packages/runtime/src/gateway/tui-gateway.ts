import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import {
  buildOperatorToolResultPayload,
  isGuiProviderModeless,
  type GuiAuthorityStatus,
  type GuiInboundFrame,
  type GuiProviderDiscoveryResult,
  type GuiProviderModelCapabilities,
  type GuiProviderModelDiscoveryProjection,
  type GuiProviderModelRouteHealth,
  type GuiSessionTurnOutcome,
  type OperatorExecutionMode,
  type OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";
import { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import type { RuntimeBudgetAdmissionPort } from "../session/runtime-budget-admission.js";
import { SessionRegistry } from "../session/persistence/session-registry.js";
import {
  textParts,
  extractText,
  EventBus,
  type ApprovalRequestedEvent,
  type ApprovalReceivedEvent,
  type CanonicalSessionEvent,
  type KilnEvent,
  type ToolAuthorizedEvent,
  type DefaultBuiltinToolRegistryOptions,
  type ContextArtifactCache,
  type ArtifactResourceStore,
  type ContentPart,
  type SttAdapter,
  type TtsAdapter,
  type VoiceConfig,
  defineTurnTemporalContext,
  type TurnTemporalContext,
  assertScopedExecutionSessionToolEvent,
  type ExecutionSessionEvent,
} from "@kilnai/core";
import { toCoreDeliberationIntent, toCoreModelCapabilities } from "./deliberation-projection.js";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";
import type { CliDeliberationTransport, CliSessionFactory } from "../execution/cli-subscription-executor.js";
import { ApprovalGateRegistry } from "./approval-registry.js";
import { processAdmittedTurn, sanitizeAssistantEgressText } from "./message-pipeline/index.js";
import type { RuntimeSessionHydrator } from "./message-pipeline/index.js";
import { synthesizeVoiceOutputOnDemand } from "./voice-output-synthesizer.js";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  resolveAttachedRuntimeToolCallMetadata,
  type AttachedRuntimeBuiltinToolSurface,
} from "./attached-runtime-tool-surface.js";
import {
  attachManagedInvocationSessionEventSink,
  withManagedInvocationService,
  type ManagedInvocationToolAttachment,
} from "../agents/managed-invocation/runtime-tool/index.js";
import { createOperatorThemeBridge } from "./operator-theme-bridge.js";
import { toOperatorSessionEventFrame } from "./operator-session-event-frame.js";
import { approvePlanExecutionTransition } from "./plan-approval-transition.js";
import {
  markGuiProviderDiscoveryStale,
  projectGuiProviderModelDiscovery,
  projectGuiOperatorModels,
  providerRequiresSelectedModelMessage,
  resolveGuiOperatorDiscoveryResults,
} from "./gui-provider-models.js";
import { createProviderCatalogService } from "./provider-catalog-service.js";
import { startProviderAuthRequest } from "./provider-auth.js";
import type {
  RuntimeTurnApprovalTransition,
  RuntimeTurnAuthorityDecision,
  RuntimeTurnFileChange,
  RuntimeTurnToolCompletion,
} from "../session/runtime-turn-record.js";

type BunHonoAdapters = typeof import("hono/bun");
const TUI_OPERATOR_COCKPIT_INSTANCE_ID = "local-tui";

async function loadBunHonoAdapters(): Promise<BunHonoAdapters> {
  return import("hono/bun");
}

/**
 * Provider switch handler - called by the gateway when user switches provider.
 */
export type OnProviderSwitch = (provider: string) => void | Promise<void>;

export interface TuiGatewayOptions {
  /** Port for the TUI gateway. Default: 4801. */
  readonly port?: number;
  /**
   * Multi-provider session manager (injected by packages/cli/src/commands/tui.ts).
   * Provides factory + provider/model get/set for cross-provider session support.
   */
  readonly sessionManager: {
    readonly factory: CliSessionFactory;
    getProvider: () => string;
    getDeliberationTransport?: () => CliDeliberationTransport;
    setProvider: (provider: string) => void;
    getModel: () => string;
    setModel: (model: string) => void;
  };
  /** System prompt for the TUI session. Default: "You are a helpful assistant." */
  readonly systemPrompt?: string;
  /** IANA timezone from the operator's validated global identity. */
  readonly operatorTimeZone?: string;
  /**
   * Optional callback invoked when the TUI sends a { type: "clear" } frame.
   * Should reset the persisted session ID so the next turn starts fresh.
   * Fail-open: errors are swallowed and { type: "cleared" } is still sent.
   */
  readonly onClear?: () => Promise<void>;
  /** Optional callback invoked when user switches provider in TUI. */
  readonly onProviderSwitch?: OnProviderSwitch;
  /** Optional context-artifact cache used to hydrate and persist runtime summaries. */
  readonly contextArtifactCache?: ContextArtifactCache;
  /** Artifact store used to persist replayable multimodal turn inputs. */
  readonly artifactStore?: ArtifactResourceStore;
  readonly voiceConfig?: VoiceConfig;
  readonly sttAdapter?: SttAdapter;
  readonly ttsAdapter?: TtsAdapter;
  /** Event bus for listening to approval events. */
  readonly eventBus?: EventBus;
  /** Initial shared execution mode for operator work. */
  readonly executionMode?: OperatorExecutionMode;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly managedInvocation?: ManagedInvocationToolAttachment;
  readonly budgetAdmission?: RuntimeBudgetAdmissionPort;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
  readonly getProviderAvailability?: () => Promise<Record<string, boolean>> | Record<string, boolean>;
  readonly initialProviderDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly onProviderDiscoveryResolved?: (discovery: readonly GuiProviderDiscoveryResult[]) => void;
}

export interface TuiGateway {
  /** WebSocket URL to connect to. e.g. "ws://localhost:4801/tui/ws" */
  readonly url: string;
  readonly port: number;
  readonly models: Record<string, string[]>;
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection;
  /** Gracefully stop the gateway server. */
  shutdown(): void;
}

const TUI_APP_NAME = "kiln-tui";
const TUI_TENANT_ID = "_tui";

function tuiProviderAuthDebug(message: string, context?: Record<string, unknown>): void {
  if (!/^(1|true|yes)$/i.test(process.env.KILN_PROVIDER_AUTH_DEBUG?.trim() ?? "")) {
    return;
  }
  console.warn(`[tui-gateway:provider-auth][debug] ${message}`, context ?? {});
}

export type TuiAuthorityStatus = GuiAuthorityStatus;

export function buildTuiPerCallToolConfig(): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: TUI_TENANT_ID,
  });
}

export function deriveTuiAuthorityStatusFromPerCallConfig(
  config: PerCallToolConfig,
): TuiAuthorityStatus {
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

export function deriveTuiDoneAuthorityStatus(
  turnPerCallConfig: PerCallToolConfig | undefined,
  fallbackPerCallConfig: PerCallToolConfig = buildTuiPerCallToolConfig(),
): TuiAuthorityStatus {
  return deriveTuiAuthorityStatusFromPerCallConfig(turnPerCallConfig ?? fallbackPerCallConfig);
}

export function buildTuiWelcomeFramePayload(input: {
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection;
  readonly models: Record<string, string[]>;
  readonly providerDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly executionMode: OperatorExecutionMode;
  readonly authorityStatus: TuiAuthorityStatus;
}): {
  readonly type: "welcome";
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection;
  readonly models: Record<string, string[]>;
  readonly providerDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly executionMode: OperatorExecutionMode;
  readonly authorityStatus: TuiAuthorityStatus;
} {
  return {
    type: "welcome",
    providerModelDiscovery: input.providerModelDiscovery,
    models: input.models,
    ...(input.providerDiscovery ? { providerDiscovery: input.providerDiscovery } : {}),
    executionMode: input.executionMode,
    authorityStatus: input.authorityStatus,
  };
}

export function buildTuiTurnPerCallConfig(
  activeProvider: string,
  activeModel: string | undefined,
  builtinToolSurface: AttachedRuntimeBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface(),
  activeModelCapabilities?: GuiProviderModelCapabilities,
  deliberationIntent?: PerCallToolConfig["deliberationIntent"],
  executionMode: OperatorExecutionMode = "execute",
  requestedAuthority?: OperatorTurnRequestedAuthority,
  temporalContext?: TurnTemporalContext,
): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: TUI_TENANT_ID,
    activeProvider,
    activeModel,
    ...(activeModelCapabilities ? { activeModelCapabilities: toCoreModelCapabilities(activeModelCapabilities) } : {}),
    ...(deliberationIntent ? { deliberationIntent } : {}),
    builtinToolSurface,
    executionMode,
    requestedAuthority,
    ...(temporalContext ? { temporalContext } : {}),
  });
}

function resolveExecutionMode(value: unknown): OperatorExecutionMode {
  return value === "plan" ? "plan" : "execute";
}

export function resolveTuiRequestedAuthority(value: unknown): OperatorTurnRequestedAuthority | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "auto" || value === "read_only" || value === "audited" || value === "destructive") {
    return value;
  }
  throw new Error(`Unknown requested authority '${String(value)}'.`);
}

function findProviderModelCapabilities(
  discovery: readonly GuiProviderDiscoveryResult[],
  provider: string | undefined,
  model: string | undefined,
): GuiProviderModelCapabilities | undefined {
  if (!provider || !model) return undefined;
  return discovery.find((entry) => entry.provider === provider)?.modelCapabilities?.[model];
}

function buildTuiContextUsageWindowEvidence(
  providerId: string,
  modelId: string | undefined,
  capabilities: GuiProviderModelCapabilities | undefined,
  discovery: readonly GuiProviderDiscoveryResult[],
) {
  const tokens = capabilities?.contextWindow;
  if (!modelId || !Number.isInteger(tokens) || !tokens || tokens < 1) {
    return undefined;
  }
  const status = discovery.find((entry) => entry.provider === providerId)?.status;
  return {
    providerId,
    modelId,
    tokens,
    authority: "runtime_observed" as const,
    freshness: status === "stale" ? "stale" as const : "fresh" as const,
  };
}

function findProviderModelRouteHealth(
  discovery: readonly GuiProviderDiscoveryResult[],
  provider: string | undefined,
  model: string | undefined,
): GuiProviderModelRouteHealth | undefined {
  if (!provider || !model) return undefined;
  return discovery.find((entry) => entry.provider === provider)?.modelRouteHealth?.[model];
}

export function buildTuiDoneFramePayload(input: {
  readonly sourceMessageId?: string;
  readonly content: string;
  readonly parts: readonly unknown[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly outcome: GuiSessionTurnOutcome;
  readonly routedProvider: string;
  readonly routedModel: string;
  readonly runtimeContinuity: {
    readonly strategy: string;
    readonly feedbackLabel?: string;
    readonly pressure?: string;
    readonly supportArtifactCount?: number;
    readonly supportArtifactSources?: readonly string[];
    readonly fallbackLabel?: string;
    readonly usedCachedSupport?: boolean;
    readonly selectionReason?: string;
  };
  readonly authorityStatus: TuiAuthorityStatus;
}): {
  readonly type: "done";
  readonly content: string;
  readonly parts: readonly unknown[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly outcome: GuiSessionTurnOutcome;
  readonly routedProvider: string;
  readonly routedModel: string;
  readonly runtimeContinuity: {
    readonly strategy: string;
    readonly feedbackLabel?: string;
    readonly pressure?: string;
    readonly supportArtifactCount?: number;
    readonly supportArtifactSources?: readonly string[];
    readonly fallbackLabel?: string;
    readonly usedCachedSupport?: boolean;
    readonly selectionReason?: string;
  };
  readonly authorityStatus: TuiAuthorityStatus;
} {
  return {
    type: "done",
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    content: input.content,
    parts: input.parts,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    outcome: input.outcome,
    routedProvider: input.routedProvider,
    routedModel: input.routedModel,
    runtimeContinuity: input.runtimeContinuity,
    authorityStatus: input.authorityStatus,
  };
}

/**
 * Start the in-process TUI gateway.
 *
 * Returns immediately after the server is listening.
 * The caller (tui.ts CLI command) holds the returned TuiGateway and calls
 * shutdown() on process exit.
 */
export async function startTuiGateway(options: TuiGatewayOptions): Promise<TuiGateway> {
  const port = options.port ?? 4801;
  const managedInvocation = options.managedInvocation
    ? {
        ...options.managedInvocation,
        options: withManagedInvocationService(options.managedInvocation.options),
      }
    : undefined;
  const builtinToolOptions = options.builtinToolOptions;
  const providerLabel = options.sessionManager.getProvider();
  const systemPrompt = options.systemPrompt ?? "You are a helpful assistant.";
  const providerCatalog = createProviderCatalogService<readonly GuiProviderDiscoveryResult[]>(
    () => resolveTuiProviderDiscovery(options.getProviderAvailability),
    [],
    {
      initialDiscovery: options.initialProviderDiscovery
        ? markGuiProviderDiscoveryStale(options.initialProviderDiscovery)
        : undefined,
      onDiscoveryResolved: options.onProviderDiscoveryResolved,
    },
  );
  let providerDiscovery = providerCatalog.snapshot().discovery;
  let models = projectGuiOperatorModels(providerDiscovery);
  const applyDiscovery = (nextDiscovery: readonly GuiProviderDiscoveryResult[]): readonly GuiProviderDiscoveryResult[] => {
    providerDiscovery = nextDiscovery;
    models = projectGuiOperatorModels(providerDiscovery);
    return providerDiscovery;
  };
  const refreshDiscovery = async (
    refreshOptions?: { readonly force?: boolean },
  ): Promise<readonly GuiProviderDiscoveryResult[]> => applyDiscovery(
    (await providerCatalog.refresh(refreshOptions)).discovery,
  );
  const readDiscovery = (): readonly GuiProviderDiscoveryResult[] => applyDiscovery(providerCatalog.snapshot().discovery);

  const approvalRegistry = new ApprovalGateRegistry();

  // Activity streamer: bridges CLI session events to the active WS connection
  const activityStreamer = new TuiActivityStreamer(approvalRegistry);
  const builtinToolSurface = createAttachedRuntimeBuiltinToolSurface({
    builtinToolOptions,
    managedInvocation: attachManagedInvocationSessionEventSink(
      managedInvocation,
      { publish: (events) => activityStreamer.forwardSessionEvents(events) },
    ),
  });
  const resourceSurfaces: AttachedRuntimeBuiltinToolSurface[] = [builtinToolSurface];
  const rememberToolSurface = (surface: AttachedRuntimeBuiltinToolSurface): void => {
    resourceSurfaces.unshift(surface);
    resourceSurfaces.splice(8);
  };
  activityStreamer.setToolCallMetadata(builtinToolSurface.toolCallMetadata);
  let activeOperatorSurface: { theme: { setTheme: ReturnType<typeof createOperatorThemeBridge>["request"] } } | undefined;

  const executor = new CliSubscriptionExecutor(
    options.sessionManager.factory,
    providerLabel,
    (event) => activityStreamer.forward(event),
    () => activeOperatorSurface,
    () => options.sessionManager.getDeliberationTransport?.() ?? "none",
  );
  const eventBus = options.eventBus ?? new EventBus(100);
  const orchestrator = new RuntimeSessionOrchestrator({
    provider: executor,
    eventBus,
    builtinTools: builtinToolSurface.callBuiltinTools,
    ...(options.budgetAdmission ? { budgetAdmission: options.budgetAdmission } : {}),
  });
  const sessionRegistry = new SessionRegistry();
  const voiceSynthesisSources = new Map<string, { readonly parts: readonly ContentPart[]; readonly sessionId: string }>();
  activityStreamer.bindApprovalBridge({
    approve: (approvalId) => orchestrator.continue(approvalId),
    reject: (approvalId, reason) => orchestrator.emitApprovalReceived(false, reason, approvalId),
  });

  const { upgradeWebSocket, websocket } = (await loadBunHonoAdapters()).createBunWebSocket();

  const app = new Hono();

  // Health check — polled by the CLI to confirm gateway is ready
  app.get("/health", (c) => c.json({ status: "ok", channel: "tui" }));

  // TUI WebSocket endpoint — no widgetId, no tenant, just userId
  app.get(
    "/tui/ws",
    upgradeWebSocket((c) => {
      const userId = c.req.query("userId") ?? crypto.randomUUID();
      let operatorSocket: WSContext | null = null;
      let unsubscribeDiscovery: (() => void) | undefined;
      const operatorThemeBridge = createOperatorThemeBridge((frame) => {
        operatorSocket?.send(JSON.stringify(frame));
      });
      activeOperatorSurface = { theme: { setTheme: operatorThemeBridge.request } };

      return {
        async onOpen(_event: Event, ws: WSContext) {
          operatorSocket = ws;
          activityStreamer.register(ws, eventBus);
          unsubscribeDiscovery?.();
          unsubscribeDiscovery = providerCatalog.subscribe((snapshot) => {
            const currentDiscovery = applyDiscovery(snapshot.discovery);
            ws.send(JSON.stringify({
              type: "providers_refreshed",
              providerModelDiscovery: projectGuiProviderModelDiscovery(currentDiscovery),
              models: projectGuiOperatorModels(currentDiscovery),
              providerDiscovery: currentDiscovery,
            }));
          });
          const activeProvider = options.sessionManager.getProvider();
          const storedModel = options.sessionManager.getModel().trim();
          const currentDiscovery = readDiscovery();
          const currentModels = projectGuiOperatorModels(currentDiscovery);
          const providerModels = currentModels[activeProvider];
          let activeModel = storedModel.length > 0 ? storedModel : undefined;
          if (providerModels?.length === 0 && isGuiProviderModeless(activeProvider)) {
            if (activeModel) {
              options.sessionManager.setModel("");
            }
            activeModel = undefined;
          }
          const activeModelCapabilities = findProviderModelCapabilities(
            currentDiscovery,
            activeProvider,
            activeModel,
          );
          const authorityStatus = deriveTuiAuthorityStatusFromPerCallConfig(
            buildTuiTurnPerCallConfig(
              activeProvider,
              activeModel,
              builtinToolSurface,
              activeModelCapabilities,
            ),
          );
          ws.send(JSON.stringify(buildTuiWelcomeFramePayload({
            providerModelDiscovery: projectGuiProviderModelDiscovery(currentDiscovery),
            models: currentModels,
            providerDiscovery: currentDiscovery,
            executionMode: options.executionMode ?? "execute",
            authorityStatus,
          })));
        },

        async onMessage(event: MessageEvent, ws: WSContext) {
          try {
            const raw = typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer);

            const frame = JSON.parse(raw) as Record<string, unknown>;

            if (frame.type === "operator_theme_set_result") {
              operatorThemeBridge.resolve(frame as {
                type: "operator_theme_set_result";
                requestId: string;
                ok: boolean;
                appliedTheme?: string;
                error?: string;
              });
              return;
            }

            if (frame.type === "clear") {
              try {
                await options.onClear?.();
              } catch {
                // Fail-open: log nothing, still acknowledge
              }
              ws.send(JSON.stringify({ type: "cleared" }));
              return;
            }

            if (frame.type === "refresh_providers") {
              const currentDiscovery = await refreshDiscovery({ force: true });
              ws.send(JSON.stringify({
                type: "providers_refreshed",
                providerModelDiscovery: projectGuiProviderModelDiscovery(currentDiscovery),
                models: projectGuiOperatorModels(currentDiscovery),
                providerDiscovery: currentDiscovery,
              }));
              return;
            }

            if (frame.type === "provider_auth") {
              tuiProviderAuthDebug("received frame", {
                provider: typeof frame.provider === "string" ? frame.provider : null,
                requestId: typeof frame.requestId === "string" ? frame.requestId : null,
              });
              const auth = await startProviderAuthRequest(frame);
              if (!auth.ok) {
                tuiProviderAuthDebug("request rejected", {
                  provider: auth.provider,
                  requestId: auth.requestId,
                  error: auth.error,
                });
                ws.send(JSON.stringify({
                  type: "provider_auth_failed",
                  provider: auth.provider,
                  requestId: auth.requestId,
                  message: auth.error,
                }));
                return;
              }
              if (auth.started) {
                tuiProviderAuthDebug("sending started frame", {
                  provider: auth.provider,
                  requestId: auth.requestId,
                  method: auth.method,
                });
                ws.send(JSON.stringify(auth.started));
              }
              try {
                tuiProviderAuthDebug("waiting for completion", {
                  provider: auth.provider,
                  requestId: auth.requestId,
                  method: auth.method,
                });
                await auth.complete();
              } catch (error) {
                tuiProviderAuthDebug("completion failed", {
                  provider: auth.provider,
                  requestId: auth.requestId,
                  error: error instanceof Error ? error.message : String(error),
                });
                ws.send(JSON.stringify({
                  type: "provider_auth_failed",
                  provider: auth.provider,
                  requestId: auth.requestId,
                  message: error instanceof Error ? error.message : "Provider authentication failed.",
                }));
                return;
              }
              tuiProviderAuthDebug("completion succeeded; refreshing discovery", {
                provider: auth.provider,
                requestId: auth.requestId,
              });
              const currentDiscovery = await refreshDiscovery({ force: true });
              const providerDiscovery = currentDiscovery.find((entry) => entry.provider === auth.provider);
              tuiProviderAuthDebug("discovery refreshed after auth", {
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
              }));
              return;
            }

            if (frame.type === "provider") {
              const requestId = typeof frame.requestId === "string" && frame.requestId.trim().length > 0
                ? frame.requestId.trim()
                : undefined;
              if (!requestId) {
                ws.send(JSON.stringify({ type: "error", message: "Provider switch requestId is required" }));
                return;
              }
              const currentDiscovery = await refreshDiscovery();
              const resolution = resolveTuiProviderSwitch({
                provider: frame.provider,
                model: frame.model,
                discovery: currentDiscovery,
                providerModelDiscovery: projectGuiProviderModelDiscovery(currentDiscovery),
              });
              if (!resolution.ok) {
                ws.send(JSON.stringify({
                  type: "provider_change_failed",
                  provider: frame.provider,
                  ...(frame.model ? { model: frame.model } : {}),
                  requestId,
                  reason: resolution.error,
                }));
                return;
              }
              options.sessionManager.setProvider(resolution.provider);
              options.sessionManager.setModel(resolution.model);
              options.onProviderSwitch?.(resolution.provider);
              const providerChangedFrame = {
                type: "provider_changed",
                provider: resolution.provider,
                requestId,
                ...(resolution.model ? { model: resolution.model } : {}),
              };
              ws.send(JSON.stringify(providerChangedFrame));
              return;
            }

            if (frame.type === "execution_mode_transition") {
              const toMode = resolveExecutionMode(frame.toMode);
              if (toMode === "execute") {
                const transition = await approvePlanExecutionTransition({
                  surfaces: resourceSurfaces,
                  planId: typeof frame.planId === "string" ? frame.planId : undefined,
                  sessionRegistry,
                  appName: TUI_APP_NAME,
                  tenantId: TUI_TENANT_ID,
                  userId,
                  sourceSurface: "tui",
                  component: "tui-gateway",
                  residualRiskAcknowledged: typeof frame.residualRiskAcknowledged === "boolean"
                    ? frame.residualRiskAcknowledged
                    : true,
                  residualRiskAcknowledgement: typeof frame.residualRiskAcknowledgement === "string"
                    ? frame.residualRiskAcknowledgement
                    : "Operator requested execute mode from the TUI after reviewing the current plan.",
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
                ws.send(JSON.stringify(transition.frame));
                return;
              }
              ws.send(JSON.stringify({ type: "execution_mode_transitioned", executionMode: toMode }));
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
                  options.voiceConfig,
                  options.ttsAdapter,
                  {
                    artifactStore: options.artifactStore,
                    appName: TUI_APP_NAME,
                    tenantId: TUI_TENANT_ID,
                    userId,
                    channel: "tui",
                    sessionId: source.sessionId,
                    model: options.sessionManager.getModel() || "gateway-transform",
                    retentionMaxArtifacts: options.voiceConfig?.policy?.artifacts?.retentionMaxArtifacts,
                  },
                );
                if (!voiceSynthesis.voiceOutput) {
                  ws.send(JSON.stringify({
                    type: "voice_synthesis_failed",
                    requestId,
                    sourceMessageId,
                    message: "On-demand voice synthesis is not enabled for the TUI surface.",
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

            // Handle approval responses from TUI
            if (frame.type === "approve") {
              const approvalId = typeof frame.approvalId === "string" ? frame.approvalId : undefined;
              const result = approvalRegistry.approve(approvalId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Approval failed" }));
              }
              return;
            }
            if (frame.type === "reject") {
              const approvalId = typeof frame.approvalId === "string" ? frame.approvalId : undefined;
              const reason = typeof frame.reason === "string" ? frame.reason : "rejected by user";
              const result = approvalRegistry.reject(reason, approvalId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Rejection failed" }));
              }
              return;
            }

            if (frame.type !== "message") return;

            const userContent = typeof frame.content === "string"
              ? frame.content
              : "";

            if (!userContent.trim()) return;
            // Send "thinking" status to indicate work has started
            ws.send(JSON.stringify({ type: "thinking" }));
            let result;
            let turnPerCallConfig: PerCallToolConfig | undefined;
            let turnProvider: string | undefined;
            let turnModel: string | undefined;
            try {
              const currentDiscovery = await refreshDiscovery();
              const activeProvider = options.sessionManager.getProvider();
              const activeDiscovery = currentDiscovery.find((entry) => entry.provider === activeProvider);
              const providerModels = activeDiscovery?.available ? activeDiscovery.models : undefined;
              if (!providerModels || (providerModels.length === 0 && !isGuiProviderModeless(activeProvider))) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: activeDiscovery?.reason ?? `Provider '${activeProvider}' is unavailable`,
                }));
                return;
              }
              const storedModel = options.sessionManager.getModel().trim();
              let activeModel = storedModel.length > 0 ? storedModel : undefined;
              if (providerModels.length === 0 && isGuiProviderModeless(activeProvider)) {
                if (activeModel) {
                  options.sessionManager.setModel("");
                }
                activeModel = undefined;
              }
              if (providerModels.length > 0 && !activeModel) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: providerRequiresSelectedModelMessage(activeProvider),
                }));
                return;
              }
              if (activeModel && !providerModels.includes(activeModel)) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: `Provider '${activeProvider}' does not advertise model '${activeModel}'`,
                }));
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
                }));
                return;
              }
              const activeModelCapabilities = findProviderModelCapabilities(
                currentDiscovery,
                activeProvider,
                activeModel,
              );
              const deliberationIntent = toCoreDeliberationIntent(frame.deliberationIntent);
              const executionMode = resolveExecutionMode(frame.executionMode);
              const requestedAuthority = resolveTuiRequestedAuthority(frame.requestedAuthority);
              turnProvider = activeProvider;
              turnModel = activeModel;
              const turnBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface({
                builtinToolOptions,
                executionMode,
                managedInvocation: attachManagedInvocationSessionEventSink(
                  managedInvocation,
                  { publish: (events) => activityStreamer.forwardSessionEvents(events) },
                ),
                operatorSurface: {
                  theme: {
                    setTheme: operatorThemeBridge.request,
                  },
                },
              });
              rememberToolSurface(turnBuiltinToolSurface);
              turnPerCallConfig = buildTuiTurnPerCallConfig(
                activeProvider,
                activeModel,
                turnBuiltinToolSurface,
                activeModelCapabilities,
                deliberationIntent,
                executionMode,
                requestedAuthority,
                options.operatorTimeZone
                  ? defineTurnTemporalContext({
                    observedAt: new Date().toISOString(),
                    timeZone: options.operatorTimeZone,
                  })
                  : undefined,
              );
              result = await processAdmittedTurn({
                orchestrator,
                sessionRegistry,
                appName: TUI_APP_NAME,
                tenantId: TUI_TENANT_ID,
                userId,
                systemPrompt,
                userParts: textParts(userContent),
                channel: "tui",
                resumeSessionHydrator: options.resumeSessionHydrator,
                providerValidation: currentDiscovery,
                contextUsageWindow: buildTuiContextUsageWindowEvidence(
                  activeProvider,
                  activeModel,
                  activeModelCapabilities,
                  currentDiscovery,
                ),
                publishCanonicalSessionEvents: (events) => activityStreamer.forwardSessionEvents(
                  events.filter((event) => event.kind === "context_usage_observed"),
                ),
                executionMode,
                contextArtifactCache: options.contextArtifactCache,
                artifactStore: options.artifactStore,
                voiceConfig: options.voiceConfig,
                sttAdapter: options.sttAdapter,
                ttsAdapter: options.ttsAdapter,
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
              }));
              return;
            }

            if (!result.ok) {
              ws.send(JSON.stringify({
                type: "error",
                message: result.budgetDenied.message,
              }));
              return;
            }
            const output = result.result;
            const runtimeContinuity = output.runtimeContinuity ?? { strategy: "none" };
            if (!turnProvider) {
              ws.send(JSON.stringify({
                type: "error",
                message: "Runtime completed without a provider route.",
              }));
              return;
            }
            const routedProvider = output.routingDecision?.provider ?? turnProvider;
            const fallbackRoutedModel = isGuiProviderModeless(routedProvider)
              ? ""
              : turnModel ?? "";
            const routedModel = output.routingDecision?.model ?? fallbackRoutedModel;
            const authorityStatus = deriveTuiDoneAuthorityStatus(turnPerCallConfig);
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
            ws.send(JSON.stringify(buildTuiDoneFramePayload({
              sourceMessageId,
              content: extractText(output.parts),
              parts: output.parts,
              inputTokens: output.inputTokens,
              outputTokens: output.outputTokens,
              outcome: output.outcome,
              routedProvider,
              routedModel,
              runtimeContinuity,
              authorityStatus,
            })));
          } catch {
            // Discard malformed frames
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
          operatorThemeBridge.rejectAll("Operator surface disconnected before applying the theme.");
          activityStreamer.unregister(ws);
          // Session persists across reconnects (stored in sessionRegistry)
        },
      };
    }),
  );

  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  });
  providerCatalog.startBackgroundRefresh({ force: true });

  return {
    url: `ws://localhost:${port}/tui/ws`,
    port,
    get models() {
      readDiscovery();
      return models;
    },
    get providerDiscovery() {
      readDiscovery();
      return providerDiscovery;
    },
    get providerModelDiscovery() {
      readDiscovery();
      return projectGuiProviderModelDiscovery(providerDiscovery);
    },
    shutdown: () => server.stop(),
  };
}

/**
 * Bridges CLI session events to the active WebSocket connection.
 *
 * The TUI gateway has exactly one WS connection at a time. This class
 * holds a reference to the current WS and forwards activity events
 * (tool_use, tool_result, cost_update, thinking) as they arrive from
 * the CliSubscriptionExecutor.
 */
class TuiActivityStreamer {
  private readonly pendingApprovals = new Set<string>();
  private capture: {
    sessionId: string;
    nextSequence: number;
    fileChanges: RuntimeTurnFileChange[];
    approvalTransitions: RuntimeTurnApprovalTransition[];
    authorityDecisions: RuntimeTurnAuthorityDecision[];
    toolCompletions: RuntimeTurnToolCompletion[];
  } | null = null;
  private ws: WSContext | null = null;
  private eventBus: EventBus | null = null;
  private approvalHandler: ((event: import("@kilnai/core").KilnEvent) => void) | null = null;
  private receivedHandler: ((event: import("@kilnai/core").KilnEvent) => void) | null = null;
  private authorizedHandler: ((event: import("@kilnai/core").KilnEvent) => void) | null = null;
  private approvalBridge: {
    approve: (approvalId: string) => void;
    reject: (approvalId: string, reason: string) => void;
  } | null = null;

  private toolCallMetadata: NonNullable<PerCallToolConfig["toolCallMetadata"]> = new Map();

  constructor(private readonly approvalRegistry: ApprovalGateRegistry) {}

  setToolCallMetadata(metadata: NonNullable<PerCallToolConfig["toolCallMetadata"]>): void {
    this.toolCallMetadata = metadata;
  }

  bindApprovalBridge(bridge: {
    approve: (approvalId: string) => void;
    reject: (approvalId: string, reason: string) => void;
  }): void {
    this.approvalBridge = bridge;
  }

  beginTurnCapture(sessionId: string, nextSequence: number): void {
    this.capture = {
      sessionId,
      nextSequence,
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
    kind: "assistant_delta" | "tool_call_started" | "tool_call_output_delta" | "tool_call_completed" | "approval_requested" | "approval_resolved" | "file_changed";
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
          surface: "tui",
          component: "tui-gateway",
        },
        payload: input.payload,
      },
    } satisfies GuiInboundFrame));
  }

  forwardSessionEvents(events: readonly CanonicalSessionEvent[]): void {
    if (!this.ws) return;
    for (const event of events) {
      const sequence = this.nextLiveSequence() ?? event.sequence;
      this.ws.send(JSON.stringify(toOperatorSessionEventFrame(event, {
        eventId: `${event.eventId}:live`,
        sequence,
        instanceId: TUI_OPERATOR_COCKPIT_INSTANCE_ID,
      }) satisfies GuiInboundFrame));
    }
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
    if (this.eventBus && this.authorizedHandler) {
      this.eventBus.offAny(this.authorizedHandler);
      this.authorizedHandler = null;
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
          messageId: this.capture ? `${this.capture.sessionId}:live:assistant` : "assistant-live",
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
    // completed/error are handled by the gateway's done/error frames.
    // approval_requested/approval_received come via eventBus, not execution session events.
  }
}

async function resolveTuiProviderDiscovery(
  getProviderAvailability?: () => Promise<Record<string, boolean>> | Record<string, boolean>,
): Promise<GuiProviderDiscoveryResult[]> {
  const providerAvailability = getProviderAvailability
    ? await Promise.resolve(getProviderAvailability()).catch(() => ({}))
    : {};
  return resolveGuiOperatorDiscoveryResults(providerAvailability);
}

export function resolveTuiProviderSwitch(input: {
  readonly provider: unknown;
  readonly model: unknown;
  readonly models?: Record<string, string[]>;
  readonly discovery?: readonly GuiProviderDiscoveryResult[];
  readonly providerModelDiscovery?: GuiProviderModelDiscoveryProjection;
}):
  | { readonly ok: true; readonly provider: string; readonly model: string }
  | { readonly ok: false; readonly error: string } {
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (!provider) {
    return { ok: false, error: "Provider switch request must include a provider id" };
  }

  const discoveryResult = input.discovery?.find((entry) => entry.provider === provider);
  if (discoveryResult && !discoveryResult.available) {
    return { ok: false, error: discoveryResult.reason };
  }
  const discoveredProviderModels = input.providerModelDiscovery
    ? input.providerModelDiscovery.entries
        .filter((entry) => entry.providerRoute.providerId === provider)
        .map((entry) => entry.providerRoute.providerModelId)
    : discoveryResult
      ? [...discoveryResult.models]
      : input.models?.[provider];
  if (!discoveredProviderModels) {
    return { ok: false, error: `Provider '${provider}' is unavailable` };
  }
  const providerModels = isGuiProviderModeless(provider) ? [] : discoveredProviderModels;
  if (providerModels.length === 0) {
    if (!isGuiProviderModeless(provider)) {
      return { ok: false, error: `Provider '${provider}' is unavailable` };
    }
    const requestedModel = typeof input.model === "string" ? input.model.trim() : "";
    if (requestedModel.length > 0) {
      return { ok: false, error: `Provider '${provider}' does not advertise model '${requestedModel}'` };
    }
    return { ok: true, provider, model: "" };
  }

  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model) {
    return { ok: false, error: providerRequiresSelectedModelMessage(provider) };
  }
  const canonicalRoute = input.providerModelDiscovery?.entries.find((entry) =>
    entry.providerRoute.providerId === provider
    && entry.providerRoute.providerModelId === model
  );
  if (input.providerModelDiscovery && !canonicalRoute) {
    return { ok: false, error: `Provider '${provider}' does not advertise model '${model}'` };
  }
  if (canonicalRoute && !canonicalRoute.eligibility.eligible) {
    return {
      ok: false,
      error: canonicalRoute.routeHealth.reason
        ?? `Provider '${provider}' model '${model}' is not eligible (${canonicalRoute.eligibility.reasonCodes.join(", ")})`,
    };
  }
  if (!input.providerModelDiscovery && !providerModels.includes(model)) {
    return { ok: false, error: `Provider '${provider}' does not advertise model '${model}'` };
  }
  const routeHealth = discoveryResult?.modelRouteHealth?.[model];
  if (!input.providerModelDiscovery && routeHealth && !routeHealth.healthy) {
    return {
      ok: false,
      error: routeHealth.reason ?? `Provider '${provider}' model '${model}' is cooling down`,
    };
  }

  return { ok: true, provider, model };
}
