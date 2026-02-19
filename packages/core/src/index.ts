export * from "./orchestrator/index.js";
export * from "./agents/index.js";
export * from "./domain/index.js";
export * from "./memory/index.js";
export * from "./tree/index.js";
export * from "./events/index.js";
export * from "./cost/index.js";
export * from "./security/index.js";
export * as engine from "./engine/index.js";

// Re-export streaming types for runtime
export type { StreamLevel } from "./events/index.js";
export { EVENT_LEVEL_MAP, LEVEL_HIERARCHY } from "./events/index.js";

// Error hierarchy re-exported for direct access by runtime
export { KilnError } from "./engine/errors.js";
export type { KilnErrorCode } from "./engine/errors.js";

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

// Gateway types re-exported for direct access by runtime gateway
export type {
  GatewayConfig,
  GatewayAppBinding,
  GatewayChannelBinding,
  GatewayValidationError,
} from "./engine/gateway/gateway-config.js";
export { validateGatewayConfig } from "./engine/gateway/gateway-config.js";
export { GatewayLoaderError, parseGatewayYaml } from "./engine/gateway/gateway-loader.js";

// App loader re-exported for direct access by runtime gateway
export type { App, MemoryConfig, AppValidationError } from "./engine/composites/app.js";
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
