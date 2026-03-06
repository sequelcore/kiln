export * from "./orchestrator/index.js";
export * from "./agents/index.js";
export * from "./domain/index.js";
export * from "./package/index.js";
export * from "./skill/index.js";
export * from "./memory/index.js";
export * from "./tree/index.js";
export * from "./events/index.js";
export * from "./cost/index.js";
export * from "./security/index.js";
export * from "./observability/index.js";
export * from "./knowledge/index.js";
export * from "./eval/index.js";
export * from "./safety/index.js";
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

// App loader re-exported for direct access by runtime gateway
export type { App, MemoryConfig, AppValidationError } from "./engine/composites/app.js";
export type { EventsConfig } from "./engine/gateway/events-config.js";
export { parseEventsConfig } from "./engine/gateway/events-loader.js";
export { AppLoaderError, parseAppYaml, validateAppGraph } from "./engine/loader/app-loader.js";

// Preset loader re-exported for direct access by tests and tooling
export { PresetLoaderError, loadPresetConfig } from "./engine/loader/preset-loader.js";

// Mode B config re-exported for direct access by runtime gateway
export type {
  RuntimeMode,
  ProviderConfig,
  BillingConfig,
  BillingTier,
  BudgetResponse,
  UsageReport,
  ModeBConfig,
  ModeBValidationError,
} from "./engine/gateway/mode-b-config.js";
export { validateModeBConfig } from "./engine/gateway/mode-b-config.js";
export { ModeBLoaderError, parseModeBConfig } from "./engine/gateway/mode-b-loader.js";

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
export { parseCronExpression, validateCronExpression, nextFireTime } from "./engine/domain/cron.js";

// Tenant types re-exported for direct access by runtime tenant module
export type {
  TenantConfig,
  TenantService,
  TenantContact,
  TenantHours,
  TenantFaqEntry,
  TenantTone,
  TenantBilling,
  TenantValidationError,
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
} from "./engine/domain/knowledge-config.js";
export { validateKnowledgeConfig } from "./engine/domain/knowledge-config.js";

// Knowledge source types re-exported for direct access by runtime
export type {
  KnowledgeSource,
  KnowledgeSourceType,
  KnowledgeSourceStatus,
  ExtractedContent,
  ContentExtractor,
  SourceStore,
} from "./engine/domain/knowledge-source.js";

// Source manager re-exported for direct access by runtime
export { SourceManager } from "./knowledge/source-manager.js";
export type { SourceManagerConfig } from "./knowledge/source-manager.js";

// Vector store types re-exported for direct access by runtime
export type { VectorStore, VectorEntry, VectorResult, VectorQueryOptions } from "./engine/domain/vector-store.js";

// Chunker types re-exported for direct access by runtime
export type { ChunkEnricher } from "./engine/domain/chunker.js";
