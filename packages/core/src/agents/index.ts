import type { ContentPart } from "../engine/domain/content.js";
import type { ContextUsageRawEvidence } from "../events/context-usage-projection.js";
import type { DeliberationResolution } from "./deliberation-policy.js";
import type { CommunicationResolution } from "./communication-policy.js";

export type { AgentTier } from "./agent-tier.js";
export {
  assessCompletionEligibility,
  resolveRequiredProducerObligations,
} from "./completion-obligation.js";
export type {
  CompletionEligibility,
  CompletionObligation,
  CompletionObligationUnmet,
  CompletionObligationUnmetStatus,
  RequiredProducerEvidence,
  RequiredProducerEvidenceReference,
  RequiredProducerEvidenceStatus,
} from "./completion-obligation.js";
export {
  decideTurnConvergence,
  resolveTurnConvergencePolicy,
} from "./turn-convergence.js";
export type {
  ObservedTurnQuantity,
  TurnConvergenceDecision,
  TurnConvergenceLimitPauseReason,
  TurnConvergenceMetric,
  TurnConvergenceObservation,
  TurnConvergencePauseDecision,
  TurnConvergencePauseReason,
  TurnConvergencePolicyInput,
  TurnConvergenceReservation,
  ResolvedTurnConvergencePolicy,
} from "./turn-convergence.js";
export type { TurnProgressEvidence } from "./turn-progress-evidence.js";
export type {
  CompletionSettlementEvidence,
  EligibleCompletionSettlementEvidence,
  IneligibleCompletionSettlementEvidence,
  TurnConvergenceEvidence,
  TurnConvergenceSettlementEvidence,
  ExternalHarnessTerminalEvidence,
  ExternalHarnessTurnTerminalDisposition,
  RuntimeTurnTerminalDisposition,
  TurnTerminalDisposition,
} from "./turn-terminal-disposition.js";

/**
 * Agent role in the orchestration.
 * Built-in roles: "architect", "worker", "optimizer".
 * Domain apps can define arbitrary roles (e.g. "summarizer", "reviewer").
 */
export type AgentRole = string;

/** Message for agent communication */
export interface AgentMessage {
  readonly role: "user" | "assistant";
  readonly parts: readonly ContentPart[];
}

/** Streaming event from an agent */
export interface AgentStreamEvent {
  readonly type: "thinking" | "text" | "tool_use" | "tool_result" | "done";
  readonly content: string;
}

export {
  PhaseAwareModelRouter,
  selectPhaseAwareRoute,
} from "./phase-aware-route-policy.js";
export type {
  ModelRoutingPhase,
  PhaseAwareRouteCandidate,
  PhaseAwareRouteDecision,
  PhaseAwareRouteDiagnostic,
  PhaseAwareRouteProjection,
  PhaseAwareRoutingSignals,
  PhaseAwareModelRouterOptions,
  RouteHealthState,
  SelectPhaseAwareRouteInput,
} from "./phase-aware-route-policy.js";
export {
  KNOWN_DELIBERATION_LEVEL_IDS,
  admitDeliberationForExecution,
  defineDeliberationLevelId,
  resolveDeliberation,
} from "./deliberation-policy.js";
export {
  admitCommunicationForExecution,
  renderCommunicationPromptProjection,
  knownModelCommunicationCapabilities,
  resolveCommunicationIntent,
  resolveCommunicationProfile,
  validateResolvedCommunicationIntent,
} from "./communication-policy.js";
export type {
  CommunicationCapabilityEvidence,
  CommunicationContractReference,
  CommunicationExecutionIdentity,
  CommunicationIntent,
  CommunicationIntentCandidate,
  CommunicationIntentSource,
  CommunicationRequiredContent,
  CommunicationResolution,
  CommunicationResolutionReason,
  CommunicationProjectionResolution,
  CommunicationSurface,
  InteractionBehavior,
  InteractionProfileCapability,
  InteractionProfileIntent,
  InteractionProfileResolution,
  ModelCommunicationCapabilities,
  ResolvedCommunicationIntent,
  ResponseDetailCapabilities,
  ResponseDetailIntent,
  ResponseDetailResolution,
} from "./communication-policy.js";
export type {
  DeliberationBounds,
  DeliberationCapabilityEvidence,
  DeliberationIntent,
  DeliberationLevelId,
  DeliberationResolution,
  DeliberationResolutionReason,
  DeliberationSource,
  DeliberationTarget,
  ModelDeliberationCapabilities,
  ModelDeliberationLevel,
  ResolveDeliberationInput,
  UnsupportedDeliberationPolicy,
} from "./deliberation-policy.js";

