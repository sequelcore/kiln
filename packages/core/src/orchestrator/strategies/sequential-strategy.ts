// Sequential strategy: default team execution mode
// Extracts existing runImplementLoop behavior from Orchestrator

import type { ExecutionStrategy, StrategyContext, StrategyHandler } from "./index.js";
import type { TaskNode } from "../../tree/index.js";

/**
 * Sequential mode: select batches from the tree, execute via BatchExecutor,
 * record evidence and status updates. Identical to the original Orchestrator
 * runImplementLoop behavior.
 *
 * The first agent in the team's agents map is used for all tasks.
 */
export class SequentialStrategy implements ExecutionStrategy {
  async execute(context: StrategyContext, handler: StrategyHandler): Promise<TaskNode[]> {
    const { team, tree, batchExecutor } = context;
    const defaultAgent = Object.keys(team.agents)[0] ?? "worker";

    while (!tree.isComplete) {
      const batch = tree.selectBatch();
      if (batch.length === 0) break;

      const results = await batchExecutor.execute(batch, (task, workerIndex) =>
        handler(task, workerIndex, defaultAgent),
      );

      for (const result of results) {
        for (const evidence of result.evidence) {
          tree.addEvidence(result.taskId, evidence);
        }
        tree.updateStatus(result.taskId, result.success ? "supported" : "refuted");
      }
    }

    return tree.allNodes;
  }
}
