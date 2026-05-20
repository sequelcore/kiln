import type {
  KilnWorkGovernanceEvidence,
  KilnWorkGovernanceRisk,
  KilnWorkGovernanceTrigger,
} from "../kiln-yaml-types.js";

export type WorkGovernanceWorkflowProfileId =
  | "small-fix"
  | "bug-diagnosis"
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
  readonly recommendedAgentProfiles: readonly string[];
  readonly defaultAuthorityProfile: string;
  readonly requiredEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly verificationGates: readonly string[];
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
  "architecture-change": {
    "managed-agent-review": ["architecture/DDD review"],
    tests: ["contract tests where behavior changes"],
    typecheck: ["typecheck/build"],
    "residual-risk": ["residual-risk closeout when a gate is skipped or risk remains"],
  },
  "ui-change": {
    "visual-reference-research": [
      "real product UI screenshots, demo/video frames, running-app captures, README images, or docs images before planning; repository chrome or code listings do not count",
      "source URLs and extracted reusable design principles",
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
    "managed-agent-review": ["review closeout"],
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
    description: "Local, low-risk correction inside the direct-execution envelope.",
    triggers: [],
    minimumRisk: "low",
    recommendedAgentProfiles: ["coder", "fast-coder"],
    defaultAuthorityProfile: "foundation-propose-writes",
    requiredEvidence: ["tests", "typecheck", "residual-risk"],
    verificationGates: ["focused test or explicit no-test rationale", "typecheck when TypeScript is affected"],
  },
  {
    id: "bug-diagnosis",
    description: "Diagnose a defect through a surface map, hypothesis, failing proof, minimal fix, and verification loop.",
    triggers: ["verification-heavy"],
    minimumRisk: "medium",
    recommendedAgentProfiles: ["scout", "tdd", "coder", "reviewer"],
    defaultAuthorityProfile: "foundation-propose-writes",
    requiredEvidence: ["surface-map", "risk-hypothesis", "tests", "typecheck", "residual-risk"],
    verificationGates: ["failing test or reproduction before fix", "focused regression test", "typecheck/build"],
  },
  {
    id: "architecture-change",
    description: "Change with bounded-context, dependency-direction, contract, or long-term design impact.",
    triggers: ["architecture", "cross-surface"],
    minimumRisk: "high",
    recommendedAgentProfiles: ["scout", "architect", "architecture-planner", "ddd-validator", "reviewer"],
    defaultAuthorityProfile: "foundation-readonly-plan",
    requiredEvidence: ["surface-map", "risk-hypothesis", "plan", "managed-agent-review", "tests", "typecheck", "residual-risk"],
    verificationGates: ["architecture/DDD review", "contract tests where behavior changes", "typecheck/build"],
  },
  {
    id: "ui-change",
    description: "Operator-facing or browser-facing change requiring interaction, responsive, and visual evidence.",
    triggers: ["ui", "cross-surface"],
    minimumRisk: "medium",
    recommendedAgentProfiles: ["scout", "react-ts-reviewer", "reviewer"],
    defaultAuthorityProfile: "foundation-propose-writes",
    requiredEvidence: [
      "surface-map",
      "risk-hypothesis",
      "visual-reference-research",
      "browser-qa",
      "tests",
      "typecheck",
      "residual-risk",
    ],
    verificationGates: [
      "real product UI screenshots, demo/video frames, running-app captures, README images, or docs images before planning; repository chrome or code listings do not count",
      "source URLs and extracted reusable design principles",
      "browser QA screenshot or interaction proof",
      "accessibility/overflow check",
      "typecheck",
    ],
  },
  {
    id: "managed-agent-change",
    description: "Managed invocation, route identity, child handoff, evidence, replay, or provider behavior change.",
    triggers: ["managed-agents", "provider-routing", "runtime", "cross-surface"],
    minimumRisk: "high",
    recommendedAgentProfiles: ["scout", "architect", "adversarial-reviewer", "reviewer"],
    defaultAuthorityProfile: "foundation-readonly-plan",
    requiredEvidence: ["surface-map", "risk-hypothesis", "plan", "managed-agent-review", "tests", "typecheck", "residual-risk"],
    verificationGates: [
      "managed child live or simulated evidence",
      "route/provider identity check",
      "adversarial managed-agent review",
      "typecheck/build",
    ],
  },
  {
    id: "config-change",
    description: "Global, project, harness projection, or setup mutation change.",
    triggers: ["config", "cross-surface"],
    minimumRisk: "medium",
    recommendedAgentProfiles: ["scout", "reviewer"],
    defaultAuthorityProfile: "foundation-propose-writes",
    requiredEvidence: ["surface-map", "risk-hypothesis", "tests", "typecheck", "residual-risk"],
    verificationGates: ["config parse/merge tests", "projection or sync diagnostic test", "typecheck"],
  },
  {
    id: "verification-heavy",
    description: "Work where correctness depends on strong checks instead of confidence language.",
    triggers: ["verification-heavy"],
    minimumRisk: "medium",
    recommendedAgentProfiles: ["scout", "tdd", "adversarial-reviewer", "reviewer"],
    defaultAuthorityProfile: "foundation-propose-writes",
    requiredEvidence: ["surface-map", "risk-hypothesis", "tests", "typecheck", "managed-agent-review", "residual-risk"],
    verificationGates: ["failing proof or test first", "verification loop until no known blocker", "review closeout"],
  },
  {
    id: "formal-proof-candidate",
    description: "Small high-value logic surface with crisp invariants suitable for deterministic verifier feedback.",
    triggers: ["formal-proof-candidate", "verification-heavy"],
    minimumRisk: "high",
    recommendedAgentProfiles: ["architect", "tdd", "adversarial-reviewer"],
    defaultAuthorityProfile: "foundation-readonly-plan",
    requiredEvidence: ["surface-map", "risk-hypothesis", "spec", "formal-proof", "tests", "residual-risk"],
    verificationGates: ["explicit invariant/spec review", "deterministic proof/property-test result", "residual-risk closeout"],
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
): WorkGovernanceWorkflowProfile {
  if (triggers.includes("formal-proof-candidate")) return requiredProfile("formal-proof-candidate");
  if (triggers.includes("managed-agents") || triggers.includes("provider-routing") || triggers.includes("runtime")) return requiredProfile("managed-agent-change");
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
