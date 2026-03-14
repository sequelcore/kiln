// Composable auth middleware for gateway routes
// Each function returns a Hono middleware or utility for a specific auth mechanism

import type { Context, Next } from "hono";
import { timingSafeEqual } from "node:crypto";
import { verifyHmacSha256 } from "../utils/hmac.js";
import type { JwtVerifyFn, JwtPayload } from "./jwt-verifier.js";

/** Timing-safe string comparison. Returns false immediately for different lengths (safe — no content leak). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Require API key via X-Api-Key header. Returns 401 if missing or invalid.
 */
export function requireApiKey(key: string): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const provided = c.req.header("x-api-key");
    if (!provided || !safeEqual(provided, key)) {
      return c.json({ error: "unauthorized", message: "Invalid or missing API key" }, 401);
    }
    return next();
  };
}

/**
 * Require Bearer token via Authorization header. Returns 401 if missing or invalid.
 */
export function requireBearer(token: string): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.req.header("authorization");
    const expected = `Bearer ${token}`;
    if (!auth || !safeEqual(auth, expected)) {
      return c.json({ error: "unauthorized", message: "Invalid or missing Bearer token" }, 401);
    }
    return next();
  };
}

/**
 * Validate HMAC-SHA256 signature from a specified header against the raw request body.
 * Strips optional "sha256=" prefix from the signature (Meta/WhatsApp convention).
 * Returns 401 if the header is missing or the signature is invalid.
 */
export function requireWebhookSignature(
  secret: string,
  headerName: string,
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const signature = c.req.header(headerName);
    if (!signature) {
      return c.json({ error: "unauthorized", message: `Missing ${headerName} header` }, 401);
    }

    const body = await c.req.text();
    const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    if (!verifyHmacSha256(secret, body, sig)) {
      return c.json({ error: "unauthorized", message: "Invalid webhook signature" }, 401);
    }

    return next();
  };
}

/**
 * Require a valid JWT via Authorization: Bearer <token>.
 * Verifies using the provided JwtVerifyFn (JWKS or HS256).
 * Attaches the decoded payload to the Hono context under key "jwtPayload" for downstream use.
 * Returns 401 if the header is missing, malformed, or the token is invalid/expired.
 * No error details are leaked in the response body.
 */
export function requireJwt(verify: JwtVerifyFn): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.req.header("authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized", message: "Missing or malformed Authorization header" }, 401);
    }
    const token = auth.slice(7);
    try {
      const payload: JwtPayload = await verify(token);
      c.set("jwtPayload", payload);
      return next();
    } catch {
      return c.json({ error: "unauthorized", message: "Invalid or expired JWT" }, 401);
    }
  };
}

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

/**
 * Check if a WebSocket origin is allowed. Utility function, not middleware.
 *
 * - Empty/undefined allowedOrigins -> allow all (open mode)
 * - No Origin header (null) -> allow (non-browser client)
 * - localhost/127.0.0.1 any port -> always allowed
 * - Otherwise -> exact match against allowedOrigins list
 */
export function isOriginAllowed(origin: string | null, allowedOrigins?: readonly string[]): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) return true;
  if (!origin) return true;

  try {
    const url = new URL(origin);
    if (LOCALHOST_HOSTNAMES.has(url.hostname)) return true;
  } catch {
    return false;
  }

  return allowedOrigins.includes(origin);
}
