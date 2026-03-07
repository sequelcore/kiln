// HMAC-SHA256 signature verification using timing-safe comparison

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an HMAC-SHA256 signature against a payload.
 *
 * The caller prepares the payload string (e.g. Slack prepends "v0:{ts}:{body}").
 * The signature may include a prefix (e.g. "sha256=" or "v0=") which is stripped
 * by the caller before passing to this function, OR passed as-is if the caller
 * uses `expectedPrefix` to let this function handle it.
 *
 * @param secret - The HMAC secret key
 * @param payload - The already-prepared payload string to hash
 * @param signature - The hex-encoded signature to verify against
 * @returns true if the signature is valid
 */
export function verifyHmacSha256(secret: string, payload: string, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  if (expected.length !== signature.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export function signHmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
