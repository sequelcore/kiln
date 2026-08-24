import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { dirname } from "node:path";
import {
  estimateTextTokens,
  inspectSkillPackage,
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
  /** Explicit private project catalog directory supplied by CLI composition. */
  readonly projectSkillsDirectory?: string;
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
  readonly projectionEvidence: TaskSkillProjectionEvidence;
}

export interface TaskSkillProjectionSelectionEvidence {
  readonly skillName: string;
  readonly selectionReason: "explicit" | "auto";
  readonly materializationSource: "memory-cache" | "filesystem";
  readonly metadataBytes: number;
  readonly contextBytes: number;
  readonly contextTokens: number;
}

export interface TaskSkillProjectionEvidence {
  readonly policyId: "progressive-skill-projection-v1";
  readonly selectionHash: string;
  readonly catalogSkillCount: number;
  readonly selectedSkillCount: number;
  readonly deferredSkillCount: number;
  readonly catalogMetadataBytes: number;
  readonly selectedContextBytes: number;
  readonly selectedContextTokens: number;
  readonly avoidedSourceBytes: number;
  readonly selections: readonly TaskSkillProjectionSelectionEvidence[];
}

export function resolveTaskSkillSelection(input: TaskSkillSelectionInput): TaskSkillSelectionResult {
  const explicitSkillNames = normalizeSkillNames(input.explicitSkills);
  const autoRecommendedSkillNames = resolveAutoRecommendedSkills(input);
  const registry = createConfiguredSkillRegistry({
    projectPath: input.projectPath,
    ...(input.projectSkillsDirectory ? { projectSkillsDirectory: input.projectSkillsDirectory } : {}),
    ...(input.userHome ? { userHome: input.userHome } : {}),
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
  for (const skill of explicitResolved) assertSkillHealthy(skill.filePath, skill.name, input.requesterLabel);

  const autoCandidates = registry.resolve(autoRecommendedSkillNames);
  const autoResolved = autoCandidates.filter((skill) => skillHealth(skill.filePath).status !== "blocked");
  const autoResolvedNames = new Set(autoResolved.map((skill) => skill.name));
  const unavailableAutoSkillNames = autoRecommendedSkillNames.filter((skill) => !autoResolvedNames.has(skill));
  const skillNames = unique([
    ...explicitResolved.map((skill) => skill.name),
    ...autoResolved.map((skill) => skill.name),
  ]);

  const explicitNameSet = new Set(explicitResolved.map((skill) => skill.name));
  const catalog = registry.all();
  const catalogMetadata = new Map(catalog.map((skill) => [skill.name, renderSkillMetadata(skill)] as const));
  const contextCandidates: ContextCandidate[] = [];
  const selections: TaskSkillProjectionSelectionEvidence[] = [];
  for (const name of skillNames) {
    const materialized = registry.loadWithEvidence(name);
    if (!materialized) {
      throw new Error(
        `${input.requesterLabel} references skill "${name}", but the skill content could not be loaded.`,
      );
    }
    const candidate = skillConfigToContextCandidate(materialized.skill, {
      required: true,
      score: SKILL_CONTEXT_SCORE,
    });
    contextCandidates.push(candidate);
    const metadata = catalogMetadata.get(name) ?? "";
    selections.push({
      skillName: name,
      selectionReason: explicitNameSet.has(name) ? "explicit" : "auto",
      materializationSource: materialized.source,
      metadataBytes: Buffer.byteLength(metadata, "utf8"),
      contextBytes: Buffer.byteLength(candidate.content, "utf8"),
      contextTokens: estimateTextTokens(candidate.content),
    });
  }

  const selectedNameSet = new Set(skillNames);
  const projectionEvidence = buildProjectionEvidence(catalog, catalogMetadata, selections, selectedNameSet);

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
    projectionEvidence,
  };
}

function assertSkillHealthy(filePath: string, name: string, requesterLabel: string): void {
  const health = skillHealth(filePath);
  if (health.status !== "blocked") return;
  const reasons = [
    ...health.brokenResources.map((entry) => `${entry.reason} resource ${entry.target}`),
    ...health.diagnostics.map((entry) => entry.code),
  ];
  throw new Error(`${requesterLabel} references blocked skill "${name}": ${reasons.join(", ") || "package health failed"}`);
}

function skillHealth(filePath: string): ReturnType<typeof inspectSkillPackage> {
  if (filePath.startsWith("builtin://")) return { status: "healthy", fileCount: 1, packageBytes: 0, brokenResources: [], riskSignals: [], diagnostics: [] };
  return inspectSkillPackage(dirname(filePath));
}

function buildProjectionEvidence(
  catalog: readonly { readonly name: string; readonly filePath: string }[],
  metadata: ReadonlyMap<string, string>,
  selections: readonly TaskSkillProjectionSelectionEvidence[],
  selectedNames: ReadonlySet<string>,
): TaskSkillProjectionEvidence {
  const catalogMetadataBytes = [...metadata.values()].reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0);
  const avoidedSourceBytes = catalog
    .filter((skill) => !selectedNames.has(skill.name))
    .reduce((total, skill) => total + sourceBytes(skill.filePath, metadata.get(skill.name) ?? ""), 0);
  const selectedContextBytes = selections.reduce((total, selection) => total + selection.contextBytes, 0);
  const selectedContextTokens = selections.reduce((total, selection) => total + selection.contextTokens, 0);
  const selectionHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(selections.map(({ skillName, selectionReason }) => ({ skillName, selectionReason }))))
    .digest("hex")}`;
  return {
    policyId: "progressive-skill-projection-v1",
    selectionHash,
    catalogSkillCount: catalog.length,
    selectedSkillCount: selections.length,
    deferredSkillCount: Math.max(0, catalog.length - selections.length),
    catalogMetadataBytes,
    selectedContextBytes,
    selectedContextTokens,
    avoidedSourceBytes,
    selections,
  };
}

function renderSkillMetadata(skill: {
  readonly name: string;
  readonly description?: string;
  readonly tools?: readonly string[];
  readonly tags?: readonly string[];
}): string {
  return JSON.stringify({
    name: skill.name,
    description: skill.description ?? "",
    tools: skill.tools ?? [],
    tags: skill.tags ?? [],
  });
}

function sourceBytes(filePath: string, fallbackMetadata: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return Buffer.byteLength(fallbackMetadata, "utf8");
  }
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
