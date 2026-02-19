import type { OrchestratorStatus } from "./index.js";
import type { TaskNode, TreeConfig } from "../tree/index.js";
import type { KilnEvent } from "../events/index.js";
import type { CostSummary } from "../cost/index.js";

export interface Checkpoint {
  readonly id: string;
  readonly sessionId: string;
  readonly parentId: string | null;
  readonly phase: string;
  readonly phaseIndex: number;
  readonly status: OrchestratorStatus;
  readonly task: string;
  readonly tree: {
    readonly nodes: readonly TaskNode[];
    readonly config: TreeConfig;
  };
  readonly eventHistory: readonly KilnEvent[];
  readonly costSummary: CostSummary;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface CheckpointOptions {
  readonly metadata?: Record<string, unknown>;
}

export interface ReplayOverrides {
  readonly task?: string;
  readonly startPhase?: string;
  readonly metadata?: Record<string, unknown>;
}
