import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { WSContext } from "hono/ws";
import {
  type CanonicalSessionEvent,
  type ContentPart,
  type DefaultBuiltinToolRegistryOptions,
  defineTurnTemporalContext,
  EventBus,
  extractText,
  type TurnTemporalContext,
  type CommunicationIntentCandidate,
} from "@kilnai/core";
import { RuntimeSessionOrchestrationSurface } from "../session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../session/runtime-session.js";
import {
  readRuntimeModelRoundAdmission,
  type RuntimeModelRoundDispatchContext,
} from "../execution-kernel/runtime-model-round-action-claim.js";
import type { RuntimeToolActionClaimsContext } from "../execution-kernel/runtime-tool-action-claim.js";
import {
  hasGovernedGoalTools,
  prepareOperatorAdoptionTurn,
} from "../session/operator-adoption-authority.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import type { RuntimeAuthorityAdmissionCandidateConfig } from "../session/runtime-session-orchestrator.types.js";
import type { RuntimeConfigurationRevisionProvider } from "../session/runtime-configuration-revision-pin.js";
import {
  readExecutionToolAllowlist,
  readExecutionTurnAuthority,
} from "../session/effective-authority-admission-bundle.js";
import { SessionRegistry } from "../session/persistence/session-registry.js";
import {
  type ActiveOperatorTurn,
  abortAndAwaitOperatorTurns,
  createActiveOperatorTurn,
} from "./active-operator-turn.js";
import { ApprovalGateRegistry } from "./approval-registry.js";
import { resolveOperatorCommunicationIntent } from "./communication-intent-resolution.js";
import { synthesizeVoiceOutputOnDemand } from "./voice-output-synthesizer.js";
import { guiOutboundMessageParts } from "./gui-frame-parts.js";
import { createProviderCatalogService, type ProviderCatalogSnapshot } from "./provider-catalog-service.js";
import { projectProviderCatalogStateFrame } from "./provider-catalog-state-frame.js";
import { projectModelCatalog } from "./model-catalog-projector.js";
import { executionTargetWizardDeniedResult, handleExecutionTargetWizard } from "./execution-target-wizard-handler.js";
import { startProviderAuthRequest } from "./provider-auth.js";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  deriveAttachedRuntimeToolAdmissionProjection,
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
import { processAdmittedTurn, projectAdmittedTurnDisposition } from "./message-pipeline/index.js";
import { OperatorActivityStreamer } from "./operator-activity-streamer.js";
import type { OnContinueSession, OperatorGuiSessionTransportOptions } from "./operator-gateway.js";
import {
  LOCAL_OPERATOR_GATEWAY_HOST,
  localOperatorGatewayHttpOrigin,
  localOperatorGatewayHttpUrl,
  localOperatorGatewayWebSocketUrl,
  parseExternalGuiOrigin,
} from "./operator-gateway-network.js";
import { toOperatorSessionEventFrame } from "./operator-session-event-frame.js";
import { approvePlanExecutionTransition } from "./plan-approval-transition.js";
import { projectMemoryLatticeInvalidationFrame } from "./gui-memory-lattice-events.js";
import { createGuiMemoryLatticeRoutes } from "./gui-memory-lattice.js";
import {
  KilnConfigSetupActionRequestSchema,
  KilnConfigSetupActionResultSchema,
  KilnConfigurationOnboardingApplyRequestSchema,
  KilnConfigurationOnboardingResultSchema,
  KilnConfigurationOnboardingSnapshotSchema,
  KilnSettingsApplyRequestSchema,
  KilnSettingsMutationResultSchema,
  KilnSettingsProposalRequestSchema,
  KilnSettingsProposalProjectionSchema,
  KilnSettingsSnapshotSchema,
  isGuiExecutableConfigSetupAction,
  OperatorResourceReadRequestSchema,
  projectOperatorResourceReadResult,
  isGuiProviderModeless,
  type GuiDashboardSnapshot,
  type GuiBrowserSessionState,
  type GuiDoneFrame,
  type GuiDoneFrameFields,
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
  type KilnConfigurationOnboardingApplyRequest,
  type KilnConfigurationOnboardingResult,
  type KilnConfigurationOnboardingSnapshot,
  type KilnSettingsApplyRequest,
  type KilnSettingsMutationResult,
  type KilnSettingsProposalProjection,
  type KilnSettingsProposalRequest,
  type KilnSettingsSnapshot,
  type GuiMemoryLatticeScope,
  type GuiSessionDetail,
  type OperatorSessionSummary,
  type OperatorExecutionMode,
  type OperatorWorkspaceError,
  type OperatorWorkspaceErrorCode,
  type OperatorWorkspaceExplorer,
  type OperatorTurnTerminalDisposition,
} from "@kilnai/gateway-contracts";
import { toCoreDeliberationIntent, toCoreModelCapabilities } from "./deliberation-projection.js";
import type { OperatorExecutionTargetSelectionPort } from "./operator-execution-target-selection.js";
import {
  fingerprintOperatorTurnIntent,
  type OperatorTurnDispatchPort,
  type OperatorTurnDispatchResult,
  type OperatorTurnGuiDispatchPayload,
} from "../execution-routing/operator-turn-dispatcher.js";
import {
  OperatorSessionPreDispatchCancellationError,
  type OperatorSessionCommittedExecution,
} from "../execution-routing/operator-session-execution-routing-service.js";
import { OperatorAuthorityAdmissionCoordinator } from "../execution-routing/operator-authority-admission-coordinator.js";
import {
  defineOperatorAuthorityAdmissionFacets,
  defineOperatorSkillCatalogAdmission,
} from "../execution-routing/operator-authority-admission-facets.js";

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
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly guiDistPath?: string;
  readonly guiAssetMode?: "bundled" | "external";
  /** Exact loopback origin of an externally served local GUI, such as the Vite development surface. */
  readonly externalGuiOrigin?: string;
  readonly getSnapshot: (context?: {
    readonly operatorModels?: Record<string, string[]>;
    readonly operatorDiscovery?: readonly GuiProviderDiscoveryResult[];
  }) => Promise<GuiDashboardSnapshot>;
  readonly getSetupSnapshot?: (options?: {
    readonly refreshSkillDiagnostics?: boolean;
  }) => Promise<KilnConfigSetupSnapshot>;
  readonly executeSetupAction?: (action: KilnConfigSetupAction) => Promise<KilnConfigSetupActionResult>;
  readonly getConfigurationOnboarding?: () => Promise<KilnConfigurationOnboardingSnapshot>;
  readonly applyConfigurationOnboarding?: (
    request: KilnConfigurationOnboardingApplyRequest,
  ) => Promise<KilnConfigurationOnboardingResult>;
  readonly getSettingsSnapshot?: () => Promise<KilnSettingsSnapshot>;
  readonly proposeSettingsMutation?: (
    request: KilnSettingsProposalRequest,
  ) => Promise<KilnSettingsProposalProjection>;
  readonly applySettingsMutation?: (
    request: KilnSettingsApplyRequest,
  ) => Promise<KilnSettingsMutationResult>;
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
  /** Target selection is the only operator execution-selection authority. */
  readonly executionTargetSelection?: OperatorExecutionTargetSelectionPort;
  readonly runExecutionTargetWizard?: (request: import("@kilnai/gateway-contracts").ExecutionTargetWizardRequest, evidence: import("./execution-target-wizard-handler.js").ExecutionTargetWizardDiscoveryEvidence) => Promise<import("./execution-target-wizard-handler.js").ExecutionTargetWizardApplicationResult>;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly operatorTransport?: OperatorGuiSessionTransportOptions;
  readonly managedInvocation?: ManagedInvocationToolAttachment;
  readonly boundedWork?: AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"];
  readonly memoryLatticeDefaultScope?: GuiMemoryLatticeScope;
  readonly goalController?: GuiGoalController;
  /** Persisted sources retain provenance; a message-local user intent is added per turn. */
  readonly communicationIntentCandidates?: readonly CommunicationIntentCandidate[];
  /** Canonical configuration revision captured once at each admitted turn. */
  readonly runtimeConfigurationRevisionProvider?: RuntimeConfigurationRevisionProvider;
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
  /** Ephemeral capability for local configuration mutations and target setup. */
  readonly operatorCapability?: string;
  shutdown(): Promise<void>;
}

