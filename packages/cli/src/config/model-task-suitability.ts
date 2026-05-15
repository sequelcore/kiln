import {
  ModelCapabilityRegistry,
  type ModelTaskSuitability,
  type ModelTaskSuitabilityEvidence,
  type ModelTaskSuitabilityTask,
} from "@kilnai/core";
import type { KilnModelTaskSuitabilityOverride } from "../kiln-yaml-types.js";

const MODEL_CAPABILITIES = new ModelCapabilityRegistry();

export function resolveConfiguredModelTaskSuitability(
  input: {
    readonly provider: string;
    readonly model: string;
    readonly overrides?: readonly KilnModelTaskSuitabilityOverride[];
    readonly liveProof?: ModelTaskSuitabilityEvidence;
  },
): readonly ModelTaskSuitability[] {
  const merged = new Map<ModelTaskSuitabilityTask, ModelTaskSuitability>();
  for (const entry of MODEL_CAPABILITIES.taskSuitability(input.provider, input.model)) {
    merged.set(entry.task, appendSuitabilityEvidence(entry, input.liveProof));
  }
  for (const override of input.overrides ?? []) {
    if (override.provider !== input.provider || override.model !== input.model) {
      continue;
    }
    const existing = merged.get(override.task);
    merged.set(override.task, {
      task: override.task,
      level: override.level,
      source: "operator-override",
      reason: override.reason,
      ...(existing?.recommendedSkills ? { recommendedSkills: existing.recommendedSkills } : {}),
      evidence: [
        {
          source: "operator-override",
          status: "declared",
          summary: override.reason,
        },
        ...(input.liveProof ? [input.liveProof] : []),
      ],
    });
  }
  return [...merged.values()];
}

function appendSuitabilityEvidence(
  entry: ModelTaskSuitability,
  evidence: ModelTaskSuitabilityEvidence | undefined,
): ModelTaskSuitability {
  if (!evidence) {
    return entry;
  }
  return {
    ...entry,
    evidence: [...(entry.evidence ?? []), evidence],
  };
}
