// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  ContentPart,
  ArtifactResourceStore,
  SessionLimitsConfig,
  SkillRegistry,
  EventBus,
  ContextArtifactCache,
  ContextCandidate,
  ApprovalRequestedEvent,
  ApprovalReceivedEvent,
  ToolAuthorizedEvent,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  MultimodalRoutedEvent,
  ToolCalledEvent,
  ToolOutputEvent,
  ToolResultEvent,
  TenantConfig,
  SttAdapter,
  TtsAdapter,
  VoiceConfig,
  CanonicalSessionEvent,
  EffectiveTurnAuthoritySnapshot,
  EffectivePromptObservation,
  CommunicationResolution,
} from "@kilnai/core";
import type { RuntimeTurnTerminalDisposition } from "@kilnai/core/agents";
import {
  estimateTextTokens,
  extractText,
  textParts,
  skillConfigToContextCandidate,
  projectFinalEffectivePromptObservation,
} from "@kilnai/core";
import type {
  AbuseDetectionConfig
} from "../../session/repetitive-abuse-detector.js";
import {
  detectRepetitiveAbuse
} from "../../session/repetitive-abuse-detector.js";
import type {
  RuntimeSessionOrchestrator,
  OrchestrateResult,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary
} from "../../session/runtime-session-orchestrator.js";
import type {
  SessionRegistry
} from "../../session/persistence/session-registry.js";
import type {
  BillingConfig
} from "../budget-middleware.js";
import {
  checkBudget
} from "../budget-middleware.js";
import type {
  SessionMode
} from "../../session/session-mode.js";
import type {
  EscalationSignal
} from "../../session/support/escalation/escalation-detector.js";
import {
  TraceContext
} from "../trace-context.js";
import {
  formatRuntimeContinuityPresentation,
  normalizeRuntimeTaskShape,
  readRuntimeSupportArtifactsDetailed,
  writeRuntimeHandoffSummaryArtifact
} from "../../session/support/artifacts/context-artifact-summary.js";
import {
  applyRuntimeTurnRecord,
  type RuntimeTurnApprovalTransition,
  type RuntimeTurnAuthorityDecision,
  type RuntimeTurnDangerousCommandOutcome,
  type RuntimeTurnProviderValidation
} from "../../session/runtime-turn-record.js";
import {
  CanonicalTurnLifecycle,
  resolveCanonicalTurnIdentity,
  type CanonicalSessionEventPersistence,
} from "../../session/runtime-session-event-ledger.js";
import { hasGovernedGoalTools } from "../../session/operator-adoption-authority.js";
import {
  type ContextUsageWindowEvidence
} from "../../session/context-usage-projection.js";
import {
  resolveAgentContextAsync
} from "../../tenant/agent-resolver.js";
import {
  buildTenantSystemPrompt
} from "../../tenant/system-prompt-builder.js";
import {
  parseRuntimeOperatorTurnTerminalDisposition,
  type OperatorExecutionMode,
  type RuntimeOperatorTurnTerminalDisposition,
} from "@kilnai/gateway-contracts";
import type {
  RuntimeSession
} from "../../session/runtime-session.js";
import {
  createGenericMediaDownloader
} from "../audio-preprocessor.js";
import {
  captureMultimodalArtifacts
} from "../multimodal-artifact-ingestion.js";
import {
  synthesizeVoiceOutput
} from "../voice-output-synthesizer.js";
import {
  appendCoordinationProviderFailureAudit,
  projectAdmittedTurnContext,
  projectCompletedTurnContextUsage,
  resolveCoordinationContextCandidates,
  type RuntimeContextAudit
} from "./admitted-turn-context.js";
import {
  appendWebSourceAttributionIfMissing,
  buildAuthorityGuidanceContextCandidate,
  buildGovernedWorkCloseoutContextCandidate,
  buildGovernedWorkMaterializationContextCandidate,
  buildWebSourceAttributionContextCandidate,
  hasWebToolAvailable,
  shouldIncludeGovernedWorkCloseoutContext
} from "./procedural-context-candidates.js";
import {
  EGRESS_DENIED_FALLBACK_TEXT,
  EGRESS_REDACTED_TEXT,
  type EgressPermissionDecision,
  type EgressPermissionRequest,
  redactAssistantParts,
  resolveEgressDecision,
  sanitizeAssistantEgressParts
} from "./assistant-egress-text.js";
import {
  appendRuntimeLedgerEvent,
  isCancellationErrorEvent,
  replayCapturedRuntimeLedgerEvents,
  resolveTurnToolExecutions,
  runtimeFailureEvent,
  type RuntimePipelineLedgerEvent
} from "./runtime-ledger-replay.js";
import {
  dangerousCommandOutcomeFromExecution,
  buildAuthorityMutationViolation
} from "./turn-authority-guard.js";
import {
  extractPlanAnalysisReports,
  extractPlanSubmissions,
  extractSpecificationSubmissions,
  extractClarificationRecords
} from "./governed-work-extraction.js";
import {
  resolveVoiceInputParts
} from "./voice-input-resolver.js";
import type {
  RuntimeConfigurationRevisionProvider,
  RuntimeConfigurationRevisionSnapshot,
} from "../../session/runtime-configuration-revision-pin.js";
import {
  readExecutionBinding,
  readExecutionConfigurationRevision,
  readExecutionOperatorAdoptionDecision,
  readExecutionToolAllowlist,
  readExecutionTurnAuthority,
  readExecutionTurnId,
  type EffectiveAuthorityAdmissionBundle,
} from "../../session/effective-authority-admission-bundle.js";
import { assertPersistableAuthorityAdmissionBundle } from "../../session/authority-admission-evidence.js";
import type { RuntimeMediaActionClaimContext } from "../../execution-kernel/runtime-media-action-claim.js";

export type { CanonicalSessionEventPersistence } from "../../session/runtime-session-event-ledger.js";

