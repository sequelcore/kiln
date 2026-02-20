import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SkillConfig } from "./types.js";
import { loadSkillYaml } from "./yaml-parser.js";
import type { DomainPackageManifest } from "../package/types.js";

export interface SkillRegistryOptions {
  readonly builtinSkills?: readonly SkillConfig[];
}

export class SkillRegistry {
  private readonly skills = new Map<string, SkillConfig>();

  constructor(options?: SkillRegistryOptions) {
    if (options?.builtinSkills) {
      for (const skill of options.builtinSkills) {
        this.register(skill);
      }
    }
  }

  /** Register a skill. First-registered wins -- no overwrite. */
  register(skill: SkillConfig): void {
    if (!this.skills.has(skill.name)) {
      this.skills.set(skill.name, skill);
    }
  }

  get(name: string): SkillConfig | undefined {
    return this.skills.get(name);
  }

  all(): SkillConfig[] {
    return [...this.skills.values()];
  }

  /** Discover skills from a directory path. Returns number of skills loaded. */
  discoverFrom(dirPath: string): number {
    if (!existsSync(dirPath)) return 0;

    const files = readdirSync(dirPath).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );

    let loaded = 0;
    for (const file of files) {
      try {
        const skill = loadSkillYaml(join(dirPath, file));
        if (!this.skills.has(skill.name)) {
          this.skills.set(skill.name, skill);
          loaded++;
        }
      } catch {
        // Skip invalid files silently
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
      try {
        const skill = loadSkillYaml(fullPath);
        if (!this.skills.has(skill.name)) {
          this.skills.set(skill.name, skill);
          loaded++;
        }
      } catch {
        // Skip invalid skill files silently
      }
    }
    return loaded;
  }

  /**
   * Discover skills from 3-tier hierarchy:
   * 1. workspace: projectPath/.kiln/skills/
   * 2. user: userHome/.kiln/skills/
   * 3. builtin (passed via constructor)
   * Earlier tiers override later (workspace wins over user wins over builtin).
   */
  discoverAll(projectPath: string, userHome: string): number {
    const workspaceDir = join(projectPath, ".kiln", "skills");
    const userDir = join(userHome, ".kiln", "skills");

    let total = 0;
    total += this.discoverFrom(workspaceDir);
    total += this.discoverFrom(userDir);
    return total;
  }
}
