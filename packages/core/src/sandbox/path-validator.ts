import { resolve } from "node:path";
import type { SandboxPolicy } from "./policies.js";

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+[\/\\]/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bformat\s+[a-z]:/i,
] as const;

export function isSubPath(child: string, parent: string): boolean {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent);
  return (
    resolvedChild.startsWith(resolvedParent + "/") ||
    resolvedChild.startsWith(resolvedParent + "\\") ||
    resolvedChild === resolvedParent
  );
}

export class PathValidator {
  private readonly _policy: SandboxPolicy;

  constructor({ policy }: { policy: SandboxPolicy }) {
    this._policy = policy;
  }

  validateRead(filePath: string): ValidationResult {
    if (this._policy.canRead(filePath)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Read access denied: ${filePath}` };
  }

  validateWrite(filePath: string): ValidationResult {
    if (this._policy.canWrite(filePath)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Write access denied: ${filePath}` };
  }

  validateExecute(command: string, _cwd: string): ValidationResult {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: `Dangerous command blocked: ${command}`,
        };
      }
    }
    return { allowed: true };
  }
}