export interface AdmittedTurnContext {
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  /** Exact Runtime session already bound and persisted by the authority-admission owner. */
  readonly admittedSession?: RuntimeSession;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly systemPrompt?: string;
  readonly userParts: readonly ContentPart[];
  readonly artifactStore?: ArtifactResourceStore;
  readonly voiceConfig?: VoiceConfig;
  readonly sttAdapter?: SttAdapter;
  readonly ttsAdapter?: TtsAdapter;
  readonly billing?: BillingConfig;
  readonly channel: string;
  readonly idleTimeoutMs?: number;
  readonly recalledMemoryCandidates?: readonly ContextCandidate[];
  readonly tenant?: TenantConfig;
  readonly eventBus?: EventBus;
  readonly runtimeEvents?: readonly RuntimePipelineLedgerEvent[];
  readonly callBuiltinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly perCallConfig: PerCallToolConfig;
  /** Committed Runtime authority; the sole execution-authority source. */
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle;
  /** Workload-owned durable owner for consequential STT/TTS effects. */
  readonly runtimeMediaActionClaims?: RuntimeMediaActionClaimContext;
  /** Reads the current secret-free configuration revision once per admitted turn. */
  readonly runtimeConfigurationRevisionProvider?: RuntimeConfigurationRevisionProvider;
  readonly contextPolicy?: NonNullable<PerCallToolConfig["contextPolicy"]>;
  readonly contextUsageWindow?: ContextUsageWindowEvidence;
  readonly traceId?: string;
  readonly activeAgentId?: string;
  readonly activeAgentName?: string;
  readonly voiceProfile?: string;
  readonly voiceOutputIntent?: string;
  readonly isHandoff?: boolean;
  readonly previousAgentId?: string;
  readonly previousAgentName?: string;
  readonly handoffBrief?: string;
  readonly pingPongBlocked?: boolean;
  readonly pingPongReason?: string;
  readonly routingTier?: "rule" | "fallback";
  readonly routingConfidence?: number;
  readonly sessionLimits?: SessionLimitsConfig;
  readonly abuseDetection?: AbuseDetectionConfig;
  readonly skillRegistry?: SkillRegistry;
  readonly activeSkills?: readonly string[];
  readonly activeSkillTags?: readonly string[];
  readonly userContext?: Record<string, string>;
  readonly providerValidation?: readonly RuntimeTurnProviderValidation[];
  readonly executionMode?: OperatorExecutionMode;
  readonly contextArtifactCache?: ContextArtifactCache;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
  readonly coordinationContextProvider?: (input: {
    readonly appName: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly channel: string;
    readonly activeAgentId?: string;
  }) => readonly ContextCandidate[] | Promise<readonly ContextCandidate[]>;
  readonly evaluateEgressPermission?: (
    request: EgressPermissionRequest,
  ) => EgressPermissionDecision | Promise<EgressPermissionDecision>;
  /** Publishes persisted canonical turn evidence to the active operator surface. */
  readonly publishCanonicalSessionEvents?: (events: readonly CanonicalSessionEvent[]) => void;
  /** Durable sink for canonical events produced by this turn. */
  readonly persistCanonicalSessionEvents?: CanonicalSessionEventPersistence;
}

export interface RuntimeSessionHydrationResult {
  readonly rehydrated: boolean;
  readonly messageCount: number;
  readonly reason?: string;
  readonly sourceSequence?: number;
}

export type RuntimeSessionHydrator = (input: {
  readonly sessionId: string;
  readonly session: RuntimeSession;
}) => RuntimeSessionHydrationResult | Promise<RuntimeSessionHydrationResult>;

type AdmittedTurnResultCommon = {
  readonly parts: readonly ContentPart[];
  readonly admittedInput?: {
    readonly content: string;
  };
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly queued: boolean;
  readonly sessionId: string;
  readonly sessionMode: SessionMode;
  readonly escalation?: EscalationSignal;
  readonly contextSummary?: string;
  readonly toolExecutions?: readonly ToolExecutionSummary[];
  readonly traceId: string;
  readonly activeAgentId?: string;
  readonly routingDecision?: {
    readonly provider: string;
    readonly model: string;
    readonly routingTier: string;
    readonly reasoning?: string;
    readonly selectionMode?: "automatic" | "explicit-operator-only";
    readonly deliberationResolution?: import("@kilnai/core").DeliberationResolution;
    readonly rationale?: import("@kilnai/core").ModelRoutingRationale;
  };
  readonly limitReached?: { type: "tokens" | "turns" | "abuse"; value: number; max?: number };
  readonly voiceOutput?: {
    readonly artifactUris: readonly string[];
    readonly provider: string;
    readonly model?: string;
    readonly surface: string;
    readonly mode: "audio-response" | "artifact-only" | "audio-on-demand";
  };
  readonly runtimeContinuity?: {
    readonly strategy: string;
    readonly feedbackLabel?: string;
    readonly pressure?: string;
    readonly supportArtifactCount?: number;
    readonly supportArtifactSources?: readonly string[];
    readonly fallbackLabel?: string;
    readonly usedCachedSupport?: boolean;
    readonly selectionReason?: string;
  };
  readonly contextAudit?: RuntimeContextAudit;
  readonly effectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot;
  readonly communicationResolution?: CommunicationResolution;
  readonly effectivePromptObservation?: EffectivePromptObservation;
};

/** Public admitted response carrying the exact Runtime terminal disposition. */
export type AdmittedTurnResult = AdmittedTurnResultCommon & RuntimeTurnTerminalDisposition;

/**
 * Projects the Core-owned terminal fields at the gateway boundary. Runtime
 * results are enriched with pipeline metadata; operator frames carry only the
 * disposition fields so evidence cannot be lost or accidentally widened.
 */
export function projectAdmittedTurnDisposition(
  result: RuntimeTurnTerminalDisposition
    & Partial<AdmittedTurnResultCommon>
): RuntimeOperatorTurnTerminalDisposition {
  return parseRuntimeOperatorTurnTerminalDisposition(result);
}

function sessionNotActiveDisposition(): Extract<RuntimeTurnTerminalDisposition, { readonly dispositionReason: "session_not_active" }> {
  return {
    outcome: "paused",
    dispositionReason: "session_not_active",
  };
}

export interface BudgetDeniedResult {
  readonly budgetExhausted: true;
  readonly message: string;
}

export type ProcessResult =
  | { ok: true; result: AdmittedTurnResult }
  | { ok: false; budgetDenied: BudgetDeniedResult };

/**
 * State threaded from turn admission (session resolution, agent routing) into the
 * remaining pipeline phases. Populated once by {@link resolveSessionAndAgentContext}.
 */
interface SessionAdmissionState {
  readonly turnStartedAt: Date;
  readonly preAdmissionRuntimeEvents: readonly RuntimePipelineLedgerEvent[];
  readonly runtimeConfigurationRevision?: RuntimeConfigurationRevisionSnapshot;
  readonly runtimeSessionConfigurationRevision?: RuntimeConfigurationRevisionSnapshot;
  readonly effectiveTenantId: string;
  readonly executionMode: OperatorExecutionMode;
  readonly session: RuntimeSession;
  readonly userParts: readonly ContentPart[];
  readonly userText: string;
  readonly taskShape: ReturnType<typeof normalizeRuntimeTaskShape>;
  readonly effectiveCallBuiltinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly effectivePerCallConfig?: PerCallToolConfig;
  readonly effectiveActiveAgentId?: string;
  readonly effectiveActiveAgentName?: string;
  readonly effectiveRoutingTier?: "rule" | "fallback";
  readonly effectiveRoutingConfidence?: number;
  readonly effectiveIsHandoff?: boolean;
  readonly effectivePreviousAgentId?: string;
  readonly effectivePreviousAgentName?: string;
  readonly effectiveHandoffBrief?: string;
  readonly effectivePingPongBlocked?: boolean;
  readonly effectivePingPongReason?: string;
}

/**
 * Turn admission / session resolution: budget gate, session get-or-create (with
 * optional resume hydration), and voice-input transcription.
 * multi-agent routing/tool registration. Returns either a terminal budget-denied
 * result or the admitted state consumed by the remaining phases.
 */
async function resolveSessionAndAgentContext(
  ctx: AdmittedTurnContext,
  trace: TraceContext,
): Promise<
  | { readonly kind: "stop"; readonly result: ProcessResult }
  | { readonly kind: "continue"; readonly state: SessionAdmissionState }
