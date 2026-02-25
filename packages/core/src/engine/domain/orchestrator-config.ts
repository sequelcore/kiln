// Engine domain: OrchestratorConfig -- shared configuration interface
// Lives in engine (innermost layer) so both engine/loader and orchestrator can import it

/** Orchestrator configuration */
export interface OrchestratorConfig {
  readonly requireApproval: boolean;
  readonly maxDepth: number;
  readonly parallelWorkers: number;
  readonly phases: readonly string[];
  readonly maxIterations?: number;
  /** Phase after which to pause for approval. Defaults to "architect" when requireApproval is true. */
  readonly approvalAfterPhase?: string;
}
