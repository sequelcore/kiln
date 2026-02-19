import type { Phase, OrchestratorStatus } from "@kilnai/core";
import type { TaskNode, TaskStatus } from "@kilnai/core";
import type { CostSummary, RoleUsage } from "@kilnai/core";
import type { KilnEvent } from "@kilnai/core";
import type {
  PhaseChangedEvent,
  TaskStartedEvent,
  TaskCompletedEvent,
  ToolCalledEvent,
  CostUpdateEvent,
  ErrorEvent,
} from "@kilnai/core";

/** Ordered list of orchestrator phases */
export const PHASES: Phase[] = [
  "analyze",
  "research",
  "architect",
  "implement",
  "verify",
  "synthesize",
];

/** Human-readable labels for each phase */
export const PHASE_LABELS: Record<Phase, string> = {
  analyze: "Analyze",
  research: "Research",
  architect: "Architect",
  implement: "Implement",
  verify: "Verify",
  synthesize: "Synthesize",
};

/** Status icons for task tree nodes */
export const TASK_ICONS: Record<TaskStatus, string> = {
  proposed: "\u25CB",
  testing: "\u25C9",
  supported: "\u2713",
  refuted: "\u2717",
  rejected: "\u2298",
  revised: "\u21BB",
};

/**
 * Determine whether a phase is done, active, or pending
 * relative to the current phase and orchestrator status.
 */
export function phaseState(
  phase: Phase,
  currentPhase: Phase,
  status: OrchestratorStatus,
): "done" | "active" | "pending" {
  const phaseIdx = PHASES.indexOf(phase);
  const currentIdx = PHASES.indexOf(currentPhase);

  if (status === "completed" || status === "failed" || status === "cancelled") {
    if (phaseIdx <= currentIdx) return "done";
    return "pending";
  }

  if (phaseIdx < currentIdx) return "done";
  if (phaseIdx === currentIdx) return "active";
  return "pending";
}

/**
 * Format the phase progress bar as a single string.
 */
export function formatPhaseBar(
  currentPhase: Phase,
  status: OrchestratorStatus,
): string {
  const parts = PHASES.map((phase) => {
    const state = phaseState(phase, currentPhase, status);
    const label = PHASE_LABELS[phase];

    if (state === "done") return `[\u2713 ${label}]`;
    if (state === "active") return `[\u25CF ${label}]`;
    return `[ ${label}]`;
  });

  return parts.join(" > ");
}

/**
 * Format a single task node as an indented line.
 */
export function formatTaskNode(node: TaskNode): string {
  const indent = "  ".repeat(node.depth);
  const icon = TASK_ICONS[node.status];
  const statement =
    node.statement.length > 60
      ? node.statement.slice(0, 57) + "..."
      : node.statement;
  return `${indent}${icon} ${statement}`;
}

/**
 * Format the full task tree as an array of formatted lines.
 */
export function formatTaskTree(nodes: readonly TaskNode[]): string[] {
  const statusOrder: Record<TaskStatus, number> = {
    testing: 0,
    proposed: 1,
    supported: 2,
    revised: 3,
    refuted: 4,
    rejected: 5,
  };

  const sorted = [...nodes].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
  });

  return sorted.map(formatTaskNode);
}

/**
 * Compute the cost per role from a CostSummary and format as a string.
 */
export function formatCost(summary: CostSummary): string {
  const total = `$${summary.totalCostUsd.toFixed(2)}`;
  const roles = Object.entries(summary.byRole) as [string, RoleUsage][];

  if (roles.length === 0) return `Cost: ${total}`;

  const breakdown = roles
    .map(([role, usage]) => {
      const pricing = computeRoleCost(usage);
      return `${role}: $${pricing.toFixed(2)}`;
    })
    .join(", ");

  return `Cost: ${total} (${breakdown})`;
}

/** Compute USD cost for a single role usage entry */
function computeRoleCost(usage: RoleUsage): number {
  const MODEL_RATES: Record<string, { input: number; output: number }> = {
    "claude-opus-4-6": { input: 15, output: 75 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  };

  const rates = MODEL_RATES[usage.model];
  if (!rates) return 0;

  const uncachedInput = Math.max(
    0,
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens,
  );

  return (
    (uncachedInput * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheReadTokens * rates.input * 0.1 +
      usage.cacheWriteTokens * rates.input * 1.25) /
    1_000_000
  );
}

/**
 * Determine the color tier for a total cost in USD.
 */
export function costColor(totalUsd: number): "green" | "yellow" | "red" {
  if (totalUsd < 1) return "green";
  if (totalUsd < 5) return "yellow";
  return "red";
}

/**
 * Format a single event as a log line.
 */
export function formatEvent(event: KilnEvent): string {
  switch (event.type) {
    case "phase_changed": {
      const e = event as PhaseChangedEvent;
      return `[Phase] \u2192 ${e.phaseName}`;
    }
    case "task_started": {
      const e = event as TaskStartedEvent;
      const stmt =
        e.statement.length > 50
          ? e.statement.slice(0, 47) + "..."
          : e.statement;
      return `[Task] Started: ${stmt}`;
    }
    case "task_completed": {
      const e = event as TaskCompletedEvent;
      return `[Task] ${e.status}: ${e.taskId.slice(0, 8)}`;
    }
    case "tool_called": {
      const e = event as ToolCalledEvent;
      return `[Tool] ${e.toolName} (worker ${e.workerIndex})`;
    }
    case "cost_update": {
      const e = event as CostUpdateEvent;
      return `[Cost] $${e.totalCostUsd.toFixed(2)} total`;
    }
    case "error": {
      const e = event as ErrorEvent;
      return `[Error] ${e.message}`;
    }
    default:
      return `[${event.type}]`;
  }
}

/**
 * Format the activity log as an array of strings (last N events).
 */
export function formatActivityLog(
  events: readonly KilnEvent[],
  maxLines = 8,
): string[] {
  const recent = events.slice(-maxLines);
  return recent.map(formatEvent);
}

/**
 * Strip ANSI escape codes from a string.
 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1B(?:\[[0-9;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1B\\))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}
