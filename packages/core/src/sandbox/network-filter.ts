import type { SandboxPolicy } from "./policies.js";
import type { ValidationResult } from "./path-validator.js";

export const PACKAGE_MANAGER_DOMAINS = [
  "registry.npmjs.org",
  "pypi.org",
  "proxy.golang.org",
  "plugins.gradle.org",
  "repo.maven.apache.org",
  "crates.io",
] as const;

export const DOCUMENTATION_DOMAINS = [
  "docs.python.org",
  "developer.mozilla.org",
  "pkg.go.dev",
  "docs.oracle.com",
  "react.dev",
  "nodejs.org",
  "bun.sh",
] as const;

export class NetworkFilter {
  private readonly _policy: SandboxPolicy;

  constructor({ policy }: { policy: SandboxPolicy }) {
    this._policy = policy;
  }

  validateUrl(url: string): ValidationResult {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { allowed: false, reason: `Invalid URL: ${url}` };
    }
    if (this._policy.canAccess(hostname)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Network access denied: ${hostname}` };
  }

  validateDomain(domain: string): ValidationResult {
    if (this._policy.canAccess(domain)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Domain access denied: ${domain}` };
  }
}
