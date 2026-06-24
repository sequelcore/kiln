export type SecretSource = EnvSecretSource | ManagedSecretSource | CredentialPoolSecretSource;

export interface EnvSecretSource {
  readonly kind: "env";
  readonly name: string;
}

export interface ManagedSecretSource {
  readonly kind: "managed";
  readonly providerId: string;
  readonly reference: string;
  readonly version?: string;
}

export interface CredentialPoolSecretSource {
  readonly kind: "credential-pool";
  readonly providerId: string;
  readonly credentialId?: string;
  readonly field: string;
}

export type CredentialRotationKind = "manual" | "leased" | "provider-managed";

export interface CredentialRotationMetadata {
  readonly kind: CredentialRotationKind;
  readonly nextRotationAt?: string;
  readonly leaseExpiresAt?: string;
  readonly renewable?: boolean;
}

export interface CredentialRefreshMetadata {
  readonly kind: "oauth2-refresh-token";
  readonly refreshSecretRefId?: string;
  readonly nextRefreshAt?: string;
}

export interface SecretRef {
  readonly id: string;
  readonly purpose: string;
  readonly scopes: readonly string[];
  readonly source: SecretSource;
  readonly expiresAt?: string;
  readonly rotation?: CredentialRotationMetadata;
  readonly refresh?: CredentialRefreshMetadata;
}

export type SecretDiagnosticStatus = "available" | "missing" | "expired" | "invalid";

export type SecretLifecycleStatus = "usable" | "refresh-due" | "rotation-due" | "expired";

export interface SecretLifecycleDiagnostic {
  readonly status: SecretLifecycleStatus;
  readonly reason?: string;
  readonly dueAt?: string;
}

export interface SecretDiagnostic {
  readonly refId: string;
  readonly purpose: string;
  readonly scopes: readonly string[];
  readonly source: SecretSource;
  readonly status: SecretDiagnosticStatus;
  readonly reason?: string;
  readonly expiresAt?: string;
  readonly resolvedAt?: string;
  readonly rotation?: CredentialRotationMetadata;
  readonly refresh?: CredentialRefreshMetadata;
  readonly lifecycle?: SecretLifecycleDiagnostic;
}

export type SecretResolution =
  | {
    readonly status: "available";
    readonly value: string;
    readonly resolvedAt: string;
  }
  | {
    readonly status: "missing" | "invalid";
    readonly reason: string;
    readonly resolvedAt?: string;
  };

export interface SecretValidationIssue {
  readonly field: string;
  readonly message: string;
}

export interface ResolvedSecret {
  readonly ref: SecretRef;
  readonly value: string;
  readonly diagnostic: SecretDiagnostic;
}

