import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import {
  buildOperatorToolResultPayload,
  type ExecutionRouteCatalog,
  isGuiProviderModeless,
  type GuiAuthorityStatus,
  type GuiInboundFrame,
  type GuiOutboundFrame,
  type GuiProviderDiscoveryResult,
  type GuiProviderModelCapabilities,
  type GuiProviderModelDiscoveryProjection,
  type OperatorSessionTurnOutcome,
  type OperatorExecutionMode,
  type OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";
import { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../session/runtime-session.js";
import {
  readRuntimeModelRoundAdmission,
  type RuntimeModelRoundDispatchContext,
} from "../execution-kernel/runtime-model-round-action-claim.js";
import type { RuntimeToolActionClaimsContext } from "../execution-kernel/runtime-tool-action-claim.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import type { RuntimeAuthorityAdmissionCandidateConfig } from "../session/runtime-session-orchestrator.types.js";
import type { RuntimeConfigurationRevisionProvider } from "../session/runtime-configuration-revision-pin.js";
import {
  readExecutionToolAllowlist,
  readExecutionTurnAuthority,
} from "../session/effective-authority-admission-bundle.js";
import type { RuntimeSessionTurnBudgetAuthority } from "../session/session-turn-budget-authority.js";
import type { AuthorityAdmissionEvidenceStore } from "../session/authority-admission-evidence.js";
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
  type TurnTemporalContext,
  defineTurnTemporalContext,
  assertScopedExecutionSessionToolEvent,
  type CommunicationIntentCandidate,
  type ExecutionSessionEvent,
} from "@kilnai/core";
import { toCoreDeliberationIntent, toCoreModelCapabilities } from "./deliberation-projection.js";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";
import type { CliDeliberationTransport, CliSessionFactory } from "../execution/cli-subscription-executor.js";
import { ApprovalGateRegistry } from "./approval-registry.js";
import { processAdmittedTurn, sanitizeAssistantEgressText } from "./message-pipeline/index.js";
import { resolveOperatorCommunicationIntent } from "./communication-intent-resolution.js";
import type { RuntimeSessionHydrator } from "./message-pipeline/index.js";
import { synthesizeVoiceOutputOnDemand } from "./voice-output-synthesizer.js";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  resolveAttachedRuntimeToolCallMetadata,
  type AttachedRuntimeBuiltinToolSurface,
  type AttachedRuntimeBuiltinToolSurfaceOptions,
} from "./attached-runtime-tool-surface.js";
import {
  attachManagedInvocationSessionEventSink,
  withManagedInvocationService,
  type ManagedInvocationToolAttachment,
} from "../agents/managed-invocation/runtime-tool/index.js";
import { createOperatorThemeBridge } from "./operator-theme-bridge.js";
import {
  LOCAL_OPERATOR_GATEWAY_HOST,
  localOperatorGatewayWebSocketUrl,
} from "./operator-gateway-network.js";
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
import { projectAvailableModelCatalogForExecutionRoutes } from "./available-model-catalog-projector.js";
import { startProviderAuthRequest } from "./provider-auth.js";
import type {
  RuntimeTurnApprovalTransition,
  RuntimeTurnAuthorityDecision,
  RuntimeTurnFileChange,
  RuntimeTurnToolCompletion,
} from "../session/runtime-turn-record.js";
import type { OperatorExecutionRouteSelectionPort } from "./operator-execution-route-selection.js";
import {
  fingerprintOperatorTurnIntent,
  type OperatorSessionAuthorityAdmissionBridge,
  type OperatorSessionExecutionBridge,
  type OperatorTurnDispatchPort,
  type OperatorTurnDispatchResult,
  type OperatorTurnTuiDispatchPayload,
} from "../execution-routing/operator-turn-dispatcher.js";
import type { OperatorSessionCommittedExecution } from "../execution-routing/operator-session-execution-routing-service.js";
import { OperatorAuthorityAdmissionCoordinator } from "../execution-routing/operator-authority-admission-coordinator.js";
import {
  defineOperatorAuthorityAdmissionFacets,
  defineOperatorSkillCatalogAdmission,
} from "../execution-routing/operator-authority-admission-facets.js";
import {
  hasGovernedGoalTools,
  prepareOperatorAdoptionTurn,
  requireOperatorAdoptionDecisionPersistence,
  type OperatorAdoptionDecisionPersistence,
} from "../session/operator-adoption-authority.js";

