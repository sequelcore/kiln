// DevOrchestrator -- bridges core Orchestrator with gateway ApprovalGateRegistry + EventBus

import { Orchestrator } from "@kilnai/core";
import type { EventBus, KilnEvent, OrchestratorStatus } from "@kilnai/core";
import type { ApprovalGateRegistry, ApprovalTarget } from "./approval-registry.js";

export interface DevOrchestratorConfig {
  readonly eventBus: EventBus;
  readonly approvalRegistry: ApprovalGateRegistry;
  readonly requireApproval?: boolean;
}

export interface DevRunResult {
  readonly sessionId: string;
  readonly status: OrchestratorStatus;
}

export class DevOrchestrator {
  private readonly _orchestrator: Orchestrator;
  private readonly _approvalRegistry: ApprovalGateRegistry;
  private readonly _eventBus: EventBus;
  private _eventBridge: ((event: KilnEvent) => void) | null = null;

  constructor(config: DevOrchestratorConfig) {
    this._orchestrator = new Orchestrator({
      requireApproval: config.requireApproval ?? true,
    });
    this._approvalRegistry = config.approvalRegistry;
    this._eventBus = config.eventBus;
  }

  get orchestrator(): Orchestrator {
    return this._orchestrator;
  }

  get isRunning(): boolean {
    const s = this._orchestrator.status;
    return s === "running" || s === "awaiting_approval";
  }

  start(task: string): string {
    if (this.isRunning) {
      throw new Error("A run is already in progress");
    }

    const sessionId = this._orchestrator.start(task);

    // Bridge events: orchestrator -> gateway EventBus
    this._eventBridge = (event: KilnEvent) => {
      this._eventBus.emit(event);
    };
    this._orchestrator.eventBus.onAny(this._eventBridge);

    // Register approval target adapter
    const target: ApprovalTarget = {
      approve: () => this._orchestrator.approve(),
      reject: (reason: string) => this._orchestrator.reject(reason),
      status: () => this._orchestrator.status,
    };
    this._approvalRegistry.register(sessionId, target);

    // Fire-and-forget phase loop
    this.runPhaseLoop(sessionId);

    return sessionId;
  }

  private async runPhaseLoop(sessionId: string): Promise<DevRunResult> {
    try {
      while (
        this._orchestrator.status === "running" ||
        this._orchestrator.status === "awaiting_approval"
      ) {
        const result = this._orchestrator.advancePhase();
        if (result === null) break;
        if (result instanceof Promise) {
          const next = await result;
          if (next === null) break;
        }
      }
      // If the loop ended but status is still "running" (e.g. rejection), cancel
      if (this._orchestrator.status === "running") {
        this._orchestrator.cancel();
      }
      return { sessionId, status: this._orchestrator.status };
    } finally {
      this._approvalRegistry.unregister(sessionId);
      if (this._eventBridge) {
        this._orchestrator.eventBus.offAny(this._eventBridge);
        this._eventBridge = null;
      }
    }
  }
}