> {
  // Validate both transported admission values before artifact, tenant, or
  // provider work. The persistence assertion recomputes each complete bundle
  // digest and returns its canonical normalized value; comparing those values
  // prevents an authority-id-only match or object-identity shortcut from
  // admitting a mutated per-call bundle.
  const admittedAuthority = assertPersistableAuthorityAdmissionBundle(ctx.authorityAdmission);
  const perCallAuthority = ctx.perCallConfig.authorityAdmission;
  if (perCallAuthority === undefined) {
    throw new Error("Admitted turn config must carry the exact EffectiveAuthorityAdmissionBundle.");
  }
  let canonicalPerCallAuthority: EffectiveAuthorityAdmissionBundle;
  try {
    canonicalPerCallAuthority = assertPersistableAuthorityAdmissionBundle(perCallAuthority);
  } catch {
    throw new Error("Admitted turn config must carry the exact EffectiveAuthorityAdmissionBundle.");
  }
  if (JSON.stringify(canonicalPerCallAuthority) !== JSON.stringify(admittedAuthority)) {
    throw new Error("Admitted turn config must carry the exact EffectiveAuthorityAdmissionBundle.");
  }

  let userParts = ctx.artifactStore
    ? await captureMultimodalArtifacts(ctx.userParts, {
      artifactStore: ctx.artifactStore,
      downloader: createGenericMediaDownloader(),
      sourceKind: "uploaded-file",
      sourceIdPrefix: `${ctx.appName}:${ctx.tenantId}:${ctx.userId}:${ctx.channel}`,
      producerName: `gateway-${ctx.channel}-ingress`,
      abortSignal: ctx.perCallConfig?.abortSignal,
    })
    : ctx.userParts;
  const turnStartedAt = new Date();
  let preAdmissionRuntimeEvents: readonly RuntimePipelineLedgerEvent[] = [];
  const effectiveTenantId = ctx.tenant?.tenantId ?? ctx.tenantId;
  const executionMode = ctx.executionMode ?? "execute";
  const initialSystemPrompt = ctx.tenant
    ? buildTenantSystemPrompt(ctx.tenant)
    : (ctx.systemPrompt ?? "You are a helpful assistant.");

  // Budget check
  if (ctx.billing) {
    const budgetResult = await checkBudget(ctx.billing, effectiveTenantId);
    if (!budgetResult.allowed) {
      trace.log("pipeline", "Budget denied");
      return {
        kind: "stop",
        result: {
          ok: false,
          budgetDenied: {
            budgetExhausted: true,
            message: ctx.billing.overBudgetMessage ?? "Budget exhausted.",
          },
        },
      };
    }
  }

  // Capture once after the ingress budget gate and before work that can span
  // the turn. Later phases receive this exact frozen value and never reread
  // live configuration.
  const runtimeConfigurationRevision = readExecutionConfigurationRevision(ctx.perCallConfig);

  const shouldAttemptResumeHydration = ctx.admittedSession === undefined
    && ctx.sessionId !== undefined
    && ctx.resumeSessionHydrator !== undefined;
  const existingResumeTarget = shouldAttemptResumeHydration && ctx.sessionId
    ? await ctx.sessionRegistry.getById(ctx.sessionId)
    : undefined;
  const shouldHydrateResumedSession = shouldAttemptResumeHydration
    && (existingResumeTarget === undefined || existingResumeTarget.isExpired);

  // Get or create session
  const session = ctx.admittedSession ?? await ctx.sessionRegistry.getOrCreate({
    appName: ctx.appName,
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    systemPrompt: initialSystemPrompt,
    idleTimeoutMs: ctx.idleTimeoutMs,
  });
  if (ctx.admittedSession
    && (session.id !== ctx.authorityAdmission?.sessionId
      || session.appName !== ctx.appName
      || session.tenantId !== effectiveTenantId
      || session.userId !== ctx.userId)) {
    throw new Error("Authority-admitted Runtime session does not match the admitted turn identity.");
  }
  const runtimeSessionConfigurationRevision = runtimeConfigurationRevision
    ? session.bindRuntimeConfigurationRevision(runtimeConfigurationRevision)
    : session.runtimeConfigurationRevision;
  trace.log("pipeline", "Session ready", { sessionId: session.id, sessionMode: session.sessionMode });

  if (shouldHydrateResumedSession && ctx.sessionId && ctx.resumeSessionHydrator) {
    try {
      const hydration = await ctx.resumeSessionHydrator({ sessionId: ctx.sessionId, session });
      const summary = hydration.rehydrated
        ? `Runtime session rehydrated from transcript: ${hydration.messageCount} messages`
        : `Runtime session rehydration skipped: ${hydration.reason ?? "no usable transcript"}`;
      session.addExactArtifact(summary);
      session.updateSessionLedger({
        lastSummary: summary,
      });
      trace.log("pipeline", "Resume hydration completed", {
        sessionId: session.id,
        rehydrated: hydration.rehydrated,
        messageCount: hydration.messageCount,
        reason: hydration.reason,
        sourceSequence: hydration.sourceSequence,
      });
    } catch (error) {
      const summary = `Runtime session rehydration failed: ${error instanceof Error ? error.message : String(error)}`;
      session.addExactArtifact(summary);
      session.updateSessionLedger({ lastSummary: summary });
      trace.warn("pipeline", "Resume hydration failed", { sessionId: session.id, error: String(error) });
    }
  }

  // Merge incoming user context into session (merge semantics: keys accumulate)
  if (ctx.userContext && Object.keys(ctx.userContext).length > 0) {
    session.updateUserContext(ctx.userContext);
  }

  const voiceInput = await resolveVoiceInputParts({
    parts: userParts,
    voiceConfig: ctx.voiceConfig,
    sttAdapter: ctx.sttAdapter,
    artifactStore: ctx.artifactStore,
    appName: ctx.appName,
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    channel: ctx.channel,
    sessionId: session.id,
    mediaActionClaims: ctx.runtimeMediaActionClaims,
    authorityAdmission: ctx.authorityAdmission,
    attemptId: ctx.perCallConfig?.runtimeModelRoundDispatch?.attemptId,
    callerId: `${ctx.channel}:voice-input:${ctx.userId}:${session.id}`,
    idempotencyKey: ctx.authorityAdmission?.turnId ?? session.id,
    logicalSendSlotPrefix: "inbound-stt",
    abortSignal: ctx.perCallConfig?.abortSignal,
  });
  userParts = voiceInput.parts;
  preAdmissionRuntimeEvents = voiceInput.events;

  const userText = extractText(userParts);
  const taskShape = normalizeRuntimeTaskShape(userText);

  let effectiveCallBuiltinTools = ctx.callBuiltinTools;
  let effectivePerCallConfig = ctx.perCallConfig;
  let effectiveActiveAgentId = ctx.activeAgentId;
  let effectiveActiveAgentName = ctx.activeAgentName;
  let effectiveRoutingTier = ctx.routingTier;
  let effectiveRoutingConfidence = ctx.routingConfidence;
  let effectiveIsHandoff = ctx.isHandoff;
  let effectivePreviousAgentId = ctx.previousAgentId;
  let effectivePreviousAgentName = ctx.previousAgentName;
  let effectiveHandoffBrief = ctx.handoffBrief;
  let effectivePingPongBlocked = ctx.pingPongBlocked;
  let effectivePingPongReason = ctx.pingPongReason;

  if (ctx.tenant) {
    const agentCtx = await resolveAgentContextAsync(
      ctx.tenant,
      userParts,
      session,
      { eventBus: ctx.eventBus },
      undefined,
      effectiveCallBuiltinTools,
      session.userContext,
    );

    effectiveActiveAgentId = agentCtx.activeAgentId;
    effectiveActiveAgentName = agentCtx.activeAgentName;
    effectiveRoutingTier = agentCtx.routingResult?.tier;
    effectiveRoutingConfidence = agentCtx.routingResult?.confidence;
    effectiveIsHandoff = agentCtx.isHandoff;
    effectivePreviousAgentId = agentCtx.previousAgentId;
    effectivePreviousAgentName = effectivePreviousAgentId
      ? ctx.tenant.agents?.find((agent) => agent.id === effectivePreviousAgentId)?.name
      : undefined;
    effectiveHandoffBrief = agentCtx.handoffBrief;
    effectivePingPongBlocked = agentCtx.pingPongBlocked;
    effectivePingPongReason = agentCtx.pingPongReason;

    const tenantToolCtx = agentCtx.tenantToolContext;
    if (tenantToolCtx.toolDefinitions.length > 0) {
      ctx.orchestrator.registerTools(tenantToolCtx.toolDefinitions);
    }

    if (tenantToolCtx.callBuiltinTools.size > 0) {
      effectiveCallBuiltinTools = tenantToolCtx.callBuiltinTools;
    }

    if (effectivePerCallConfig?.authorityAdmission) {
      // Tenant routing may contribute model-visible definitions and runtime
      // limits, but it cannot replace any committed authority facet. Keep
      // only definitions/capabilities already named by the immutable bundle.
      const committedToolAllowlist = readExecutionToolAllowlist(effectivePerCallConfig);
      const admittedTenantTools = tenantToolCtx.toolDefinitions.filter((tool) => committedToolAllowlist?.has(tool.name));
      const admittedTenantCapabilities = new Map(
        [...tenantToolCtx.capabilities.entries()].filter(([name]) => committedToolAllowlist?.has(name)),
      );
      effectivePerCallConfig = {
        ...effectivePerCallConfig,
        tenantId: effectiveTenantId,
        rateLimiter: tenantToolCtx.rateLimiter,
        ...(admittedTenantTools.length > 0
          ? { additionalTools: admittedTenantTools, perCallCapabilities: admittedTenantCapabilities }
          : {}),
        ...(tenantToolCtx.executionEnvelope ? { executionEnvelope: tenantToolCtx.executionEnvelope } : {}),
      };
    } else {
      const baseToolAllowlist = effectivePerCallConfig?.toolAllowlist;
      const tenantToolAllowlist = tenantToolCtx.toolAllowlist;
      const narrowedToolAllowlist = baseToolAllowlist && tenantToolAllowlist
        ? new Set([...tenantToolAllowlist].filter((name) => baseToolAllowlist.has(name)))
        : tenantToolAllowlist ?? baseToolAllowlist;
      effectivePerCallConfig = {
        ...effectivePerCallConfig,
        tenantId: effectiveTenantId,
        toolAuthority: tenantToolCtx.toolAuthority,
        toolAllowlist: narrowedToolAllowlist,
        rateLimiter: tenantToolCtx.rateLimiter,
        additionalTools: tenantToolCtx.toolDefinitions.length > 0 ? tenantToolCtx.toolDefinitions : undefined,
        perCallCapabilities: tenantToolCtx.capabilities.size > 0 ? tenantToolCtx.capabilities : undefined,
        ...(tenantToolCtx.executionEnvelope ? { executionEnvelope: tenantToolCtx.executionEnvelope } : {}),
      };
    }

    session.setSystemPrompt(agentCtx.systemPrompt);
    if (agentCtx.activeAgentId) {
      session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
    }
  }

  session.updateSessionLedger({
    currentPhase: "processing",
    turnDepth: session.messageCount + 1,
  });

  return {
    kind: "continue",
    state: {
      turnStartedAt,
      preAdmissionRuntimeEvents,
      runtimeConfigurationRevision,
      runtimeSessionConfigurationRevision,
      effectiveTenantId,
      executionMode,
      session,
      userParts,
      userText,
      taskShape,
      effectiveCallBuiltinTools,
      effectivePerCallConfig,
      effectiveActiveAgentId,
      effectiveActiveAgentName,
      effectiveRoutingTier,
      effectiveRoutingConfidence,
      effectiveIsHandoff,
      effectivePreviousAgentId,
      effectivePreviousAgentName,
      effectiveHandoffBrief,
      effectivePingPongBlocked,
      effectivePingPongReason,
    },
  };
}

