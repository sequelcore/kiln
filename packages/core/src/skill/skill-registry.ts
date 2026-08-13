import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SkillIndex, SkillConfig } from "./types.js";
import { loadSkillMdIndex, loadSkillMd } from "./md-parser.js";
import type { DomainPackageManifest } from "../package/types.js";

export interface SkillRegistryOptions {
  readonly builtinSkills?: readonly SkillConfig[];
}

export type SkillMaterializationSource = "memory-cache" | "filesystem";

export interface SkillMaterializationResult {
  readonly skill: SkillConfig;
  readonly source: SkillMaterializationSource;
}

export class SkillRegistry {
  private readonly indexes = new Map<string, SkillIndex>();
  private readonly fullCache = new Map<string, SkillConfig>();

  constructor(options?: SkillRegistryOptions) {
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
    if (!index?.filePath) return undefined;

    try {
      const config = loadSkillMd(index.filePath);
      this.fullCache.set(name, config);
      return { skill: config, source: "filesystem" };
    } catch {
      return undefined;
    }
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

  /** Discover SKILL.md files from a directory. Returns number of skills loaded. */
  discoverFrom(dirPath: string): number {
    if (!existsSync(dirPath)) return 0;

    const entries = readdirSync(dirPath, { withFileTypes: true });
    let loaded = 0;

    for (const entry of entries) {
      // Portable Agent Skills are complete directory packages containing SKILL.md.
      if (entry.isDirectory()) {
        const skillMdPath = join(dirPath, entry.name, "SKILL.md");
        if (existsSync(skillMdPath)) {
          loaded += this.tryLoadIndex(skillMdPath);
        }
      }
    }

    return loaded;
  }

  /** Discover skills from a domain package manifest. Returns number loaded. */
  discoverFromPackage(manifest: DomainPackageManifest): number {
    if (manifest.skills.length === 0) return 0;

    let loaded = 0;
    for (const skillPath of manifest.skills) {
      const fullPath = join(manifest.installPath, skillPath);
      loaded += this.tryLoadIndex(fullPath);
    }
    return loaded;
  }

  /**
   * Discover skills from 3-tier hierarchy:
   * 1. workspace: projectPath/.kiln/skills/
   * 2. user: userHome/.kiln/skills/
   * 3. builtin (passed via constructor)
   * Earlier tiers win (workspace > user > builtin).
   */
  discoverAll(projectPath: string, userHome: string): number {
    const workspaceDir = join(projectPath, ".kiln", "skills");
    const userDir = join(userHome, ".kiln", "skills");

    let total = 0;
    total += this.discoverFrom(workspaceDir);
    total += this.discoverFrom(userDir);
    return total;
  }

  private tryLoadIndex(filePath: string): number {
    try {
      const index = loadSkillMdIndex(filePath);
      if (!this.indexes.has(index.name)) {
        this.indexes.set(index.name, index);
        return 1;
      }
    } catch {
      // Skip invalid files silently
    }
    return 0;
  }
}
