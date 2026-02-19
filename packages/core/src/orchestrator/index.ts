import type { EventBus } from "../events/event-bus.js";

/**
 * Phase identifier -- any string.
 * Temper default: "analyze" | "research" | "architect" | "implement" | "verify" | "synthesize"
 * Other presets define their own phase names via OrchestratorConfig.phases.
 */
export type Phase = string;

/** Phase transition result */
export interface PhaseGateResult {
  readonly passed: boolean;
  readonly phase: Phase;
  readonly violations: readonly string[];
}

/** Orchestrator configuration */
export interface OrchestratorConfig {
  readonly requireApproval: boolean;
  readonly maxDepth: number;
  readonly parallelWorkers: number;
  readonly phases: readonly Phase[];
  readonly maxIterations?: number;
  /** Phase after which to pause for approval. Defaults to "architect" when requireApproval is true. */
  readonly approvalAfterPhase?: string;
}

/** Orchestrator status */
export type OrchestratorStatus =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

/** Context passed to phase handlers */
export interface PhaseContext {
  readonly task: string;
  readonly sessionId: string;
  readonly phase: Phase;
  readonly eventBus: EventBus;
  readonly config: OrchestratorConfig;
}

/** Result returned from phase handlers */
export interface PhaseResult {
  readonly gateResult?: PhaseGateResult;
  readonly output?: string;
  readonly error?: string;
}

export { PhaseMachine } from "./phase-machine.js";
export { Orchestrator } from "./orchestrator.js";
export type { ArchitectPlan, TaskEvaluation } from "./orchestrator.js";
export {
  ARCHITECT_PLAN_SCHEMA,
  ARCHITECT_EVALUATION_SCHEMA,
  ARCHITECT_REVIEW_SCHEMA,
} from "./schemas.js";
