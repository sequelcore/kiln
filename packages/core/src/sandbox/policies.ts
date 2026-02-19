import { resolve } from "node:path";
import type { SandboxConfig } from "./index.js";

/** Predefined sandbox configs per agent role. */
export const ROLE_PRESETS: Record<string, SandboxConfig> = {
  architect: {
    fsPolicy: "read-only",
    netPolicy: "documentation",
    allowedPaths: [],
    deniedPaths: [],
    allowedDomains: ["*"],
  },
  worker: {
    fsPolicy: "read-write",
    netPolicy: "package-managers",
    allowedPaths: [],
    deniedPaths: [
      "/etc",
      "/usr",
      "/bin",
      "/sbin",
      "/var",
      "C:\\Windows",
      "C:\\Program Files",
    ],
    allowedDomains: [
      "registry.npmjs.org",
      "pypi.org",
      "proxy.golang.org",
      "plugins.gradle.org",
      "repo.maven.apache.org",
    ],
  },
  optimizer: {
    fsPolicy: "read-only",
    netPolicy: "none",
    allowedPaths: [],
    deniedPaths: [],
    allowedDomains: [],
  },
  researcher: {
    fsPolicy: "read-only",
    netPolicy: "full",
    allowedPaths: [],
    deniedPaths: [],
    allowedDomains: ["*"],
  },
};

export class SandboxPolicy {
  private readonly _config: SandboxConfig;
  private readonly _projectPath: string;
  private readonly _resolvedAllowedPaths: readonly string[];
  private readonly _resolvedDeniedPaths: readonly string[];

  constructor({
    config,
    projectPath,
  }: {
    config: SandboxConfig;
    projectPath: string;
  }) {
    this._config = config;
    this._projectPath = projectPath;

    // Default allowedPaths to project dir for read-write policies
    const allowed =
      config.allowedPaths.length === 0 && config.fsPolicy === "read-write"
        ? [resolve(projectPath)]
        : config.allowedPaths.map((p) => resolve(p));

    this._resolvedAllowedPaths = allowed;
    this._resolvedDeniedPaths = config.deniedPaths.map((p) => resolve(p));
  }

  canRead(filePath: string): boolean {
    if (this._config.fsPolicy === "none") return false;

    const resolved = resolve(filePath);

    // Find the most specific (longest) matching allowed and denied paths
    const matchedAllow = this._resolvedAllowedPaths
      .filter((a) => resolved.startsWith(a))
      .reduce<string | null>((best, a) => (best === null || a.length > best.length ? a : best), null);

    const matchedDeny = this._resolvedDeniedPaths
      .filter((d) => resolved.startsWith(d))
      .reduce<string | null>((best, d) => (best === null || d.length > best.length ? d : best), null);

    if (matchedAllow !== null && matchedDeny !== null) {
      // Most specific rule wins
      return matchedAllow.length >= matchedDeny.length;
    }

    if (matchedDeny !== null) return false;

    if (this._resolvedAllowedPaths.length > 0) {
      return matchedAllow !== null;
    }

    return true;
  }

  canWrite(filePath: string): boolean {
    if (this._config.fsPolicy !== "read-write") return false;

    const resolved = resolve(filePath);

    // Find the most specific (longest) matching allowed and denied paths
    const matchedAllow = this._resolvedAllowedPaths
      .filter((a) => resolved.startsWith(a))
      .reduce<string | null>((best, a) => (best === null || a.length > best.length ? a : best), null);

    const matchedDeny = this._resolvedDeniedPaths
      .filter((d) => resolved.startsWith(d))
      .reduce<string | null>((best, d) => (best === null || d.length > best.length ? d : best), null);

    if (matchedAllow !== null && matchedDeny !== null) {
      // Most specific rule wins
      return matchedAllow.length >= matchedDeny.length;
    }

    if (matchedDeny !== null) return false;

    if (this._resolvedAllowedPaths.length > 0) {
      return matchedAllow !== null;
    }

    return true;
  }

  canAccess(domain: string): boolean {
    if (this._config.netPolicy === "none") return false;
    if (this._config.netPolicy === "full") return true;
    if (this._config.allowedDomains.includes("*")) return true;

    return this._config.allowedDomains.some(
      (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
    );
  }

  get config(): SandboxConfig {
    return this._config;
  }

  get projectPath(): string {
    return this._projectPath;
  }

  toJSON(): {
    config: SandboxConfig;
    projectPath: string;
    resolvedAllowedPaths: readonly string[];
    resolvedDeniedPaths: readonly string[];
  } {
    return {
      config: this._config,
      projectPath: this._projectPath,
      resolvedAllowedPaths: this._resolvedAllowedPaths,
      resolvedDeniedPaths: this._resolvedDeniedPaths,
    };
  }
}

export function createPolicy(
  role: string,
  projectPath: string,
  overrides?: Partial<SandboxConfig>,
): SandboxPolicy {
  const preset = ROLE_PRESETS[role] ?? ROLE_PRESETS["worker"]!;
  const config: SandboxConfig = {
    fsPolicy: overrides?.fsPolicy ?? preset.fsPolicy,
    netPolicy: overrides?.netPolicy ?? preset.netPolicy,
    allowedPaths: overrides?.allowedPaths ?? preset.allowedPaths,
    deniedPaths: overrides?.deniedPaths ?? preset.deniedPaths,
    allowedDomains: overrides?.allowedDomains ?? preset.allowedDomains,
  };
  return new SandboxPolicy({ config, projectPath });
}

/**
 * Create a tenant-scoped filesystem jail.
 * The tenant is allowed read-write access only within `<basePath>/tenants/<tenantId>`.
 * Access to other tenant directories is blocked because only the tenant's own dir is in allowedPaths.
 * The parent `<basePath>/tenants` is explicitly denied to block directory listing of all tenants.
 * Note: allowedPaths is checked after deniedPaths in SandboxPolicy -- so the tenant dir is placed in
 * allowedPaths and the parent-deny ensures other tenants are unreachable even if allowedPaths
 * matching were to fail. The tenant's own dir does NOT start-with a different tenant's allowed path,
 * so cross-tenant access is blocked by the allowedPaths whitelist.
 */
export function createTenantSandbox(
  tenantId: string,
  basePath: string,
  basePolicy?: SandboxConfig,
): SandboxConfig {
  const tenantDir = resolve(basePath, "tenants", tenantId);
  const tenantsRoot = resolve(basePath, "tenants");
  return {
    fsPolicy: "read-write",
    allowedPaths: [tenantDir],
    deniedPaths: [tenantsRoot],
    netPolicy: basePolicy?.netPolicy ?? "none",
    allowedDomains: basePolicy?.allowedDomains ?? [],
  };
}
