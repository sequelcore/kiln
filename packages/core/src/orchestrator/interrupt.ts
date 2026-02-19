// Interrupt primitive: pause execution for external input
// Builds on Phase 1 checkpointing -- interrupt() creates a checkpoint

/** Request to interrupt execution and wait for external input */
export interface InterruptRequest {
  readonly reason: string;
  readonly resumeSchema?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

/** Command to resume from an interrupt with a value */
export interface ResumeCommand {
  readonly checkpointId: string;
  readonly value: unknown;
  readonly metadata?: Record<string, unknown>;
}

/** Interrupt state stored in checkpoint metadata */
export interface InterruptState {
  readonly reason: string;
  readonly resumeSchema?: Record<string, unknown>;
  readonly requestedAt: string; // ISO string for serialization
  readonly phase: string;
  readonly agentName?: string;
}
