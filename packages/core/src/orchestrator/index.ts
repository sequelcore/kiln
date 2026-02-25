import type { EventBus } from "../events/event-bus.js";

/**
 * Phase identifier -- any string.
 * Example: "analyze" | "research" | "architect" | "implement" | "verify" | "synthesize"
 * Presets define their own phase names via OrchestratorConfig.phases.
 */
export type Phase = string;

/** Phase transition result */
export interface PhaseGateResult {
  readonly passed: boolean;
  readonly phase: Phase;
  readonly violations: readonly string[];
}

// Re-exported from engine domain (single source of truth)
import type { OrchestratorConfig } from "../engine/domain/orchestrator-config.js";
export type { OrchestratorConfig } from "../engine/domain/orchestrator-config.js";

/** Orchestrator status */
export type OrchestratorStatus =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "interrupted"
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
export type { Checkpoint, CheckpointOptions, ReplayOverrides } from "./checkpoint-types.js";
export type { CheckpointStore } from "./checkpoint-store.js";
export {
  ARCHITECT_PLAN_SCHEMA,
  ARCHITECT_EVALUATION_SCHEMA,
  ARCHITECT_REVIEW_SCHEMA,
} from "./schemas.js";

// Execution strategies (Phase 2)
export { createStrategy, SequentialStrategy, SupervisorStrategy, SwarmStrategy } from "./strategies/index.js";
export type { ExecutionStrategy, StrategyContext, StrategyHandler } from "./strategies/index.js";
export type { DelegationDecision, ReviewDecision, SupervisorConfig } from "./strategies/supervisor-strategy.js";
export type { HandoffRequest, SwarmConfig } from "./strategies/swarm-strategy.js";

// Interrupt (Phase 2C)
export type { InterruptRequest, ResumeCommand, InterruptState } from "./interrupt.js";

// Guardrails (Phase 2C)
export { validateJsonSchema, validateOutput, withGuardrail } from "./guardrails.js";
export type { GuardrailResult } from "./guardrails.js";