export interface SecretResolver {
  resolve(ref: SecretRef): Promise<ResolvedSecret>;
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function createSecretRef(input: SecretRef): SecretRef {
  const issues = validateSecretRef(input);
  if (issues.length > 0) {
    throw new Error(`Invalid secret reference: ${issues[0]!.field} ${issues[0]!.message}`);
  }
  return Object.freeze({
    id: input.id.trim(),
    purpose: input.purpose.trim(),
    scopes: Object.freeze(input.scopes.map((scope) => scope.trim())),
    source: freezeSecretSource(input.source),
    ...(input.expiresAt ? { expiresAt: requireIsoTimestamp(input.expiresAt, "expiresAt") } : {}),
    ...(input.rotation ? { rotation: freezeRotation(input.rotation) } : {}),
    ...(input.refresh ? { refresh: freezeRefresh(input.refresh) } : {}),
  });
}

export function validateSecretRef(input: SecretRef): readonly SecretValidationIssue[] {
  const issues: SecretValidationIssue[] = [];
  if (!input.id?.trim()) {
    issues.push({ field: "id", message: "must be non-empty" });
  }
  if (!input.purpose?.trim()) {
    issues.push({ field: "purpose", message: "must be non-empty" });
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    issues.push({ field: "scopes", message: "must contain at least one scope" });
  } else if (input.scopes.some((scope) => !scope.trim())) {
    issues.push({ field: "scopes", message: "must not contain empty scopes" });
  }
  if (input.source.kind === "env") {
    if (!ENV_NAME_PATTERN.test(input.source.name)) {
      issues.push({ field: "source.name", message: "env secret source name must be a valid environment variable name" });
    }
  } else if (input.source.kind === "managed") {
    if (!input.source.providerId.trim()) {
      issues.push({ field: "source.providerId", message: "must be non-empty" });
    }
    if (!input.source.reference.trim()) {
      issues.push({ field: "source.reference", message: "must be non-empty" });
    }
  } else if (input.source.kind === "credential-pool") {
    if (!input.source.providerId.trim()) {
      issues.push({ field: "source.providerId", message: "must be non-empty" });
    }
    if (!input.source.field.trim()) {
      issues.push({ field: "source.field", message: "must be non-empty" });
    }
  } else {
    issues.push({ field: "source.kind", message: "must be env, managed, or credential-pool" });
  }
  pushIsoIssue(issues, input.expiresAt, "expiresAt");
  pushIsoIssue(issues, input.rotation?.nextRotationAt, "rotation.nextRotationAt");
  pushIsoIssue(issues, input.rotation?.leaseExpiresAt, "rotation.leaseExpiresAt");
  pushIsoIssue(issues, input.refresh?.nextRefreshAt, "refresh.nextRefreshAt");
  return Object.freeze(issues);
}

export function diagnoseSecretResolution(
  ref: SecretRef,
  resolution: SecretResolution,
  now: Date = new Date(),
): SecretDiagnostic {
  const base = {
    refId: ref.id,
    purpose: ref.purpose,
    scopes: Object.freeze([...ref.scopes]),
    source: ref.source,
    ...(ref.expiresAt ? { expiresAt: ref.expiresAt } : {}),
    ...(resolution.resolvedAt ? { resolvedAt: resolution.resolvedAt } : {}),
    ...(ref.rotation ? { rotation: ref.rotation } : {}),
    ...(ref.refresh ? { refresh: ref.refresh } : {}),
    lifecycle: evaluateSecretLifecycle(ref, now),
  };

  if (base.lifecycle.status === "expired") {
    return Object.freeze({
      ...base,
      status: "expired",
      reason: base.lifecycle.reason,
    });
  }

  if (resolution.status !== "available") {
    return Object.freeze({
      ...base,
      status: resolution.status,
      reason: resolution.reason,
    });
  }

  return Object.freeze({
    ...base,
    status: "available",
  });
}

export function evaluateSecretLifecycle(
  ref: SecretRef,
  now: Date = new Date(),
): SecretLifecycleDiagnostic {
  if (isDue(ref.expiresAt, now)) {
    return Object.freeze({
      status: "expired",
      reason: "secret reference expiry has passed",
      dueAt: ref.expiresAt,
    });
  }
  if (isDue(ref.refresh?.nextRefreshAt, now)) {
    return Object.freeze({
      status: "refresh-due",
      reason: "credential refresh is due",
      dueAt: ref.refresh!.nextRefreshAt,
    });
  }
  const rotationDueAt = ref.rotation?.nextRotationAt ?? ref.rotation?.leaseExpiresAt;
  if (isDue(rotationDueAt, now)) {
    return Object.freeze({
      status: "rotation-due",
      reason: "credential rotation is due",
      dueAt: rotationDueAt,
    });
  }
  return Object.freeze({ status: "usable" });
}

function freezeSecretSource(source: SecretSource): SecretSource {
  if (source.kind === "env") {
    return Object.freeze({ kind: source.kind, name: source.name.trim() });
  }
  if (source.kind === "managed") {
    return Object.freeze({
      kind: source.kind,
      providerId: source.providerId.trim(),
      reference: source.reference.trim(),
      ...(source.version ? { version: source.version.trim() } : {}),
    });
  }
  return Object.freeze({
    kind: source.kind,
    providerId: source.providerId.trim(),
    ...(source.credentialId ? { credentialId: source.credentialId.trim() } : {}),
    field: source.field.trim(),
  });
}

function freezeRotation(rotation: CredentialRotationMetadata): CredentialRotationMetadata {
  return Object.freeze({
    kind: rotation.kind,
    ...(rotation.nextRotationAt
      ? { nextRotationAt: requireIsoTimestamp(rotation.nextRotationAt, "rotation.nextRotationAt") }
      : {}),
    ...(rotation.leaseExpiresAt
      ? { leaseExpiresAt: requireIsoTimestamp(rotation.leaseExpiresAt, "rotation.leaseExpiresAt") }
      : {}),
    ...(typeof rotation.renewable === "boolean" ? { renewable: rotation.renewable } : {}),
  });
}

function freezeRefresh(refresh: CredentialRefreshMetadata): CredentialRefreshMetadata {
  return Object.freeze({
    kind: refresh.kind,
    ...(refresh.refreshSecretRefId ? { refreshSecretRefId: refresh.refreshSecretRefId.trim() } : {}),
    ...(refresh.nextRefreshAt
      ? { nextRefreshAt: requireIsoTimestamp(refresh.nextRefreshAt, "refresh.nextRefreshAt") }
      : {}),
  });
}

function pushIsoIssue(issues: SecretValidationIssue[], value: string | undefined, field: string): void {
  if (!value) {
    return;
  }
  if (Number.isNaN(Date.parse(value))) {
    issues.push({ field, message: "must be an ISO timestamp" });
  }
}

function requireIsoTimestamp(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
  return new Date(parsed).toISOString();
}

function isDue(value: string | undefined, now: Date): boolean {
  return Boolean(value && Date.parse(value) <= now.getTime());
}
