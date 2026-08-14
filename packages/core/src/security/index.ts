// Security bounded context: audit, secrets, prompt scanning, guardian review

export { ActionEffectAuthorizer } from "./action-effect-authorizer.js";

export { JsonlAuditLog } from "./audit-log.js";
export { DeterministicDangerousCommandDetector } from "./dangerous-command-detector.js";
export type { GuardianRequest } from "./guardian.js";
export { Guardian } from "./guardian.js";
export type { InjectionPattern } from "./prompt-scanner.js";
export { INJECTION_PATTERNS, PromptScanner } from "./prompt-scanner.js";
export { AesSecretStore } from "./secret-store.js";
export type {
  SecurityAuditReport,
  SecurityCheckName,
  SecurityCheckResult,
  SelfAuditOptions,
} from "./self-audit.js";
export { SelfAudit } from "./self-audit.js";
export type {
  TrustedExecutionAuthorizationRecord,
  TrustedExecutionHarness,
} from "./trusted-execution-authorization-store.js";
export {
  readTrustedExecutionAuthorization,
  writeTrustedExecutionAuthorization,
} from "./trusted-execution-authorization-store.js";
export type { TrustedExecutionEnforcementInput } from "./trusted-execution-enforcement.js";
export { describeTrustedExecutionEnforcement } from "./trusted-execution-enforcement.js";
export type { TrustedExecutionLimitationAcceptance, TrustedExecutionSemanticLimitation } from "./trusted-execution-semantic-limitation.js";
export {
  OPENCODE_NO_FILESYSTEM_SANDBOX,
  TRUSTED_EXECUTION_SEMANTIC_LIMITATIONS,
  acceptTrustedExecutionSemanticLimitation,
  readTrustedExecutionSemanticLimitationAcceptance,
  revokeTrustedExecutionSemanticLimitation,
  validateTrustedExecutionLimitationAcceptance,
  validateTrustedExecutionSemanticLimitation,
} from "./trusted-execution-semantic-limitation.js";
export type { TrustedExecutionGrantPlan } from "./trusted-execution-grant.js";
export {
  finalizeTrustedExecutionGrant,
  planTrustedExecutionGrant,
  revokeTrustedExecutionGrant,
} from "./trusted-execution-grant.js";
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
export {
  authorizeTrustedExecutionIntent,
  classifyTrustedExecutionIntegrity,
  TRUSTED_EXECUTION_CLASSIFICATIONS,
  TRUSTED_EXECUTION_EVIDENCE_FRESHNESS,
  TRUSTED_EXECUTION_EVIDENCE_SOURCES,
  TRUSTED_EXECUTION_PROFILES,
  TRUSTED_EXECUTION_PROOF_STATUSES,
} from "./trusted-execution-integrity.js";
export type {
  AuditAction,
  AuditChainResult,
  AuditConfig,
  AuditEntry,
  AuditFilter,
  AuditLog,
  GuardianConfig,
  GuardianReviewResult,
  PromptInjectionConfig,
  PromptScanResult,
  PromptThreat,
  SecretStore,
  SecretsConfig,
  SecurityConfig,
  TenantIsolationConfig,
} from "./types.js";
