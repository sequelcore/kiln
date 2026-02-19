// Swarm strategy: agents hand control to each other via handoff capabilities
// No central coordinator. Active agent tracked per-task.

import type { ExecutionStrategy, StrategyContext, StrategyHandler } from "./index.js";
import type { TaskNode } from "../../tree/index.js";
import type { HandoffRequestedEvent, HandoffCompletedEvent } from "../../events/index.js";
import { KilnError } from "../../engine/errors.js";

/** Handoff request parsed from agent output */
export interface HandoffRequest {
  readonly targetAgent: string;
  readonly reason: string;
  readonly context?: Record<string, unknown>;
}

/** Configuration for swarm behavior */
export interface SwarmConfig {
  readonly maxHandoffDepth: number;
}

const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  maxHandoffDepth: 10,
};

/**
 * Swarm mode: agents hand control to each other via handoff capabilities.
 * No central coordinator. Active agent tracked per-task.
 *
 * Flow:
 * 1. Start with first agent in the agents map
 * 2. Active agent processes the current task
 * 3. If agent output indicates a handoff, control transfers to target agent
 * 4. Continue until no more handoffs (agent completes without handoff)
 *
 * Cycle detection: track handoff chain, error if same agent seen twice in one task.
 * Max handoff depth per task (configurable, default 10).
 */
export class SwarmStrategy implements ExecutionStrategy {
  private readonly config: SwarmConfig;

  constructor(config?: Partial<SwarmConfig>) {
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
  }

  async execute(context: StrategyContext, handler: StrategyHandler): Promise<TaskNode[]> {
    const { team, tree, eventBus, sessionId } = context;
    const agentKeys = Object.keys(team.agents);

    if (agentKeys.length < 2) {
      throw new Error("Swarm strategy requires at least 2 agents");
    }

    while (!tree.isComplete) {
      const batch = tree.selectBatch();
      if (batch.length === 0) break;

      for (const task of batch) {
        let activeAgent = agentKeys[0]!;
        const visitedAgents = new Set<string>();
        let handoffCount = 0;
        let taskCompleted = false;

        while (!taskCompleted) {
          // Cycle detection
          if (visitedAgents.has(activeAgent)) {
            throw new KilnError("HANDOFF_FAILED", `Handoff cycle detected: agent "${activeAgent}" already processed this task`, {
              context: { agent: activeAgent, taskId: task.id, chain: [...visitedAgents] },
            });
          }
          visitedAgents.add(activeAgent);

          // Depth check
          if (handoffCount >= this.config.maxHandoffDepth) {
            throw new KilnError("HANDOFF_FAILED", `Max handoff depth (${this.config.maxHandoffDepth}) exceeded for task "${task.id}"`, {
              context: { taskId: task.id, depth: handoffCount },
            });
          }

          // Execute with active agent
          const result = await handler(task, handoffCount, activeAgent);

          // Record evidence
          for (const evidence of result.evidence) {
            tree.addEvidence(task.id, evidence);
          }

          // Check for handoff in the output
          const handoff = this.parseHandoff(result.output, agentKeys);

          if (handoff) {
            // Emit handoff events
            const handoffRequest: HandoffRequestedEvent = {
              type: "handoff_requested",
              fromAgent: activeAgent,
              toAgent: handoff.targetAgent,
              reason: handoff.reason,
              context: handoff.context,
              timestamp: new Date(),
              sessionId,
            };
            eventBus.emit(handoffRequest);

            const handoffComplete: HandoffCompletedEvent = {
              type: "handoff_completed",
              fromAgent: activeAgent,
              toAgent: handoff.targetAgent,
              accepted: true,
              timestamp: new Date(),
              sessionId,
            };
            eventBus.emit(handoffComplete);

            activeAgent = handoff.targetAgent;
            handoffCount++;
          } else {
            // No handoff -- task is complete
            tree.updateStatus(task.id, result.success ? "supported" : "refuted");
            taskCompleted = true;
          }
        }
      }
    }

    return tree.allNodes;
  }

  /**
   * Parse a handoff request from agent output.
   * Returns null if no handoff is indicated.
   */
  private parseHandoff(
    output: string,
    agentKeys: readonly string[],
  ): HandoffRequest | null {
    try {
      const parsed = JSON.parse(output);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        parsed.type === "handoff" &&
        typeof parsed.targetAgent === "string" &&
        agentKeys.includes(parsed.targetAgent)
      ) {
        return {
          targetAgent: parsed.targetAgent,
          reason: typeof parsed.reason === "string" ? parsed.reason : "",
          context: typeof parsed.context === "object" && parsed.context !== null
            ? parsed.context
            : undefined,
        };
      }
    } catch {
      // Not valid JSON or not a handoff -- no handoff
    }
    return null;
  }
}
