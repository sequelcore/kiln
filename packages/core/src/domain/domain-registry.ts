import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DomainConfig } from "./index.js";
import { mergeDomainConfigs } from "./index.js";
import { loadDomainYaml } from "./yaml-parser.js";
import type { DomainPackageManifest } from "../package/types.js";
import { loadDomainPackageYaml } from "./marketplace.js";

const GENERIC_FALLBACK: DomainConfig = {
  name: "generic",
  displayName: "Generic",
  detectPatterns: [],
  toolTags: new Set<string>(),
  qualityGates: [],
  multishotExamples: "",
  phaseExamples: "",
};

/** Options for constructing a DomainRegistry */
export interface DomainRegistryOptions {
  /** Pre-registered domain configs (replaces hardcoded builtins) */
  readonly builtinConfigs?: readonly DomainConfig[];
  /** Relative path from project root for installed domains (default: ".kiln/domains") */
  readonly domainsDir?: string;
}

export class DomainRegistry {
  private readonly configs = new Map<string, DomainConfig>();
  private readonly domainsDir: string;

  constructor(options?: DomainRegistryOptions) {
    this.domainsDir = options?.domainsDir ?? join(".kiln", "domains");
    if (options?.builtinConfigs) {
      for (const config of options.builtinConfigs) {
        this.register(config);
      }
    }
  }

  register(config: DomainConfig): void {
    this.configs.set(config.name, config);
  }

  detect(projectPath: string): DomainConfig[] {
    const matched: DomainConfig[] = [];

    for (const config of this.configs.values()) {
      const hasMatch = config.detectPatterns.some((pattern) => {
        // Skip glob patterns -- only check exact filenames
        if (pattern.includes("*")) return false;
        return existsSync(join(projectPath, pattern));
      });

      if (hasMatch) {
        matched.push(config);
      }
    }

    return matched;
  }

  detectAndMerge(projectPath: string): DomainConfig {
    const detected = this.detect(projectPath);
    if (detected.length === 0) return GENERIC_FALLBACK;
    return mergeDomainConfigs(detected);
  }

  /** Load installed domain packages from the configured domains directory and register them */
  loadInstalledDomains(projectPath: string): number {
    const domainsDir = join(projectPath, this.domainsDir);
    if (!existsSync(domainsDir)) return 0;

    const files = readdirSync(domainsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );

    let loaded = 0;
    for (const file of files) {
      try {
        const config = loadDomainYaml(join(domainsDir, file));
        if (!this.configs.has(config.name)) {
          this.register(config);
          loaded++;
        }
      } catch {
        // Skip invalid files silently -- list command handles warnings
      }
    }
    return loaded;
  }

  /** Load installed domain packages and return full manifests */
  loadInstalledPackages(projectPath: string): DomainPackageManifest[] {
    const domainsDir = join(projectPath, this.domainsDir);
    if (!existsSync(domainsDir)) return [];

    const files = readdirSync(domainsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );

    const manifests: DomainPackageManifest[] = [];
    for (const file of files) {
      try {
        const manifest = loadDomainPackageYaml(join(domainsDir, file), domainsDir);
        manifests.push(manifest);
        if (!this.configs.has(manifest.config.name)) {
          this.register(manifest.config);
        }
      } catch {
        // Skip invalid files
      }
    }
    return manifests;
  }

  get(name: string): DomainConfig | undefined {
    return this.configs.get(name);
  }

  all(): DomainConfig[] {
    return [...this.configs.values()];
  }

  /** Load all built-in domain kits shipped with the package */
  static loadBuiltinDomains(): DomainConfig[] {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const domainsDir = join(currentDir, "..", "domains");

    if (!existsSync(domainsDir)) return [];

    const files = readdirSync(domainsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );

    const configs: DomainConfig[] = [];
    for (const file of files) {
      try {
        const config = loadDomainYaml(join(domainsDir, file));
        configs.push(config);
      } catch {
        // Skip invalid files silently
      }
    }
    return configs;
  }
}
