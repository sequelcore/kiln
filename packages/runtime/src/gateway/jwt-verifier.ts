// Gateway: JwtVerifier -- JWT verification via JWKS (RS256) or shared secret (HS256)
// Initialized once at gateway startup; jose handles JWKS caching and key refresh internally.

import type { GatewayAuthConfig } from "@kilnai/core";

/** Decoded JWT payload passed to downstream handlers */
export interface JwtPayload {
  readonly sub?: string;
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly exp?: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly jti?: string;
  readonly [key: string]: unknown;
}

/**
 * A callable that verifies a raw JWT string and returns its decoded payload.
 * Throws a jose error (JWTExpired, JWTInvalid, JWSSignatureVerificationFailed, etc.)
 * if the token is missing, expired, or has an invalid signature.
 */
export type JwtVerifyFn = (token: string) => Promise<JwtPayload>;

/**
 * Build a JwtVerifyFn from a GatewayAuthConfig.
 *
 * RS256: uses jose's createRemoteJWKSet, which fetches and caches the JWKS
 *        automatically, refreshing on key rotation (cache miss).
 * HS256: imports the secret from process.env once at startup; fails fast if the
 *        env var is not set.
 */
export async function buildJwtVerifier(config: GatewayAuthConfig): Promise<JwtVerifyFn> {
  // Dynamic import: jose loads only when JWT auth is configured.
  const { jwtVerify, createRemoteJWKSet } = await import("jose");
  const clockTolerance = config.clockToleranceSeconds ?? 30;

  const verifyOptions = {
    ...(config.issuer ? { issuer: config.issuer } : {}),
    ...(config.audience ? { audience: config.audience } : {}),
    clockTolerance,
  };

  if (config.algorithm === "RS256") {
    const jwks = createRemoteJWKSet(new URL(config.jwksUri!), {
      headers: { Accept: "application/json" },
    });

    return async (token: string): Promise<JwtPayload> => {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ["RS256"],
        ...verifyOptions,
      });
      return payload as JwtPayload;
    };
  }

  // HS256: resolve secret at startup, not per-request
  const secret = process.env[config.secretEnv!];
  if (!secret) {
    throw new Error(`Gateway JWT auth: env var "${config.secretEnv}" is not set`);
  }

  const secretBytes = new TextEncoder().encode(secret);

  return async (token: string): Promise<JwtPayload> => {
    const { payload } = await jwtVerify(token, secretBytes, {
      algorithms: ["HS256"],
      ...verifyOptions,
    });
    return payload as JwtPayload;
  };
}
