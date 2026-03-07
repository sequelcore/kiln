// Meta Webhook Foundation -- shared verification, HMAC validation, and entry dispatch
// Used by WhatsApp, Instagram, and Messenger webhook handlers

import type { Context } from "hono";
import { verifyHmacSha256 } from "../utils/hmac.js";

/**
 * Handle Meta's GET verification handshake.
 * Returns hub.challenge on valid subscribe requests; 403 otherwise.
 */
export function verifyMetaWebhook(c: Context, verifyToken: string): Response {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === verifyToken) {
    return c.text(challenge ?? "", 200);
  }
  return c.text("Forbidden", 403);
}

/**
 * Validate Meta's HMAC-SHA256 signature from `X-Hub-Signature-256` header.
 * Strips the `sha256=` prefix before comparison.
 */
export function validateMetaSignature(body: string, signature: string, appSecret: string): boolean {
  const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  return verifyHmacSha256(appSecret, body, sig);
}
