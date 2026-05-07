import { homedir } from "node:os";
import { SkillRegistry, skillConfigToContextCandidate } from "@kilnai/core";
import type {
  ManagedInvocationContextResolver,
  ManagedInvocationContextResolution,
} from "@kilnai/runtime";
import { findAgent, loadAgentDefinitions } from "../application/agent-loader.js";

export function createManagedInvocationContextResolver(
  projectPath: string,
  userHome = homedir(),
): ManagedInvocationContextResolver {
  return async (input) => {
    if (input.contextMode === "fork") {
      throw new Error("Managed invocation fork context is not enabled for this surface.");
    }

    const sections: string[] = [];
    let admittedAgentProfile: string | undefined;
    let profileSkills: readonly string[] = [];
    if (input.agentProfile) {
      const definitions = await loadAgentDefinitions(projectPath);
      const agent = findAgent(definitions, input.agentProfile);
      if (!agent) {
        throw new Error(`Managed invocation agent profile not found: ${input.agentProfile}`);
      }
      admittedAgentProfile = agent.name;
      profileSkills = agent.skills ?? [];
      sections.push([
        "## Child Agent Profile",
        `name: ${agent.name}`,
        `role: ${agent.role}`,
        agent.description ? `description: ${agent.description}` : undefined,
        agent.goal ? `goal: ${agent.goal}` : undefined,
        agent.backstory ? `backstory: ${agent.backstory}` : undefined,
        agent.tier ? `tier: ${agent.tier}` : undefined,
        agent.instructions ? "instructions:" : undefined,
        agent.instructions,
      ].filter((line): line is string => Boolean(line)).join("\n"));
    }

    const admittedSkills = resolveManagedInvocationSkills(
      unique([
        ...profileSkills,
        ...input.skills,
      ]),
      projectPath,
      userHome,
      sections,
    );

    return {
      ...(sections.length > 0 ? { promptPrefix: sections.join("\n\n") } : {}),
      ...(admittedAgentProfile ? { admittedAgentProfile } : {}),
      ...(admittedSkills.length > 0 ? { admittedSkills } : {}),
    } satisfies ManagedInvocationContextResolution;
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function resolveManagedInvocationSkills(
  skills: readonly string[],
  projectPath: string,
  userHome: string,
  sections: string[],
): readonly string[] {
  if (skills.length === 0) {
    return [];
  }

  const registry = new SkillRegistry();
  registry.discoverAll(projectPath, userHome);
  const resolved = registry.resolve(skills);
  const resolvedNames = new Set(resolved.map((skill) => skill.name));
  const missing = skills.filter((skill) => !resolvedNames.has(skill));
  if (missing.length > 0) {
    throw new Error(`Managed invocation skill(s) not found: ${missing.join(", ")}`);
  }

  const admittedSkills: string[] = [];
  for (const index of resolved) {
    const skill = registry.load(index.name);
    if (!skill) {
      throw new Error(`Managed invocation skill could not be loaded: ${index.name}`);
    }
    admittedSkills.push(skill.name);
    sections.push(skillConfigToContextCandidate(skill, {
      required: true,
      score: 0.95,
    }).content);
  }
  return admittedSkills;
}
