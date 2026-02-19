// Supervisor strategy: manager agent delegates tasks to workers
// Manager decides which worker handles each task, then reviews results

import type { ExecutionStrategy, StrategyContext, StrategyHandler } from "./index.js";
import type { TaskNode } from "../../tree/index.js";
import type { HandoffRequestedEvent, HandoffCompletedEvent } from "../../events/index.js";

/** Manager's delegation decision */
export interface DelegationDecision {
  readonly assignTo: string;
  readonly instructions: string;
}

/** Manager's review of a worker's result */
export interface ReviewDecision {
  readonly accepted: boolean;
  readonly feedback?: string;
}

/** Configuration for supervisor behavior */
export interface SupervisorConfig {
  readonly maxRetriesPerTask: number;
}

const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  maxRetriesPerTask: 2,
};

/**
 * Supervisor mode: manager agent receives all tasks, delegates to workers
 * by name, and validates results.
 *
 * Flow:
 * 1. Select batch from tree
 * 2. For each task, call handler with manager agent name (manager decides delegation)
 * 3. If the result output contains a delegation decision, call handler with the assigned worker
 * 4. Record evidence and advance
 *
 * In practice, the handler callback is responsible for:
 * - When called with the manager agent: returning a DelegationDecision as structured output
 * - When called with a worker agent: executing the task
 *
 * The strategy orchestrates the delegation flow and emits handoff events.
 */
export class SupervisorStrategy implements ExecutionStrategy {
  private readonly config: SupervisorConfig;

  constructor(config?: Partial<SupervisorConfig>) {
    this.config = { ...DEFAULT_SUPERVISOR_CONFIG, ...config };
  }

  async execute(context: StrategyContext, handler: StrategyHandler): Promise<TaskNode[]> {
    const { team, tree, eventBus, sessionId } = context;

    const managerKey = team.manager;
    if (!managerKey) {
      throw new Error("Supervisor strategy requires a manager agent");
    }

    const workerKeys = Object.keys(team.agents).filter((k) => k !== managerKey);
    if (workerKeys.length === 0) {
      throw new Error("Supervisor strategy requires at least one worker agent besides the manager");
    }

    while (!tree.isComplete) {
      const batch = tree.selectBatch();
      if (batch.length === 0) break;

      // Process tasks sequentially through the supervisor -- manager must see each task
      for (const task of batch) {
        let assigned = false;
        let retries = 0;

        while (!assigned && retries <= this.config.maxRetriesPerTask) {
          // Step 1: Manager decides delegation
          const managerResult = await handler(task, 0, managerKey);

          // Parse delegation decision from manager output
          const decision = this.parseDelegation(managerResult.output, workerKeys);

          // Emit handoff request
          const handoffRequest: HandoffRequestedEvent = {
            type: "handoff_requested",
            fromAgent: managerKey,
            toAgent: decision.assignTo,
            reason: decision.instructions,
            timestamp: new Date(),
            sessionId,
          };
          eventBus.emit(handoffRequest);

          // Step 2: Worker executes task
          const workerResult = await handler(task, retries + 1, decision.assignTo);

          // Emit handoff completion
          const handoffComplete: HandoffCompletedEvent = {
            type: "handoff_completed",
            fromAgent: managerKey,
            toAgent: decision.assignTo,
            accepted: workerResult.success,
            timestamp: new Date(),
            sessionId,
          };
          eventBus.emit(handoffComplete);

          // Record evidence from worker
          for (const evidence of workerResult.evidence) {
            tree.addEvidence(task.id, evidence);
          }

          if (workerResult.success) {
            tree.updateStatus(task.id, "supported");
            assigned = true;
          } else {
            retries++;
            if (retries > this.config.maxRetriesPerTask) {
              tree.updateStatus(task.id, "refuted");
            }
          }
        }
      }
    }

    return tree.allNodes;
  }

  /**
   * Parse a delegation decision from the manager's output.
   * Tries to parse JSON; falls back to assigning to first worker.
   */
  private parseDelegation(output: string, workerKeys: readonly string[]): DelegationDecision {
    try {
      const parsed = JSON.parse(output);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof parsed.assignTo === "string" &&
        workerKeys.includes(parsed.assignTo)
      ) {
        return {
          assignTo: parsed.assignTo,
          instructions: typeof parsed.instructions === "string" ? parsed.instructions : "",
        };
      }
    } catch {
      // Not valid JSON -- fall through to default
    }

    // Default: assign to first available worker
    return {
      assignTo: workerKeys[0]!,
      instructions: output,
    };
  }
}
