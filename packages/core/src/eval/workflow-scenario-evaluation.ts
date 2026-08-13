export const WORKFLOW_SCENARIOS = [
  { id: "orchestration-direct-low-risk", workflow: "orchestration", requiredSignals: ["direct-work"] },
  { id: "orchestration-independent-readonly", workflow: "orchestration", requiredSignals: ["independent-contracts", "reconciled-evidence"] },
  { id: "orchestration-overlapping-writes", workflow: "orchestration", requiredSignals: ["serialized"] },
  { id: "orchestration-authority-widening", workflow: "orchestration", requiredSignals: ["authority-denied-or-paused"] },
  { id: "orchestration-unknown-remote-state", workflow: "orchestration", requiredSignals: ["completion-unsettled", "capacity-unsettled"] },
  { id: "orchestration-missing-delegation", workflow: "orchestration", requiredSignals: ["unsupported-capability", "resolved-direct-policy"] },
  { id: "orchestration-unsupported-child-result", workflow: "orchestration", requiredSignals: ["adoption-blocked"] },
  { id: "research-current-software", workflow: "research", requiredSignals: ["official-current-source", "version-date"] },
  { id: "research-benchmark-claim", workflow: "research", requiredSignals: ["method", "uncertainty", "limitations"] },
  { id: "research-conflicting-primary-sources", workflow: "research", requiredSignals: ["contradiction-exposed", "confidence-withheld"] },
  { id: "research-advice-versus-measurement", workflow: "research", requiredSignals: ["evidence-classes-separated"] },
  { id: "research-search-unavailable", workflow: "research", requiredSignals: ["current-claim-unverified", "capability-gap"] },
  { id: "research-diminishing-returns", workflow: "research", requiredSignals: ["stop", "residual-uncertainty"] },
] as const;

export type WorkflowScenarioId = typeof WORKFLOW_SCENARIOS[number]["id"];

export interface WorkflowScenarioObservation {
  readonly scenarioId: WorkflowScenarioId;
  readonly signals: readonly string[];
  readonly replayEvidenceId: string;
}

export interface WorkflowScenarioEvaluation {
  readonly scenarioId: WorkflowScenarioId;
  readonly passed: boolean;
  readonly missingSignals: readonly string[];
  readonly issues: readonly string[];
}

export function evaluateWorkflowScenario(observation: WorkflowScenarioObservation): WorkflowScenarioEvaluation {
  const scenario = WORKFLOW_SCENARIOS.find((entry) => entry.id === observation.scenarioId);
  if (!scenario) throw new Error(`Unknown workflow scenario: ${observation.scenarioId}`);
  const observed = new Set(observation.signals.map((signal) => signal.trim()).filter(Boolean));
  const missingSignals = scenario.requiredSignals.filter((signal) => !observed.has(signal));
  const issues = [
    ...missingSignals.map((signal) => `missing required signal: ${signal}`),
    ...(!observation.replayEvidenceId.trim() ? ["missing replay evidence"] : []),
  ];
  return { scenarioId: observation.scenarioId, passed: issues.length === 0, missingSignals, issues };
}
