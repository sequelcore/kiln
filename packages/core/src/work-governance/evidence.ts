/**
 * Canonical work-governance evidence taxonomy. Lives in core (not CLI, where
 * it originated) because both `@kilnai/cli` (phase/task derivation) and
 * `@kilnai/runtime` (managed-invocation admission) need the same stable
 * evidence identities, and runtime must not depend on cli.
 */
export type KilnWorkGovernanceEvidence =
  | "surface-map"
  | "risk-hypothesis"
  | "spec"
  | "plan"
  | "tests"
  | "typecheck"
  | "visual-reference-research"
  | "browser-qa"
  | "managed-agent-review"
  | "managed-orchestration:result-handoff"
  | "managed-orchestration:completion-signal"
  | "managed-orchestration:comparison-summary"
  | "managed-orchestration:route-outcome"
  | "managed-orchestration:adoption-gate"
  | "managed-orchestration:diff"
  | "managed-orchestration:verification"
  | "managed-orchestration:review"
  | "managed-orchestration:merge:compare-and-select"
  | "managed-orchestration:merge:collect-all"
  | "managed-orchestration:merge:first-success"
  | "managed-orchestration:merge:manual-review-required"
  | "managed-orchestration:merge:none"
  | "formal-proof"
  | "residual-risk";

export const KILN_WORK_GOVERNANCE_EVIDENCE: readonly KilnWorkGovernanceEvidence[] = [
  "surface-map",
  "risk-hypothesis",
  "spec",
  "plan",
  "tests",
  "typecheck",
  "visual-reference-research",
  "browser-qa",
  "managed-agent-review",
  "managed-orchestration:result-handoff",
  "managed-orchestration:completion-signal",
  "managed-orchestration:comparison-summary",
  "managed-orchestration:route-outcome",
  "managed-orchestration:adoption-gate",
  "managed-orchestration:diff",
  "managed-orchestration:verification",
  "managed-orchestration:review",
  "managed-orchestration:merge:compare-and-select",
  "managed-orchestration:merge:collect-all",
  "managed-orchestration:merge:first-success",
  "managed-orchestration:merge:manual-review-required",
  "managed-orchestration:merge:none",
  "formal-proof",
  "residual-risk",
];

export function isKilnWorkGovernanceEvidence(value: unknown): value is KilnWorkGovernanceEvidence {
  return KILN_WORK_GOVERNANCE_EVIDENCE.includes(value as KilnWorkGovernanceEvidence);
}
