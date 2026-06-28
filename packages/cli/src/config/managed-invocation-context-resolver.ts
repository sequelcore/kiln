import { homedir } from "node:os";
import type {
  ManagedInvocationContextResolver,
  ManagedInvocationContextResolution,
} from "@kilnai/runtime";
import type { ModelTaskSuitabilityTask } from "@kilnai/core";
import { findAgent, loadAgentDefinitions } from "../application/agent-loader.js";
import { resolveInstructionProfileContextCandidates } from "../application/instruction-profile-context.js";
import { readGlobalConfig } from "./global-config.js";
import type { KilnGlobalConfig } from "./global-config.js";
import { readKilnYaml } from "../kiln-yaml.js";
import type { KilnModelTaskSuitabilityOverride, KilnYaml, KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { join } from "node:path";
import { inferRouteTask } from "./provider-route-candidates.js";
import { resolveTaskSkillSelection } from "./task-skill-selection.js";

export function createManagedInvocationContextResolver(
  projectPath: string,
  userHome = homedir(),
  config: {
    readonly globalConfig?: KilnGlobalConfig | null;
    readonly projectConfig?: KilnYaml | null;
    readonly skillConfig?: KilnYamlSkillsConfig | null;
    readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  } = {},
): ManagedInvocationContextResolver {
  return async (input) => {
    if (input.contextMode === "fork") {
      throw new Error("Managed invocation fork context is not enabled for this surface.");
    }

    const sections: string[] = [];
    let admittedAgentProfile: string | undefined;
    let profileSkills: readonly string[] = [];
    let agentInstructionProfiles: readonly string[] = [];
    let agentTaskAffinity: readonly ModelTaskSuitabilityTask[] = [];
    let agentWorkClassification = input.workClassification;
    if (input.agentProfile) {
      const definitions = await loadAgentDefinitions(projectPath);
      const agent = findAgent(definitions, input.agentProfile);
      if (!agent) {
        throw new Error(`Managed invocation agent profile not found: ${input.agentProfile}`);
      }
      admittedAgentProfile = agent.name;
      profileSkills = agent.skills ?? [];
      agentInstructionProfiles = agent.instructionProfiles ?? [];
      agentTaskAffinity = agent.taskAffinity ?? [];
      agentWorkClassification = input.workClassification ?? agent.workClassification;
      sections.push([
        "## Child Agent Profile",
        `name: ${agent.name}`,
        agent.displayName ? `displayName: ${agent.displayName}` : undefined,
        agent.nicknameCandidates?.length ? `nicknameCandidates: ${agent.nicknameCandidates.join(", ")}` : undefined,
        `role: ${agent.role}`,
        agent.description ? `description: ${agent.description}` : undefined,
        agent.goal ? `goal: ${agent.goal}` : undefined,
        agent.backstory ? `backstory: ${agent.backstory}` : undefined,
        agent.tier ? `tier: ${agent.tier}` : undefined,
        agent.instructionProfiles?.length ? `instructionProfiles: ${agent.instructionProfiles.join(", ")}` : undefined,
        agent.instructions ? "instructions:" : undefined,
        agent.instructions,
      ].filter((line): line is string => Boolean(line)).join("\n"));
    }

    const admittedInstructionProfiles = resolveManagedInstructionProfiles(
      projectPath,
      userHome,
      agentInstructionProfiles,
      sections,
      config,
    );

    const skillSelection = resolveTaskSkillSelection({
      explicitSkills: unique([
        ...profileSkills,
        ...input.skills,
      ]),
      projectPath,
      userHome,
      skillConfig: config.skillConfig,
      selection: config.skillConfig?.selection,
      task: inferRouteTask({
        text: input.task,
        agentTaskAffinity,
      }),
      provider: input.providerRoute?.providerId,
      model: input.providerRoute?.model,
      taskSuitability: input.taskSuitability,
      modelTaskSuitability: config.modelTaskSuitability,
      workClassification: agentWorkClassification,
      requesterLabel: "Managed invocation",
    });
    for (const candidate of skillSelection.contextCandidates) {
      sections.push(candidate.content);
    }

    return {
      ...(sections.length > 0 ? { promptPrefix: sections.join("\n\n") } : {}),
      ...(admittedAgentProfile ? { admittedAgentProfile } : {}),
      ...(skillSelection.skillNames.length > 0 ? { admittedSkills: skillSelection.skillNames } : {}),
      ...(agentWorkClassification ? { workClassification: agentWorkClassification } : {}),
      ...(skillSelection.workRecommendedSkillNames.length > 0 ? { workRecommendedSkills: skillSelection.workRecommendedSkillNames } : {}),
      ...(skillSelection.workRecommendedSkillDiagnostics.length > 0 ? { workRecommendedSkillDiagnostics: skillSelection.workRecommendedSkillDiagnostics } : {}),
      ...(admittedInstructionProfiles.length > 0 ? { admittedInstructionProfiles } : {}),
    } satisfies ManagedInvocationContextResolution;
  };
}

function resolveManagedInstructionProfiles(
  projectPath: string,
  userHome: string,
  agentInstructionProfiles: readonly string[],
  sections: string[],
  config: {
    readonly globalConfig?: KilnGlobalConfig | null;
    readonly projectConfig?: KilnYaml | null;
  },
): readonly string[] {
  const candidates = resolveInstructionProfileContextCandidates({
    projectPath,
    userHome,
    globalConfig: config.globalConfig === undefined ? readGlobalConfig() : config.globalConfig,
    projectConfig: config.projectConfig === undefined ? readKilnYaml(join(projectPath, ".kiln")) : config.projectConfig,
    agent: agentInstructionProfiles.length > 0
      ? { name: "managed-child", instructionProfiles: agentInstructionProfiles }
      : undefined,
  });
  const admitted: string[] = [];
  for (const candidate of candidates) {
    const match = /^Instruction Profile\nname: ([^\n]+)/u.exec(candidate.content);
    if (match?.[1]) {
      admitted.push(match[1]);
    }
    sections.push(candidate.content);
  }
  return admitted;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
