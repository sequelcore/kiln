import { resolve } from "node:path";
import type { SandboxPolicy } from "./policies.js";

/** Runtime-owned physical path canonicalization required for filesystem checks. */
export interface PhysicalPathResolver {
  resolve(filePath: string): string | undefined;
}

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
  private readonly _physicalPathResolver: PhysicalPathResolver | undefined;

  constructor({
    policy,
    physicalPathResolver,
  }: {
    policy: SandboxPolicy;
    physicalPathResolver?: PhysicalPathResolver;
  }) {
    this._policy = policy;
    this._physicalPathResolver = physicalPathResolver;
  }

  validateRead(filePath: string): ValidationResult {
    if (this._policy.canRead(filePath) && this.validatePhysicalPath(filePath, "read")) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Read access denied: ${filePath}` };
  }

  validateWrite(filePath: string): ValidationResult {
    if (this._policy.canWrite(filePath) && this.validatePhysicalPath(filePath, "write")) {
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

  private validatePhysicalPath(filePath: string, operation: "read" | "write"): boolean {
    if (!this._physicalPathResolver) return false;
    let physicalPath: string | undefined;
    try {
      physicalPath = this._physicalPathResolver.resolve(filePath);
    } catch {
      return false;
    }
    if (physicalPath === undefined) return false;
    return operation === "read"
      ? this._policy.canRead(physicalPath)
      : this._policy.canWrite(physicalPath);
  }
}
