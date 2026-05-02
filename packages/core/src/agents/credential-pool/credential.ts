

export interface Credential<TAuth> {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly source: CredentialSource;
  readonly priority: number;
  readonly tier?: string;
  readonly auth: TAuth;
  readonly requestCount: number;
  readonly lastSuccess: number | null;
  readonly lastExhausted: number | null;
  readonly cooldownUntil: number | null;
  readonly softLeaseCount: number;
}

export type CredentialSource = "manual" | "env" | "imported";

export interface Lease<TAuth> {
  readonly credentialId: string;
  readonly auth: TAuth;
  readonly acquiredAt: number;
  readonly providerId: string;
}

export function createCredential<TAuth>(
  id: string,
  label: string,
  providerId: string,
  auth: TAuth,
  options?: {
    readonly source?: CredentialSource;
    readonly priority?: number;
    readonly tier?: string;
  },
): Credential<TAuth> {
  return {
    id,
    label,
    providerId,
    source: options?.source ?? "manual",
    priority: options?.priority ?? 0,
    tier: options?.tier,
    auth,
    requestCount: 0,
    lastSuccess: null,
    lastExhausted: null,
    cooldownUntil: null,
    softLeaseCount: 0,
  };
}

export function incrementRequestCount<TAuth>(
  credential: Credential<TAuth>,
): Credential<TAuth> {
  return {
    ...credential,
    requestCount: credential.requestCount + 1,
  };
}

export function recordSuccess<TAuth>(
  credential: Credential<TAuth>,
  timestamp: number = Date.now(),
): Credential<TAuth> {
  return {
    ...credential,
    requestCount: credential.requestCount + 1,
    lastSuccess: timestamp,
    cooldownUntil: null,
  };
}

export function recordExhaustion<TAuth>(
  credential: Credential<TAuth>,
  cooldownUntil: number,
  timestamp: number = Date.now(),
): Credential<TAuth> {
  return {
    ...credential,
    requestCount: credential.requestCount + 1,
    lastExhausted: timestamp,
    cooldownUntil,
  };
}

export function recordFailure<TAuth>(
  credential: Credential<TAuth>,
): Credential<TAuth> {
  return {
    ...credential,
    requestCount: credential.requestCount + 1,
  };
}

export function clearExpiredCooldown<TAuth>(
  credential: Credential<TAuth>,
  now: number = Date.now(),
): Credential<TAuth> {
  if (credential.cooldownUntil === null || now < credential.cooldownUntil) {
    return credential;
  }

  return {
    ...credential,
    cooldownUntil: null,
  };
}

export function acquireSoftLease<TAuth>(
  credential: Credential<TAuth>,
): Credential<TAuth> {
  return {
    ...credential,
    softLeaseCount: credential.softLeaseCount + 1,
  };
}

export function releaseSoftLease<TAuth>(
  credential: Credential<TAuth>,
): Credential<TAuth> {
  return {
    ...credential,
    softLeaseCount: Math.max(0, credential.softLeaseCount - 1),
  };
}

export function isAvailable<TAuth>(
  credential: Credential<TAuth>,
  now: number = Date.now(),
): boolean {
  if (credential.cooldownUntil === null) {
    return true;
  }
  return now >= credential.cooldownUntil;
}

export function isCooling<TAuth>(
  credential: Credential<TAuth>,
  now: number = Date.now(),
): boolean {
  return credential.cooldownUntil !== null && now < credential.cooldownUntil;
}

export function getHealthStatus<TAuth>(
  credential: Credential<TAuth>,
  now: number = Date.now(),
): "ok" | "cooling" | "exhausted" {
  if (isAvailable(credential, now)) {
    return "ok";
  }
  if (credential.lastExhausted !== null) {
    return "exhausted";
  }
  return "cooling";
}
