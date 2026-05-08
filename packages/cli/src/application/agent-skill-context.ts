import { homedir } from "node:os";
import { skillConfigToContextCandidate } from "@kilnai/core";
import type { ContextCandidate } from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import type { KilnAgentDefinition } from "./agent-loader.js";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { createConfiguredSkillRegistry } from "../config/skill-registry.js";

const AGENT_SKILL_CONTEXT_SCORE = 0.95;

export function withContextCandidates(
  appConfig: KilnAppConfig,
  contextCandidates: readonly ContextCandidate[],
): KilnAppConfig {
  if (contextCandidates.length === 0) {
    return appConfig;
  }

  return {
    ...appConfig,
    contextCandidates: [
      ...(appConfig.contextCandidates ?? []),
      ...contextCandidates,
    ],
  };
}

export function resolveAgentSkillContextCandidates(
  agent: KilnAgentDefinition | undefined,
  projectPath: string,
  userHome = homedir(),
  skillConfig?: KilnYamlSkillsConfig | null,
): readonly ContextCandidate[] {
  const requestedSkills = normalizeSkillNames(agent?.skills);
  if (!agent || requestedSkills.length === 0) {
    return [];
  }

  const registry = createConfiguredSkillRegistry({ projectPath, userHome, skillConfig });

  const resolved = registry.resolve(requestedSkills);
  const resolvedNames = new Set(resolved.map((skill) => skill.name));
  const missing = requestedSkills.filter((skill) => !resolvedNames.has(skill));
  if (missing.length > 0) {
    throw new Error(
      `Agent "${agent.name}" references unavailable skill(s): ${missing.join(", ")}`,
    );
  }

  return resolved.map((index) => {
    const skill = registry.load(index.name);
    if (!skill) {
      throw new Error(
        `Agent "${agent.name}" references skill "${index.name}", but the skill content could not be loaded.`,
      );
    }
    return skillConfigToContextCandidate(skill, {
      required: true,
      score: AGENT_SKILL_CONTEXT_SCORE,
    });
  });
}

function normalizeSkillNames(skills: readonly string[] | undefined): readonly string[] {
  if (!skills || skills.length === 0) {
    return [];
  }

  const unique = new Set<string>();
  for (const skill of skills) {
    const normalized = skill.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return [...unique];
}
