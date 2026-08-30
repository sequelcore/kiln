import type { DomainConfig } from "./index.js";
import { mergeDomainConfigs } from "./index.js";
import { parseDomainYaml } from "./yaml-parser.js";

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
  /** Explicit installed-domain catalog directory supplied by composition. */
  readonly domainsDir?: string;
  /** Host discovery supplied by Runtime; absent Core registries remain pure and in-memory. */
  readonly discovery?: DomainDiscoveryPort;
}

export interface DomainYamlSource {
  readonly filePath: string;
  readonly content: string;
}

export interface DomainDiscoveryPort {
  exists(projectPath: string, relativePath: string): boolean;
  readYamlFiles(directory: string): readonly DomainYamlSource[];
}

export class DomainRegistry {
  private readonly configs = new Map<string, DomainConfig>();
  private readonly domainsDir?: string;
  private readonly discovery?: DomainDiscoveryPort;

  constructor(options?: DomainRegistryOptions) {
    this.domainsDir = options?.domainsDir;
    this.discovery = options?.discovery;
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
        return this.discovery?.exists(projectPath, pattern) === true;
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

  /** Load installed domain YAML files from an explicit catalog directory. */
  loadInstalledDomains(domainsDir = this.domainsDir): number {
    if (!domainsDir) return 0;
    if (!this.discovery) return 0;

    let loaded = 0;
    for (const source of this.discovery.readYamlFiles(domainsDir)) {
      try {
        const config = parseDomainYaml(source.content, source.filePath);
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

  get(name: string): DomainConfig | undefined {
    return this.configs.get(name);
  }

  all(): DomainConfig[] {
    return [...this.configs.values()];
  }

}
