import { createHash } from "node:crypto";

export function sha256ContentIdentity(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
