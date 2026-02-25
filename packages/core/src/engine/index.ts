// Engine primitives -- 6 domain-agnostic building blocks
// Zero external dependencies, pure TypeScript interfaces

// Errors -- unified error hierarchy (Phase 0.2) + error catalog (Phase 4)
export { KilnError } from "./errors.js";
export type { KilnErrorCode } from "./errors.js";
export { getErrorSuggestion } from "./error-catalog.js";
export type { ErrorSuggestion } from "./error-catalog.js";

export type { Agent, AgentTier } from "./domain/agent.js";
export type { ContentPart, TextPart, ImagePart, AudioPart, FilePart, ToolUsePart, ToolResultPart } from "./domain/content.js";
export { textPart, textParts, extractText, hasModality, validateContentPart, validateContentParts } from "./domain/content.js";
export type { Modality } from "./domain/modality.js";
export { VALID_MODALITIES, validateModalities } from "./domain/modality.js";
export type { SttAdapter, SttResult, TtsAdapter, TtsOptions, TtsResult, VoiceConfig, SttProviderConfig, TtsProviderConfig } from "./domain/speech-config.js";
export { validateVoiceConfig } from "./domain/speech-config.js";
export { assembleAgentPrompt } from "./domain/prompt-assembler.js";
export type { PromptContext } from "./domain/prompt-assembler.js";
export type { Capability, CapabilityAnnotations } from "./domain/capability.js";
export type { Workflow, Gate } from "./domain/workflow.js";
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
export type { Team, TeamMode, QualityGate, TeamKnowledge, TeamValidationError } from "./composites/team.js";
export { validateTeam } from "./composites/team.js";
export type { Router, PatternRule, RouterValidationError } from "./composites/router.js";
export { validateRouter } from "./composites/router.js";
export type { App, MemoryConfig, AppValidationError } from "./composites/app.js";
export { validateApp } from "./composites/app.js";

// Engine loader -- YAML -> typed composites (Phase 16)
export { AppLoaderError, parseAppYaml, validateAppGraph } from "./loader/app-loader.js";

// Orchestrator config -- shared interface in engine domain (used by orchestrator + preset loader)
export type { OrchestratorConfig } from "./domain/orchestrator-config.js";

// Preset loader -- App -> OrchestratorConfig (Phase 17)
export { PresetLoaderError, loadPresetConfig } from "./loader/preset-loader.js";

// Gateway -- multi-app hosting (Phase 22)
export type {
  GatewayConfig,
  GatewayAppBinding,
  GatewayChannelBinding,
  GatewayValidationError,
} from "./gateway/gateway-config.js";
export { validateGatewayConfig } from "./gateway/gateway-config.js";
export { GatewayLoaderError, parseGatewayYaml } from "./gateway/gateway-loader.js";

// Mode B -- provider-adapter runtime config (Phase 23)
export type {
  RuntimeMode,
  ProviderConfig,
  BillingTier,
  BillingConfig,
  BudgetResponse,
  UsageReport,
  ModeBConfig,
  ModeBValidationError,
} from "./gateway/mode-b-config.js";
export { validateModeBConfig } from "./gateway/mode-b-config.js";
export { ModeBLoaderError, parseModeBConfig } from "./gateway/mode-b-loader.js";

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
export { parseCronExpression, validateCronExpression, nextFireTime } from "./domain/cron.js";

// Knowledge primitives (Phase 8)
export type { EmbeddingAdapter } from "./domain/embedding.js";
export type { VectorEntry, VectorResult, VectorQueryOptions, VectorStore } from "./domain/vector-store.js";
export type { Document, Chunk, ChunkConfig, Chunker } from "./domain/chunker.js";
export type {
  KnowledgeConfig,
  KnowledgeEmbeddingConfig,
  KnowledgeStoreConfig,
  KnowledgeChunkingConfig,
  KnowledgeSourceConfig,
  KnowledgeValidationError,
} from "./domain/knowledge-config.js";
export { validateKnowledgeConfig } from "./domain/knowledge-config.js";

// Tenant -- multi-tenant business configuration (Phase 25)
export type {
  TenantConfig,
  TenantService,
  TenantContact,
  TenantHours,
  TenantFaqEntry,
  TenantTone,
  TenantBilling,
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
