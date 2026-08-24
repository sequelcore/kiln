import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type OperatorProjectBinding,
  type OperatorRuntimePrincipal,
  type OperatorSessionClaims,
  OperatorSessionClaimsSchema,
} from "@kilnai/gateway-contracts";

export const OPERATOR_SESSION_CREDENTIAL_VERSION = "v3" as const;
export const OPERATOR_SESSION_MAX_LIFETIME_SECONDS = 300;
export const OPERATOR_SESSION_CLOCK_SKEW_SECONDS = 5;
export const OPERATOR_SESSION_MIN_SECRET_BYTES = 32;

export const OPERATOR_SESSION_CREDENTIAL_ERROR_CODES = [
  "malformed",
  "invalid_signature",
  "invalid_claims",
  "expired",
  "not_yet_valid",
  "lifetime_exceeded",
  "binding_mismatch",
  "invalid_secret",
] as const;

export type OperatorSessionCredentialErrorCode = (typeof OPERATOR_SESSION_CREDENTIAL_ERROR_CODES)[number];

export class OperatorSessionCredentialError extends Error {
  readonly code: OperatorSessionCredentialErrorCode;

  constructor(code: OperatorSessionCredentialErrorCode) {
    super(`Operator session credential rejected: ${code}.`);
    this.name = "OperatorSessionCredentialError";
    this.code = code;
  }
}

export type OperatorSessionExpectedBinding = OperatorProjectBinding & {
  principal: OperatorRuntimePrincipal;
  sessionId: string;
};

export interface OperatorSessionVerificationOptions {
  /** Injectable epoch seconds for deterministic verification. Defaults to the system clock. */
  nowEpochSeconds?: number;
}

export function signOperatorSessionCredential(untrustedClaims: unknown, secret: Uint8Array): string {
  requireSecret(secret);
  const claims = parseClaims(untrustedClaims);
  validateClaimLifetime(claims);
  const encodedPayload = encodeCanonicalClaims(claims);
  const signature = createSignature(encodedPayload, secret).toString("base64url");
  return `${OPERATOR_SESSION_CREDENTIAL_VERSION}.${encodedPayload}.${signature}`;
}

export function verifyOperatorSessionCredential(
  credential: string,
  secret: Uint8Array,
  expected: OperatorSessionExpectedBinding,
  options: OperatorSessionVerificationOptions = {},
): OperatorSessionClaims {
  requireSecret(secret);
  const segments = parseCredentialSegments(credential);
  const expectedSignature = createSignature(segments.encodedPayload, secret);
  const suppliedSignature = decodeSignature(segments.encodedSignature);

  if (!timingSafeEqual(expectedSignature, suppliedSignature)) {
    throw new OperatorSessionCredentialError("invalid_signature");
  }

  const claims = decodeClaims(segments.encodedPayload);
  validateClaimLifetime(claims);
  const nowEpochSeconds = resolveNow(options.nowEpochSeconds);
  if (claims.issuedAt > nowEpochSeconds + OPERATOR_SESSION_CLOCK_SKEW_SECONDS) {
    throw new OperatorSessionCredentialError("not_yet_valid");
  }
  if (claims.expiresAt < nowEpochSeconds - OPERATOR_SESSION_CLOCK_SKEW_SECONDS) {
    throw new OperatorSessionCredentialError("expired");
  }
  if (
    claims.projectRuntimeId !== expected.projectRuntimeId ||
    claims.compositionRevision !== expected.compositionRevision ||
    !samePrincipal(claims.principal, expected.principal) ||
    claims.sessionId !== expected.sessionId
  ) {
    throw new OperatorSessionCredentialError("binding_mismatch");
  }
  return claims;
}

function parseCredentialSegments(credential: string): {
  encodedPayload: string;
  encodedSignature: string;
} {
  if (typeof credential !== "string" || credential.length > 2_048) {
    throw new OperatorSessionCredentialError("malformed");
  }
  const segments = credential.split(".");
  if (
    segments.length !== 3 ||
    segments[0] !== OPERATOR_SESSION_CREDENTIAL_VERSION ||
    !isCanonicalBase64Url(segments[1] ?? "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(segments[2] ?? "")
  ) {
    throw new OperatorSessionCredentialError("malformed");
  }
  return { encodedPayload: segments[1]!, encodedSignature: segments[2]! };
}

function decodeSignature(encodedSignature: string): Buffer {
  const decoded = Buffer.from(encodedSignature, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== encodedSignature) {
    throw new OperatorSessionCredentialError("malformed");
  }
  return decoded;
}

function decodeClaims(encodedPayload: string): OperatorSessionClaims {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new OperatorSessionCredentialError("invalid_claims");
  }
  const claims = parseClaims(value);
  if (encodeCanonicalClaims(claims) !== encodedPayload) {
    throw new OperatorSessionCredentialError("invalid_claims");
  }
  return claims;
}

function parseClaims(value: unknown): OperatorSessionClaims {
  const result = OperatorSessionClaimsSchema.safeParse(value);
  if (!result.success) {
    throw new OperatorSessionCredentialError("invalid_claims");
  }
  return result.data;
}

function validateClaimLifetime(claims: OperatorSessionClaims): void {
  const lifetime = claims.expiresAt - claims.issuedAt;
  if (lifetime <= 0) {
    throw new OperatorSessionCredentialError("invalid_claims");
  }
  if (lifetime > OPERATOR_SESSION_MAX_LIFETIME_SECONDS) {
    throw new OperatorSessionCredentialError("lifetime_exceeded");
  }
}

function encodeCanonicalClaims(claims: OperatorSessionClaims): string {
  const canonicalClaims: OperatorSessionClaims = {
    protocolVersion: claims.protocolVersion,
    audience: claims.audience,
    projectRuntimeId: claims.projectRuntimeId,
    compositionRevision: claims.compositionRevision,
    principal: claims.principal,
    sessionId: claims.sessionId,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  };
  return Buffer.from(JSON.stringify(canonicalClaims), "utf8").toString("base64url");
}

function samePrincipal(left: OperatorRuntimePrincipal, right: OperatorRuntimePrincipal): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "native-harness"
    ? right.kind === "native-harness" && left.harness === right.harness
    : right.kind === "operator-surface" && left.surface === right.surface;
}

function createSignature(encodedPayload: string, secret: Uint8Array): Buffer {
  return createHmac("sha256", secret)
    .update(`${OPERATOR_SESSION_CREDENTIAL_VERSION}.${encodedPayload}`, "ascii")
    .digest();
}

function requireSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.byteLength < OPERATOR_SESSION_MIN_SECRET_BYTES) {
    throw new OperatorSessionCredentialError("invalid_secret");
  }
}

function resolveNow(nowEpochSeconds: number | undefined): number {
  const resolved = nowEpochSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new OperatorSessionCredentialError("invalid_claims");
  }
  return resolved;
}

function isCanonicalBase64Url(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length > 0 && decoded.toString("base64url") === value;
}
