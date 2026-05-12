export type { UserContext } from "./engine/domain/user-context.js";
export * from "./orchestrator/index.js";
export * from "./agents/index.js";
export * from "./domain/index.js";
export * from "./package/index.js";
export * from "./skill/index.js";
export * from "./memory/index.js";
export * from "./context/index.js";
export * from "./field/index.js";
export * from "./tree/index.js";
export * from "./events/index.js";
export * from "./verification/index.js";
export * from "./cost/index.js";
export * from "./security/index.js";
export * from "./observability/index.js";
export * from "./knowledge/index.js";
export * from "./eval/index.js";
export * from "./safety/index.js";
export * from "./enrichment/index.js";
export * from "./tools/index.js";
export * from "./work-governance/index.js";
export type { FsPolicy, NetPolicy, SandboxConfig } from "./sandbox/index.js";
export {
  DOCUMENTATION_DOMAINS,
  NetworkFilter,
  PACKAGE_MANAGER_DOMAINS,
  SandboxPolicy,
  createPolicy,
} from "./sandbox/index.js";
export * as engine from "./engine/index.js";

// Re-export streaming types for runtime
export type { StreamLevel } from "./events/index.js";
export { EVENT_LEVEL_MAP, LEVEL_HIERARCHY } from "./events/index.js";

// Error hierarchy re-exported for direct access by runtime
export { KilnError } from "./engine/errors.js";
export type { KilnErrorCode } from "./engine/errors.js";

// Error catalog re-exported for direct access by CLI formatters
export { getErrorSuggestion } from "./engine/error-catalog.js";
export type { ErrorSuggestion } from "./engine/error-catalog.js";

// Circuit breaker re-exported for direct access by runtime
export { CircuitBreaker } from "./agents/circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitState } from "./agents/circuit-breaker.js";

// Channel primitive types re-exported for direct access by runtime channel adapters
export type {
  Channel,
  MessageFormat,
  IncomingMessage,
  OutgoingMessage,
  EngineEvent,
} from "./engine/domain/channel.js";

// Multimodal content types re-exported for direct access by runtime
export type {
  ContentPart,
  TextPart,
  ImagePart,
  AudioPart,
  FilePart,
  ToolUsePart,
  ToolResultPart,
} from "./engine/domain/content.js";
export {
  textPart,
  textParts,
  extractText,
  hasModality,
  validateContentPart,
  validateContentParts,
} from "./engine/domain/content.js";
export type { Modality } from "./engine/domain/modality.js";
export { VALID_MODALITIES, validateModalities } from "./engine/domain/modality.js";
export type {
  SttAdapter,
  SttResult,
  TtsAdapter,
  TtsOptions,
  TtsResult,
  VoiceConfig,
  SttProviderConfig,
  TtsProviderConfig,
} from "./engine/domain/speech-config.js";
export { validateVoiceConfig } from "./engine/domain/speech-config.js";

// Gateway types re-exported for direct access by runtime gateway
export type {
  GatewayConfig,
  GatewayAppBinding,
  GatewayChannelBinding,
  GatewayValidationError,
} from "./engine/gateway/gateway-config.js";
export { validateGatewayConfig } from "./engine/gateway/gateway-config.js";
export { GatewayLoaderError, parseGatewayYaml } from "./engine/gateway/gateway-loader.js";
export type { ObservabilityConfig, ObservabilityExporter } from "./engine/gateway/observability-config.js";
export { validateObservabilityConfig } from "./engine/gateway/observability-config.js";
export type { GatewayAuthConfig, JwtAlgorithm, GatewayAuthValidationError } from "./engine/gateway/auth-config.js";
export { validateGatewayAuthConfig } from "./engine/gateway/auth-config.js";
export type { GatewayMcpConfig, GatewayMcpAuthConfig, GatewayMcpEvalConfig, GatewayMcpValidationError } from "./engine/gateway/mcp-config.js";
export { validateGatewayMcpConfig } from "./engine/gateway/mcp-config.js";

// App loader re-exported for direct access by runtime gateway
export type { App, MemoryConfig, AppValidationError } from "./engine/composites/app.js";
export type { EventsConfig } from "./engine/gateway/events-config.js";
export { parseEventsConfig } from "./engine/gateway/events-loader.js";
export { AppLoaderError, parseAppYaml, validateAppGraph } from "./engine/loader/app-loader.js";

// Preset loader re-exported for direct access by tests and tooling
export { PresetLoaderError, loadPresetConfig } from "./engine/loader/preset-loader.js";

// Runtime-mode config re-exported for direct access by the runtime gateway
export type {
  RuntimeMode,
  ProviderConfig,
  BillingConfig,
  BillingTier,
  BudgetResponse,
  UsageReport,
  RuntimeModeConfig,
  RuntimeModeValidationError,
} from "./engine/gateway/runtime-mode-config.js";
export { validateRuntimeModeConfig } from "./engine/gateway/runtime-mode-config.js";
export { RuntimeModeLoaderError, parseRuntimeModeConfig } from "./engine/gateway/runtime-mode-loader.js";

// Delegation types re-exported for direct access by runtime gateway
export type {
  DelegationErrorCode,
  AppDelegation,
  DelegationTokenUsage,
  AppDelegationResult,
  DelegationError,
  DelegationValidationError,
} from "./engine/gateway/delegation-config.js";
export { isDelegationCapability, validateDelegation } from "./engine/gateway/delegation-config.js";

