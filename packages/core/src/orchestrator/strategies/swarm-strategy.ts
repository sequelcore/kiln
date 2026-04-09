// Swarm strategy: agents hand control to each other via handoff capabilities
// No central coordinator. Active agent tracked per-task.
// Uses coordination primitives (ThresholdAllocator, CascadeController, TaskChannel) when available.

import type { ExecutionStrategy, StrategyContext, StrategyHandler } from "./index.js";
import type { TaskNode } from "../../tree/index.js";
import type { HandoffRequestedEvent, HandoffCompletedEvent } from "../../events/index.js";
import { DEFAULT_CASCADE_CONFIG, type CascadeConfig } from "../cascade-controller.js";
import { CascadeController } from "../cascade-controller.js";
import { inferCategory } from "../demand-signal.js";
import type { TaskCategory } from "../threshold-allocator.js";

/** Handoff request parsed from agent output */
export interface HandoffRequest {
  readonly targetAgent: string;
  readonly reason: string;
  readonly context?: Record<string, unknown>;
}

/** Configuration for swarm behavior */
export interface SwarmConfig {
  readonly cascadeConfig?: Partial<CascadeConfig>;
  readonly useCoordination: boolean;
}

const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  useCoordination: true,
};

/**
 * Swarm mode: agents hand control to each other via handoff capabilities.
 * No central coordinator. Active agent tracked per-task.
 *
 * Flow:
 * 1. Start with threshold-allocated agent (or agentKeys[0] in fallback)
 * 2. Active agent processes the current task
 * 3. If agent output indicates a handoff, control transfers to target agent
 * 4. Continue until no more handoffs (cascade energy depleted) or cycle detected
 *
 * Cycle detection: track handoff chain, error if same agent seen twice in one task.
 * Cascade energy model (CascadeController) replaces hard depth counter.
 * When coordination primitives are unavailable, falls back to local CascadeController.
 */
export class SwarmStrategy implements ExecutionStrategy {
  private readonly config: SwarmConfig;

  constructor(config?: Partial<SwarmConfig>) {
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
  }

  async execute(context: StrategyContext, handler: StrategyHandler): Promise<TaskNode[]> {
    const { team, tree, eventBus, sessionId, allocator, taskChannel } = context;
    const agentKeys = Object.keys(team.agents);

    if (agentKeys.length < 2) {
      throw new Error("Swarm strategy requires at least 2 agents");
    }

    const useCoordination = this.config.useCoordination;
    const hasAllocator = useCoordination && allocator !== undefined;

    while (!tree.isComplete) {
      const batch = tree.selectBatch();
      if (batch.length === 0) break;

      for (const task of batch) {
        try {
          let activeAgent: string;
          let cascade: CascadeController;
          let category: TaskCategory;

          if (hasAllocator && context.cascadeController !== undefined) {
            const complexity = task.branchScore;
            cascade = new CascadeController(complexity, this.config.cascadeConfig ?? DEFAULT_CASCADE_CONFIG);
            category = inferCategory({
              score: complexity,
              class: "simple",
              signals: { tokenCount: 100, hasTools: false, toolCount: 0, hasCodeBlocks: false, hasReasoningMarkers: false, turnDepth: 1 },
            });
            const demand = { category, demand: complexity };
            const allocResult = allocator.allocateWithFallback(demand);
            activeAgent = allocResult.agentId;
          } else {
            cascade = new CascadeController(1.0, this.config.cascadeConfig);
            activeAgent = agentKeys[0]!;
            category = "general" as TaskCategory;
          }

          if (taskChannel) {
            taskChannel.publish({
              id: task.id,
              description: task.statement,
              category,
              demand: task.branchScore,
            });
          }

          const visitedAgents = new Set<string>();
          let taskCompleted = false;

          while (!taskCompleted) {
            // Cycle detection -- mark task as refuted instead of aborting batch
            if (visitedAgents.has(activeAgent)) {
              tree.updateStatus(task.id, "refuted");
              break;
            }
            visitedAgents.add(activeAgent);

            if (taskChannel) {
              taskChannel.claim(task.id, activeAgent);
            }

            // Execute with active agent
            const result = await handler(task, visitedAgents.size - 1, activeAgent);

            // Record evidence
            for (const evidence of result.evidence) {
              tree.addEvidence(task.id, evidence);
            }

            // Check for handoff in the output
            const handoff = this.parseHandoff(result.output, agentKeys);

            if (handoff) {
              // Estimate gain from reason length
              const gain = Math.min(1, handoff.reason.length / 200);

              const cascadeContinue = cascade.shouldContinue(gain);

              if (!cascadeContinue) {
                // Graceful cascade termination -- task supported with current results
                tree.updateStatus(task.id, "supported");
                taskCompleted = true;
              } else {
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
              }
            } else {
              // No handoff -- task is complete
              tree.updateStatus(task.id, result.success ? "supported" : "refuted");
              taskCompleted = true;
            }
          }

          // Record outcome for adaptive learning
          if (hasAllocator) {
            const finalStatus = tree.getNode(task.id)?.status;
            const success = finalStatus === "supported";
            allocator.recordOutcome({ agentId: activeAgent, category, success });
          }

          // Mark channel complete/failed
          if (taskChannel) {
            const node = tree.getNode(task.id);
            if (node?.status === "supported") {
              taskChannel.complete(task.id, { result: `supported by ${activeAgent}` });
            } else {
              taskChannel.fail(task.id, { error: `refuted by ${activeAgent}` });
            }
          }
        } catch {
          // Handler error -- mark task as refuted, continue with remaining tasks
          tree.updateStatus(task.id, "refuted");

          if (taskChannel) {
            taskChannel.fail(task.id, { error: "handler error" });
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
