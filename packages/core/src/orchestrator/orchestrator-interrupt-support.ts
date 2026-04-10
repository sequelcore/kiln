import type { EventBus } from "../events/event-bus.js";
import type { InterruptRequestedEvent, InterruptResumedEvent } from "../events/index.js";
import type { CheckpointOptions } from "./checkpoint-types.js";
import type { InterruptRequest, InterruptState, ResumeCommand } from "./interrupt.js";

interface InterruptSupportDeps {
  readonly eventBus: EventBus;
  readonly getSessionId: () => string | null;
  readonly getCurrentPhase: () => string;
  readonly hasCheckpointStore: () => boolean;
  readonly checkpoint: (options?: CheckpointOptions) => Promise<string>;
  readonly loadCheckpointMetadata: (checkpointId: string) => Promise<Record<string, unknown> | undefined>;
  readonly resume: (checkpointId: string) => Promise<string>;
}

export class OrchestratorInterruptSupport {
  private interruptState: InterruptState | null = null;

  constructor(private readonly deps: InterruptSupportDeps) {}

  get state(): InterruptState | null {
    return this.interruptState;
  }

  async interrupt(request: InterruptRequest): Promise<string> {
    if (!this.deps.hasCheckpointStore()) {
      throw new Error("No checkpoint store attached. Call attachCheckpointStore() first.");
    }

    const sessionId = this.deps.getSessionId();
    if (!sessionId) {
      throw new Error("No active session. Call start() first.");
    }

    const interruptState: InterruptState = {
      reason: request.reason,
      resumeSchema: request.resumeSchema,
      requestedAt: new Date().toISOString(),
      phase: this.deps.getCurrentPhase(),
    };
    this.interruptState = interruptState;

    const checkpointId = await this.deps.checkpoint({
      metadata: {
        ...request.metadata,
        interruptState,
      },
    });

    const event: InterruptRequestedEvent = {
      type: "interrupt_requested",
      checkpointId,
      reason: request.reason,
      resumeSchema: request.resumeSchema,
      timestamp: new Date(),
      sessionId,
    };
    this.deps.eventBus.emit(event);

    return checkpointId;
  }

  async resumeInterrupt(command: ResumeCommand): Promise<string> {
    if (!this.deps.hasCheckpointStore()) {
      throw new Error("No checkpoint store attached. Call attachCheckpointStore() first.");
    }

    const metadata = await this.deps.loadCheckpointMetadata(command.checkpointId);
    const interruptState = metadata?.interruptState as InterruptState | undefined;
    if (!interruptState) {
      throw new Error("Checkpoint does not contain interrupt state");
    }

    const newSessionId = await this.deps.resume(command.checkpointId);
    this.interruptState = null;

    const event: InterruptResumedEvent = {
      type: "interrupt_resumed",
      checkpointId: command.checkpointId,
      resumeValue: command.value,
      timestamp: new Date(),
      sessionId: newSessionId,
    };
    this.deps.eventBus.emit(event);

    return newSessionId;
  }
}