// Trigger types re-exported for direct access by runtime trigger module
export type {
  Trigger,
  TriggerType,
  WebhookTrigger,
  EventTrigger,
  ScheduleTrigger,
  TriggerValidationError,
} from "./engine/domain/trigger.js";
export { validateTrigger } from "./engine/domain/trigger.js";
export type { CronExpression } from "./engine/domain/cron.js";
export {
  parseCronExpression,
  validateCronExpression,
  validateTimezone,
  nextFireTime,
} from "./engine/domain/cron.js";

// Tenant types re-exported for direct access by runtime tenant module
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
  PreChatFieldType,
  PreChatField,
  PreChatFormConfig,
  SessionLimitsConfig,
  WhatsAppCoexistenceConfig,
  EmailTransportConfig,
  TenantValidationError,
  GroundingMode,
} from "./engine/gateway/tenant-config.js";
export { validateTenantConfig } from "./engine/gateway/tenant-config.js";

// A2A types re-exported for direct access by runtime a2a module
export type {
  AgentCard,
  A2ACapabilitySchema,
  A2AAuthConfig,
  A2ATaskStatus,
  A2AArtifact,
  A2APart,
  A2ATask,
  A2AMessage,
  A2AValidationError,
} from "./engine/domain/a2a-config.js";
export { validateAgentCard } from "./engine/domain/a2a-config.js";

// MCP types re-exported for direct access by runtime mcp module
export type {
  McpConfig,
  McpServerConfig,
  McpValidationError,
} from "./engine/domain/mcp-config.js";
export { validateMcpConfig } from "./engine/domain/mcp-config.js";

// Tool selection types re-exported for direct access
export type {
  ToolSelectionConfig,
  ToolSelectionStrategy,
  ToolSelectionValidationError,
} from "./engine/domain/tool-selection-config.js";
export { validateToolSelectionConfig } from "./engine/domain/tool-selection-config.js";

// Conversation event types re-exported for direct access by runtime
export type {
  ConversationEventType,
  ConversationEvent,
  ConversationEventBatch,
} from "./engine/gateway/conversation-event.js";

// Safety config types re-exported for direct access by runtime
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
} from "./engine/domain/safety-config.js";
export { validateSafetyConfig } from "./engine/domain/safety-config.js";

// Knowledge config types re-exported for direct access by runtime gateway
export type {
  KnowledgeConfig,
  KnowledgeEmbeddingConfig,
  KnowledgeStoreConfig,
  KnowledgeChunkingConfig,
  KnowledgeSourceConfig,
  ContextualConfig,
  KnowledgeRerankerConfig,
  ContactMemoryConfig,
} from "./engine/domain/knowledge-config.js";
export { validateKnowledgeConfig } from "./engine/domain/knowledge-config.js";

// Contact memory types re-exported for direct access by runtime
export type {
  ContactFact,
  ExtractedFact,
  FactCategory,
  FactAction,
  ContactMemoryService,
} from "./engine/domain/contact-memory.js";

// Knowledge source types re-exported for direct access by runtime
export type {
  KnowledgeSource,
  KnowledgeSourceType,
  KnowledgeSourceStatus,
  ExtractedContent,
  ExtractionOptions,
  ContentExtractor,
  SourceStore,
} from "./engine/domain/knowledge-source.js";

// Source manager re-exported for direct access by runtime
export { SourceManager } from "./knowledge/source-manager.js";
export type { SourceManagerConfig } from "./knowledge/source-manager.js";

// Vector store types re-exported for direct access by runtime
export type { VectorStore, VectorEntry, VectorResult, VectorQueryOptions } from "./engine/domain/vector-store.js";

// Embedding adapter type re-exported for direct access by runtime
export type { EmbeddingAdapter } from "./engine/domain/embedding.js";

// Chunker types re-exported for direct access by runtime
export type { ChunkEnricher } from "./engine/domain/chunker.js";

// Capability types re-exported for direct access by runtime
export type { Capability, CapabilityAnnotations } from "./engine/domain/capability.js";

// Agent type re-exported for CLI preamble builder
export type { Agent, AgentTier } from "./engine/domain/agent.js";

// Tool execution types re-exported for direct access by runtime
export type {
  RetryStrategy,
  RetryConfig,
  AuthorizationLevel,
  ToolAuthorizationResult,
  AuthorityDescriptor,
  ToolErrorType,
  ToolAuthorizer,
  ToolExecutionRequest,
  ToolExecutionResult,
} from "./engine/domain/tool-execution.js";

// Integration adapter types re-exported for direct access by runtime
export type {
  IntegrationAdapter,
  IntegrationOperation,
  IntegrationResult,
  IntegrationResultMetadata,
  ExecutionOptions,
  CredentialResolver,
  ResolvedCredential,
} from "./engine/domain/integration.js";

// Rate limiter types + implementation re-exported for direct access by runtime
export type { RateLimiter, RateLimitConfig, RateLimitResult } from "./engine/domain/rate-limiter.js";
export { SlidingWindowRateLimiter } from "./agents/sliding-window-rate-limiter.js";

// Routing templates re-exported for direct access by runtime
export type { RoutingTemplate } from "./domains/routing-templates.js";
export { getRoutingTemplate, listRoutingTemplates } from "./domains/routing-templates.js";

// Model routing types re-exported for direct access by runtime
export type {
  ModelRouter,
  ModelCapabilityProfile,
  RoutingRequest,
  RoutingDecision,
  ModelRoutingDiagnostic,
  ModelRoutingDiagnosticSeverity,
  ModelRoutingPolicyInputsUsed,
  ModelRoutingRankingEvidence,
  ModelRoutingRationale,
  ModelRoutingReasoningEffort,
  ModelSelectionMode,
  RoutingTier,
  RoutingRule,
  RoutingCondition,
  ComplexityScore,
  ComplexityClass,
} from "./engine/domain/model-router.js";