/**
 * Session-limit and abuse-detection guards: turn-count limit, token limit, and
 * repetitive-abuse detection. Returns a terminal `paused` result when a guard
 * trips, or `undefined` to continue the pipeline.
 */
async function applyTurnGuards(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  trace: TraceContext,
): Promise<ProcessResult | undefined> {
  const { session, userText } = state;

  // Session turn limit check
  if (ctx.sessionLimits?.maxTurns && session.userTurnCount >= ctx.sessionLimits.maxTurns) {
    trace.warn("pipeline", "Session turn limit reached", { turns: session.userTurnCount, max: ctx.sessionLimits.maxTurns });
    session.setSessionMode("human_active");
    await ctx.sessionRegistry.save(session);
    return {
      ok: true,
      result: {
        parts: [],
        admittedInput: { content: userText },
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        ...sessionNotActiveDisposition(),
        queued: true,
        sessionId: session.id,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        limitReached: { type: "turns", value: session.userTurnCount, max: ctx.sessionLimits.maxTurns },
      },
    };
  }

  // Session token limit check
  if (ctx.sessionLimits?.maxTokens && session.totalTokens >= ctx.sessionLimits.maxTokens) {
    trace.warn("pipeline", "Session token limit reached", { tokens: session.totalTokens, max: ctx.sessionLimits.maxTokens });
    session.setSessionMode("human_active");
    await ctx.sessionRegistry.save(session);
    return {
      ok: true,
      result: {
        parts: [],
        admittedInput: { content: userText },
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        ...sessionNotActiveDisposition(),
        queued: true,
        sessionId: session.id,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        limitReached: { type: "tokens", value: session.totalTokens, max: ctx.sessionLimits.maxTokens },
      },
    };
  }

  // Repetitive abuse detection
  if (ctx.abuseDetection) {
    const abuse = detectRepetitiveAbuse(userText, session.conversationHistory, ctx.abuseDetection);
    if (abuse) {
      trace.warn("pipeline", "Abuse detected", { type: abuse.type, confidence: abuse.confidence });
      session.setSessionMode("human_active");
      await ctx.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [],
          admittedInput: { content: userText },
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          ...sessionNotActiveDisposition(),
          queued: true,
          sessionId: session.id,
          sessionMode: session.sessionMode,
          traceId: trace.traceId,
          limitReached: { type: "abuse", value: abuse.confidence },
        },
      };
    }
  }

  return undefined;
}

/**
 * Turn context assembly: projects runtime continuity/support artifacts, procedural
 * and coordination context candidates, and the per-call tool config used by the
 * orchestrator invocation.
 */
