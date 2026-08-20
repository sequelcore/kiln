import type {
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceEvidence,
  KilnWorkGovernanceTrigger,
} from "../kiln-yaml-types.js";

export interface WorkGovernanceAssessmentInput {
  readonly summary: string;
  readonly triggers?: readonly KilnWorkGovernanceTrigger[];
}

export interface WorkGovernanceAssessment {
  readonly recommendation: "direct" | "orchestrate";
  readonly reasons: readonly string[];
  readonly triggers: readonly KilnWorkGovernanceTrigger[];
  readonly requiredEvidence: readonly KilnWorkGovernanceEvidence[];
}

export function assessWorkGovernance(
  config: KilnWorkGovernanceConfig | undefined,
  input: WorkGovernanceAssessmentInput,
): WorkGovernanceAssessment {
  const triggers = unique(input.triggers ?? []);
  const reasons: string[] = [];

  if ((config?.defaultPosture ?? "direct") === "orchestrate") {
    reasons.push("default posture is orchestrate");
  }

  const matchedDelegationTriggers = triggers.filter((trigger) =>
    (config?.requireDelegationFor ?? []).includes(trigger));
  if (matchedDelegationTriggers.length > 0) {
    reasons.push(`delegation trigger matched: ${matchedDelegationTriggers.join(", ")}`);
  }

  const shouldOrchestrate = reasons.length > 0;
  return {
    recommendation: shouldOrchestrate ? "orchestrate" : "direct",
    reasons: shouldOrchestrate ? reasons : ["no configured coordination trigger matched"],
    triggers,
    requiredEvidence: requiredEvidenceFor(config, triggers),
  };
}

function requiredEvidenceFor(
  config: KilnWorkGovernanceConfig | undefined,
  triggers: readonly KilnWorkGovernanceTrigger[],
): readonly KilnWorkGovernanceEvidence[] {
  const evidence = new Set<KilnWorkGovernanceEvidence>(config?.requiredEvidence ?? []);
  if (triggers.includes("ui")) {
    evidence.add("visual-reference-research");
    evidence.add("browser-qa");
  }
  if (triggers.includes("formal-proof-candidate")) evidence.add("formal-proof");
  return [...evidence];
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
