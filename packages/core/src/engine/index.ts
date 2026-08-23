// Engine primitives -- 6 domain-agnostic building blocks
// Zero external dependencies, pure TypeScript interfaces

// Errors -- unified error hierarchy (Phase 0.2) + error catalog (Phase 4)
export { KilnError } from "./errors.js";
export type { KilnErrorCode } from "./errors.js";
export { getErrorSuggestion } from "./error-catalog.js";
export type { ErrorSuggestion } from "./error-catalog.js";

export type { Agent } from "./domain/agent.js";
export type { ContentPart, TextPart, ImagePart, AudioPart, FilePart, ToolUsePart, ToolResultPart, ToolResultPayloadPart } from "./domain/content.js";
export { textPart, textParts, extractText, hasModality, validateContentPart, validateContentParts } from "./domain/content.js";
export type { Modality } from "./domain/modality.js";
export { VALID_MODALITIES, validateModalities } from "./domain/modality.js";
export type {
  AuxiliaryModalityRoute,
  MultimodalArtifact,
  MultimodalArtifactRetention,
  MultimodalArtifactSource,
  MultimodalCapability,
  MultimodalChecksum,
  MultimodalDelegationCostBudgetDecision,
  MultimodalDelegationEvidence,
  MultimodalDelegationExpectedResult,
  MultimodalDelegationPolicyDecision,
  MultimodalDelegationUncertainty,
  MultimodalDiagnosticSeverity,
  MultimodalDimensions,
  MultimodalReplayReference,
  MultimodalRouteHealth,
  MultimodalRoutingDecision,
  MultimodalRoutingDiagnostic,
  MultimodalRoutingPolicy,
  MultimodalRoutingReason,
  MultimodalRoutingRequest,
  MultimodalRoutingStrategy,
  MultimodalTransformCandidate,
  MultimodalTransformEvidence,
  MultimodalTransportModality,
  NativeMultimodalRouteEvidence,
  ProviderModalityCapabilities,
  ProviderModalityConstraints,
} from "./domain/multimodal-routing.js";
export { planMultimodalRoute } from "./domain/multimodal-routing.js";
export type {
  RecorderArtifactRelation,
  RecorderArtifactTrack,
  RecorderCaptureManifest,
  RecorderCaptureManifestInput,
  RecorderCaptureManifestStatus,
  RecorderCaptureManifestTracks,
  RecorderCaptureManifestVersion,
  RecorderCapturePolicy,
  RecorderCaptureSource,
  RecorderCaptureSourceKind,
  RecorderCaptureTarget,
  RecorderCaptureTrackKind,
  RecorderCaptureTransport,
  RecorderEditKind,
  RecorderEditTrack,
  RecorderEvidenceKind,
  RecorderEvidenceReference,
  RecorderEventTrack,
  RecorderExportFormat,
  RecorderExportTrack,
  RecorderRawCaptureSegment,
  RecorderRawCaptureTrack,
  RecorderRecordingConsent,
  RecorderRedactionPolicy,
  RecorderRedactionStatus,
  RecorderReplayKind,
  RecorderReplayTrack,
  RecorderResourceReference,
  RecorderResourceRelation,
  RecorderRetentionPolicy,
  RecorderTimeline,
  RecorderTimelineTimebase,
  RecorderTrackBase,
  RecorderTrackStatus,
  RecorderViewportRegion,
} from "./domain/capture-manifest.js";
export {
  RECORDER_CAPTURE_MANIFEST_VERSION,
  RECORDER_CAPTURE_TRACK_KINDS,
  createRecorderCaptureManifest,
} from "./domain/capture-manifest.js";
export type {
  SttAdapter,
  SttOptions,
  SttResult,
  TtsAdapter,
  TtsOptions,
  TtsResult,
  VoiceConfig,
  SttProviderConfig,
  TtsProviderConfig,
  VoiceDefaultsConfig,
  VoicePolicyConfig,
  VoiceArtifactPolicy,
  VoiceSurfacePolicy,
  VoiceInputPolicy,
  VoiceOutputPolicy,
  VoiceTtsProfileConfig,
  VoiceTtsIntentConfig,
  VoiceTtsIntentId,
  VoiceSurface,
  VoiceInputMode,
  VoiceOutputMode,
  VoiceFailureMode,
} from "./domain/speech-config.js";
export {
  VALID_VOICE_SURFACES,
  VALID_VOICE_TTS_INTENTS,
  VALID_VOICE_INPUT_MODES,
  VALID_VOICE_OUTPUT_MODES,
  VALID_VOICE_FAILURE_MODES,
  validateVoiceConfig,
} from "./domain/speech-config.js";
export { assembleAgentPrompt } from "./domain/prompt-assembler.js";
export type { PromptContext } from "./domain/prompt-assembler.js";
export type { Capability } from "./domain/capability.js";
export type {
  RetryStrategy,
  RetryConfig,
  AuthorizationLevel,
  AuthorityDescriptor,
  InvocationAdmission,
  ToolErrorType,
  ToolAuthorizer,
  ToolExecutionRequest,
  ToolExecutionResult,
} from "./domain/tool-execution.js";
export type {
  OperationType,
  BoundaryType,
  ReversibilityType,
  DataEgressType,
  IdentityUseType,
  ConsequenceType,
  IdempotencyType,
  ActionEffectEnvelope,
  ResolvedInvocationEffect,
  ActionEffectAuthorityLevel,
  ActionEffectPolicy,
  InvocationEffectResolver,
  InvocationEffectResolverRegistry,
} from "./domain/action-effect.js";
export {
  DEFAULT_ACTION_EFFECT_POLICY,
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  conservativeEnvelopeFromExternalHints,
  deriveAuthorityFromEffect,
  normalizeActionEffectEnvelope,
  resolveInvocationEffect,
  isValidNarrowing,
  catalogAuthorityFromEnvelope,
  tagsFromEnvelope,
} from "./domain/action-effect.js";
export type {
  IntegrationAdapter,
  IntegrationOperation,
  IntegrationResult,
  IntegrationResultMetadata,
  ExecutionOptions,
  CredentialResolver,
  ResolvedCredential,
} from "./domain/integration.js";
export type { RateLimitConfig, RateLimitResult, RateLimiter } from "./domain/rate-limiter.js";
export type { QualityGate } from "./domain/quality-gate.js";
export type { Memory, MemoryScope, MemoryEntry } from "./domain/memory.js";
export type { Task, TaskStatus, TreeAction } from "./domain/task.js";
export type {
  Channel,
  MessageFormat,
  IncomingMessage,
  OutgoingMessage,
  EngineEvent,
} from "./domain/channel.js";