/** Provider adapter interface -- all LLM providers implement this */
export interface ProviderAdapter {
  readonly name: string;
  /** Whether executable deliberation levels are projected to this provider's native request. */
  readonly deliberationTransport?: "native-level" | "none";
  /** Whether this adapter can carry a resolved communication control natively. */
  readonly communicationTransport?: "native" | "none";
  createMessage(options: CreateMessageOptions): Promise<AgentResponse>;
  streamMessage(options: CreateMessageOptions): AsyncGenerator<AgentStreamEvent>;
}

/** Tool choice strategy for agent calls */
export type ToolChoiceOption =
  | { readonly type: "auto" }
  | { readonly type: "any" }
  | { readonly type: "none" }
  | { readonly type: "tool"; readonly name: string };

/** Authority already admitted by the host for a nested provider execution. */
export type ProviderExecutionRequestedAuthority = "read_only" | "audited" | "destructive";

/** Host-owned context required to execute a provider turn in the intended workspace and authority envelope. */
export interface ProviderExecutionContext {
  readonly workingDirectory?: string;
  readonly requestedAuthority?: ProviderExecutionRequestedAuthority;
  readonly executionScope?: import("../events/session-execution-scope.js").SessionExecutionScope;
  /** Secret-free identity of the account and credential committed by the host. */
  readonly executionBinding?: Extract<
    import("../events/execution-session-event.js").ExecutionSessionBindingEvidence,
    { readonly status: "bound" }
  >;
  /** Opaque credential material resolved after the host's dispatch fence. */
  readonly executionCredential?: unknown;
}

/** Stable host-owned identity for one provider request; session affinity is separate. */
export interface ProviderRequestIdentity {
  readonly projectId?: string;
  readonly requestId?: string;
}

export { safeProviderRequestIdentity } from "./provider-request-identity.js";

/** Timeout limits for one provider transport attempt. Values must be positive milliseconds. */
export interface ProviderTransportWatchdog {
  readonly headerTimeoutMs?: number;
  readonly firstByteTimeoutMs?: number;
  readonly chunkIdleTimeoutMs?: number;
}

/**
 * Safe transport lifecycle evidence. It deliberately excludes headers, request/response bodies,
 * SSE frames, and provider error text so observers can be persisted without secret disclosure.
 */
export type ProviderTransportEvent =
  | { readonly type: "request_started"; readonly identity?: ProviderRequestIdentity }
  | { readonly type: "response_headers"; readonly identity?: ProviderRequestIdentity; readonly status: number }
  | { readonly type: "response_first_byte"; readonly identity?: ProviderRequestIdentity }
  | { readonly type: "response_chunk"; readonly identity?: ProviderRequestIdentity }
  | { readonly type: "request_completed"; readonly identity?: ProviderRequestIdentity }
  | { readonly type: "request_failed"; readonly identity?: ProviderRequestIdentity; readonly phase: "headers" | "first_byte" | "chunk_idle" | "transport" };

/** Host observer for safe provider transport lifecycle evidence. Observer failures are isolated. */
export interface ProviderTransportObserver {
  onEvent(event: ProviderTransportEvent): void;
}

/** Options for creating a message */
export interface CreateMessageOptions {
  readonly sessionId?: string;
  readonly requestIdentity?: ProviderRequestIdentity;
  readonly system: string;
  readonly messages: readonly AgentMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ToolChoiceOption;
  readonly outputSchema?: Record<string, unknown>;
  readonly maxTokens?: number;
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationResolution?: CommunicationResolution;
  readonly signal?: AbortSignal;
  readonly transportWatchdog?: ProviderTransportWatchdog;
  readonly transportObserver?: ProviderTransportObserver;
  readonly executionContext?: ProviderExecutionContext;
}

/** Response from an agent */
export interface AgentResponse {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly toolCalls: readonly ToolCall[];
  readonly stopReason: string;
  /** Adapter-owned cache semantics for the accompanying token fields. */
  readonly contextUsage?: ContextUsageRawEvidence;
}

