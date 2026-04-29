import type { ActivityPhase } from "../lib/session-store.js";

interface ActivityPhaseIndicatorProps {
  readonly phase: ActivityPhase;
  readonly toolName?: string;
  readonly details?: string;
}

function phaseLabel(phase: ActivityPhase): string {
  switch (phase) {
    case "idle":
      return "Ready";
    case "thinking":
      return "Thinking";
    case "tool_running":
      return "Running tool";
    case "awaiting_approval":
      return "Awaiting approval";
    case "streaming":
      return "Responding";
    default:
      return "Ready";
  }
}

function phaseColorClass(phase: ActivityPhase): string {
  switch (phase) {
    case "idle":
      return "text-[var(--color-text-muted)]";
    case "thinking":
      return "text-[var(--color-accent)]";
    case "tool_running":
      return "text-[var(--color-info)]";
    case "awaiting_approval":
      return "text-[var(--color-warning)]";
    case "streaming":
      return "text-[var(--color-success)]";
    default:
      return "text-[var(--color-text-muted)]";
  }
}

function spinnerClass(phase: ActivityPhase): string {
  if (phase === "idle") return "hidden";
  return "inline-block size-2 animate-pulse rounded-full bg-current";
}

export function ActivityPhaseIndicator(props: ActivityPhaseIndicatorProps) {
  const isActive = props.phase !== "idle";
  const label = phaseLabel(props.phase);
  const colorClass = phaseColorClass(props.phase);
  const truncatedDetails = props.details ? props.details.slice(0, 40) : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Activity phase: ${label}${props.toolName ? ` · ${props.toolName}` : ""}${truncatedDetails ? ` · ${truncatedDetails}` : ""}`}
      className={`inline-flex items-center gap-1.5 text-xs ${colorClass}`}
    >
      {isActive ? (
        <span aria-hidden="true" className={spinnerClass(props.phase)} />
      ) : null}
      <span>{label}</span>
      {props.toolName && props.phase === "tool_running" ? (
        <span className="text-[var(--color-text-muted)]">· {props.toolName}</span>
      ) : null}
      {truncatedDetails && props.phase !== "idle" && props.phase !== "streaming" ? (
        <span className="max-w-[160px] truncate text-[var(--color-text-muted)]">· {truncatedDetails}</span>
      ) : null}
    </div>
  );
}