// Engine composites -- 3 composition types (Phase 16)
export type { Team, TeamMode, TeamValidationError } from "./composites/team.js";
export { validateTeam } from "./composites/team.js";
export type { Router, RouterValidationError } from "./composites/router.js";
export { validateRouter } from "./composites/router.js";
export type { App, AppValidationError } from "./composites/app.js";
export { validateApp } from "./composites/app.js";

// Engine loader -- YAML -> typed composites (Phase 16)
export { AppLoaderError, parseAppYaml, validateAppGraph } from "./loader/app-loader.js";

// Orchestrator config -- shared interface in engine domain (used by orchestrator + preset loader)
export type { OrchestratorConfig } from "./domain/orchestrator-config.js";

// Model routing -- shared interfaces in engine domain
export type { ModelRouter, RoutingRequest, RoutingDecision } from "./domain/model-router.js";
export type { UserContext } from "./domain/user-context.js";

// Gateway -- multi-app hosting (Phase 22)
export type {
  GatewayConfig,
  GatewayAppBinding,
  GatewayChannelBinding,
  GatewayValidationError,
  ModelGatewayCapabilityId,
  ModelGatewayConfig,
  ModelGatewayPrincipalConfig,
  ModelGatewayVirtualModelConfig,
} from "./gateway/gateway-config.js";
export { validateGatewayConfig } from "./gateway/gateway-config.js";
export {
  GATEWAY_CONFIG_FIELD_DESCRIPTORS,
  GATEWAY_CONFIG_SCHEMA,
  GATEWAY_CONFIG_SCHEMA_ID,
  GATEWAY_CONFIG_SCHEMA_REVISION,
  describeRunningGatewayConfigSchema,
  parseGatewayConfigStructure,
  serializeGatewayConfigDescriptors,
  serializeGatewayConfigEditorSchema,
} from "./gateway/gateway-config-schema.js";
export type {
  GatewayConfigFieldDescriptor,
  GatewayConfigStructuralAdmission,
  GatewayConfigStructuralError,
} from "./gateway/gateway-config-schema.js";
export { GatewayLoaderError, parseGatewayYaml } from "./gateway/gateway-loader.js";

