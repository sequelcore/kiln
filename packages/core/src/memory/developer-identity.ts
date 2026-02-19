import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

export interface DeveloperIdentity {
  readonly name: string;
  readonly email: string;
}

let cached: DeveloperIdentity | undefined;

export function getDeveloperIdentity(cwd?: string): DeveloperIdentity {
  if (cached) return cached;

  try {
    const name = execSync("git config user.name", { cwd, encoding: "utf-8" }).trim();
    const email = execSync("git config user.email", { cwd, encoding: "utf-8" }).trim();
    cached = { name, email };
  } catch {
    cached = { name: "unknown", email: "unknown" };
  }

  return cached;
}

export function generateDeveloperId(identity: DeveloperIdentity): string {
  return createHash("sha256").update(identity.email).digest("hex").slice(0, 8);
}
