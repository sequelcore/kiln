import type {
  ManagedInvocationContextResolver,
  ManagedInvocationContextResolution,
} from "@kilnai/runtime";
import { join } from "node:path";
import type { ModelTaskSuitabilityTask } from "@kilnai/core";
import { findAgent, loadAgentDefinitions } from "../application/agent-loader.js";
import { resolveInstructionProfileContextCandidates } from "../application/instruction-profile-context.js";
import { readGlobalConfig } from "./global-config.js";
import type { KilnGlobalConfig } from "./global-config.js";
import { readKilnYamlFile } from "../kiln-yaml.js";
import type { KilnModelTaskSuitabilityOverride, KilnProjectConfig, KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { inferTargetTask } from "./execution-target-resolver.js";
import { resolveTaskSkillSelection } from "./task-skill-selection.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";

export function createManagedInvocationContextResolver(
  projectPath: string,
  userHome: string | undefined = undefined,
  config: {
    readonly globalConfig?: KilnGlobalConfig | null;
    readonly projectConfig?: KilnProjectConfig | null;
    readonly skillConfig?: KilnYamlSkillsConfig | null;
    readonly projectAgentsDirectory?: string;
    readonly projectSkillsDirectory?: string;
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
      const definitions = await loadAgentDefinitions(projectPath, {
        ...(userHome ? { userHome } : {}),
        ...(config.projectAgentsDirectory ? { projectAgentsDirectory: config.projectAgentsDirectory } : {}),
      });
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
      ...(config.projectSkillsDirectory ? { projectSkillsDirectory: config.projectSkillsDirectory } : {}),
      userHome,
      skillConfig: config.skillConfig,
      selection: config.skillConfig?.selection,
      task: inferTargetTask({
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
  userHome: string | undefined,
  agentInstructionProfiles: readonly string[],
  sections: string[],
  config: {
    readonly globalConfig?: KilnGlobalConfig | null;
    readonly projectConfig?: KilnProjectConfig | null;
  },
): readonly string[] {
  const binding = resolveProjectStateBinding(
    resolveProjectRoot({
      explicitPath: projectPath,
      ...(userHome ? { userHome } : {}),
    }).rootPath,
    userHome ? { kilnHome: join(userHome, ".kiln") } : {},
  );
  const candidates = resolveInstructionProfileContextCandidates({
    projectPath,
    userHome,
    globalConfig: config.globalConfig === undefined ? readGlobalConfig() : config.globalConfig,
    projectConfig: config.projectConfig === undefined ? readKilnYamlFile(binding.configPath) : config.projectConfig,
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