async function assembleTurnContext(ctx: AdmittedTurnContext, state: SessionAdmissionState, trace: TraceContext) {
  const { session, effectiveTenantId, executionMode, effectivePerCallConfig, effectiveActiveAgentId, taskShape, userText } = state;

  // Project admitted-turn context for orchestrator consumption.
  const runtimeSupport = readRuntimeSupportArtifactsDetailed(ctx.contextArtifactCache, {
    session,
    channel: ctx.channel,
    providerHint: session.sessionLedger.lastProvider,
    taskShape,
  });
  const runtimeContinuityPresentation = formatRuntimeContinuityPresentation(runtimeSupport);
  const cachedRuntimeSummary = runtimeSupport.content;
  session.addExactArtifact(runtimeContinuityPresentation.decisionSummary);
  trace.log("pipeline", "Runtime continuity decision", {
    strategy: runtimeContinuityPresentation.runtimeContinuity.strategy,
    signals: runtimeSupport.decision.cachedResumeSignalCount,
    pressure: runtimeContinuityPresentation.runtimeContinuity.pressure,
    sources: runtimeContinuityPresentation.runtimeContinuity.supportArtifactSources,
    fallback: runtimeContinuityPresentation.runtimeContinuity.fallbackLabel,
    usedSelectedSources: runtimeContinuityPresentation.runtimeContinuity.usedCachedSupport,
    selectionReason: runtimeContinuityPresentation.runtimeContinuity.selectionReason,
    usedCache: runtimeContinuityPresentation.runtimeContinuity.strategy === "cache-first",
    feedback: runtimeContinuityPresentation.runtimeContinuity.feedbackLabel,
    influenced: runtimeSupport.decision.resumeFeedback?.influencedChoice ?? false,
  });

  if (!effectivePerCallConfig?.authorityAdmission) {
    throw new Error("Admitted turn execution config is missing its EffectiveAuthorityAdmissionBundle.");
  }
  const canonicalTurn = resolveCanonicalTurnIdentity(session, effectivePerCallConfig.turnCorrelationId);
  if (ctx.authorityAdmission.sessionId !== session.id || ctx.authorityAdmission.turnId !== canonicalTurn.turnId) {
    throw new Error("Committed authority admission does not belong to the canonical Runtime turn.");
  }
  let perCallConfig: PerCallToolConfig = ctx.contextPolicy
    ? { ...effectivePerCallConfig, contextPolicy: ctx.contextPolicy }
    : effectivePerCallConfig;
  // Preserve the exact full bundle and workload-owned media owner through the
  // model-facing per-call projection. Legacy authority facets are deliberately
  // not reconstructed here.
  if (ctx.runtimeMediaActionClaims) {
    perCallConfig = {
      ...perCallConfig,
      runtimeMediaActionClaims: ctx.runtimeMediaActionClaims,
      runtimeMediaActionAdmission: ctx.authorityAdmission,
      runtimeMediaActionAttemptId: ctx.perCallConfig?.runtimeModelRoundDispatch?.attemptId,
      runtimeMediaActionCallerId: `${ctx.channel}:multimodal:${ctx.userId}:${session.id}`,
      runtimeMediaActionIdempotencyKey: ctx.authorityAdmission?.turnId ?? session.id,
    };
  }
  // These values are runtime authority transport, not model-facing request
  // configuration. Keep them directly readable by the orchestrator while
  // preventing accidental projection into provider/tool request snapshots.
  if (canonicalTurn.correlationId) {
    Object.defineProperty(perCallConfig, "turnCorrelationId", {
      configurable: false,
      enumerable: false,
      value: canonicalTurn.correlationId,
      writable: false,
    });
  }
  const proceduralContextCandidates: ContextCandidate[] = [];
  if (executionMode === "plan") {
    proceduralContextCandidates.push({
      kind: "procedural",
      modelFacingSemantics: "directive",
      source: "runtime-execution-mode:plan",
      required: true,
      score: 1,
      content: [
        "Execution mode: plan.",
        "Do not mutate files, run destructive commands, apply patches, install dependencies, or execute implementation work.",
        "Use only read-only inspection tools as needed.",
        "When the plan is ready, call submit_plan with a structured governed plan artifact linked to sourceSpecificationId and clarificationRecordIds.",
      ].join("\n"),
    });
  }
  proceduralContextCandidates.push(buildAuthorityGuidanceContextCandidate(perCallConfig, {
    executionMode,
    requestedAuthority: readExecutionTurnAuthority(perCallConfig).requestedAuthority,
  }));
  if (perCallConfig?.governedWorkRequirement) {
    proceduralContextCandidates.push(
      buildGovernedWorkMaterializationContextCandidate(perCallConfig.governedWorkRequirement),
    );
  }
  if (executionMode === "execute" && shouldIncludeGovernedWorkCloseoutContext(userText)) {
    proceduralContextCandidates.push(buildGovernedWorkCloseoutContextCandidate());
  }
  if (hasWebToolAvailable(perCallConfig)) {
    proceduralContextCandidates.push(buildWebSourceAttributionContextCandidate());
  }
  if (ctx.skillRegistry && (ctx.activeSkills?.length || ctx.activeSkillTags?.length)) {
    const resolved = ctx.skillRegistry.resolve(ctx.activeSkills, ctx.activeSkillTags);
    for (const skill of resolved) {
      const loadedSkill = ctx.skillRegistry.load(skill.name);
      if (loadedSkill) {
        proceduralContextCandidates.push(skillConfigToContextCandidate(loadedSkill));
      }
    }
  }
  const coordinationContext = await resolveCoordinationContextCandidates(ctx.coordinationContextProvider, {
    appName: ctx.appName,
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    sessionId: session.id,
    channel: ctx.channel,
    activeAgentId: effectiveActiveAgentId,
  });
  const projectedTurnContext = projectAdmittedTurnContext({
    userContext: session.userContext,
    cachedRuntimeSummary,
    recalledMemoryCandidates: ctx.recalledMemoryCandidates,
    proceduralContextCandidates,
    coordinationContextCandidates: coordinationContext.candidates,
    contextPolicy: ctx.contextPolicy,
  });
  const projectedContextAudit = appendCoordinationProviderFailureAudit(
    projectedTurnContext.audit,
    coordinationContext.failureReason,
  );

  return {
    runtimeSupport,
    runtimeContinuityPresentation,
    canonicalTurnIdentity: canonicalTurn,
    perCallConfig,
    projectedTurnContext,
    projectedContextAudit,
  };
}

type AssembledTurnContext = Awaited<ReturnType<typeof assembleTurnContext>>;

/**
 * Orchestrator invocation with event-ledger capture: wires transient listeners onto
 * the orchestrator event bus to capture approval/authority/runtime-ledger events for
 * this turn, invokes `orchestrator.processMessage`, and tears the listeners down. On
 * failure it records a canonical failure turn and rethrows.
 */
