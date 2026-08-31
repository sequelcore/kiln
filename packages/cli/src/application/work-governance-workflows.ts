import type {
  ManagedAgentAccess,
  ModelTaskSuitabilityTask,
} from "@kilnai/core";
import type {
  KilnWorkGovernanceEvidence,
  KilnWorkGovernanceRisk,
  KilnWorkGovernanceTrigger,
} from "../kiln-yaml-types.js";

export type WorkGovernanceWorkflowProfileId =
  | "small-fix"
  | "bug-diagnosis"
  | "architecture-review"
  | "architecture-change"
  | "ui-change"
  | "managed-agent-change"
  | "config-change"
  | "verification-heavy"
  | "formal-proof-candidate";

export interface WorkGovernanceWorkflowProfile {
  readonly id: WorkGovernanceWorkflowProfileId;
  readonly description: string;
  readonly triggers: readonly KilnWorkGovernanceTrigger[];
  readonly minimumRisk: KilnWorkGovernanceRisk;
  readonly recommendedTaskAffinities: readonly ModelTaskSuitabilityTask[];
  readonly defaultAccess: ManagedAgentAccess;
  readonly requiredEvidence: readonly KilnWorkGovernanceEvidence[];
}

export interface WorkGovernanceEvidenceMatrixEntry {
  readonly evidence: KilnWorkGovernanceEvidence;
  readonly verificationGates: readonly string[];
}

const PROFILE_EVIDENCE_GATE_MATRIX: Record<
  WorkGovernanceWorkflowProfileId,
  Partial<Record<KilnWorkGovernanceEvidence, readonly string[]>>
> = {
  "small-fix": {
    tests: ["focused test or explicit no-test rationale"],
    typecheck: ["typecheck when TypeScript is affected"],
    "residual-risk": ["residual-risk closeout when a gate is skipped or risk remains"],
  },
  "bug-diagnosis": {
    tests: ["failing test or reproduction before fix", "focused regression test"],
    typecheck: ["typecheck/build"],
    "residual-risk": ["residual-risk closeout when a gate is skipped or risk remains"],
  },
  "architecture-review": {
    "risk-hypothesis": ["evidence-grounded architecture/DDD review"],
    "residual-risk": ["residual-risk closeout when uncertainty or risk remains"],
  },
  "architecture-change": {
    plan: ["complexity disposition and architecture/DDD review"],
    tests: ["contract tests where behavior changes"],
    typecheck: ["typecheck/build"],
    "residual-risk": ["residual-risk closeout when a gate is skipped or risk remains"],
  },
  "ui-change": {
    "visual-reference-research": [
      "frontend-reference evidence before planning: running-product UI captures when available, or code-backed frontend implementation evidence when the reference has no public screenshots",
      "source URLs, relevant frontend file paths, and extracted reusable design principles; repository chrome, stars/forks/issues, and raw file listings alone do not count",
    ],
    "browser-qa": ["browser QA screenshot or interaction proof", "accessibility/overflow check"],
    typecheck: ["typecheck"],
    "residual-risk": ["residual-risk closeout when a gate is skipped or risk remains"],
  },
  "managed-agent-change": {
    "managed-agent-review": [
      "managed child live or simulated evidence",
      "route/provider identity check",
      "adversarial managed-agent review",
    ],
    typecheck: ["typecheck/build"],
    "residual-risk": ["residual-risk closeout when a gate is skipped or risk remains"],
  },
  "config-change": {
    tests: ["config parse/merge tests", "projection or sync diagnostic test"],
    typecheck: ["typecheck"],
    "residual-risk": ["residual-risk closeout when a gate is skipped or risk remains"],
  },
  "verification-heavy": {
    tests: ["failing proof or test first", "verification loop until no known blocker"],
    "residual-risk": ["residual-risk closeout when a gate is skipped or risk remains"],
  },
  "formal-proof-candidate": {
    spec: ["explicit invariant/spec review"],
    "formal-proof": ["deterministic proof/property-test result"],
    tests: ["deterministic proof/property-test result"],
    "residual-risk": ["residual-risk closeout"],
  },
};