const GUI_APP_NAME = "kiln-gui";
const GUI_TENANT_ID = "_gui";
type OperatorTurnRequestedAuthority = Extract<GuiOutboundFrame, { type: "message" }>["requestedAuthority"];

interface GuiResourceSurfaceRegistration {
  readonly surface: AttachedRuntimeBuiltinToolSurface;
  /** Undefined is the gateway-wide base surface; turn surfaces are session-scoped. */
  readonly sessionId?: string;
}

function surfacesForGuiSession(
  registrations: readonly GuiResourceSurfaceRegistration[],
  sessionId: string | undefined,
): readonly AttachedRuntimeBuiltinToolSurface[] {
  if (!sessionId) return [];
  return registrations
    .filter((registration) => registration.sessionId === undefined || registration.sessionId === sessionId)
    .map((registration) => registration.surface);
}

async function disposeGuiResourceSurfaces(registrations: readonly GuiResourceSurfaceRegistration[]): Promise<void> {
  const surfaces = [...new Set(registrations.map((registration) => registration.surface))];
  await Promise.all(surfaces.map((surface) => surface.dispose().catch(() => undefined)));
}

interface BrowserSessionUpdateHandlerConsumer {
  setBrowserSessionUpdateHandler(handler: ((state: Omit<GuiBrowserSessionState, "kilnSessionId">) => void) | undefined): void;
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

export function buildGuiPerCallToolConfig(): RuntimeAuthorityAdmissionCandidateConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: GUI_TENANT_ID,
  });
}

export function deriveGuiAuthorityStatusFromPerCallConfig(
  config: PerCallToolConfig | RuntimeAuthorityAdmissionCandidateConfig,
): GuiAuthorityStatus {
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
  turnPerCallConfig: RuntimeAuthorityAdmissionCandidateConfig | undefined,
  fallbackPerCallConfig: RuntimeAuthorityAdmissionCandidateConfig = buildGuiPerCallToolConfig(),
): GuiAuthorityStatus {
  return deriveGuiAuthorityStatusFromPerCallConfig(turnPerCallConfig ?? fallbackPerCallConfig);
}

type GuiDoneFramePayload = Omit<GuiDoneFrameFields, "type"> & OperatorTurnTerminalDisposition;

/** Build the GUI terminal frame from the canonical Runtime disposition. */
export function buildGuiDoneFramePayload(input: GuiDoneFramePayload): GuiDoneFrame {
  return { type: "done", ...input };
}

