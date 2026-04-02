// Security bounded context: audit, secrets, prompt scanning, guardian review

export type {
  AuditAction,
  AuditEntry,
  AuditLog,
  AuditFilter,
  AuditChainResult,
  SecretStore,
  PromptScanResult,
  PromptThreat,
  GuardianReviewResult,
  SecurityConfig,
  GuardianConfig,
  PromptInjectionConfig,
  SecretsConfig,
  AuditConfig,
  TenantIsolationConfig,
} from "./types.js";

export { JsonlAuditLog } from "./audit-log.js";
export { AesSecretStore } from "./secret-store.js";
export { PromptScanner, INJECTION_PATTERNS } from "./prompt-scanner.js";
export type { InjectionPattern } from "./prompt-scanner.js";
export { Guardian } from "./guardian.js";
export type { GuardianRequest } from "./guardian.js";
export { SelfAudit } from "./self-audit.js";
export type {
  SecurityCheckName,
  SecurityCheckResult,
  SecurityAuditReport,
  SelfAuditOptions,
} from "./self-audit.js";
export { AnnotationAuthorizer } from "./annotation-authorizer.js";
export type { AuthorizationPolicy } from "./annotation-authorizer.js";
export { DeterministicDangerousCommandDetector } from "./dangerous-command-detector.js";