/** Tool definition for agent */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly strict?: true;
  readonly tags: ReadonlySet<string>;
}

/** Tool call from agent */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export { ToolRegistry } from "./tool-registry.js";
export { withRetry } from "./infrastructure/retry.js";
export type { RetryOptions } from "./infrastructure/retry.js";
export { ProviderRegistry } from "./provider-registry.js";
export type { DiscoveredDirectProviderModelCapabilities } from "./provider-execution-profiles.js";
export { OpenAIAdapter, GPT4O, GPT4O_MINI, O3, O3_MINI } from "./infrastructure/openai.js";
export { LmStudioAdapter, LMSTUDIO_BASE_URL, LMSTUDIO_DEFAULT_MODEL } from "./infrastructure/lmstudio.js";
export type { LmStudioAdapterConfig } from "./infrastructure/lmstudio.js";
export { DeepSeekAdapter, DEEPSEEK_CHAT, DEEPSEEK_REASONER } from "./infrastructure/deepseek.js";
export {
  OpenRouterAdapter,
  NEMOTRON_NANO_FREE,
  STEP_FLASH_FREE,
  TRINITY_LARGE_FREE,
  LLAMA_33_70B_FREE,
  GEMMA_3_27B_FREE,
  QWEN3_CODER_FREE,
  MISTRAL_SMALL_FREE,
} from "./infrastructure/openrouter.js";
export { type CatalogPricing, MODEL_CATALOG, CODEX_DEFAULT_MODEL } from "./model-pricing.js";
export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitState } from "./circuit-breaker.js";
export { ToolCache } from "./tool-cache.js";
export { OpenAISttAdapter } from "./infrastructure/openai-stt.js";
export type { OpenAISttConfig } from "./infrastructure/openai-stt.js";
export { DeepgramSttAdapter } from "./infrastructure/deepgram-stt.js";
export type { DeepgramSttConfig } from "./infrastructure/deepgram-stt.js";
export { OpenAITtsAdapter } from "./infrastructure/openai-tts.js";
export type { OpenAITtsConfig } from "./infrastructure/openai-tts.js";
export { ElevenLabsTtsAdapter } from "./infrastructure/elevenlabs-tts.js";
export type { ElevenLabsTtsConfig } from "./infrastructure/elevenlabs-tts.js";
export { CodexOAuthAuth } from "./infrastructure/codex-oauth-auth.js";
export { CODEX_DEVICE_VERIFICATION_URI, CODEX_OAUTH_CLIENT_ID } from "./infrastructure/codex-oauth-auth.js";
export {
  CREDENTIAL_FILE_MODE,
  applyCredentialFileMode,
  isOverPermissiveCredentialMode,
} from "./infrastructure/credential-file-mode.js";
export { CodexOAuthAdapter } from "./infrastructure/codex-oauth.js";
export type {
  BrowserAuthorizationResult,
  CodexOAuthAuthOptions,
  CodexOAuthTokenFile,
  DeviceAuthorizationResult,
  PollAuthorizationParams,
} from "./infrastructure/codex-oauth-auth.js";
export { OpenCodeAuth } from "./infrastructure/opencode-auth.js";
export type { OpenCodeAuthFile, OpenCodeAuthOptions, OpenCodeTier } from "./infrastructure/opencode-auth.js";
export {
  OpenCodeAdapter,
  OpenCodeRateLimitError,
  OpenCodeQuotaError,
  OPENCODE_BASE_URL,
} from "./infrastructure/opencode-provider.js";
export type { OpenCodeAdapterConfig } from "./infrastructure/opencode-provider.js";
export { classifyToolError } from "./tool-error-classifier.js";
export { executeWithRetry } from "./tool-execution-engine.js";
export type { ToolExecutor } from "./tool-execution-engine.js";
export { SlidingWindowRateLimiter } from "./sliding-window-rate-limiter.js";
export {
  CANONICAL_MODEL_CAPABILITIES,
  ModelCapabilityRegistry,
  isCanonicalModelCapability,
} from "./model-capability-registry.js";
export type {
  CanonicalModelCapability,
  ModelTaskSuitability,
  ModelTaskSuitabilityEvidence,
  ModelTaskSuitabilityLevel,
  ModelTaskSuitabilitySource,
  ModelTaskSuitabilityTask,
} from "./model-capability-registry.js";
export {
  WORK_CLASSIFICATION_ARTIFACTS,
  WORK_CLASSIFICATION_DOMAINS,
  WORK_CLASSIFICATION_EVIDENCE_SCOPES,
  WORK_CLASSIFICATION_EFFECTS,
  WORK_CLASSIFICATION_INTENTS,
  WORK_CLASSIFICATION_MODES,
  defineWorkClassification,
  defineWorkClassificationProvenance,
  recommendedSkillsForWorkClassification,
} from "./work-classification.js";
export type {
  WorkClassification,
  WorkClassificationArtifact,
  WorkClassificationDomain,
  WorkClassificationEvidenceScope,
  WorkClassificationEffect,
  WorkClassificationInput,
  WorkClassificationIntent,
  WorkClassificationMode,
  WorkClassificationProvenance,
  WorkClassificationProvenanceInput,
  WorkClassificationProvenanceSourceKind,
} from "./work-classification.js";
export {
  normalizeToolCall,
  normalizeToolInput,
  getInvalidToolInputDetails,
  assertValidToolCallIds,
  buildSyntheticToolCallId,
  SYNTHETIC_TOOL_CALL_ID_PREFIX,
} from "./tool-call-input.js";
export type { InvalidToolInputDetails } from "./tool-call-input.js";
export {
  isDirectProviderId,
  listDirectProviderExecutionProfiles,
  getDirectProviderExecutionProfile,
  resolveProviderDefaultBillingMode,
  resolveDirectProviderExecutionProfile,
} from "./provider-execution-profiles.js";
export { scoreComplexity } from "./complexity-scorer.js";
export type { ComplexityScorerInput } from "./complexity-scorer.js";
export { RulesRouter } from "./rules-router.js";
export {
  appendExecutionIdentity,
  formatExecutionIdentity,
  resolveExecutionIdentity,
} from "./execution-identity.js";
export type {
  ExecutionBillingMode,
  ExecutionIdentity,
  ResolveExecutionIdentityOptions,
} from "./execution-identity.js";
export {
  admitOperatorExecutionIntent,
  defineExecutionTargetCatalog,
  decideExecutionTargetDataPolicy,
  defineExecutionDataClassification,
  defineExecutionTargetDataPolicyEvidence,
  EXECUTION_DATA_CLASSIFICATIONS,
  ExecutionRoutingValidationError,
  advanceExecutionAttempt,
  createExecutionAccountPolicyId,
  createExecutionAccountRef,
  createExecutionAttempt,
  defineExecutionAccountCapacityRejection,
  defineExecutionAccountUsageEvidence,
  selectAdmittedExecutionAccount,
  selectExecutionCapacityAccount,
  validateModelTurn,
  validateModelTurnResult,
} from "./execution-routing/index.js";
export type {
  AdmittedExecutionTarget,
  ExecutionAccount,
  ExecutionAccountAdmissionCandidate,
  ExecutionAccountEconomicsConfig,
  ExecutionAccountPolicy,
  ExecutionAccountAdmissionRejection,
  ExecutionAccountAdmissionRejectionReason,
  ExecutionAccountAdmissionSelection,
  ExecutionAccountAffinity,
  ExecutionAccountAffinityEvidence,
  ExecutionAccountAffinityOutcome,
  ExecutionAccountCapacityCandidate,
  ExecutionAccountCapacityHealth,
  ExecutionAccountCapacityRejection,
  ExecutionAccountCapacityRejectionReason,
  ExecutionAccountCapacitySelection,
  ExecutionAccountCapacitySelectionResult,
  ExecutionTargetCatalog,
  ExecutionTargetCatalogInput,
  ExecutionAccountPolicyId,
  ExecutionAccountRef,
  ExecutionAccountUsageEvidence,
  ExecutionAttempt,
  ExecutionAttemptPhase,
  DirectExecutionTarget,
  AdmittedExecutionAccount,
  ExecutionDataClassification,
  ExecutionTargetDataPolicyDecision,
  ExecutionTargetDataPolicyEvidence,
  ExecutionTargetDataPolicyReason,
  ExecutionPriceEvidenceConfig,
  ExecutionTargetEconomicsConfig,
  ExecutionUnitPriceConfig,
  OperatorExecutionIntent,
  OneRoundModelDispatcher,
  OneRoundModelDispatchInput,
  CustomModelTool,
  CustomModelToolCall,
  FunctionModelTool,
  FunctionModelToolCall,
  ModelJsonObject,
  ModelJsonValue,
  ModelImagePart,
  ModelPart,
  ModelReasoningSummaryPart,
  ModelTextPart,
  ModelTool,
  ModelToolCall,
  ModelToolCallPart,
  ModelToolChoice,
  ModelToolResultContent,
  ModelToolResultPart,
  ModelTurn,
  ModelTurnMessage,
  ModelTurnResult,
  ModelTurnUsage,
  SelectExecutionCapacityAccountInput,
} from "./execution-routing/index.js";
export type {
  DirectProviderId,
  DirectProviderExecutionMode,
  DirectProviderExecutionProfile,
  ResolvedDirectProviderExecutionProfile,
} from "./provider-execution-profiles.js";
export {
  createProviderModelRouteHealthRecord,
  evaluateProviderModelRouteHealth,
  formatProviderModelRouteCooldown,
  mapProviderModelRouteErrorToOutcome,
} from "./provider-model-route-health.js";
export type {
  ProviderModelRouteHealthDecision,
  ProviderModelRouteHealthRecord,
  ProviderModelRouteKey,
  ProviderModelRouteOutcome,
} from "./provider-model-route-health.js";
export {
  PROVIDER_MODEL_EVIDENCE_STATES,
  createProviderModelEvidence,
  isSameProviderModelRoute,
} from "./provider-model-evidence.js";
export type {
  ProviderModelAliasEvidence,
  ProviderModelEvidence,
  ProviderModelEvidenceAuthority,
  ProviderModelEvidenceFailure,
  ProviderModelEvidenceFreshness,
  ProviderModelEvidenceInput,
  ProviderModelEvidenceObservation,
  ProviderModelEvidenceSourceIdentity,
  ProviderModelEvidenceState,
  ProviderModelEvidenceStates,
  ProviderModelEvidenceValue,
  ProviderModelHarnessIdentity,
  ProviderModelIdentity,
  ProviderModelNormalizedIdentity,
  ProviderModelProviderIdentity,
  ProviderModelRouteIdentity,
} from "./provider-model-evidence.js";
export { deriveProviderModelEligibility } from "./provider-model-eligibility.js";
export type {
  ProviderModelCapabilityClaim,
  ProviderModelEligibilityDecision,
  ProviderModelEligibilityReason,
  ProviderModelEligibilityRequirements,
  ProviderModelEligibilityUse,
} from "./provider-model-eligibility.js";
export {
  CredentialPool,
  AllCredentialsExhaustedError,
  isOk,
  isRetryable,
  isAuthError,
  getResetAt,
  computeCooldownUntil,
  DEFAULT_COOLDOWN_POLICY,
  createCooldownPolicy,
  selectCredential,
  createInitialSelectionContext,
  updateSelectionContext,
  computePoolMetrics,
} from "./credential-pool/index.js";
export type {
  Credential,
  Lease,
  CredentialSource,
  CredentialOutcome,
  CredentialDiagnosticHealth,
  CredentialExhaustionDiagnostic,
  CredentialExhaustionEntryDiagnostic,
  CredentialExhaustionReason,
  CooldownPolicy,
  SelectionStrategy,
  CredentialPoolStatePort,
  CredentialPoolConfig,
  PoolMetrics,
  CredentialPoolSnapshot,
  CredentialPoolEntrySnapshot,
} from "./credential-pool/index.js";
export * from "./managed-invocation/index.js";
export {
  createProviderUsageQuotaObservation,
  createProviderUsageSnapshot,
} from "./provider-usage.js";
export type {
  ProviderUsageAvailability,
  ProviderUsageConfidence,
  ProviderUsageCredits,
  ProviderUsageExhaustionReason,
  ProviderUsageQuotaObservation,
  ProviderUsageSnapshot,
  ProviderUsageSource,
  ProviderUsageSpendControl,
  ProviderUsageWindow,
} from "./provider-usage.js";
