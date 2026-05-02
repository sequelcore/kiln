export {
  type Credential,
  type Lease,
  type CredentialSource,
  createCredential,
  incrementRequestCount,
  recordSuccess,
  recordExhaustion,
  recordFailure,
  clearExpiredCooldown,
  acquireSoftLease,
  releaseSoftLease,
  isAvailable,
  isCooling,
  getHealthStatus,
} from "./credential.js";

export {
  type CredentialOutcome,
  isOk,
  isRetryable,
  isAuthError,
  getResetAt,
  AllCredentialsExhaustedError,
} from "./outcome.js";

export {
  type CooldownPolicy,
  DEFAULT_COOLDOWN_POLICY,
  computeCooldownUntil,
  createCooldownPolicy,
} from "./cooldown.js";

export {
  type SelectionStrategy,
  selectCredential,
  createInitialSelectionContext,
  updateSelectionContext,
} from "./strategies.js";

export {
  type CredentialPoolStatePort,
  type CredentialPoolConfig,
  type PoolMetrics,
  computePoolMetrics,
} from "./state-port.js";

export {
  type CredentialPoolSnapshot,
  type CredentialPoolEntrySnapshot,
  CredentialPool,
} from "./pool.js";
