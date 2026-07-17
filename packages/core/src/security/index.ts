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
export { ActionEffectAuthorizer } from "./action-effect-authorizer.js";
export { DeterministicDangerousCommandDetector } from "./dangerous-command-detector.js";
export {
  TRUSTED_EXECUTION_CLASSIFICATIONS,
  TRUSTED_EXECUTION_EVIDENCE_FRESHNESS,
  TRUSTED_EXECUTION_EVIDENCE_SOURCES,
  TRUSTED_EXECUTION_PROFILES,
  TRUSTED_EXECUTION_PROOF_STATUSES,
  authorizeTrustedExecutionIntent,
  classifyTrustedExecutionIntegrity,
} from "./trusted-execution-integrity.js";
export type {
  TrustedExecutionAuthorization,
  TrustedExecutionClassification,
  TrustedExecutionClassificationInput,
  TrustedExecutionClassificationResult,
  TrustedExecutionEnforcement,
  TrustedExecutionEvidence,
  TrustedExecutionEvidenceSource,
  TrustedExecutionFreshness,
  TrustedExecutionIntentRequest,
  TrustedExecutionProfile,
  TrustedExecutionProof,
} from "./trusted-execution-integrity.js";
