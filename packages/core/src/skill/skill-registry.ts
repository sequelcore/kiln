import type { SkillIndex, SkillConfig } from "./types.js";

export interface SkillRegistryOptions {
  readonly builtinSkills?: readonly SkillConfig[];
  readonly materializationPort?: SkillMaterializationPort;
}

export type SkillMaterializationSource = "memory-cache" | "filesystem";

export interface SkillMaterializationResult {
  readonly skill: SkillConfig;
  readonly source: SkillMaterializationSource;
}

export interface SkillMaterializationPort {
  materialize(index: SkillIndex): SkillMaterializationResult | undefined;
}

export class SkillRegistry {
  private readonly indexes = new Map<string, SkillIndex>();
  private readonly fullCache = new Map<string, SkillConfig>();
  private readonly materializationPort?: SkillMaterializationPort;

  constructor(options?: SkillRegistryOptions) {
    this.materializationPort = options?.materializationPort;
    if (options?.builtinSkills) {
      for (const skill of options.builtinSkills) {
        this.registerFull(skill);
      }
    }
  }

  /** Register a skill index. First-registered wins. */
  register(index: SkillIndex): void {
    if (!this.indexes.has(index.name)) {
      this.indexes.set(index.name, index);
    }
  }

  /** Register a full SkillConfig (for builtins or programmatic use). Stores index + caches full config. */
  registerFull(config: SkillConfig): void {
    if (!this.indexes.has(config.name)) {
      this.indexes.set(config.name, config);
      this.fullCache.set(config.name, config);
    }
  }

  get(name: string): SkillIndex | undefined {
    return this.indexes.get(name);
  }

  all(): SkillIndex[] {
    return [...this.indexes.values()];
  }

  /** Remove a configured skill from discovery and materialization. */
  remove(name: string): boolean {
    this.fullCache.delete(name);
    return this.indexes.delete(name);
  }

  /** Load full SkillConfig on demand. Reads file from disk if not already cached. */
  load(name: string): SkillConfig | undefined {
    return this.loadWithEvidence(name)?.skill;
  }

  /** Load one exact skill and report whether its full body came from cache or disk. */
  loadWithEvidence(name: string): SkillMaterializationResult | undefined {
    const cached = this.fullCache.get(name);
    if (cached) return { skill: cached, source: "memory-cache" };

    const index = this.indexes.get(name);
    if (!index) return undefined;

    const materialized = this.materializationPort?.materialize(index);
    if (!materialized) return undefined;
    this.fullCache.set(name, materialized.skill);
    return materialized;
  }

  /** Resolve skills matching any of the given names or tags. */
  resolve(names?: readonly string[], tags?: readonly string[]): SkillIndex[] {
    if (!names?.length && !tags?.length) return [];

    const nameSet = names ? new Set(names) : undefined;
    const tagSet = tags ? new Set(tags) : undefined;
    const results: SkillIndex[] = [];

    for (const index of this.indexes.values()) {
      if (nameSet?.has(index.name)) {
        results.push(index);
        continue;
      }
      if (tagSet && index.tags.some((t) => tagSet.has(t))) {
        results.push(index);
      }
    }

    return results;
  }

}
