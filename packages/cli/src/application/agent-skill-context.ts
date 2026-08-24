import type { ContextCandidate, ModelTaskSuitabilityTask } from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import type { KilnAgentDefinition } from "./agent-loader.js";
import type { KilnModelTaskSuitabilityOverride, KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { resolveTaskSkillSelection } from "../config/task-skill-selection.js";

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
  userHome: string | undefined = undefined,
  skillConfig?: KilnYamlSkillsConfig | null,
  taskSelection?: {
    readonly task?: ModelTaskSuitabilityTask;
    readonly provider?: string;
    readonly model?: string;
    readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  },
): readonly ContextCandidate[] {
  if (!agent && taskSelection?.task === undefined) {
    return [];
  }
  return resolveTaskSkillSelection({
    explicitSkills: agent?.skills,
    projectPath,
    ...(userHome ? { userHome } : {}),
    skillConfig,
    selection: skillConfig?.selection,
    task: taskSelection?.task,
    provider: taskSelection?.provider,
    model: taskSelection?.model,
    modelTaskSuitability: taskSelection?.modelTaskSuitability,
    requesterLabel: agent ? `Agent "${agent.name}"` : "Task skill selection",
  }).contextCandidates;
}