type BunHonoAdapters = typeof import("hono/bun");
const TUI_OPERATOR_COCKPIT_INSTANCE_ID = "local-tui";
const TUI_SESSION_AUTHORITY_CEILING = {
  maximumAuthority: "destructive" as const,
  reason: "The attended operator controls authority for this TUI session.",
};

async function loadBunHonoAdapters(): Promise<BunHonoAdapters> {
  return import("hono/bun");
}

export interface TuiGatewayOptions {
  /** Port for the TUI gateway. Default: 4801. */
  readonly port?: number;
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
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
  /** Route catalog projection and fail-closed admission supplied by composition. */
  readonly executionRouteSelection?: OperatorExecutionRouteSelectionPort;
  /** Per-turn routing authority. Picker admission is UX evidence only. */
  readonly operatorTurnDispatcher: OperatorTurnDispatchPort<OperatorTurnTuiDispatchPayload, OperatorTurnDispatchResult>;
  /** Composition-owned bridge bound to this gateway's local orchestrator. */
  readonly operatorTurnExecutionBridge: OperatorSessionExecutionBridge<any, OperatorTurnTuiDispatchPayload, OperatorTurnDispatchResult>;
  readonly operatorAuthorityAdmissionBridge: OperatorSessionAuthorityAdmissionBridge<OperatorTurnTuiDispatchPayload>;
  readonly authorityAdmissionEvidenceStore: AuthorityAdmissionEvidenceStore;
  readonly runtimeModelRoundActionClaims: import("../execution-kernel/runtime-model-round-action-claim.js").RuntimeModelRoundActionClaimStore;
  readonly runtimeToolActionClaims: import("../execution-kernel/runtime-tool-action-claim.js").RuntimeToolActionClaimStore;
  readonly runtimeMediaActionClaims: import("../execution-kernel/runtime-media-action-claim.js").RuntimeMediaActionClaimContext;
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
  readonly boundedWork?: AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"];
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
  /** Durable transcript sink required before governed goal tools can run. */
  readonly persistCanonicalSessionEvent?: OperatorAdoptionDecisionPersistence;
  readonly getProviderAvailability?: () => Promise<Record<string, boolean>> | Record<string, boolean>;
  readonly initialProviderDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly onProviderDiscoveryResolved?: (discovery: readonly GuiProviderDiscoveryResult[]) => void;
  /** Persisted sources retain provenance; a message-local user intent is added per turn. */
  readonly communicationIntentCandidates?: readonly CommunicationIntentCandidate[];
  /** Canonical configuration revision captured once at each admitted turn. */
  readonly runtimeConfigurationRevisionProvider?: RuntimeConfigurationRevisionProvider;
}

export interface TuiGateway {
  /** WebSocket URL to connect to. e.g. "ws://127.0.0.1:4801/tui/ws" */
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

interface TuiResourceSurfaceRegistration {
  readonly surface: AttachedRuntimeBuiltinToolSurface;
  /** Undefined is the gateway-wide base surface; turn surfaces are session-scoped. */
  readonly sessionId?: string;
}

function surfacesForTuiSession(
  registrations: readonly TuiResourceSurfaceRegistration[],
  sessionId: string | undefined,
): readonly AttachedRuntimeBuiltinToolSurface[] {
  if (!sessionId) return [];
  return registrations
    .filter((registration) => registration.sessionId === undefined || registration.sessionId === sessionId)
    .map((registration) => registration.surface);
}

function disposeTuiResourceSurfaces(
  registrations: readonly TuiResourceSurfaceRegistration[],
): void {
  const surfaces = [...new Set(registrations.map((registration) => registration.surface))];
  void Promise.all(surfaces.map((surface) => surface.dispose().catch(() => undefined)));
}

function tuiProviderAuthDebug(message: string, context?: Record<string, unknown>): void {
  if (!/^(1|true|yes)$/i.test(process.env.KILN_PROVIDER_AUTH_DEBUG?.trim() ?? "")) {
    return;
  }
  console.warn(`[tui-gateway:provider-auth][debug] ${message}`, context ?? {});
}

export type TuiAuthorityStatus = GuiAuthorityStatus;

export function buildTuiPerCallToolConfig(): RuntimeAuthorityAdmissionCandidateConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: TUI_TENANT_ID,
  });
}

