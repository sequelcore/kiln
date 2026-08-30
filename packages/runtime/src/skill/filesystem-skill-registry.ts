import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSkillMd,
  parseSkillMdIndex,
  type SkillConfig,
  type SkillIndex,
  SkillRegistry,
  type SkillRegistryOptions,
} from "@kilnai/core";

export type FilesystemSkillRegistryOptions = Pick<SkillRegistryOptions, "builtinSkills">;

export function readSkillMd(filePath: string): SkillConfig {
  return parseSkillMd(readFileSync(filePath, "utf8"), filePath);
}

export function readSkillMdIndex(filePath: string): SkillIndex {
  return parseSkillMdIndex(readFileSync(filePath, "utf8"), filePath);
}

export function createFilesystemSkillRegistry(options: FilesystemSkillRegistryOptions = {}): SkillRegistry {
  return new SkillRegistry({
    ...options,
    materializationPort: {
      materialize(index) {
        if (!index.filePath) return undefined;
        try {
          return { skill: readSkillMd(index.filePath), source: "filesystem" };
        } catch {
          return undefined;
        }
      },
    },
  });
}

export function discoverSkillsFromDirectories(registry: SkillRegistry, directories: readonly string[]): number {
  return directories.reduce((total, directory) => total + discoverSkillsFromDirectory(registry, directory), 0);
}

export function discoverSkillsFromDirectory(registry: SkillRegistry, directory: string): number {
  if (!existsSync(directory)) return 0;

  let loaded = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(directory, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const index = readSkillMdIndex(skillFile);
      if (!registry.get(index.name)) {
        registry.register(index);
        loaded += 1;
      }
    } catch {
      // Invalid packages are excluded from discovery.
    }
  }
  return loaded;
}
