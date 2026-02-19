// Security types: interfaces for audit, secrets, prompt scanning, and guardian review

// --- Audit Log ---

/** Categories of auditable actions */
export type AuditAction =
  | "capability_executed"
  | "destructive_blocked"
  | "destructive_approved"
  | "injection_detected"
  | "injection_cleared"
  | "secret_accessed"
  | "secret_rotated"
  | "tenant_created"
  | "tenant_updated"
  | "tenant_deleted"
  | "memory_accessed"
  | "memory_denied"
  | "session_started"
  | "session_ended"
  | "config_changed"
  | "self_audit_completed";

/** Single audit log entry */
export interface AuditEntry {
  readonly id: string;
  readonly timestamp: Date;
  readonly action: AuditAction;
  readonly actor: string;
  readonly resource: string;
  readonly outcome: "allowed" | "denied" | "error";
  readonly metadata?: Record<string, unknown>;
  readonly tenantId?: string;
  readonly sessionId?: string;
  readonly hash?: string;
  readonly previousHash?: string;
}

/** Audit log interface (append-only) */
export interface AuditLog {
  append(entry: Omit<AuditEntry, "id" | "hash" | "previousHash">): AuditEntry;
  query(filter: AuditFilter): readonly AuditEntry[];
  verifyChain(fromIndex?: number, toIndex?: number): AuditChainResult;
  count(): number;
}

export interface AuditFilter {
  readonly action?: AuditAction;
  readonly actor?: string;
  readonly tenantId?: string;
  readonly since?: Date;
  readonly until?: Date;
  readonly outcome?: "allowed" | "denied" | "error";
  readonly limit?: number;
}

export interface AuditChainResult {
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly brokenAt?: number;
  readonly error?: string;
}

// --- Secret Store ---

/** Secret store for encrypted credentials at rest */
export interface SecretStore {
  set(key: string, value: string): void;
  get(key: string): string | null;
  has(key: string): boolean;
  delete(key: string): boolean;
  keys(): readonly string[];
  rotateKey(newMasterKey: string): void;
}

// --- Prompt Scan ---

/** Prompt injection detection result */
export interface PromptScanResult {
  readonly safe: boolean;
  readonly tier: "heuristic" | "deep";
  readonly threats: readonly PromptThreat[];
  readonly scannedAt: Date;
  readonly inputLength: number;
}

export interface PromptThreat {
  readonly pattern: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly matched: string;
  readonly description: string;
}

// --- Guardian Review ---

/** Guardian review result for destructive capability execution */
export interface GuardianReviewResult {
  readonly approved: boolean;
  readonly reason: string;
  readonly reviewedBy: string;
  readonly reviewDurationMs: number;
  readonly riskLevel: "low" | "medium" | "high" | "critical";
  readonly capabilityName: string;
  readonly agentName: string;
}

// --- Security Config ---

/** Top-level security configuration (YAML-driven, all opt-in) */
export interface SecurityConfig {
  readonly guardian?: GuardianConfig;
  readonly promptInjection?: PromptInjectionConfig;
  readonly secrets?: SecretsConfig;
  readonly audit?: AuditConfig;
  readonly tenantIsolation?: TenantIsolationConfig;
}

export interface GuardianConfig {
  readonly enabled: boolean;
  readonly reviewerTier: "reasoning" | "fast";
  readonly blockOnError: boolean;
  readonly bypassForReadOnly: boolean;
}

export interface PromptInjectionConfig {
  readonly enabled: boolean;
  readonly heuristicOnly: boolean;
  readonly blockOnDetection: boolean;
  readonly allowedPatterns?: readonly string[];
}

export interface SecretsConfig {
  readonly enabled: boolean;
  readonly storePath: string;
}

export interface AuditConfig {
  readonly enabled: boolean;
  readonly logPath: string;
  readonly hashChaining: boolean;
  readonly retentionDays?: number;
}

export interface TenantIsolationConfig {
  readonly enabled: boolean;
  readonly enforceMemoryNamespace: boolean;
  readonly enforceFileSystem: boolean;
}