export function deriveTuiAuthorityStatusFromPerCallConfig(
  config: PerCallToolConfig | RuntimeAuthorityAdmissionCandidateConfig,
): TuiAuthorityStatus {
  const effectiveTurnAuthority = "authorityAdmission" in config && config.authorityAdmission
    ? readExecutionTurnAuthority(config)
    : (config as RuntimeAuthorityAdmissionCandidateConfig).effectiveTurnAuthority;
  if (effectiveTurnAuthority) {
    const authority = effectiveTurnAuthority;
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
  const allowlist = "authorityAdmission" in config && config.authorityAdmission
    ? readExecutionToolAllowlist(config)
    : (config as RuntimeAuthorityAdmissionCandidateConfig).toolAllowlist;
  const hasAllowlist = allowlist !== undefined;
  const allowlistSize = allowlist?.size ?? 0;
  const authorityMap = "authorityAdmission" in config && config.authorityAdmission
    ? new Map(config.authorityAdmission.turn.tools.allowedToolPermissions.map((entry) => [entry.toolName, entry.authority]))
    : config.toolAuthority;
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
  turnPerCallConfig: RuntimeAuthorityAdmissionCandidateConfig | undefined,
  fallbackPerCallConfig: RuntimeAuthorityAdmissionCandidateConfig = buildTuiPerCallToolConfig(),
): TuiAuthorityStatus {
  return deriveTuiAuthorityStatusFromPerCallConfig(turnPerCallConfig ?? fallbackPerCallConfig);
}

export function buildTuiWelcomeFramePayload(input: {
  readonly executionRouteCatalog: ExecutionRouteCatalog;
  readonly availableModels: import("@kilnai/gateway-contracts").AvailableModelCatalog;
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection;
  readonly models: Record<string, string[]>;
  readonly providerDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly executionMode: OperatorExecutionMode;
  readonly authorityStatus: TuiAuthorityStatus;
}): {
  readonly type: "welcome";
  readonly executionRouteCatalog: ExecutionRouteCatalog;
  readonly availableModels: import("@kilnai/gateway-contracts").AvailableModelCatalog;
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection;
  readonly models: Record<string, string[]>;
  readonly providerDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly executionMode: OperatorExecutionMode;
  readonly authorityStatus: TuiAuthorityStatus;
} {
  return {
    type: "welcome",
    executionRouteCatalog: input.executionRouteCatalog,
    availableModels: input.availableModels,
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
  communicationIntent?: PerCallToolConfig["communicationIntent"],
): RuntimeAuthorityAdmissionCandidateConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: TUI_TENANT_ID,
    activeProvider,
    activeModel,
    ...(activeModelCapabilities ? { activeModelCapabilities: toCoreModelCapabilities(activeModelCapabilities) } : {}),
    ...(deliberationIntent ? { deliberationIntent } : {}),
    ...(communicationIntent ? { communicationIntent } : {}),
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

export function buildTuiDoneFramePayload(input: {
  readonly sourceMessageId?: string;
  readonly content: string;
  readonly parts: readonly unknown[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly outcome: OperatorSessionTurnOutcome;
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
  readonly outcome: OperatorSessionTurnOutcome;
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
    () => resolveTuiProviderDiscovery(options.getProviderAvailability, options.kilnHome),
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
    boundedWork: options.boundedWork,
    managedInvocation: attachManagedInvocationSessionEventSink(
      managedInvocation,
      { publish: (events) => activityStreamer.forwardSessionEvents(events) },
    ),
  });
  const resourceSurfaces: TuiResourceSurfaceRegistration[] = [{ surface: builtinToolSurface }];
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
  });
  const sessionRegistry = new SessionRegistry();
  const voiceSynthesisSources = new Map<string, {
    readonly parts: readonly ContentPart[];
    readonly sessionId: string;
    readonly authorityAdmission?: import("../session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle;
    readonly attemptId?: string;
  }>();
  const latestMediaAdmissionBySession = new Map<string, {
    readonly authorityAdmission: import("../session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle;
    readonly attemptId: string;
  }>();
  activityStreamer.bindApprovalBridge({
    approve: (approvalId) => orchestrator.continue(approvalId),
    reject: (approvalId, reason) => orchestrator.emitApprovalReceived(false, reason, approvalId),
  });
  const authorityCoordinator = new OperatorAuthorityAdmissionCoordinator<
    OperatorTurnTuiDispatchPayload,
    {
      readonly payload: OperatorTurnTuiDispatchPayload;
      readonly perCallConfig: RuntimeAuthorityAdmissionCandidateConfig;
      readonly turnBuiltinToolSurface: AttachedRuntimeBuiltinToolSurface;
      readonly executionMode: OperatorExecutionMode;
      readonly activeModelCapabilities: GuiProviderModelCapabilities | undefined;
      readonly runtimeSession: RuntimeSession;
    }
  >({
    resolveSession: async (request) => {
      const payload = request.payload;
      const existing = await sessionRegistry.get(TUI_APP_NAME, payload.userId, TUI_TENANT_ID);
      const session = await sessionRegistry.getOrCreate({
        appName: TUI_APP_NAME, tenantId: TUI_TENANT_ID, userId: payload.userId, systemPrompt: payload.systemPrompt,
      });
      return { session, allowAuthorityFacetCreation: existing === undefined };
    },
    sessionTurnBudget: options.sessionTurnBudget,
    prepare: async ({ request, session, admission, snapshot, binding }) => {
      const payload = request.payload;
      const route = snapshot.catalog.routes.find((candidate) => candidate.id === admission.routeId);
      if (!route) throw new Error("The admitted operator route is absent from its captured catalog.");
      const activeModelCapabilities = findProviderModelCapabilities(
        payload.providerDiscovery, route.providerId, route.providerModelId,
      );
      const executionMode = resolveExecutionMode(payload.message.executionMode);
      const turnBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface({
        builtinToolOptions,
        boundedWork: options.boundedWork,
        executionMode,
        managedInvocation: attachManagedInvocationSessionEventSink(
          managedInvocation,
          { publish: (events) => activityStreamer.forwardSessionEvents(events) },
        ),
        operatorSurface: activeOperatorSurface,
      });
      try {
        const perCallConfig = {
          ...buildTuiTurnPerCallConfig(
            route.providerId, route.providerModelId, turnBuiltinToolSurface, activeModelCapabilities,
            toCoreDeliberationIntent(payload.message.deliberationIntent), executionMode,
            resolveTuiRequestedAuthority(payload.message.requestedAuthority),
            payload.operatorTimeZone ? defineTurnTemporalContext({ observedAt: new Date().toISOString(), timeZone: payload.operatorTimeZone }) : undefined,
            resolveOperatorCommunicationIntent(options.communicationIntentCandidates, payload.message.communicationIntent),
          ),
          executionBinding: binding,
          runtimeConfigurationRevision: snapshot.configurationRevision,
        } satisfies RuntimeAuthorityAdmissionCandidateConfig;
        const adoption = await prepareOperatorAdoptionTurn({
          session,
          actorId: payload.userId,
          correlationId: request.executionId,
          persist: requireOperatorAdoptionDecisionPersistence(options.persistCanonicalSessionEvent),
        });
        const admittedPerCallConfig = {
          ...perCallConfig,
          turnId: adoption.turnId,
          turnCorrelationId: adoption.correlationId,
          operatorAdoptionDecision: adoption.operatorAdoptionDecision,
        } satisfies RuntimeAuthorityAdmissionCandidateConfig;
        const workGovernance = hasGovernedGoalTools({
          toolAllowlist: admittedPerCallConfig.toolAllowlist,
          additionalTools: admittedPerCallConfig.additionalTools,
        }) ? {
          status: "required" as const,
          kind: "goal" as const,
          subjectId: adoption.operatorAdoptionDecision.decisionId,
          authorityRevision: adoption.operatorAdoptionDecision.decisionId,
        } : { status: "not-required" as const };
        const preparedAdmission = {
          facets: defineOperatorAuthorityAdmissionFacets({
            executionId: request.executionId, turnId: adoption.turnId, session, snapshot, perCallConfig: admittedPerCallConfig,
            candidateToolNames: turnBuiltinToolSurface.toolDefinitions.map((tool) => tool.name),
            workGovernance,
            operatorAdoption: { status: "admitted", decision: adoption.operatorAdoptionDecision },
            skillCatalog: defineOperatorSkillCatalogAdmission([]),
            authorityCeiling: TUI_SESSION_AUTHORITY_CEILING,
          }),
          prepared: { payload, perCallConfig: admittedPerCallConfig, turnBuiltinToolSurface, executionMode, activeModelCapabilities, runtimeSession: session },
        };
        return preparedAdmission;
      } catch (error) {
        await turnBuiltinToolSurface.dispose();
        throw error;
      }
    },
    saveSession: (session) => sessionRegistry.save(session),
    evidenceStore: options.authorityAdmissionEvidenceStore,
    discardPrepared: ({ turnBuiltinToolSurface }) => turnBuiltinToolSurface.dispose(),
  });
  options.operatorAuthorityAdmissionBridge.bind(authorityCoordinator);
  options.operatorTurnExecutionBridge.bind(async (committed: OperatorSessionCommittedExecution<unknown, OperatorTurnTuiDispatchPayload>) => {
    const prepared = authorityCoordinator.consume(committed.executionId, committed.authorityAdmission);
    const { payload, runtimeSession, turnBuiltinToolSurface, executionMode, activeModelCapabilities } = prepared;
    const readAdmission = options.authorityAdmissionEvidenceStore.readAdmission;
    if (!readAdmission) throw new Error("Operator TUI has no durable admission readback for model-round claiming.");
    const bundle = await readRuntimeModelRoundAdmission({
      readAdmission: (request) => readAdmission.call(options.authorityAdmissionEvidenceStore, request),
      admissionId: committed.authorityAdmission.admissionId,
      sessionId: committed.authorityAdmission.sessionId,
      turnId: committed.authorityAdmission.turnId,
      expected: {
        routeId: committed.binding.routeId,
        accountId: committed.binding.accountId,
        credentialRevision: committed.binding.credentialRevision,
      },
    });
    const runtimeModelRoundDispatch: RuntimeModelRoundDispatchContext = {
      admission: bundle,
      intentFingerprint: committed.intentFingerprint as `sha256:${string}`,
      attemptId: committed.executionId,
      routeId: committed.binding.routeId,
      accountId: committed.binding.accountId,
      credentialRevision: committed.binding.credentialRevision,
      readAdmission: () => readRuntimeModelRoundAdmission({
        readAdmission: (request) => readAdmission.call(options.authorityAdmissionEvidenceStore, request),
        admissionId: bundle.admissionId,
        sessionId: bundle.sessionId,
        turnId: bundle.turnId,
        expected: {
          routeId: committed.binding.routeId,
          accountId: committed.binding.accountId,
          credentialRevision: committed.binding.credentialRevision,
        },
      }),
      store: options.runtimeModelRoundActionClaims,
      state: { claimed: false },
    };
    const runtimeToolActionClaims: RuntimeToolActionClaimsContext = {
      admission: bundle,
      attemptId: committed.executionId,
      adapterIdentity: `tui:${committed.binding.routeId}:${committed.binding.accountId}:${committed.binding.credentialRevision}`,
      readAdmission: (request) => readRuntimeModelRoundAdmission({
        readAdmission: (readRequest) => readAdmission.call(options.authorityAdmissionEvidenceStore, readRequest),
        admissionId: request.admissionId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        expected: {
          routeId: committed.binding.routeId,
          accountId: committed.binding.accountId,
          credentialRevision: committed.binding.credentialRevision,
        },
      }),
      store: options.runtimeToolActionClaims,
      state: { claimed: false },
    };
    resourceSurfaces.push({
      surface: turnBuiltinToolSurface,
      sessionId: committed.authorityAdmission.sessionId,
    });
    latestMediaAdmissionBySession.set(committed.authorityAdmission.sessionId, {
      authorityAdmission: bundle,
      attemptId: committed.executionId,
    });
    options.sessionManager.setProvider(committed.admission.providerId);
    options.sessionManager.setModel(committed.admission.providerModelId);
    const {
      turnId: _candidateTurnId,
      operatorAdoptionDecision: _candidateAdoptionDecision,
      executionBinding: _candidateExecutionBinding,
      admittedExecutionRoute: _candidateExecutionRoute,
      effectiveTurnAuthority: _candidateTurnAuthority,
      authorityContext: _candidateAuthorityContext,
      runtimeConfigurationRevision: _candidateConfigurationRevision,
      runtimeSessionConfigurationRevision: _candidateSessionConfigurationRevision,
      toolAllowlist: _candidateToolAllowlist,
      toolAuthority: _candidateToolAuthority,
      ...admittedExecutionConfig
    } = prepared.perCallConfig;
    const perCallConfig = {
      ...admittedExecutionConfig,
      authorityAdmission: bundle,
      executionCredential: committed.credential,
      runtimeModelRoundDispatch,
      runtimeToolActionClaims,
    } satisfies PerCallToolConfig;
    return processAdmittedTurn({
      orchestrator,
      sessionRegistry,
      appName: TUI_APP_NAME,
      tenantId: TUI_TENANT_ID,
      userId: payload.userId,
      sessionId: committed.authorityAdmission.sessionId,
      admittedSession: runtimeSession,
      systemPrompt: payload.systemPrompt,
      userParts: payload.userParts,
      channel: "tui",
      resumeSessionHydrator: options.resumeSessionHydrator,
      persistCanonicalSessionEvent: options.persistCanonicalSessionEvent,
      providerValidation: payload.providerDiscovery,
      contextUsageWindow: buildTuiContextUsageWindowEvidence(
        committed.admission.providerId,
        committed.admission.providerModelId,
        activeModelCapabilities,
        payload.providerDiscovery,
      ),
      executionMode,
      contextArtifactCache: options.contextArtifactCache,
      artifactStore: options.artifactStore,
      voiceConfig: options.voiceConfig,
      sttAdapter: options.sttAdapter,
      ttsAdapter: options.ttsAdapter,
      callBuiltinTools: turnBuiltinToolSurface.callBuiltinTools,
      perCallConfig,
      authorityAdmission: bundle,
      runtimeMediaActionClaims: options.runtimeMediaActionClaims,
      runtimeConfigurationRevisionProvider: options.runtimeConfigurationRevisionProvider,
      turnCapture: {
        start: (sessionId, nextSequence) => activityStreamer.beginTurnCapture(sessionId, nextSequence),
        finish: (sessionId) => { activityStreamer.endTurnCapture(sessionId); },
        abort: (sessionId) => { activityStreamer.endTurnCapture(sessionId); },
      },
      publishCanonicalSessionEvents: (events) => activityStreamer.forwardSessionEvents(
        events.filter((event) => event.kind === "context_usage_observed"),
      ),
    });
  });

  const { upgradeWebSocket, websocket } = (await loadBunHonoAdapters()).createBunWebSocket();

  const app = new Hono();

  // Health check — polled by the CLI to confirm gateway is ready
  app.get("/health", (c) => c.json({ status: "ok", channel: "tui" }));

  // TUI is a native terminal client. Browser-originated WebSocket handshakes
  // have no admitted caller and must not cross the local operator boundary.
  app.use("/tui/ws", async (c, next) => {
    if (c.req.header("origin")) {
      return c.body(null, 403);
    }
    await next();
  });

  // TUI WebSocket endpoint — no widgetId, no tenant, just userId
  app.get(
    "/tui/ws",
    upgradeWebSocket((c) => {
      const userId = c.req.query("userId") ?? crypto.randomUUID();
      let operatorSocket: WSContext | null = null;
      let unsubscribeDiscovery: (() => void) | undefined;
      let selectedRouteIntent: { readonly routeId: string; readonly accountOverrideId?: string } | undefined;
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
          const executionRouteCatalog = await options.executionRouteSelection?.getCatalog() ?? { routes: [] };
          const providerModelDiscovery = projectGuiProviderModelDiscovery(currentDiscovery);
          ws.send(JSON.stringify(buildTuiWelcomeFramePayload({
            executionRouteCatalog,
            availableModels: projectAvailableModelCatalogForExecutionRoutes({ discovery: providerModelDiscovery, executionRouteCatalog }),
            providerModelDiscovery,
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

            const frame = JSON.parse(raw) as GuiOutboundFrame;

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

            if (frame.type === "refresh_execution_routes") {
              const executionRouteCatalog = await options.executionRouteSelection?.getCatalog() ?? { routes: [] };
              ws.send(JSON.stringify({
                type: "execution_routes_refreshed",
                executionRouteCatalog,
                availableModels: projectAvailableModelCatalogForExecutionRoutes({
                  discovery: projectGuiProviderModelDiscovery(readDiscovery()), executionRouteCatalog,
                }),
              }));
              return;
            }

            if (frame.type === "provider_auth") {
              tuiProviderAuthDebug("received frame", {
                provider: typeof frame.provider === "string" ? frame.provider : null,
                requestId: typeof frame.requestId === "string" ? frame.requestId : null,
              });
              const auth = await startProviderAuthRequest({ ...frame, kilnHome: options.kilnHome });
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
              const executionRouteCatalog = await options.executionRouteSelection?.getCatalog() ?? { routes: [] };
              ws.send(JSON.stringify({
                type: "provider_auth_completed",
                provider: auth.provider,
                requestId: auth.requestId,
                providerModelDiscovery: projectGuiProviderModelDiscovery(currentDiscovery),
                models: projectGuiOperatorModels(currentDiscovery),
                providerDiscovery: currentDiscovery,
                executionRouteCatalog,
                availableModels: projectAvailableModelCatalogForExecutionRoutes({
                  discovery: projectGuiProviderModelDiscovery(currentDiscovery), executionRouteCatalog,
                }),
              }));
              return;
            }

            if (frame.type === "execution_route") {
              const selectionFrame = frame as { readonly type: "execution_route"; readonly requestId: string; readonly routeId: string; readonly accountOverrideId?: string };
              const admission = await options.executionRouteSelection?.admit(selectionFrame) ?? { ok: false as const, reasonCode: "route-evidence-pending" as const, reason: "Execution route admission is unavailable.", repairActions: ["refresh-route-catalog"] as const };
              if (!admission.ok) {
                ws.send(JSON.stringify({ type: "execution_route_change_failed", routeId: selectionFrame.routeId, requestId: selectionFrame.requestId, reasonCode: admission.reasonCode, reason: admission.reason, repairActions: admission.repairActions }));
                return;
              }
              selectedRouteIntent = { routeId: selectionFrame.routeId, ...(selectionFrame.accountOverrideId ? { accountOverrideId: selectionFrame.accountOverrideId } : {}) };
              ws.send(JSON.stringify({ type: "execution_route_changed", routeId: admission.admission.routeId, requestId: selectionFrame.requestId, providerId: admission.admission.providerId, providerModelId: admission.admission.providerModelId }));
              return;
            }

            if (frame.type === "execution_mode_transition") {
              const toMode = resolveExecutionMode(frame.toMode);
              if (toMode === "execute") {
                const transition = await approvePlanExecutionTransition({
                  surfaces: surfacesForTuiSession(
                    resourceSurfaces,
                    (await sessionRegistry.get(TUI_APP_NAME, userId, TUI_TENANT_ID))?.id,
                  ),
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
                    mediaActionClaims: options.runtimeMediaActionClaims,
                    authorityAdmission: source.authorityAdmission,
                    attemptId: source.attemptId,
                    callerId: `tui:on-demand-tts:${sourceMessageId}`,
                    idempotencyKey: requestId,
                    logicalSendSlot: "on-demand-tts",
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
                  authorityAdmission: source.authorityAdmission,
                  attemptId: source.attemptId,
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
            let result: import("./message-pipeline/index.js").ProcessResult;
            let turnProvider: string | undefined;
            let turnModel: string | undefined;
            try {
              const currentDiscovery = await refreshDiscovery();
              if (!selectedRouteIntent) {
                ws.send(JSON.stringify({ type: "error", message: "No execution route selected. Choose an execution route before sending a message." }));
                return;
              }
              const dispatcher = options.operatorTurnDispatcher;
              if (!dispatcher) {
                ws.send(JSON.stringify({ type: "error", code: "route-evidence-pending", message: "Operator execution routing is unavailable." }));
                return;
              }
              const executionId = crypto.randomUUID();
              const execution = await dispatcher.dispatchTurn({
                executionId,
                intentFingerprint: fingerprintOperatorTurnIntent({ executionId, intent: selectedRouteIntent }),
                intent: selectedRouteIntent,
                payload: {
                  surface: "tui",
                  appName: TUI_APP_NAME,
                  tenantId: TUI_TENANT_ID,
                  userId,
                  userParts: textParts(userContent),
                  systemPrompt,
                  message: frame,
                  providerDiscovery: currentDiscovery,
                  operatorTimeZone: options.operatorTimeZone,
                },
              });
              result = execution.result;
              turnProvider = execution.admission.providerId;
              turnModel = execution.admission.providerModelId;
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
            const authorityStatus = deriveTuiDoneAuthorityStatus(undefined);
            const sourceMessageId = crypto.randomUUID();
            voiceSynthesisSources.set(sourceMessageId, {
              parts: output.parts,
              sessionId: output.sessionId,
              authorityAdmission: latestMediaAdmissionBySession.get(output.sessionId)?.authorityAdmission,
              attemptId: latestMediaAdmissionBySession.get(output.sessionId)?.attemptId,
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
    hostname: LOCAL_OPERATOR_GATEWAY_HOST,
    port,
    fetch: app.fetch,
    websocket,
  });
  providerCatalog.startBackgroundRefresh({ force: true });
  const boundPort = server.port ?? port;

  return {
    url: localOperatorGatewayWebSocketUrl(boundPort, "/tui/ws"),
    port: boundPort,
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
    shutdown: () => {
      server.stop();
      disposeTuiResourceSurfaces(resourceSurfaces);
    },
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
  kilnHome?: string,
): Promise<GuiProviderDiscoveryResult[]> {
  const providerAvailability = getProviderAvailability
    ? await Promise.resolve(getProviderAvailability()).catch(() => ({}))
    : {};
  return resolveGuiOperatorDiscoveryResults(providerAvailability, undefined, kilnHome);
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