export async function startGuiGateway(options: StartGuiGatewayOptions): Promise<GuiGateway> {
  const port = options.port ?? 4810;
  const externalGuiOrigin = parseExternalGuiOrigin(options.externalGuiOrigin);
  if (externalGuiOrigin && options.guiAssetMode !== "external") {
    throw new Error("External GUI origin is valid only when GUI assets are external.");
  }
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
  const operatorCapability = options.workingDirectory
    ? crypto.randomUUID()
    : undefined;
  let activeConnections = 0;

  const { upgradeWebSocket, websocket } = (await loadBunHonoAdapters()).createBunWebSocket();
  const operatorCatalog = transportOptions
    ? createProviderCatalogService<readonly GuiProviderDiscoveryResult[]>(
      () => options.discoverOperatorProviders
        ? options.discoverOperatorProviders()
        : resolveOperatorDiscovery(options.getProviderAvailability, options.kilnHome),
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

  let allowedBrowserOrigins: ReadonlySet<string> = externalGuiOrigin
    ? new Set([externalGuiOrigin])
    : new Set();
  const guiCorsMiddleware = createGuiBrowserOriginMiddleware(() => allowedBrowserOrigins);

  app.use("/health", guiCorsMiddleware);
  app.use("/gui/api/*", guiCorsMiddleware);
  app.use("/operator/api/*", guiCorsMiddleware);
  app.use("/gui/ws", guiCorsMiddleware);

  app.get("/health", (c) => c.json({ status: "ok", channel: "gui", connections: activeConnections }));
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
    return c.json(await options.getSetupSnapshot({
      refreshSkillDiagnostics: c.req.query("refreshSkillDiagnostics") === "true",
    }));
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

  app.get("/gui/api/config/onboarding", async (c) => {
    if (!options.getConfigurationOnboarding) {
      return c.json({ error: "configuration_onboarding_unavailable" }, 404);
    }
    return c.json(KilnConfigurationOnboardingSnapshotSchema.parse(
      await options.getConfigurationOnboarding(),
    ));
  });

  app.post("/gui/api/config/onboarding", async (c) => {
    if (!options.applyConfigurationOnboarding) {
      return c.json({ error: "configuration_onboarding_unavailable" }, 404);
    }
    if (!operatorCapability
      || c.req.header("x-kiln-operator-token") !== operatorCapability) {
      return c.json({ error: "operator_authorization_required" }, 403);
    }
    const parsed = KilnConfigurationOnboardingApplyRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "invalid_configuration_onboarding_request" }, 400);
    }
    return c.json(KilnConfigurationOnboardingResultSchema.parse(
      await options.applyConfigurationOnboarding(parsed.data),
    ));
  });

  app.get("/gui/api/config/settings", async (c) => {
    if (!options.getSettingsSnapshot) {
      return c.json({ error: "settings_unavailable" }, 404);
    }
    return c.json(KilnSettingsSnapshotSchema.parse(await options.getSettingsSnapshot()));
  });

  app.post("/gui/api/config/settings/proposals", async (c) => {
    if (!options.proposeSettingsMutation) {
      return c.json({ error: "settings_mutation_unavailable" }, 404);
    }
    if (!operatorCapability
      || c.req.header("x-kiln-operator-token") !== operatorCapability) {
      return c.json({ error: "operator_authorization_required" }, 403);
    }
    const parsed = KilnSettingsProposalRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_settings_proposal_request" }, 400);
    }
    return c.json(KilnSettingsProposalProjectionSchema.parse(
      await options.proposeSettingsMutation(parsed.data),
    ));
  });

  app.post("/gui/api/config/settings/apply", async (c) => {
    if (!options.applySettingsMutation) {
      return c.json({ error: "settings_mutation_unavailable" }, 404);
    }
    if (!operatorCapability
      || c.req.header("x-kiln-operator-token") !== operatorCapability) {
      return c.json({ error: "operator_authorization_required" }, 403);
    }
    const parsed = KilnSettingsApplyRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_settings_apply_request" }, 400);
    }
    return c.json(KilnSettingsMutationResultSchema.parse(
      await options.applySettingsMutation(parsed.data),
    ));
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

  let operatorTransportLifecycle: { shutdown(): Promise<void> } | undefined;
  if (transportOptions) {
    operatorTransportLifecycle = wireOperatorTransport(app, upgradeWebSocket, {
      transport: transportOptions,
      initialDiscovery: operatorDiscovery ?? [],
      getDiscovery: async (discoveryOptions) => (await refreshOperatorDiscovery(discoveryOptions)) ?? [],
      getDiscoverySnapshot: () => operatorCatalog!.snapshot(),
      onDiscoveryUpdated: (listener) => operatorCatalog?.subscribe(listener) ?? (() => {}),
      builtinToolOptions,
      managedInvocation,
      boundedWork: options.boundedWork,
      communicationIntentCandidates: options.communicationIntentCandidates,
      runtimeConfigurationRevisionProvider: options.runtimeConfigurationRevisionProvider,
      executionTargetSelection: options.executionTargetSelection,
      runExecutionTargetWizard: options.runExecutionTargetWizard,
      operatorCapability,
      goalController: options.goalController,
      kilnHome: options.kilnHome,
      onSocketOpen: () => {
        activeConnections += 1;
      },
      onSocketClose: () => {
        activeConnections = Math.max(0, activeConnections - 1);
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
          const guiAuthorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(buildGuiPerCallToolConfig());
          const configuredTargets = await options.executionTargetSelection?.getTargets() ?? [];
          const providerModelDiscovery = projectGuiProviderModelDiscovery([]);
          const modelCatalog = projectModelCatalog({ discovery: providerModelDiscovery, configuredTargets });
          ws.send(JSON.stringify({
            type: "welcome",
            modelCatalog,
            executionMode: "execute",
            workingDirectory: options.workingDirectory,
            domainLabel: options.domainLabel,
            authorityStatus: guiAuthorityStatus,
          } satisfies GuiInboundFrame));
          ws.send(JSON.stringify({
            type: "provider_catalog_state",
            status: "ready",
            models: {},
            providerDiscovery: [],
            providerModelDiscovery,
            modelCatalog,
          } satisfies GuiInboundFrame));
        },
        onClose() {
          activeConnections = Math.max(0, activeConnections - 1);
        },
      })),
    );
  }

  app.get("/gui", (c) => c.redirect("/gui/"));

  const server = Bun.serve({
    hostname: LOCAL_OPERATOR_GATEWAY_HOST,
    port,
    fetch: app.fetch,
    websocket,
  });
  operatorCatalog?.startBackgroundRefresh({ force: true });

  const boundPort = server.port ?? port;
  const canonicalOrigin = localOperatorGatewayHttpOrigin(boundPort);
  allowedBrowserOrigins = new Set([
    canonicalOrigin,
    ...(externalGuiOrigin ? [externalGuiOrigin] : []),
  ]);
  const operatorWsUrl = transportOptions
    ? localOperatorGatewayWebSocketUrl(boundPort, "/gui/ws")
    : undefined;

  return {
    port: boundPort,
    url: localOperatorGatewayHttpUrl(boundPort, "/gui/"),
    apiUrl: localOperatorGatewayHttpUrl(boundPort, "/gui/api/dashboard"),
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
    operatorCapability,
    shutdown: async () => {
      server.stop();
      await operatorTransportLifecycle?.shutdown();
    },
  };
}

