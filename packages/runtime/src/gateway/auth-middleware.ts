// Composable auth middleware for gateway routes
// Each function returns a Hono middleware or utility for a specific auth mechanism

import type { Context, Next } from "hono";
import { verifyHmacSha256 } from "../utils/hmac.js";

/**
 * Require API key via X-Api-Key header. Returns 401 if missing or invalid.
 */
export function requireApiKey(key: string): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const provided = c.req.header("x-api-key");
    if (!provided || provided !== key) {
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
    if (!auth || auth !== `Bearer ${token}`) {
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
