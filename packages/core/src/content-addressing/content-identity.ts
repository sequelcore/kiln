import { createHash } from "node:crypto";

/** Produces the canonical SHA-256 content address used across Core concerns. */
export function sha256ContentIdentity(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