export const WORK_GOVERNANCE_WORKFLOW_PROFILES: readonly WorkGovernanceWorkflowProfile[] = [
  {
    id: "small-fix",
    description: "Bounded correction with local verification.",
    triggers: [],
    minimumRisk: "low",
    recommendedTaskAffinities: ["mechanical-edit"],
    defaultAccess: "propose",
    requiredEvidence: ["tests", "typecheck", "residual-risk"],
  },
  {
    id: "bug-diagnosis",
    description: "Diagnose a defect through a surface map, hypothesis, failing proof, minimal fix, and verification loop.",
    triggers: ["verification-heavy"],
    minimumRisk: "medium",
    recommendedTaskAffinities: ["research", "test-writing", "backend-coding"],
    defaultAccess: "propose",
    requiredEvidence: ["surface-map", "risk-hypothesis", "tests", "typecheck", "residual-risk"],
  },
  {
    id: "architecture-review",
    description: "Read-only architecture inspection, boundary review, or risk analysis without implementation work.",
    triggers: ["architecture"],
    minimumRisk: "medium",
    recommendedTaskAffinities: ["architecture-review", "research"],
    defaultAccess: "read-only",
    requiredEvidence: ["surface-map", "risk-hypothesis", "residual-risk"],
  },
  {
    id: "architecture-change",
    description: "Change with bounded-context, dependency-direction, contract, or long-term design impact.",
    triggers: ["architecture", "cross-surface"],
    minimumRisk: "high",
    recommendedTaskAffinities: ["architecture-review", "research", "test-writing"],
    defaultAccess: "read-only",
    requiredEvidence: ["surface-map", "risk-hypothesis", "plan", "tests", "typecheck", "residual-risk"],
  },
  {
    id: "ui-change",
    description: "Operator-facing or browser-facing change requiring interaction, responsive checks, and frontend-reference evidence.",
    triggers: ["ui", "cross-surface"],
    minimumRisk: "medium",
    recommendedTaskAffinities: ["frontend-design", "research", "test-writing"],
    defaultAccess: "propose",
    requiredEvidence: [
      "surface-map",
      "risk-hypothesis",
      "visual-reference-research",
      "browser-qa",
      "tests",
      "typecheck",
      "residual-risk",
    ],
  },
  {
    id: "managed-agent-change",
    description: "Managed invocation, route identity, child handoff, evidence, replay, or provider behavior change.",
    triggers: ["managed-agents", "provider-routing", "runtime", "cross-surface"],
    minimumRisk: "high",
    recommendedTaskAffinities: ["architecture-review", "backend-coding", "test-writing"],
    defaultAccess: "read-only",
    requiredEvidence: ["surface-map", "risk-hypothesis", "plan", "managed-agent-review", "tests", "typecheck", "residual-risk"],
  },
  {
    id: "config-change",
    description: "Global, project, harness projection, or setup mutation change.",
    triggers: ["config", "cross-surface"],
    minimumRisk: "medium",
    recommendedTaskAffinities: ["architecture-review", "mechanical-edit", "test-writing"],
    defaultAccess: "propose",
    requiredEvidence: ["surface-map", "risk-hypothesis", "tests", "typecheck", "residual-risk"],
  },
  {
    id: "verification-heavy",
    description: "Work where correctness depends on strong checks instead of confidence language.",
    triggers: ["verification-heavy"],
    minimumRisk: "medium",
    recommendedTaskAffinities: ["research", "test-writing", "architecture-review"],
    defaultAccess: "propose",
    requiredEvidence: ["surface-map", "risk-hypothesis", "tests", "typecheck", "residual-risk"],
  },
  {
    id: "formal-proof-candidate",
    description: "Small high-value logic surface with crisp invariants suitable for deterministic verifier feedback.",
    triggers: ["formal-proof-candidate", "verification-heavy"],
    minimumRisk: "high",
    recommendedTaskAffinities: ["architecture-review", "test-writing"],
    defaultAccess: "read-only",
    requiredEvidence: ["surface-map", "risk-hypothesis", "spec", "formal-proof", "tests", "residual-risk"],
  },
];

export function findWorkflowProfile(id: string): WorkGovernanceWorkflowProfile | undefined {
  return WORK_GOVERNANCE_WORKFLOW_PROFILES.find((profile) => profile.id === id);
}

export function evidenceMatrixForWorkflowProfile(
  profile: WorkGovernanceWorkflowProfile,
): readonly WorkGovernanceEvidenceMatrixEntry[] {
  const gateMatrix = PROFILE_EVIDENCE_GATE_MATRIX[profile.id];
  return profile.requiredEvidence.map((evidence) => ({
    evidence,
    verificationGates: gateMatrix[evidence] ?? [],
  }));
}

export function requiredEvidenceForWorkflowProfile(
  profile: WorkGovernanceWorkflowProfile,
): readonly KilnWorkGovernanceEvidence[] {
  return evidenceMatrixForWorkflowProfile(profile).map((entry) => entry.evidence);
}

export function verificationGatesForWorkflowProfile(
  profile: WorkGovernanceWorkflowProfile,
): readonly string[] {
  return uniqueText(evidenceMatrixForWorkflowProfile(profile).flatMap((entry) => entry.verificationGates));
}

export function chooseWorkflowProfile(
  triggers: readonly KilnWorkGovernanceTrigger[],
  risk: KilnWorkGovernanceRisk | undefined,
  options: { readonly readOnlyArchitectureReview?: boolean } = {},
): WorkGovernanceWorkflowProfile {
  if (triggers.includes("formal-proof-candidate")) return requiredProfile("formal-proof-candidate");
  if (triggers.includes("managed-agents") || triggers.includes("provider-routing") || triggers.includes("runtime")) return requiredProfile("managed-agent-change");
  if (triggers.includes("architecture") && options.readOnlyArchitectureReview) return requiredProfile("architecture-review");
  if (triggers.includes("architecture")) return requiredProfile("architecture-change");
  if (triggers.includes("ui")) return requiredProfile("ui-change");
  if (triggers.includes("config")) return requiredProfile("config-change");
  if (triggers.includes("verification-heavy") || risk === "high") return requiredProfile("verification-heavy");
  return requiredProfile("small-fix");
}

function requiredProfile(id: WorkGovernanceWorkflowProfileId): WorkGovernanceWorkflowProfile {
  const profile = findWorkflowProfile(id);
  if (!profile) {
    throw new Error(`Missing work governance workflow profile: ${id}`);
  }
  return profile;
}

function uniqueText(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
