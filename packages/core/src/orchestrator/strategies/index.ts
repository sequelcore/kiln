// Execution strategies for team modes: sequential, supervisor, swarm
// Strategy pattern -- adding a new mode means adding a new strategy file

import type { EventBus } from "../../events/event-bus.js";
import type { Team } from "../../engine/composites/team.js";
import type { TeamMode } from "../../engine/composites/team.js";
import type { TaskTree } from "../../tree/task-tree.js";
import type { BatchExecutor } from "../../tree/batch-executor.js";
import type { TaskNode } from "../../tree/index.js";
import type { BatchResult } from "../../tree/index.js";
import { SequentialStrategy } from "./sequential-strategy.js";
import { SupervisorStrategy } from "./supervisor-strategy.js";
import { SwarmStrategy } from "./swarm-strategy.js";

/** Context provided to execution strategies */
export interface StrategyContext {
  readonly team: Team;
  readonly eventBus: EventBus;
  readonly tree: TaskTree;
  readonly batchExecutor: BatchExecutor;
  readonly sessionId: string;
}

/** Handler signature for task execution with agent name routing */
export type StrategyHandler = (
  task: TaskNode,
  workerIndex: number,
  agentName: string,
) => Promise<BatchResult>;

/** Execution strategy for a team mode */
export interface ExecutionStrategy {
  /** Execute the implementation loop for the team */
  execute(context: StrategyContext, handler: StrategyHandler): Promise<TaskNode[]>;
}

/** Strategy factory: resolves team mode to strategy */
export function createStrategy(mode: TeamMode): ExecutionStrategy {
  switch (mode) {
    case "sequential":
      return new SequentialStrategy();
    case "supervisor":
      return new SupervisorStrategy();
    case "swarm":
      return new SwarmStrategy();
  }
}

export { SequentialStrategy } from "./sequential-strategy.js";
export { SupervisorStrategy } from "./supervisor-strategy.js";
export { SwarmStrategy } from "./swarm-strategy.js";
