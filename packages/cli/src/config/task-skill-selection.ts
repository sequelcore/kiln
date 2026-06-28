import { homedir } from "node:os";
import {
  skillConfigToContextCandidate,
  type ContextCandidate,
  type ModelTaskSuitability,
  type ModelTaskSuitabilityTask,
  type WorkClassification,
  type WorkRecommendedSkillDiagnostic,
  recommendedSkillsForWorkClassification,
} from "@kilnai/core";
import type {
  KilnModelTaskSuitabilityOverride,
  KilnYamlSkillSelectionConfig,
  KilnYamlSkillsConfig,
} from "../kiln-yaml-types.js";
import { createConfiguredSkillRegistry } from "./skill-registry.js";
import { resolveConfiguredModelTaskSuitability } from "./model-task-suitability.js";

const SKILL_CONTEXT_SCORE = 0.95;

export interface TaskSkillSelectionInput {
  readonly explicitSkills?: readonly string[];
  readonly projectPath: string;
  readonly userHome?: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
  readonly selection?: KilnYamlSkillSelectionConfig | null;
  readonly task?: ModelTaskSuitabilityTask;
  readonly provider?: string;
  readonly model?: string;
  readonly taskSuitability?: readonly ModelTaskSuitability[];
  readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  readonly workClassification?: WorkClassification;
  readonly requesterLabel: string;
}

export interface TaskSkillSelectionResult {
  readonly skillNames: readonly string[];
  readonly explicitSkillNames: readonly string[];
  readonly autoSkillNames: readonly string[];
  readonly workRecommendedSkillNames: readonly string[];
  readonly workRecommendedSkillDiagnostics: readonly WorkRecommendedSkillDiagnostic[];
  readonly unavailableAutoSkillNames: readonly string[];
  readonly contextCandidates: readonly ContextCandidate[];
}

export function resolveTaskSkillSelection(input: TaskSkillSelectionInput): TaskSkillSelectionResult {
  const explicitSkillNames = normalizeSkillNames(input.explicitSkills);
  const autoRecommendedSkillNames = resolveAutoRecommendedSkills(input);
  const registry = createConfiguredSkillRegistry({
    projectPath: input.projectPath,
    userHome: input.userHome ?? homedir(),
    skillConfig: input.skillConfig,
  });

  const explicitResolved = registry.resolve(explicitSkillNames);
  const explicitResolvedNames = new Set(explicitResolved.map((skill) => skill.name));
  const missingExplicit = explicitSkillNames.filter((skill) => !explicitResolvedNames.has(skill));
  if (missingExplicit.length > 0) {
    throw new Error(
      `${input.requesterLabel} references unavailable skill(s): ${missingExplicit.join(", ")}`,
    );
  }

  const autoResolved = registry.resolve(autoRecommendedSkillNames);
  const autoResolvedNames = new Set(autoResolved.map((skill) => skill.name));
  const unavailableAutoSkillNames = autoRecommendedSkillNames.filter((skill) => !autoResolvedNames.has(skill));
  const skillNames = unique([
    ...explicitResolved.map((skill) => skill.name),
    ...autoResolved.map((skill) => skill.name),
  ]);

  const contextCandidates = skillNames.map((name) => {
    const skill = registry.load(name);
    if (!skill) {
      throw new Error(
        `${input.requesterLabel} references skill "${name}", but the skill content could not be loaded.`,
      );
    }
    return skillConfigToContextCandidate(skill, {
      required: true,
      score: SKILL_CONTEXT_SCORE,
    });
  });

  return {
    skillNames,
    explicitSkillNames,
    autoSkillNames: autoResolved.map((skill) => skill.name),
    workRecommendedSkillNames: resolveWorkRecommendedSkills(input),
    workRecommendedSkillDiagnostics: resolveWorkRecommendedSkillDiagnostics({
      input,
      admittedSkillNames: skillNames,
      unavailableAutoSkillNames,
    }),
    unavailableAutoSkillNames,
    contextCandidates,
  };
}

function resolveWorkRecommendedSkillDiagnostics(input: {
  readonly input: TaskSkillSelectionInput;
  readonly admittedSkillNames: readonly string[];
  readonly unavailableAutoSkillNames: readonly string[];
}): readonly WorkRecommendedSkillDiagnostic[] {
  const admitted = new Set(input.admittedSkillNames);
  const unavailable = new Set(input.unavailableAutoSkillNames);
  return resolveWorkRecommendedSkills(input.input).map((skillName) => {
    if (admitted.has(skillName)) {
      return {
        skillName,
        state: "admitted",
        reason: "Recommended by work classification and admitted by auto selection.",
      };
    }
    if (unavailable.has(skillName)) {
      return {
        skillName,
        state: "unavailable",
        reason: "Recommended by work classification but not found in the governed Kiln registry.",
      };
    }
    return {
      skillName,
      state: "advisory",
      reason: "skills.selection.mode is advisory; recommendation was not auto-admitted.",
    };
  });
}

function resolveAutoRecommendedSkills(input: TaskSkillSelectionInput): readonly string[] {
  if (input.selection?.mode !== "auto") {
    return [];
  }
  return unique([
    ...resolveTaskRecommendedSkills(input),
    ...resolveWorkRecommendedSkills(input),
  ]);
}

function resolveTaskRecommendedSkills(input: TaskSkillSelectionInput): readonly string[] {
  if (!input.task) {
    return [];
  }
  const taskSuitability = (input.taskSuitability ?? resolveConfiguredTaskSuitability(input))
    .find((entry) => entry.task === input.task);
  return normalizeSkillNames(taskSuitability?.recommendedSkills);
}

function resolveWorkRecommendedSkills(input: TaskSkillSelectionInput): readonly string[] {
  return normalizeSkillNames(recommendedSkillsForWorkClassification(input.workClassification));
}

function resolveConfiguredTaskSuitability(input: TaskSkillSelectionInput): readonly ModelTaskSuitability[] {
  if (!input.provider || !input.model) {
    return [];
  }
  return resolveConfiguredModelTaskSuitability({
    provider: input.provider,
    model: input.model,
    overrides: input.modelTaskSuitability,
  });
}

function normalizeSkillNames(skills: readonly string[] | undefined): readonly string[] {
  if (!skills || skills.length === 0) {
    return [];
  }
  return unique(skills);
}

function unique(values: readonly string[]): readonly string[] {
  const uniqueValues = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length > 0) {
      uniqueValues.add(normalized);
    }
  }
  return [...uniqueValues];
}
