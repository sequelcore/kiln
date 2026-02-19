// Engine primitive: Workflow -- a configurable phase sequence with gates
// Ehrlich #6: domain-agnostic config (string phases, not hardcoded enums)

/** A quality gate that must pass before phase transition */
export interface Gate {
  readonly requires: readonly string[];
}

/** A configurable sequence of phases with quality gates */
export interface Workflow {
  readonly phases: readonly string[];
  readonly gates: Record<string, Gate>;
  readonly maxIterations?: number;
}
