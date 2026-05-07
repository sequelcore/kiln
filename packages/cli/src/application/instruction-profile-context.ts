import type { ContextCandidate } from "@kilnai/core";
import type { KilnGlobalConfig } from "../config/global-config.js";
import type { KilnYaml } from "../kiln-yaml-types.js";
import type { KilnAgentDefinition } from "./agent-loader.js";
import {
  findInstructionProfile,
  loadInstructionProfiles,
  type KilnInstructionDoctrineDefinition,
  type KilnInstructionProfileDefinition,
} from "./instruction-profile-loader.js";

const INSTRUCTION_PROFILE_SCORE = 0.98;

export interface ResolveInstructionProfileContextInput {
  readonly projectPath: string;
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly projectConfig?: KilnYaml | null;
  readonly agent?: Pick<KilnAgentDefinition, "name" | "instructionProfiles">;
  readonly userHome?: string;
}

export function resolveInstructionProfileContextCandidates(
  input: ResolveInstructionProfileContextInput,
): readonly ContextCandidate[] {
  const requested = selectedInstructionProfileIds(input);
  if (requested.length === 0) {
    return [];
  }

  const available = loadInstructionProfiles(input.projectPath, input.userHome);
  const candidates: ContextCandidate[] = [];
  const missing: string[] = [];

  for (const name of requested) {
    const profile = findInstructionProfile(available, name);
    if (!profile) {
      missing.push(name);
      continue;
    }
    candidates.push(instructionProfileToContextCandidate(profile));
  }

  if (missing.length > 0) {
    const owner = input.agent ? `Agent "${input.agent.name}"` : "Configured session";
    throw new Error(`${owner} references unavailable instruction profile(s): ${missing.join(", ")}`);
  }

  return candidates;
}

export function instructionProfileToContextCandidate(
  profile: KilnInstructionProfileDefinition,
): ContextCandidate {
  return {
    kind: "instruction",
    source: `instruction-profile:${profile.filePath}`,
    required: true,
    score: INSTRUCTION_PROFILE_SCORE,
    content: [
      "Instruction Profile",
      `name: ${profile.name}`,
      profile.displayName ? `displayName: ${profile.displayName}` : undefined,
      profile.description ? `description: ${profile.description}` : undefined,
      `scope: ${profile.scope}`,
      profile.tags && profile.tags.length > 0 ? `tags: ${profile.tags.join(", ")}` : undefined,
      profile.doctrine ? formatDoctrine(profile.doctrine) : undefined,
      "instructions:",
      profile.instructions,
    ].filter((line): line is string => line !== undefined).join("\n"),
  };
}

function formatDoctrine(doctrine: KilnInstructionDoctrineDefinition): string {
  return [
    "doctrine:",
    ...formatDoctrineList("principles", doctrine.principles),
    ...formatDoctrineList("workflow", doctrine.workflow),
    ...formatDoctrineList("qualityGates", doctrine.qualityGates),
    ...formatDoctrineList("reviewPosture", doctrine.reviewPosture),
    ...formatDoctrineList("delegation", doctrine.delegation),
  ].join("\n");
}

function formatDoctrineList(label: string, values: readonly string[] | undefined): readonly string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return [
    `${label}:`,
    ...values.map((value) => `- ${value}`),
  ];
}

function selectedInstructionProfileIds(
  input: ResolveInstructionProfileContextInput,
): readonly string[] {
  return unique([
    ...(input.globalConfig?.activeInstructionProfiles ?? []),
    ...(input.projectConfig?.activeInstructionProfiles ?? []),
    ...(input.agent?.instructionProfiles ?? []),
  ]);
}

function unique(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }
  return [...seen];
}