async function invokeOrchestratorWithLedgerCapture(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  assembled: AssembledTurnContext,
  lifecycle: CanonicalTurnLifecycle,
) {
  const { session, userParts } = state;
  const { projectedTurnContext, canonicalTurnIdentity } = assembled;
  let perCallConfig = assembled.perCallConfig;

  const executionToolAllowlist = readExecutionToolAllowlist(perCallConfig);
  const governedGoalTools = hasGovernedGoalTools({
    toolAllowlist: executionToolAllowlist,
    additionalTools: perCallConfig?.authorityAdmission
      ? perCallConfig.additionalTools?.filter((tool) => executionToolAllowlist?.has(tool.name))
      : perCallConfig?.additionalTools,
    // A committed bundle enumerates the executable tool authority. Do not
    // treat the complete builtin registry as an adoption trigger after the
    // commit boundary, or a legacy decision would be prepared here.
    builtinToolNames: perCallConfig?.authorityAdmission ? undefined : state.effectiveCallBuiltinTools?.keys(),
  });
  // A1 authority is durable before the first model/tool round. Ingress turn
  // ids (request/live/attempt) remain correlation-only and are never authority.
  // A sink is mandatory whenever governed goal tools are available; callers
  // that provide one also get the canonical decision for non-governed turns.
  const admittedAdoptionDecision = readExecutionOperatorAdoptionDecision(perCallConfig);
  if (admittedAdoptionDecision) {
    if (admittedAdoptionDecision.ownerSessionId !== session.id
      || admittedAdoptionDecision.operatorTurnId !== canonicalTurnIdentity.turnId) {
      throw new Error("Committed operator adoption decision does not belong to the canonical Runtime turn.");
    }
  } else {
    if (governedGoalTools) {
      throw new Error("Committed authority admission lacks an admitted operator-adoption decision for governed tools.");
    }
  }
  // Capture real approval state transitions for this turn from runtime events.
  const approvalTransitions: RuntimeTurnApprovalTransition[] = [];
  const authorityDecisions: RuntimeTurnAuthorityDecision[] = [];
  const capturedRuntimeReplay = replayCapturedRuntimeLedgerEvents(
    ctx.orchestrator.eventBus,
    session.id,
    state.turnStartedAt,
    [...(ctx.runtimeEvents ?? []), ...state.preAdmissionRuntimeEvents],
  );
  const capturedRuntimeEvents = capturedRuntimeReplay.events;
  const capturedRuntimeEventKeys = capturedRuntimeReplay.keys;
  const durableInitialRuntimeEvents = perCallConfig?.abortSignal?.aborted
    ? capturedRuntimeEvents.filter((event) => event.type !== "error" || !isCancellationErrorEvent(event))
    : capturedRuntimeEvents;
  await lifecycle.appendRuntimeEvents(durableInitialRuntimeEvents);
  const orchestratorEventBus = ctx.orchestrator.eventBus;
  const onApprovalRequested = (event: ApprovalRequestedEvent): void => {
    if (event.sessionId !== session.id) return;
    if (!appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id)) {
      return;
    }
    lifecycle.appendRuntimeEvent(event);
    approvalTransitions.push({
      approvalId: event.approvalId,
      status: "requested",
      sessionId: event.sessionId,
      reason: event.description,
    });
  };
  const onApprovalReceived = (event: ApprovalReceivedEvent): void => {
    if (event.sessionId !== session.id) return;
    if (!appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id)) {
      return;
    }
    lifecycle.appendRuntimeEvent(event);
    approvalTransitions.push({
      approvalId: event.approvalId,
      status: event.approved ? "approved" : "rejected",
      sessionId: event.sessionId,
      reason: event.reason,
    });
  };
  const onToolAuthorized = (event: ToolAuthorizedEvent): void => {
    if (event.sessionId !== session.id) return;
    authorityDecisions.push({
      toolName: event.toolName,
      level: event.level,
      allowed: event.allowed,
      reason: event.reason,
    });
  };
  const onRuntimeLedgerEvent = (
    event: CostUpdateEvent | ErrorEvent | ModelRoutedEvent | MultimodalRoutedEvent | ToolCalledEvent | ToolOutputEvent | ToolResultEvent,
  ): void => {
    if (event.sessionId !== session.id) {
      return;
    }
    if (event.type === "error" && perCallConfig?.abortSignal?.aborted && isCancellationErrorEvent(event)) {
      appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id);
      return;
    }
    if (!appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id)) {
      return;
    }
    lifecycle.appendRuntimeEvent(event);
  };
  orchestratorEventBus?.on("approval_requested", onApprovalRequested);
  orchestratorEventBus?.on("approval_received", onApprovalReceived);
  orchestratorEventBus?.on("tool_authorized", onToolAuthorized);
  orchestratorEventBus?.on("cost_update", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("error", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("model_routed", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("multimodal_routed", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_called", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_output", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_result", onRuntimeLedgerEvent);
  let result: OrchestrateResult;
  try {
    // Process message
    result = await ctx.orchestrator.processMessage(
      session,
      userParts,
      projectedTurnContext,
      state.effectiveCallBuiltinTools,
      perCallConfig,
    );
  } catch (error) {
    const turnFailedAt = new Date();
    const cancelled = perCallConfig?.abortSignal?.aborted === true;
    const terminalRuntimeEvents = !cancelled && !capturedRuntimeEvents.some((event) => event.type === "error")
      ? [runtimeFailureEvent(error, session.id, turnFailedAt)]
      : [];
    for (const event of terminalRuntimeEvents) {
      appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id);
    }
    await lifecycle.settle({
      queued: false,
      disposition: terminalDispositionForError(ctx, perCallConfig?.abortSignal),
      turnCompletedAt: turnFailedAt,
      terminalRuntimeEvents,
      providerRequests: undefined,
      ...(cancelled ? {} : {
        lifecycleAttributionEvidence: {
          contextAudit: projectedTurnContext.audit,
        },
      }),
    });
    await ctx.sessionRegistry.save(session);
    throw error;
  } finally {
    orchestratorEventBus?.off("approval_requested", onApprovalRequested);
    orchestratorEventBus?.off("approval_received", onApprovalReceived);
    orchestratorEventBus?.off("tool_authorized", onToolAuthorized);
    orchestratorEventBus?.off("cost_update", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("error", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("model_routed", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("multimodal_routed", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_called", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_output", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_result", onRuntimeLedgerEvent);
  }
  return {
    result,
    approvalTransitions,
    authorityDecisions,
    capturedRuntimeEvents,
    capturedRuntimeEventKeys,
  };
}

type OrchestrationOutcome = Awaited<ReturnType<typeof invokeOrchestratorWithLedgerCapture>>;

/**
 * Egress sanitization + voice synthesis + turn-record persistence: merges tool
 * execution evidence, extracts governed-work artifacts, applies egress permission
 * decisions to the assistant response/summary/tool results, synthesizes voice
 * output, persists the runtime turn record, and appends canonical turn events.
 */
async function finalizeEgressAndPersistTurn(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  assembled: AssembledTurnContext,
  orchestration: OrchestrationOutcome,
  lifecycle: CanonicalTurnLifecycle,
  runtimeFinalOutputText: string,
) {
  const { session, effectiveTenantId, executionMode, taskShape } = state;
  const { perCallConfig, runtimeSupport, projectedContextAudit } = assembled;
  const { result, approvalTransitions, authorityDecisions, capturedRuntimeEvents } = orchestration;
  let resultParts = result.parts;

  const turnToolExecutions = resolveTurnToolExecutions(
    result.toolExecutions,
    capturedRuntimeEvents,
  );
  const fileChanges = turnToolExecutions?.flatMap((execution) => (
    execution.fileChanges?.map((change) => ({
      ...change,
      ...(execution.toolCallId ? { toolCallId: execution.toolCallId } : {}),
      ...(execution.executionScope ? { executionScope: execution.executionScope } : {}),
    })) ?? []
  )) ?? [];
  const dangerousCommandOutcomes = turnToolExecutions
    ?.map((execution) => dangerousCommandOutcomeFromExecution(execution))
    .filter((outcome): outcome is RuntimeTurnDangerousCommandOutcome => outcome !== undefined)
    ?? [];
  const planSubmissions = executionMode === "plan"
    ? extractPlanSubmissions(turnToolExecutions)
    : [];
  const specificationSubmissions = executionMode === "plan"
    ? extractSpecificationSubmissions(turnToolExecutions)
    : [];
  const clarificationRecords = executionMode === "plan"
    ? extractClarificationRecords(turnToolExecutions)
    : [];
  const analysisReports = executionMode === "plan"
    ? extractPlanAnalysisReports(turnToolExecutions)
    : [];
  const authorityMutationViolation = buildAuthorityMutationViolation(
    readExecutionTurnAuthority(perCallConfig),
    fileChanges,
  );

  resultParts = appendWebSourceAttributionIfMissing(resultParts, turnToolExecutions);
  let egressContextSummary = result.contextSummary;
  let egressToolExecutions = turnToolExecutions;
  resultParts = sanitizeAssistantEgressParts(resultParts);
  const assistantDecision = await resolveEgressDecision(
    ctx,
    effectiveTenantId,
    session.id,
    "assistant-response",
    extractText(resultParts),
  );

  if (assistantDecision === "deny") {
    resultParts = textParts(EGRESS_DENIED_FALLBACK_TEXT);
  } else if (assistantDecision === "redact") {
    resultParts = redactAssistantParts(resultParts);
  }

  if (assistantDecision === "deny") {
    egressContextSummary = undefined;
  } else if (assistantDecision === "redact" && egressContextSummary !== undefined) {
    egressContextSummary = EGRESS_REDACTED_TEXT;
  } else {
    const summaryDecision = await resolveEgressDecision(
      ctx,
      effectiveTenantId,
      session.id,
      "context-summary",
      result.contextSummary,
    );
    if (summaryDecision === "deny") {
      egressContextSummary = undefined;
    } else if (summaryDecision === "redact" && egressContextSummary !== undefined) {
      egressContextSummary = EGRESS_REDACTED_TEXT;
    }
  }

  if (egressToolExecutions && egressToolExecutions.length > 0) {
    const mapped: ToolExecutionSummary[] = [];
    for (const exec of egressToolExecutions) {
      let summaryDecision: EgressPermissionDecision;
      if (assistantDecision === "deny") {
        summaryDecision = "deny";
      } else if (assistantDecision === "redact") {
        summaryDecision = "redact";
      } else {
        summaryDecision = await resolveEgressDecision(
          ctx,
          effectiveTenantId,
          session.id,
          "tool-result-summary",
          exec.resultSummary,
        );
      }

      if (summaryDecision === "deny") {
        mapped.push({ ...exec, resultSummary: "" });
      } else if (summaryDecision === "redact") {
        mapped.push({ ...exec, resultSummary: EGRESS_REDACTED_TEXT });
      } else {
        mapped.push(exec);
      }
    }
    egressToolExecutions = mapped;
  }

  const voiceSynthesis = await synthesizeVoiceOutput(
    resultParts,
    ctx.voiceConfig,
    ctx.ttsAdapter,
    {
      artifactStore: ctx.artifactStore,
      appName: ctx.appName,
      tenantId: effectiveTenantId,
      userId: ctx.userId,
      channel: ctx.channel,
      sessionId: session.id,
      model: result.routingDecision?.model ?? ctx.orchestrator.model ?? "gateway-transform",
      voiceProfile: ctx.voiceProfile,
      voiceOutputIntent: ctx.voiceOutputIntent,
      escalationReason: result.escalation?.reason,
      retentionMaxArtifacts: ctx.voiceConfig?.policy?.artifacts?.retentionMaxArtifacts,
      mediaActionClaims: ctx.runtimeMediaActionClaims,
      authorityAdmission: ctx.authorityAdmission,
      attemptId: perCallConfig?.runtimeModelRoundDispatch?.attemptId,
      callerId: `${ctx.channel}:voice-output:${ctx.userId}:${session.id}`,
      idempotencyKey: ctx.authorityAdmission?.turnId ?? session.id,
      logicalSendSlot: "assistant-tts",
      abortSignal: perCallConfig?.abortSignal,
    },
  );
  resultParts = voiceSynthesis.parts;
  for (const event of voiceSynthesis.events) {
    if (appendRuntimeLedgerEvent(capturedRuntimeEvents, orchestration.capturedRuntimeEventKeys, event, session.id)) {
      lifecycle.appendRuntimeEvent(event);
    }
  }
  await lifecycle.flush();

  writeRuntimeHandoffSummaryArtifact(ctx.contextArtifactCache, {
    session,
    handoffBrief: state.effectiveHandoffBrief,
    handoffBlocked: state.effectivePingPongBlocked,
    handoffBlockReason: state.effectivePingPongReason,
    escalationReason: result.escalation?.reason,
    escalationDetail: result.escalation?.detail,
  });
  await lifecycle.settle({
    assistantMessageContent: extractText(resultParts),
    queued: result.queued,
    disposition: readRuntimeDisposition(result),
    turnCompletedAt: new Date(),
    planSubmissions,
    analysisReports,
    specificationSubmissions,
    lifecycleAttributionEvidence: {
      contextAudit: projectedContextAudit,
      finalOutput: {
        estimatedTokens: estimateTextTokens(runtimeFinalOutputText),
      },
    },
    efficiencyPolicy: ctx.contextPolicy
      ? {
          owner: "ContextGovernor",
          policyId: ctx.contextPolicy.policyId,
          configurationHash: ctx.contextPolicy.configurationHash,
        }
      : undefined,
    clarificationRecords,
    authorityMutationViolations: authorityMutationViolation ? [authorityMutationViolation] : undefined,
    fileChanges: fileChanges.length > 0 ? fileChanges : undefined,
    contextUsage: projectCompletedTurnContextUsage({
      result,
      turnId: readExecutionTurnId(perCallConfig),
      contextWindow: ctx.contextUsageWindow,
    }),
    providerRequests: result.providerRequests,
  });

  applyRuntimeTurnRecord({
    session,
    channel: ctx.channel,
    taskShape,
    contextArtifactCache: ctx.contextArtifactCache,
    continuityDecision: runtimeSupport.decision,
    queued: result.queued,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    contextSummary: result.contextSummary,
    toolExecutions: turnToolExecutions,
    routingDecision: result.routingDecision,
    escalationReason: result.escalation?.reason,
    activeAgentId: state.effectiveActiveAgentId,
    routingTierHint: state.effectiveRoutingTier,
    fileChanges: fileChanges.length > 0 ? fileChanges : undefined,
    approvalTransitions: approvalTransitions.length > 0 ? approvalTransitions : undefined,
    authorityDecisions: authorityDecisions.length > 0 ? authorityDecisions : undefined,
    dangerousCommandOutcomes: dangerousCommandOutcomes.length > 0 ? dangerousCommandOutcomes : undefined,
    providerValidation: ctx.providerValidation,
  });

  return {
    resultParts,
    egressContextSummary,
    egressToolExecutions,
    voiceSynthesis,
  };
}

type FinalizedTurn = Awaited<ReturnType<typeof finalizeEgressAndPersistTurn>>;

/**
 * Persist the session and publish canonical session evidence, then return the
 * final `AdmittedTurnResult`.
 */
async function finalizeAndPersistTurn(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  assembled: AssembledTurnContext,
  orchestration: OrchestrationOutcome,
  finalized: FinalizedTurn,
  trace: TraceContext,
): Promise<ProcessResult> {
  const { session, userText } = state;
  const { projectedContextAudit, perCallConfig } = assembled;
  const { result } = orchestration;
  const { resultParts, egressContextSummary, egressToolExecutions, voiceSynthesis } = finalized;
  // Persist mutated session (required for non-reference stores like Redis)
  await ctx.sessionRegistry.save(session);


  trace.log("pipeline", "Message processed", { queued: result.queued, tokens: result.inputTokens + result.outputTokens });

  return {
    ok: true,
    result: {
      ...result,
      parts: resultParts,
      admittedInput: { content: userText },
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      queued: result.queued,
      sessionId: session.id,
      sessionMode: session.sessionMode,
      escalation: result.escalation,
      contextSummary: egressContextSummary,
      toolExecutions: egressToolExecutions,
      traceId: trace.traceId,
      activeAgentId: state.effectiveActiveAgentId,
      routingDecision: result.routingDecision
        ? {
            provider: result.routingDecision.provider,
            model: result.routingDecision.model,
            routingTier: result.routingDecision.routingTier,
            reasoning: result.routingDecision.reasoning,
            selectionMode: result.routingDecision.selectionMode,
            deliberationResolution: result.routingDecision.deliberationResolution,
            rationale: result.routingDecision.rationale,
          }
        : undefined,
      voiceOutput: voiceSynthesis.voiceOutput,
      runtimeContinuity: assembled.runtimeContinuityPresentation.runtimeContinuity,
      contextAudit: projectedContextAudit,
      effectiveTurnAuthority: readExecutionTurnAuthority(perCallConfig),
      communicationResolution: result.communicationResolution,
      effectivePromptObservation: projectFinalEffectivePromptObservation(result.providerRequests),
    },
  };
}

export async function processAdmittedTurn(ctx: AdmittedTurnContext): Promise<ProcessResult> {
  const trace = new TraceContext(ctx.traceId);
  trace.log("pipeline", "Processing inbound message", { appName: ctx.appName, userId: ctx.userId, channel: ctx.channel });

  const admission = await resolveSessionAndAgentContext(ctx, trace);
  if (admission.kind === "stop") {
    return admission.result;
  }
  const { state } = admission;

  const guardResult = await applyTurnGuards(ctx, state, trace);
  if (guardResult) {
    return guardResult;
  }

  const assembled = await assembleTurnContext(ctx, state, trace);
  if (ctx.authorityAdmission?.turn.execution.status === "routed"
    && !assembled.perCallConfig?.runtimeModelRoundDispatch) {
    throw new Error("App Gateway admitted provider turns require a durable Runtime model-round claim.");
  }
  const turnAbort = deriveTurnAbortSignal(assembled.perCallConfig?.abortSignal);
  const executionAssembled: AssembledTurnContext = {
    ...assembled,
    perCallConfig: {
      ...assembled.perCallConfig,
      abortSignal: turnAbort.signal,
    },
  };
  const liveTurnId = readExecutionTurnId(executionAssembled.perCallConfig);
  const liveLifecycle = state.session as RuntimeSession & {
    beginLiveTurn?: (turnId: string) => void;
    settleLiveTurn?: (turnId: string) => void;
  };
  liveLifecycle.beginLiveTurn?.(liveTurnId);
  try {
  const lifecycle = new CanonicalTurnLifecycle({
    session: state.session,
    turnId: executionAssembled.canonicalTurnIdentity.turnId,
    channel: ctx.channel,
    userMessageContent: state.userText,
    turnStartedAt: state.turnStartedAt,
    continuity: executionAssembled.runtimeContinuityPresentation.runtimeContinuity,
    executionRouteId: readExecutionBinding(executionAssembled.perCallConfig)?.routeId,
    persist: ctx.persistCanonicalSessionEvents,
    publish: ctx.publishCanonicalSessionEvents,
    requestAbort: (reason) => turnAbort.abort(reason),
  });
  await lifecycle.start();
  const orchestration = await invokeOrchestratorWithLedgerCapture(ctx, state, executionAssembled, lifecycle);
  await lifecycle.flush();
  const runtimeFinalOutputText = extractText(orchestration.result.parts);

  try {
    const finalized = await finalizeEgressAndPersistTurn(
      ctx,
      state,
      executionAssembled,
      orchestration,
      lifecycle,
      runtimeFinalOutputText,
    );
    return await finalizeAndPersistTurn(ctx, state, executionAssembled, orchestration, finalized, trace);
  } catch (error) {
    if (lifecycle.state === "open") {
      const turnFailedAt = new Date();
      const cancelled = executionAssembled.perCallConfig?.abortSignal?.aborted === true;
      const terminalRuntimeEvents = !cancelled && !orchestration.capturedRuntimeEvents.some((event) => event.type === "error")
        ? [runtimeFailureEvent(error, state.session.id, turnFailedAt)]
        : [];
      for (const event of terminalRuntimeEvents) {
        appendRuntimeLedgerEvent(
          orchestration.capturedRuntimeEvents,
          orchestration.capturedRuntimeEventKeys,
          event,
          state.session.id,
        );
      }
      await lifecycle.settle({
        assistantMessageContent: runtimeFinalOutputText,
        queued: orchestration.result.queued,
        disposition: terminalDispositionForError(ctx, executionAssembled.perCallConfig?.abortSignal),
        turnCompletedAt: turnFailedAt,
        terminalRuntimeEvents,
        lifecycleAttributionEvidence: {
          contextAudit: executionAssembled.projectedContextAudit,
          finalOutput: {
            estimatedTokens: estimateTextTokens(runtimeFinalOutputText),
          },
        },
        providerRequests: orchestration.result.providerRequests,
      });
      await ctx.sessionRegistry.save(state.session);
    }
    throw error;
  }
  } finally {
    liveLifecycle.settleLiveTurn?.(liveTurnId);
    turnAbort.dispose();
  }
}

function deriveTurnAbortSignal(parent: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  readonly abort: (reason?: unknown) => void;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  if (!parent) {
    return {
      signal: controller.signal,
      abort: (reason) => controller.abort(reason),
      dispose: () => undefined,
    };
  }
  const onAbort = (): void => controller.abort(parent.reason);
  if (parent.aborted) {
    onAbort();
  } else {
    parent.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    dispose: () => parent.removeEventListener("abort", onAbort),
  };
}

function terminalDispositionForError(
  ctx: AdmittedTurnContext,
  signal: AbortSignal | undefined,
): RuntimeTurnTerminalDisposition {
  if (signal?.aborted === true) {
    return {
      outcome: "cancelled",
      dispositionReason: ctx.perCallConfig.abortSignal?.aborted === true
        ? "operator_cancelled"
        : "runtime_cancelled",
    };
  }
  return {
    outcome: "failed",
    dispositionReason: "runtime_failure",
  };
}

function readRuntimeDisposition(result: OrchestrateResult): RuntimeTurnTerminalDisposition {
  return projectAdmittedTurnDisposition(result);
}