async function resolveOperatorDiscovery(
  getProviderAvailability?: () => Promise<Record<string, boolean>> | Record<string, boolean>,
  kilnHome?: string,
): Promise<GuiProviderDiscoveryResult[]> {
  const providerAvailability = getProviderAvailability
    ? await Promise.resolve(getProviderAvailability()).catch(() => ({}))
    : {};
  return resolveGuiOperatorDiscoveryResults(providerAvailability, undefined, kilnHome);
}

function wireOperatorTransport(
  app: Hono,
  upgradeWebSocket: BunUpgradeWebSocket,
  input: {
    transport: OperatorGuiSessionTransportOptions;
    initialDiscovery: readonly GuiProviderDiscoveryResult[];
    getDiscovery: (options?: { readonly force?: boolean }) => Promise<readonly GuiProviderDiscoveryResult[]>;
    getDiscoverySnapshot: () => ProviderCatalogSnapshot<readonly GuiProviderDiscoveryResult[]>;
    onDiscoveryUpdated: (listener: (snapshot: ProviderCatalogSnapshot<readonly GuiProviderDiscoveryResult[]>) => void) => () => void;
    builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
    managedInvocation?: ManagedInvocationToolAttachment;
    boundedWork?: AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"];
    communicationIntentCandidates?: readonly CommunicationIntentCandidate[];
    runtimeConfigurationRevisionProvider?: RuntimeConfigurationRevisionProvider;
    executionTargetSelection?: OperatorExecutionTargetSelectionPort;
    runExecutionTargetWizard?: (request: import("@kilnai/gateway-contracts").ExecutionTargetWizardRequest, evidence: import("./execution-target-wizard-handler.js").ExecutionTargetWizardDiscoveryEvidence) => Promise<import("./execution-target-wizard-handler.js").ExecutionTargetWizardApplicationResult>;
    onSocketOpen?: () => void;
    onSocketClose?: () => void;
    operatorCapability?: string;
    goalController?: GuiGoalController;
    kilnHome?: string;
  },
): { shutdown(): Promise<void> } {
  const approvalRegistry = new ApprovalGateRegistry();
  const builtinToolSurface = createAttachedRuntimeBuiltinToolSurface({
    builtinToolOptions: input.builtinToolOptions,
    boundedWork: input.boundedWork,
    managedInvocation: input.managedInvocation,
  });
  const resourceSurfaces: GuiResourceSurfaceRegistration[] = [{ surface: builtinToolSurface }];
  const committedAuthoritySessionIds = new Set<string>();
  const latestMediaAdmissionBySession = new Map<
    string,
    {
      readonly authorityAdmission: import("../session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle;
      readonly attemptId: string;
    }
  >();
  const activityStreamer = new OperatorActivityStreamer({
    approvalRegistry,
    instanceId: GUI_OPERATOR_COCKPIT_INSTANCE_ID,
    onRuntimeEvent: (event, send) => {
      const frame = projectMemoryLatticeInvalidationFrame(event);
      if (frame) send(frame);
    },
  });
  bindBrowserSessionUpdateHandler(input.builtinToolOptions, (state) => {
    forwardGuiBrowserSessionState(activityStreamer, state);
  });
  let activeOperatorSurface:
    | { theme: { setTheme: ReturnType<typeof createOperatorThemeBridge>["request"] } }
    | undefined;
  const activeTurns = new Map<string, ActiveOperatorTurn>();
  const eventBus = input.transport.eventBus ?? new EventBus(100);
  const orchestrationSurface = new RuntimeSessionOrchestrationSurface({
    eventBus,
    builtinTools: builtinToolSurface.callBuiltinTools,
    materializableTools: builtinToolSurface.materializableTools,
    materializableToolBindings: builtinToolSurface.materializableToolBindings,
    toolCatalogSnapshotId: builtinToolSurface.toolCatalogSnapshotId,
    capabilityMap: builtinToolSurface.materializableCapabilities,
  });
  const sessionRegistry = new SessionRegistry();
  const priorActiveSessions = new Map<string, RuntimeSession | undefined>();

  activityStreamer.bindApprovalBridge({
    approve: (approvalId) => orchestrationSurface.continue(approvalId),
    reject: (approvalId, reason) => orchestrationSurface.emitApprovalReceived(false, reason, approvalId),
  });
  const authorityCoordinator = new OperatorAuthorityAdmissionCoordinator<
    OperatorTurnGuiDispatchPayload,
    {
      readonly payload: OperatorTurnGuiDispatchPayload;
      readonly perCallConfig: RuntimeAuthorityAdmissionCandidateConfig;
      readonly turnBuiltinToolSurface: AttachedRuntimeBuiltinToolSurface;
      readonly executionMode: OperatorExecutionMode;
      readonly activeModelCapabilities: GuiProviderModelCapabilities | undefined;
      readonly priorActiveSession: RuntimeSession | undefined;
      readonly runtimeSessionId: string;
      readonly runtimeSession: RuntimeSession;
    }
  >({
    resolveSession: async (request) => {
      const payload = request.payload;
      if (payload.freshSessionRequested) {
        const priorActiveSession = await sessionRegistry.get(GUI_APP_NAME, payload.userId, GUI_TENANT_ID);
        const session = new RuntimeSession({
          appName: GUI_APP_NAME,
          tenantId: GUI_TENANT_ID,
          userId: payload.userId,
          systemPrompt: payload.systemPrompt,
        });
        priorActiveSessions.set(session.id, priorActiveSession);
        return {
          session,
          allowAuthorityFacetCreation: true,
        };
      }
      const requestedSessionId = payload.sessionId;
      const existing = requestedSessionId
        ? await sessionRegistry.getById(requestedSessionId)
        : await sessionRegistry.get(GUI_APP_NAME, payload.userId, GUI_TENANT_ID);
      const priorActiveSession = await sessionRegistry.get(GUI_APP_NAME, payload.userId, GUI_TENANT_ID);
      const session = await sessionRegistry.getOrCreate({
        appName: GUI_APP_NAME,
        tenantId: GUI_TENANT_ID,
        userId: payload.userId,
        ...(requestedSessionId ? { sessionId: requestedSessionId } : {}),
        systemPrompt: payload.systemPrompt,
      });
      if (requestedSessionId && !existing) {
        try {
          const hydrator = input.transport.resumeSessionHydrator;
          if (!hydrator) {
            throw new Error("Continuation authority admission requires a transcript-backed Runtime session hydrator.");
          }
          const hydration = await hydrator({ sessionId: requestedSessionId, session });
          if (!hydration.rehydrated) {
            throw new Error(`Continuation authority admission could not rehydrate canonical session state: ${hydration.reason ?? "unknown reason"}.`);
          }
        } catch (error) {
          await sessionRegistry.remove(GUI_APP_NAME, payload.userId, GUI_TENANT_ID);
          if (priorActiveSession) await sessionRegistry.save(priorActiveSession);
          throw error;
        }
      }
      return { session, allowAuthorityFacetCreation: existing === undefined };
    },
    sessionTurnBudget: input.transport.sessionTurnBudget,
    prepare: async ({ request, session, admission, snapshot, binding }) => {
      const payload = request.payload;
      const target = snapshot.catalog.targets.find((candidate) => candidate.id === admission.targetId);
      if (!target) throw new Error("The admitted execution target is absent from its captured catalog.");
      const activeModelCapabilities = findProviderModelCapabilities(
        payload.providerDiscovery, target.providerId, target.providerModelId,
      );
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
      try {
        const perCallConfig = {
          ...buildGuiTurnPerCallConfig(
            target.providerId, target.providerModelId, turnBuiltinToolSurface, activeModelCapabilities,
            toCoreDeliberationIntent(payload.message.deliberationIntent), executionMode, requestedAuthority,
            input.transport.workingDirectory, governedWorkRequirement,
            payload.operatorTimeZone ? defineTurnTemporalContext({ observedAt: new Date().toISOString(), timeZone: payload.operatorTimeZone }) : undefined,
            resolveOperatorCommunicationIntent(input.communicationIntentCandidates, payload.message.communicationIntent),
          ),
          abortSignal: payload.abortSignal,
          executionBinding: binding,
          runtimeConfigurationRevision: snapshot.configurationRevision,
        } satisfies RuntimeAuthorityAdmissionCandidateConfig;
        const adoption = await prepareOperatorAdoptionTurn({
          session,
          actorId: payload.userId,
          correlationId: request.executionId,
          persist: (event) => input.transport.persistCanonicalSessionEvents([event]),
        });
        const admittedPerCallConfig = {
          ...perCallConfig,
          turnId: adoption.turnId,
          turnCorrelationId: adoption.correlationId,
          operatorAdoptionDecision: adoption.operatorAdoptionDecision,
        } satisfies RuntimeAuthorityAdmissionCandidateConfig;
        const governedGoalTools = hasGovernedGoalTools({
          toolAllowlist: admittedPerCallConfig.toolAllowlist,
          additionalTools: admittedPerCallConfig.additionalTools,
        });
        const workGovernance = governedWorkRequirement || governedGoalTools
          ? {
              status: "required" as const,
              kind: "goal" as const,
              subjectId: adoption.operatorAdoptionDecision.decisionId,
              authorityRevision: adoption.operatorAdoptionDecision.decisionId,
            }
          : { status: "not-required" as const };
        const preparedAdmission = {
          facets: defineOperatorAuthorityAdmissionFacets({
            executionId: request.executionId,
            turnId: adoption.turnId,
            session,
            snapshot,
            perCallConfig: admittedPerCallConfig,
            candidateToolNames: deriveAttachedRuntimeToolAdmissionProjection(turnBuiltinToolSurface).candidateToolNames,
            workGovernance,
            operatorAdoption: { status: "admitted", decision: adoption.operatorAdoptionDecision },
            capabilityParticipation: { status: "not-requested" },
            skillCatalog: defineOperatorSkillCatalogAdmission([]),
            authorityCeiling: admittedPerCallConfig.authorityContext!.sessionPolicy!,
          }),
          prepared: {
            payload,
            perCallConfig: admittedPerCallConfig,
            turnBuiltinToolSurface,
            executionMode,
            activeModelCapabilities,
            priorActiveSession: priorActiveSessions.get(session.id),
            runtimeSessionId: session.id,
            runtimeSession: session,
          },
        };
        return preparedAdmission;
      } catch (error) {
        await turnBuiltinToolSurface.dispose();
        priorActiveSessions.delete(session.id);
        throw error;
      }
    },
    saveSession: (session) => sessionRegistry.save(session),
    evidenceStore: input.transport.authorityAdmissionEvidenceStore,
    discardPrepared: async ({ turnBuiltinToolSurface, payload, priorActiveSession, runtimeSessionId }) => {
      await turnBuiltinToolSurface.dispose();
      if (payload.freshSessionRequested) {
        await sessionRegistry.remove(GUI_APP_NAME, payload.userId, GUI_TENANT_ID);
        if (priorActiveSession) await sessionRegistry.save(priorActiveSession);
      }
      priorActiveSessions.delete(runtimeSessionId);
    },
  });
  input.transport.operatorAuthorityAdmissionBridge.bind(authorityCoordinator);
  input.transport.operatorTurnExecutionBridge.bind(async (committed: OperatorSessionCommittedExecution<import("../managed-account-leases/configured-execution-account-runtime.js").ConfiguredExecutionCredential, OperatorTurnGuiDispatchPayload>) => {
    if (committed.payload.freshSessionRequested) {
      try {
        await input.transport.onClear?.();
      } catch (error) {
        throw new OperatorSessionPreDispatchCancellationError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const prepared = authorityCoordinator.consume(committed.executionId, committed.authorityAdmission);
    priorActiveSessions.delete(prepared.runtimeSessionId);
    const { payload, runtimeSession, turnBuiltinToolSurface, executionMode, activeModelCapabilities } = prepared;
    const readAdmission = input.transport.authorityAdmissionEvidenceStore.readAdmission;
    if (!readAdmission) throw new Error("Operator GUI has no durable admission readback for model-round claiming.");
    const bundle = await readRuntimeModelRoundAdmission({
      readAdmission: (request) => readAdmission.call(input.transport.authorityAdmissionEvidenceStore, request),
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
        readAdmission: () =>
          readRuntimeModelRoundAdmission({
            readAdmission: (request) => readAdmission.call(input.transport.authorityAdmissionEvidenceStore, request),
            admissionId: bundle.admissionId,
            sessionId: bundle.sessionId,
            turnId: bundle.turnId,
            expected: {
              routeId: committed.binding.routeId,
              accountId: committed.binding.accountId,
              credentialRevision: committed.binding.credentialRevision,
            },
          }),
        store: input.transport.runtimeModelRoundActionClaims,
        state: { claimed: false },
      };
      const runtimeToolActionClaims: RuntimeToolActionClaimsContext = {
        admission: bundle,
        attemptId: committed.executionId,
        adapterIdentity: `gui:${committed.binding.routeId}:${committed.binding.accountId}:${committed.binding.credentialRevision}`,
        readAdmission: (request) =>
          readRuntimeModelRoundAdmission({
            readAdmission: (readRequest) =>
              readAdmission.call(input.transport.authorityAdmissionEvidenceStore, readRequest),
            admissionId: request.admissionId,
            sessionId: request.sessionId,
            turnId: request.turnId,
            expected: {
              routeId: committed.binding.routeId,
              accountId: committed.binding.accountId,
              credentialRevision: committed.binding.credentialRevision,
            },
          }),
        store: input.transport.runtimeToolActionClaims,
        state: { claimed: false },
      };
      resourceSurfaces.push({
        surface: turnBuiltinToolSurface,
        sessionId: committed.authorityAdmission.sessionId,
      });
      committedAuthoritySessionIds.add(committed.authorityAdmission.sessionId);
      latestMediaAdmissionBySession.set(committed.authorityAdmission.sessionId, {
        authorityAdmission: bundle,
        attemptId: committed.executionId,
      });
      input.transport.sessionManager.setProvider(committed.admission.providerId);
      input.transport.sessionManager.setModel(committed.admission.providerModelId);
      const {
        turnId: _candidateTurnId,
        operatorAdoptionDecision: _candidateAdoptionDecision,
        executionBinding: _candidateExecutionBinding,
        admittedExecutionTarget: _candidateExecutionTarget,
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
      const provider = await input.transport.createProvider({
        credential: committed.credential,
        admission: committed.admission,
      });
      const orchestrator = orchestrationSurface.bindProvider(provider, committed.admission.providerModelId, {
        builtinTools: turnBuiltinToolSurface.callBuiltinTools,
        materializableTools: turnBuiltinToolSurface.materializableTools,
        materializableToolBindings: turnBuiltinToolSurface.materializableToolBindings,
        toolCatalogSnapshotId: turnBuiltinToolSurface.toolCatalogSnapshotId,
        capabilityMap: turnBuiltinToolSurface.materializableCapabilities,
      });
      activityStreamer.selectSession(runtimeSession.id);
      return processAdmittedTurn({
        orchestrator,
        sessionRegistry,
        appName: GUI_APP_NAME,
        tenantId: GUI_TENANT_ID,
        userId: payload.userId,
        sessionId: committed.authorityAdmission.sessionId,
        admittedSession: runtimeSession,
        systemPrompt: payload.systemPrompt,
        userParts: payload.userParts,
        channel: "gui",
        resumeSessionHydrator: input.transport.resumeSessionHydrator,
        persistCanonicalSessionEvents: input.transport.persistCanonicalSessionEvents,
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
        authorityAdmission: bundle,
        runtimeMediaActionClaims: input.transport.runtimeMediaActionClaims,
        runtimeConfigurationRevisionProvider: input.runtimeConfigurationRevisionProvider,
        publishCanonicalSessionEvents: (events) => activityStreamer.forwardSessionEvents(events),
      });
  });

  app.post("/gui/api/resources/read", async (c) => {
    const request = OperatorResourceReadRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!request.success) {
      return c.json({ error: "resource_read_request_invalid" }, 400);
    }
    const sessionId = request.data.target?.sessionId;
    if (!sessionId || !committedAuthoritySessionIds.has(sessionId)) {
      return c.json({ error: "resource_admission_required" }, 404);
    }
    for (const surface of surfacesForGuiSession(resourceSurfaces, sessionId)) {
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
      const operatorAuthorized = Boolean(
        input.operatorCapability
        && c.req.query("operatorToken") === input.operatorCapability,
      );
      let discovery = [...input.initialDiscovery];
      const applyDiscovery = (nextDiscovery: readonly GuiProviderDiscoveryResult[]): readonly GuiProviderDiscoveryResult[] => {
        discovery = [...nextDiscovery];
        return discovery;
      };
      let correlatedDiscoveryRefreshDepth = 0;
      const refreshDiscovery = async (
        options?: { readonly force?: boolean },
      ): Promise<readonly GuiProviderDiscoveryResult[]> => {
        correlatedDiscoveryRefreshDepth += 1;
        try {
          return applyDiscovery(await input.getDiscovery(options));
        } finally {
          correlatedDiscoveryRefreshDepth -= 1;
        }
      };
      let operatorSocket: WSContext | null = null;
      let unsubscribeDiscovery: (() => void) | undefined;
      let selectedTargetIntent: { readonly targetId: string; readonly accountOverrideId?: string } | undefined;
      const voiceSynthesisSources = new Map<string, {
        readonly parts: readonly ContentPart[];
        readonly sessionId: string;
        readonly authorityAdmission?: import("../session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle;
        readonly attemptId?: string;
      }>();
      const operatorThemeBridge = createOperatorThemeBridge((frame) => {
        operatorSocket?.send(JSON.stringify(frame satisfies GuiInboundFrame));
      });
      activeOperatorSurface = { theme: { setTheme: operatorThemeBridge.request } };

      return {
        async onOpen(_event: Event, ws: WSContext) {
          operatorSocket = ws;
          input.onSocketOpen?.();
          activityStreamer.register(ws, eventBus);
          const activeSession = await sessionRegistry.get(GUI_APP_NAME, userId, GUI_TENANT_ID);
          if (activeSession) {
            activityStreamer.forwardSessionEvents(activeSession.sessionEvents);
          }
          const configuredTargets = await input.executionTargetSelection?.getTargets() ?? [];
          const catalogSnapshot = input.getDiscoverySnapshot();
          applyDiscovery(catalogSnapshot.discovery);
          const initialCatalogState = await projectProviderCatalogStateFrame(
            catalogSnapshot,
            async () => input.executionTargetSelection?.getTargets() ?? [],
            configuredTargets,
          );
          unsubscribeDiscovery?.();
          unsubscribeDiscovery = input.onDiscoveryUpdated((snapshot) => {
            applyDiscovery(snapshot.discovery);
            if (correlatedDiscoveryRefreshDepth > 0) return;
            void projectProviderCatalogStateFrame(
              snapshot,
              async () => input.executionTargetSelection?.getTargets() ?? [],
            ).then((frame) => {
              if (operatorSocket === ws) ws.send(JSON.stringify(frame satisfies GuiInboundFrame));
            }).catch((error: unknown) => {
              if (operatorSocket !== ws) return;
              ws.send(JSON.stringify({
                type: "provider_catalog_state",
                status: "error",
                message: error instanceof Error ? error.message : "Provider catalog projection failed.",
              } satisfies GuiInboundFrame));
            });
          });
          const guiAuthorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(
            buildGuiTurnPerCallConfig("", undefined, builtinToolSurface),
          );
          ws.send(JSON.stringify({
            type: "welcome",
            modelCatalog: initialCatalogState.status === "ready"
              ? initialCatalogState.modelCatalog
              : projectModelCatalog({ discovery: projectGuiProviderModelDiscovery(discovery), configuredTargets }),
            executionMode: input.transport.executionMode ?? "execute",
            workingDirectory: input.transport.workingDirectory,
            domainLabel: input.transport.domainLabel,
            authorityStatus: guiAuthorityStatus,
          } satisfies GuiInboundFrame));
          ws.send(JSON.stringify(initialCatalogState satisfies GuiInboundFrame));
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

            if (frame.type === "refresh_model_catalog") {
              const requestId = typeof frame.requestId === "string" ? frame.requestId.trim() : "";
              if (!requestId) {
                ws.send(JSON.stringify({ type: "error", message: "Execution target refresh requires requestId." } satisfies GuiInboundFrame));
                return;
              }
              try {
                await refreshDiscovery({ force: true });
                const currentTargets = await input.executionTargetSelection?.getTargets() ?? [];
                const refreshed = await projectProviderCatalogStateFrame(
                  input.getDiscoverySnapshot(),
                  async () => currentTargets,
                  currentTargets,
                );
                if (refreshed.status !== "ready") throw new Error("Model catalog refresh did not produce a ready snapshot.");
                ws.send(JSON.stringify({
                  type: "model_catalog_refreshed",
                  requestId,
                  modelCatalog: refreshed.modelCatalog,
                } satisfies GuiInboundFrame));
              } catch (error) {
                ws.send(JSON.stringify({
                  type: "model_catalog_refresh_failed",
                  requestId,
                  message: error instanceof Error ? error.message : "Execution target refresh failed.",
                } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "execution_target_wizard") {
              if (!operatorAuthorized) {
                ws.send(JSON.stringify(executionTargetWizardDeniedResult(frame) satisfies GuiInboundFrame));
                return;
              }
              const currentTargets = await input.executionTargetSelection?.getTargets() ?? [];
              const responseFrames = await handleExecutionTargetWizard({
                operatorAuthorized,
                frame,
                discovery: projectGuiProviderModelDiscovery(discovery),
                configuredTargets: currentTargets,
                runWizard: input.runExecutionTargetWizard,
                readConfiguredTargets: async () => input.executionTargetSelection?.getTargets() ?? [],
              });
              for (const responseFrame of responseFrames) {
                ws.send(JSON.stringify(responseFrame satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "provider_auth") {
              guiProviderAuthDebug("received frame", {
                provider: typeof frame.provider === "string" ? frame.provider : null,
                requestId: typeof frame.requestId === "string" ? frame.requestId : null,
              });
              const auth = await startProviderAuthRequest({ ...frame, kilnHome: input.kilnHome });
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
              const configuredTargets = await input.executionTargetSelection?.getTargets() ?? [];
              const modelCatalog = projectModelCatalog({
                discovery: projectGuiProviderModelDiscovery(currentDiscovery),
                configuredTargets,
              });
              ws.send(JSON.stringify({
                type: "provider_auth_completed",
                provider: auth.provider,
                requestId: auth.requestId,
                providerModelDiscovery: projectGuiProviderModelDiscovery(currentDiscovery),
                models: projectGuiOperatorModels(currentDiscovery),
                providerDiscovery: currentDiscovery,
                modelCatalog,
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "execution_target") {
              const selectionFrame = frame as Extract<GuiOutboundFrame, { type: "execution_target" }>;
              const admission = await input.executionTargetSelection?.admit(selectionFrame) ?? {
                ok: false as const, reasonCode: "target-evidence-pending" as const,
                reason: "Execution target admission is unavailable.", repairActions: ["refresh-model-catalog"] as const,
              };
              if (!admission.ok) {
                ws.send(JSON.stringify({ type: "execution_target_change_failed", targetId: selectionFrame.targetId, requestId: selectionFrame.requestId, reasonCode: admission.reasonCode, reason: admission.reason, repairActions: admission.repairActions } satisfies GuiInboundFrame));
                return;
              }
              selectedTargetIntent = { targetId: selectionFrame.targetId, ...(selectionFrame.accountOverrideId ? { accountOverrideId: selectionFrame.accountOverrideId } : {}) };
              ws.send(JSON.stringify({ type: "execution_target_changed", targetId: admission.admission.targetId, requestId: selectionFrame.requestId, providerId: admission.admission.providerId, providerModelId: admission.admission.providerModelId } satisfies GuiInboundFrame));
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
                  surfaces: surfacesForGuiSession(
                    resourceSurfaces,
                    (await sessionRegistry.get(GUI_APP_NAME, userId, GUI_TENANT_ID))?.id,
                  ),
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
                    toolCallScopeId: requestId ?? `managed-agent-control:${action}:${invocationId}`,
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
                  toolCallScopeId: requestId ?? `managed-agent-control:${action}:${invocationId}`,
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
                    mediaActionClaims: input.transport.runtimeMediaActionClaims,
                    authorityAdmission: source.authorityAdmission,
                    attemptId: source.attemptId,
                    callerId: `gui:on-demand-tts:${sourceMessageId}`,
                    idempotencyKey: requestId,
                    logicalSendSlot: "on-demand-tts",
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

            const currentTurn = createActiveOperatorTurn();
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
                  selectedTargetIntent?.targetId,
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
              if (!selectedTargetIntent) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "No execution target selected. Choose a model before sending a message.",
                } satisfies GuiInboundFrame));
                return;
              }
              const dispatcher: OperatorTurnDispatchPort<OperatorTurnGuiDispatchPayload, OperatorTurnDispatchResult> = input.transport.operatorTurnDispatcher;
              if (!dispatcher) {
                ws.send(JSON.stringify({
                  type: "error",
                  code: "target-evidence-pending",
                  message: "Operator execution routing is unavailable.",
                } satisfies GuiInboundFrame));
                return;
              }
              const executionId = crypto.randomUUID();
              const execution = await dispatcher.dispatchTurn({
                executionId,
                intentFingerprint: fingerprintOperatorTurnIntent({ executionId, intent: selectedTargetIntent }),
                intent: selectedTargetIntent,
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
            const disposition = projectAdmittedTurnDisposition(output);
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

            ws.send(JSON.stringify(buildGuiDoneFramePayload({
              kilnSessionId: output.sessionId,
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
              authorityStatus: deriveGuiDoneAuthorityStatus(undefined),
              ...disposition,
            })));
            } finally {
              currentTurn.settle();
              if (activeTurns.get(userId) === currentTurn) {
                activeTurns.delete(userId);
              }
            }
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

  return {
    shutdown: async () => {
      await abortAndAwaitOperatorTurns(activeTurns.values());
      await disposeGuiResourceSurfaces(resourceSurfaces);
    },
  };
}

const GUI_CORS_ALLOWED_METHODS = new Set(["GET", "POST"]);
const GUI_CORS_ALLOWED_HEADERS = new Set([
  "accept",
  "content-type",
  "x-kiln-operator-token",
]);

function createGuiBrowserOriginMiddleware(
  readAllowedOrigins: () => ReadonlySet<string>,
): (c: Context, next: Next) => Promise<Response | undefined> {
  return async (c, next): Promise<Response | undefined> => {
    const origin = c.req.header("origin");
    if (!origin) {
      if (c.req.method === "OPTIONS") {
        return c.body(null, 403);
      }
      await next();
      return;
    }

    if (!readAllowedOrigins().has(origin) || !isAdmittedCorsPreflight(c)) {
      return c.body(null, 403);
    }

    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Headers", "Content-Type, Accept, X-Kiln-Operator-Token");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Vary", "Origin");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  };
}

function isAdmittedCorsPreflight(c: Context): boolean {
  if (c.req.method !== "OPTIONS") {
    return true;
  }

  const requestedMethod = c.req.header("access-control-request-method")?.toUpperCase();
  if (!requestedMethod || !GUI_CORS_ALLOWED_METHODS.has(requestedMethod)) {
    return false;
  }

  const requestedHeaders = c.req.header("access-control-request-headers");
  if (!requestedHeaders) {
    return true;
  }

  return requestedHeaders
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .every((header) => header.length > 0 && GUI_CORS_ALLOWED_HEADERS.has(header));
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
  communicationIntent?: PerCallToolConfig["communicationIntent"],
): RuntimeAuthorityAdmissionCandidateConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: GUI_TENANT_ID,
    workingDirectory,
    governedWorkRequirement,
    activeProvider,
    activeModel,
    ...(activeModelCapabilities ? { activeModelCapabilities: toCoreModelCapabilities(activeModelCapabilities) } : {}),
    ...(deliberationIntent ? { deliberationIntent } : {}),
    ...(communicationIntent ? { communicationIntent } : {}),
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

function forwardGuiBrowserSessionState(
  streamer: OperatorActivityStreamer,
  state: Omit<GuiBrowserSessionState, "kilnSessionId">,
): void {
  const kilnSessionId = streamer.currentSessionId();
  streamer.sendFrame({
    type: "browser_session_updated",
    browserSession: {
      ...state,
      ...(kilnSessionId ? { kilnSessionId } : {}),
    },
  });
  if (
    state.viewMode !== "live" ||
    state.stream.status !== "live" ||
    !state.sessionId ||
    !state.latestCapture?.uri ||
    !state.latestCapture.width ||
    !state.latestCapture.height
  ) {
    return;
  }
  streamer.sendFrame({
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
  });
}
