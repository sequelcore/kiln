import { randomUUID } from "node:crypto";
import type { EventBus } from "../events/event-bus.js";
import type { PhaseChangedEvent } from "../events/index.js";
import type { CostSummary } from "../cost/index.js";
import type { BatchExecutor, TaskTree } from "../tree/index.js";
import type { OrchestratorConfig } from "./index.js";
import { phaseMeta, type PhaseMachine } from "./phase-machine.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { Checkpoint, CheckpointOptions, ReplayOverrides } from "./checkpoint-types.js";

interface SessionState {
  readonly sessionId: string | null;
  readonly task: string | null;
}

interface CheckpointSupportDeps {
  readonly phaseMachine: PhaseMachine;
  readonly config: OrchestratorConfig;
  readonly tree: TaskTree;
  readonly batchExecutor: BatchExecutor;
  readonly eventBus: EventBus;
  readonly getSessionState: () => SessionState;
  readonly setSessionState: (state: { sessionId: string; task: string }) => void;
  readonly getCostSummary: () => CostSummary;
  readonly resetCostTrackerFromSummary: (summary: CostSummary) => void;
}

export class OrchestratorCheckpointSupport {
  private store: CheckpointStore | null = null;
  private autoCheckpointUnsubscribe: (() => void) | null = null;
  private isRestoring = false;
  private lastRestoredCheckpointId: string | null = null;

  constructor(private readonly deps: CheckpointSupportDeps) {}

  get checkpointStore(): CheckpointStore | null {
    return this.store;
  }

  async loadCheckpointMetadata(checkpointId: string): Promise<Record<string, unknown> | undefined> {
    const checkpoint = await this.requireCheckpoint(checkpointId);
    return checkpoint.metadata;
  }

  attachStore(store: CheckpointStore): void {
    this.store = store;

    if (this.autoCheckpointUnsubscribe) {
      this.autoCheckpointUnsubscribe();
    }

    const handler = (_event: PhaseChangedEvent): void => {
      if (this.isRestoring) return;
      const { sessionId, task } = this.deps.getSessionState();
      if (sessionId && task) {
        this.checkpoint().catch((err) => {
          console.error("Auto-checkpoint failed:", err);
        });
      }
    };

    this.deps.eventBus.on("phase_changed", handler);
    this.autoCheckpointUnsubscribe = () => {
      this.deps.eventBus.off("phase_changed", handler);
    };
  }

  async checkpoint(options?: CheckpointOptions): Promise<string> {
    if (!this.store) {
      throw new Error("No checkpoint store attached. Call attachCheckpointStore() first.");
    }

    const { sessionId, task } = this.deps.getSessionState();
    if (!sessionId || !task) {
      throw new Error("No active session. Call start() first.");
    }

    const checkpointId = randomUUID();
    const checkpoint: Checkpoint = {
      id: checkpointId,
      sessionId,
      parentId: this.lastRestoredCheckpointId,
      phase: this.deps.phaseMachine.currentPhase,
      phaseIndex: this.deps.config.phases.indexOf(this.deps.phaseMachine.currentPhase),
      status: this.deps.phaseMachine.status,
      task,
      tree: this.deps.tree.toJSON(),
      eventHistory: this.deps.eventBus.history(),
      costSummary: this.deps.getCostSummary(),
      timestamp: new Date(),
      metadata: options?.metadata,
    };

    await this.store.save(checkpoint, options);
    return checkpointId;
  }

  async resume(checkpointId: string): Promise<string> {
    const checkpoint = await this.requireCheckpoint(checkpointId);

    this.isRestoring = true;
    try {
      const newSessionId = randomUUID();
      this.deps.setSessionState({
        sessionId: newSessionId,
        task: checkpoint.task,
      });
      this.lastRestoredCheckpointId = checkpointId;

      this.deps.phaseMachine.reset();
      this.deps.phaseMachine.restoreState(checkpoint.phaseIndex, checkpoint.status);
      this.deps.tree.setSessionId(newSessionId);
      this.deps.batchExecutor.setSessionId(newSessionId);
      this.deps.tree.loadFromJSON(checkpoint.tree);

      this.deps.resetCostTrackerFromSummary(checkpoint.costSummary);

      const meta = phaseMeta(this.deps.phaseMachine.currentPhase);
      const phaseEvent: PhaseChangedEvent = {
        type: "phase_changed",
        phase: this.deps.phaseMachine.currentPhase,
        phaseName: meta.name,
        phaseDescription: meta.description,
        timestamp: new Date(),
        sessionId: newSessionId,
      };
      this.deps.eventBus.emit(phaseEvent);

      return newSessionId;
    } finally {
      this.isRestoring = false;
    }
  }

  async fork(checkpointId: string, options?: CheckpointOptions): Promise<string> {
    const newSessionId = await this.resume(checkpointId);
    const checkpoint = await this.requireCheckpoint(checkpointId);
    const { task } = this.deps.getSessionState();

    const forkCheckpoint: Checkpoint = {
      id: randomUUID(),
      sessionId: newSessionId,
      parentId: checkpointId,
      phase: this.deps.phaseMachine.currentPhase,
      phaseIndex: this.deps.config.phases.indexOf(this.deps.phaseMachine.currentPhase),
      status: this.deps.phaseMachine.status,
      task: task ?? checkpoint.task,
      tree: this.deps.tree.toJSON(),
      eventHistory: this.deps.eventBus.history(),
      costSummary: this.deps.getCostSummary(),
      timestamp: new Date(),
      metadata: options?.metadata,
    };

    await this.store!.save(forkCheckpoint, options);
    return newSessionId;
  }

  async replay(checkpointId: string, overrides?: ReplayOverrides): Promise<string> {
    const checkpoint = await this.requireCheckpoint(checkpointId);
    const newSessionId = await this.resume(checkpointId);

    if (overrides?.startPhase) {
      const phaseIndex = this.deps.config.phases.indexOf(overrides.startPhase);
      if (phaseIndex === -1) {
        throw new Error(`Phase not found: ${overrides.startPhase}`);
      }
      this.deps.phaseMachine.restoreState(phaseIndex, checkpoint.status);
    }

    if (overrides?.task) {
      this.deps.setSessionState({
        sessionId: newSessionId,
        task: overrides.task,
      });
    }

    return newSessionId;
  }

  private async requireCheckpoint(id: string): Promise<Checkpoint> {
    if (!this.store) {
      throw new Error("No checkpoint store attached. Call attachCheckpointStore() first.");
    }

    const checkpoint = await this.store.load(id);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`);
    }

    return checkpoint;
  }
}
