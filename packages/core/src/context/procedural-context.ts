import type { SkillConfig } from "../skill/types.js";
import type { ContextCandidate } from "./projected-context.js";

export interface ProceduralContextCandidateOptions {
  readonly score?: number;
  readonly required?: boolean;
}

const DEFAULT_PROCEDURAL_CONTEXT_SCORE = 0.7;

export function skillConfigToContextCandidate(
  skill: SkillConfig,
  options?: ProceduralContextCandidateOptions,
): ContextCandidate {
  const content = [
    "Skill",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    skill.tools.length > 0 ? `tools: ${skill.tools.join(", ")}` : undefined,
    skill.tags.length > 0 ? `tags: ${skill.tags.join(", ")}` : undefined,
    "instructions:",
    skill.instructions,
  ].filter((line): line is string => line !== undefined).join("\n");

  return {
    kind: "procedural",
    source: `runtime-skill:${skill.filePath}`,
    content,
    score: options?.score ?? DEFAULT_PROCEDURAL_CONTEXT_SCORE,
    required: options?.required ?? false,
  };
}
