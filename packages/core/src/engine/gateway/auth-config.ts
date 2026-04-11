// Engine type: GatewayAuthConfig -- gateway-level JWT authentication configuration
// Domain types only -- no external dependencies

/** JWT algorithm supported at the gateway level */
export type JwtAlgorithm = "RS256" | "HS256";

/**
 * Gateway-level JWT authentication configuration.
 * Loaded from the `auth` block in gateway.yaml.
 *
 * RS256: verifies tokens by fetching public keys from a JWKS endpoint.
 * HS256: verifies tokens using a shared secret resolved from an env var.
 */
export interface GatewayAuthConfig {
  readonly algorithm: JwtAlgorithm;
  /** RS256 only: URL of the JWKS endpoint (e.g. "https://auth.myapp.com/.well-known/jwks.json") */
  readonly jwksUri?: string;
  /** HS256 only: env var name containing the shared HMAC secret */
  readonly secretEnv?: string;
  /** Optional: expected `iss` claim. Tokens with a different issuer are rejected. */
  readonly issuer?: string;
  /** Optional: expected `aud` claim. Tokens must include this audience. */
  readonly audience?: string;
  /** Optional: tolerated clock skew in seconds for nbf/iat/exp checks. */
  readonly clockToleranceSeconds?: number;
}

/** Validation error for auth configuration */
export interface GatewayAuthValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate a GatewayAuthConfig. Returns an array of errors; empty means valid. */
export function validateGatewayAuthConfig(config: GatewayAuthConfig): GatewayAuthValidationError[] {
  const errors: GatewayAuthValidationError[] = [];

  const validAlgorithms: JwtAlgorithm[] = ["RS256", "HS256"];
  if (!validAlgorithms.includes(config.algorithm)) {
    errors.push({ field: "auth.algorithm", message: `must be one of: ${validAlgorithms.join(", ")}` });
    return errors; // Cannot continue without a valid algorithm
  }

  if (config.algorithm === "RS256") {
    if (!config.jwksUri || typeof config.jwksUri !== "string" || !config.jwksUri.trim()) {
      errors.push({ field: "auth.jwksUri", message: "required when algorithm is RS256" });
    }
    if (config.secretEnv) {
      errors.push({ field: "auth.secretEnv", message: "must not be set when algorithm is RS256" });
    }
  }

  if (config.algorithm === "HS256") {
    if (!config.secretEnv || typeof config.secretEnv !== "string" || !config.secretEnv.trim()) {
      errors.push({ field: "auth.secretEnv", message: "required when algorithm is HS256" });
    }
    if (config.jwksUri) {
      errors.push({ field: "auth.jwksUri", message: "must not be set when algorithm is HS256" });
    }
  }

  if (
    config.clockToleranceSeconds !== undefined
    && (!Number.isInteger(config.clockToleranceSeconds) || config.clockToleranceSeconds < 0)
  ) {
    errors.push({
      field: "auth.clockToleranceSeconds",
      message: "must be a non-negative integer when provided",
    });
  }

  return errors;
}
