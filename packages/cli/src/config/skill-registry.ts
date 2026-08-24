import { join } from "node:path";
import {
  resolveKilnCoreBuiltinSkills,
  SkillRegistry,
} from "@kilnai/core";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { resolveSkillVisibility } from "./skill-visibility.js";
import {
  type ProjectStateBinding,
  type ProjectStateRootOptions,
  resolveProjectStateBinding,
} from "../application/project-state-root.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveKilnHomePath } from "./global-config/path.js";

export interface ConfiguredSkillRegistryOptions extends ProjectStateRootOptions {
  readonly projectPath: string;
  readonly userHome?: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
  /** Explicit private project catalog directory supplied by composition. */
  readonly projectSkillsDirectory?: string;
  /** Explicit global catalog directory; defaults to the canonical Kiln home. */
  readonly globalSkillsDirectory?: string;
  /** Already-established private project binding. */
  readonly projectStateBinding?: ProjectStateBinding;
}

export function createConfiguredSkillRegistry(
  options: ConfiguredSkillRegistryOptions,
): SkillRegistry {
  const registry = new SkillRegistry();
  const projectSkillsDirectory = options.projectSkillsDirectory
    ?? options.projectStateBinding?.skillsPath
    ?? resolvePrivateProjectSkillsDirectory(options.projectPath, options);
  const globalSkillsDirectory = options.globalSkillsDirectory
    ?? join(resolveConfiguredKilnHome(options), "skills");
  registry.discoverAll(projectSkillsDirectory, globalSkillsDirectory);
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

function resolvePrivateProjectSkillsDirectory(
  projectPath: string,
  options: ConfiguredSkillRegistryOptions,
): string {
  const projectRoot = resolveProjectRoot({
    explicitPath: projectPath,
    ...(options.userHome ? { userHome: options.userHome } : {}),
  }).rootPath;
  const kilnHome = options.kilnHome
    ?? (options.userHome ? join(options.userHome, ".kiln") : undefined);
  return resolveProjectStateBinding(projectRoot, {
    ...(kilnHome ? { kilnHome } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
  }).skillsPath;
}

function resolveConfiguredKilnHome(options: ConfiguredSkillRegistryOptions): string {
  if (options.kilnHome) return options.kilnHome;
  if (options.userHome) return join(options.userHome, ".kiln");
  return resolveKilnHomePath();
}
