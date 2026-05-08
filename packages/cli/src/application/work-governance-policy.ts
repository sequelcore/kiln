import type {
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceEvidence,
  KilnWorkGovernanceRisk,
  KilnWorkGovernanceTrigger,
} from "../kiln-yaml-types.js";

export interface WorkGovernanceAssessmentInput {
  readonly summary: string;
  readonly estimatedFiles?: number;
  readonly risk?: KilnWorkGovernanceRisk;
  readonly triggers?: readonly KilnWorkGovernanceTrigger[];
}

export interface WorkGovernanceAssessment {
  readonly recommendation: "direct" | "orchestrate";
  readonly reasons: readonly string[];
  readonly triggers: readonly KilnWorkGovernanceTrigger[];
  readonly requiredEvidence: readonly KilnWorkGovernanceEvidence[];
}

const RISK_RANK: Record<KilnWorkGovernanceRisk, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function assessWorkGovernance(
  config: KilnWorkGovernanceConfig | undefined,
  input: WorkGovernanceAssessmentInput,
): WorkGovernanceAssessment {
  const triggers = unique(input.triggers ?? []);
  const reasons: string[] = [];
  const directExecution = config?.directExecution;

  if ((config?.defaultPosture ?? "direct") === "orchestrate") {
    reasons.push("default posture is orchestrate");
  }

  const matchedDelegationTriggers = triggers.filter((trigger) =>
    (config?.requireDelegationFor ?? []).includes(trigger));
  if (matchedDelegationTriggers.length > 0) {
    reasons.push(`delegation trigger matched: ${matchedDelegationTriggers.join(", ")}`);
  }

  if (
    directExecution?.maxFiles !== undefined
    && input.estimatedFiles !== undefined
    && input.estimatedFiles > directExecution.maxFiles
  ) {
    reasons.push(`estimated file count ${input.estimatedFiles} exceeds direct max ${directExecution.maxFiles}`);
  }

  if (
    directExecution?.maxRisk
    && input.risk
    && RISK_RANK[input.risk] > RISK_RANK[directExecution.maxRisk]
  ) {
    reasons.push(`risk ${input.risk} exceeds direct max ${directExecution.maxRisk}`);
  }

  const shouldOrchestrate = reasons.length > 0;
  return {
    recommendation: shouldOrchestrate ? "orchestrate" : "direct",
    reasons: shouldOrchestrate ? reasons : ["inside direct-execution envelope"],
    triggers,
    requiredEvidence: requiredEvidenceFor(config, triggers),
  };
}

function requiredEvidenceFor(
  config: KilnWorkGovernanceConfig | undefined,
  triggers: readonly KilnWorkGovernanceTrigger[],
): readonly KilnWorkGovernanceEvidence[] {
  const evidence = new Set<KilnWorkGovernanceEvidence>(config?.requiredEvidence ?? []);
  if (triggers.includes("ui")) evidence.add("browser-qa");
  if (
    triggers.includes("architecture")
    || triggers.includes("security")
    || triggers.includes("runtime")
    || triggers.includes("provider-routing")
    || triggers.includes("managed-agents")
  ) {
    evidence.add("managed-agent-review");
  }
  if (triggers.includes("formal-proof-candidate")) evidence.add("formal-proof");
  return [...evidence];
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