// MCP server config (Phase 28)
export type {
  GatewayMcpConfig,
  GatewayMcpAuthConfig,
  GatewayMcpValidationError,
  McpAuthType,
} from "./gateway/mcp-config.js";
export { validateGatewayMcpConfig } from "./gateway/mcp-config.js";

// Runtime mode -- gateway runtime-variant config (Phase 23)
export type {
  RuntimeMode,
  ProviderConfig,
  BillingTier,
  BillingConfig,
  BudgetResponse,
  RuntimeModeConfig,
  RuntimeModeValidationError,
} from "./gateway/runtime-mode-config.js";
export { validateRuntimeModeConfig } from "./gateway/runtime-mode-config.js";
export { mapRuntimeModeConfig } from "./gateway/runtime-mode-config.js";

export {
  APP_CONFIG_FIELD_DESCRIPTORS,
  APP_CONFIG_SCHEMA,
  APP_CONFIG_SCHEMA_ID,
  APP_CONFIG_SCHEMA_REVISION,
  describeRunningAppConfigSchema,
  parseAppConfigStructure,
  serializeAppConfigDescriptors,
  serializeAppConfigEditorSchema,
} from "./loader/app-config-schema.js";
export { addAppScheduleTrigger, removeAppScheduleTrigger } from "./loader/app-config-mutation.js";
export type { AppConfigMutationResult, AppScheduleTriggerInput } from "./loader/app-config-mutation.js";
export type {
  AppConfigDocument,
  AppConfigFieldDescriptor,
  AppConfigStructuralAdmission,
  AppConfigStructuralError,
} from "./loader/app-config-schema.js";

// Delegation -- cross-app cognitive delegation (Phase 24)
export type {
  DelegationErrorCode,
  AppDelegation,
  DelegationTokenUsage,
  AppDelegationResult,
  DelegationError,
  DelegationValidationError,
} from "./gateway/delegation-config.js";
export { isDelegationCapability, validateDelegation } from "./gateway/delegation-config.js";

// Trigger primitive (Phase 5)
export type { Trigger, TriggerType, WebhookTrigger, EventTrigger, ScheduleTrigger, TriggerValidationError } from "./domain/trigger.js";
export { validateTrigger } from "./domain/trigger.js";
export type { CronExpression } from "./domain/cron.js";
export {
  parseCronExpression,
  validateCronExpression,
  validateTimezone,
  nextFireTime,
} from "./domain/cron.js";

// Tenant -- multi-tenant business configuration (Phase 25)
export type {
  TenantConfig,
  TenantService,
  TenantContact,
  TenantHours,
  TenantFaqEntry,
  TenantTone,
  TenantBilling,
  TenantWebhookTool,
  TenantIntegration,
  TenantToolConfig,
  TenantAgentConfig,
  TenantRoutingRule,
  TenantRoutingConfig,
  TenantModelConfig,
  EmailTransportConfig,
  TenantValidationError,
} from "./gateway/tenant-config.js";
export { validateTenantConfig } from "./gateway/tenant-config.js";

// Safety config (Phase 12)
export type {
  SafetyConfig,
  SafetyValidationError,
  PiiConfig,
  PiiType,
  PiiAction,
  ContentConfig,
  ContentCategory,
  ContentAction,
  ContentCategoryConfig,
  RailConfig,
  RailType,
  TopicRailConfig,
  CompetitorRailConfig,
  EscalationRailConfig,
  ComplianceRailConfig,
} from "./domain/safety-config.js";
export { validateSafetyConfig } from "./domain/safety-config.js";
