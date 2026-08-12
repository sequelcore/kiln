import { homedir } from "node:os";
import {
  resolveKilnCoreBuiltinSkills,
  SkillRegistry,
} from "@kilnai/core";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { resolveSkillVisibility } from "./skill-visibility.js";

export interface ConfiguredSkillRegistryOptions {
  readonly projectPath: string;
  readonly userHome?: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
}

export function createConfiguredSkillRegistry(
  options: ConfiguredSkillRegistryOptions,
): SkillRegistry {
  const registry = new SkillRegistry();
  registry.discoverAll(options.projectPath, options.userHome ?? homedir());
  for (const skill of registry.all()) {
    if (resolveSkillVisibility(skill.name, options.skillConfig) === "disabled") {
      registry.remove(skill.name);
    }
  }
  for (const skill of resolveKilnCoreBuiltinSkills(options.skillConfig?.builtin)) {
    if (resolveSkillVisibility(skill.name, options.skillConfig) !== "disabled" && !registry.get(skill.name)) {
      registry.registerFull(skill);
    }
  }
  return registry;
}
