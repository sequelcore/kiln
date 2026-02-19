import type { Phase, PhaseGateResult, OrchestratorConfig, OrchestratorStatus } from "./index.js";
import type { EventBus } from "../events/event-bus.js";
import type {
  ErrorEvent,
  ApprovalRequestedEvent,
  ApprovalReceivedEvent,
  PhaseChangedEvent,
} from "../events/index.js";

/** Derive display name from a phase string: "analyze" -> "Analyze", "my_phase" -> "My_phase" */
function phaseMeta(phase: string): { name: string; description: string } {
  const name = phase.charAt(0).toUpperCase() + phase.slice(1);
  return { name, description: `${name} phase` };
}

/**
 * Configurable linear phase state machine with quality gate enforcement and approval pause.
 * Phases are defined by config.phases -- any sequence of string phase names.
 * Approval gate pauses after config.approvalAfterPhase (or "architect" when requireApproval is true).
 */
export class PhaseMachine {
  private _currentIndex = 0;
  private _status: OrchestratorStatus = "idle";
  private _approvalResolve: ((phase: Phase | null) => void) | null = null;
  private readonly _sessionId: string;
  private readonly _approvalPhase: string | undefined;

  constructor(
    private readonly eventBus: EventBus,
    private readonly config: OrchestratorConfig,
    sessionId = "session",
  ) {
    this._sessionId = sessionId;
    this._approvalPhase =
      config.approvalAfterPhase ?? (config.requireApproval ? "architect" : undefined);
  }

  get currentPhase(): Phase {
    return this.config.phases[this._currentIndex]!;
  }

  get status(): OrchestratorStatus {
    return this._status;
  }

  /** Set status to running. Called by orchestrator before advancing. */
  start(): void {
    this._status = "running";
  }

  /**
   * Attempt to advance to the next phase.
   * Returns the new phase, a Promise (when awaiting approval), or null if blocked.
   */
  advance(gateResult?: PhaseGateResult): Phase | Promise<Phase | null> | null {
    if (this._status !== "running") return null;

    // Gate check
    if (gateResult && !gateResult.passed) {
      const errorEvent: ErrorEvent = {
        type: "error",
        message: `Phase gate failed: ${gateResult.violations.join(", ")}`,
        code: "GATE_FAILED",
        taskId: null,
        timestamp: new Date(),
        sessionId: this._sessionId,
      };
      this.eventBus.emit(errorEvent);
      return null;
    }

    // Already at last phase
    if (this._currentIndex >= this.config.phases.length - 1) {
      this._status = "completed";
      return null;
    }

    // Approval gate after configured phase
    if (this._approvalPhase && this.currentPhase === this._approvalPhase) {
      this._status = "awaiting_approval";
      const approvalEvent: ApprovalRequestedEvent = {
        type: "approval_requested",
        taskId: "",
        description: `${phaseMeta(this.currentPhase).name} plan requires approval before proceeding`,
        timestamp: new Date(),
        sessionId: this._sessionId,
      };
      this.eventBus.emit(approvalEvent);
      return new Promise<Phase | null>((resolve) => {
        this._approvalResolve = resolve;
      });
    }

    // Normal advance
    this._currentIndex++;
    const newPhase = this.currentPhase;
    const meta = phaseMeta(newPhase);
    const phaseEvent: PhaseChangedEvent = {
      type: "phase_changed",
      phase: newPhase,
      phaseName: meta.name,
      phaseDescription: meta.description,
      timestamp: new Date(),
      sessionId: this._sessionId,
    };
    this.eventBus.emit(phaseEvent);
    return newPhase;
  }

  /** Approve the plan, advancing past the approval gate. */
  approve(): void {
    if (this._status !== "awaiting_approval" || !this._approvalResolve) return;

    this._status = "running";
    const receivedEvent: ApprovalReceivedEvent = {
      type: "approval_received",
      taskId: "",
      approved: true,
      timestamp: new Date(),
      sessionId: this._sessionId,
    };
    this.eventBus.emit(receivedEvent);

    // Advance past the approval phase
    this._currentIndex++;
    const newPhase = this.currentPhase;
    const meta = phaseMeta(newPhase);
    const phaseEvent: PhaseChangedEvent = {
      type: "phase_changed",
      phase: newPhase,
      phaseName: meta.name,
      phaseDescription: meta.description,
      timestamp: new Date(),
      sessionId: this._sessionId,
    };
    this.eventBus.emit(phaseEvent);

    const resolve = this._approvalResolve;
    this._approvalResolve = null;
    resolve(newPhase);
  }

  /** Reject the plan, keeping phase at the approval gate. */
  reject(_reason: string): void {
    if (this._status !== "awaiting_approval" || !this._approvalResolve) return;

    this._status = "running";
    const receivedEvent: ApprovalReceivedEvent = {
      type: "approval_received",
      taskId: "",
      approved: false,
      timestamp: new Date(),
      sessionId: this._sessionId,
    };
    this.eventBus.emit(receivedEvent);

    const resolve = this._approvalResolve;
    this._approvalResolve = null;
    resolve(null);
  }

  /** Set status to failed, emit error event. */
  fail(error: string): void {
    this._status = "failed";
    const errorEvent: ErrorEvent = {
      type: "error",
      message: error,
      code: "ORCHESTRATOR_FAILED",
      taskId: null,
      timestamp: new Date(),
      sessionId: this._sessionId,
    };
    this.eventBus.emit(errorEvent);
  }

  /** Set status to cancelled. */
  cancel(): void {
    this._status = "cancelled";
  }

  /** Reset to initial state (first phase, idle status). */
  reset(): void {
    this._currentIndex = 0;
    this._status = "idle";
    this._approvalResolve = null;
  }

  /** Restore state from a checkpoint (for resume/fork/replay) */
  restoreState(phaseIndex: number, status: OrchestratorStatus): void {
    this._currentIndex = phaseIndex;
    this._status = status;
  }

  /** Get the current phase index */
  get currentPhaseIndex(): number {
    return this._currentIndex;
  }
}
