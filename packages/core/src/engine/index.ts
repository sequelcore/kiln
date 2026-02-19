// Engine primitives -- 6 domain-agnostic building blocks
// Zero external dependencies, pure TypeScript interfaces

export type { Agent, AgentTier } from "./domain/agent.js";
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
export type { Team, QualityGate, TeamKnowledge, TeamValidationError } from "./composites/team.js";
export { validateTeam } from "./composites/team.js";
export type { Router, PatternRule, RouterValidationError } from "./composites/router.js";
export { validateRouter } from "./composites/router.js";
export type { App, MemoryConfig, AppValidationError } from "./composites/app.js";
export { validateApp } from "./composites/app.js";

// Engine loader -- YAML -> typed composites (Phase 16)
export { AppLoaderError, parseAppYaml, validateAppGraph } from "./loader/app-loader.js";

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
