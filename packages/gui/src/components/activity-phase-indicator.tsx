import { ThinkingOrb, type OrbState } from "thinking-orbs";
import type { ActivityPhase } from "../lib/session-store/index.js";

interface ActivityPhaseIndicatorProps {
  readonly phase: ActivityPhase;
  readonly toolName?: string;
  readonly details?: string;
}

function phaseLabel(phase: ActivityPhase, toolName?: string): string {
  switch (phase) {
    case "thinking":
      return "Thinking";
    case "tool_running":
      return toolName ? `Using ${toolName}` : "Using tool";
    case "awaiting_approval":
      return "Awaiting approval";
    case "streaming":
      return "Responding";
    default:
      return "Ready";
  }
}

function phaseOrbState(phase: ActivityPhase): OrbState {
  switch (phase) {
    case "thinking":
      return "solving";
    case "streaming":
      return "composing";
    case "tool_running":
    case "awaiting_approval":
    case "idle":
      return "working";
  }
}

export function ActivityPhaseIndicator(props: ActivityPhaseIndicatorProps) {
  const label = phaseLabel(props.phase, props.toolName);
  const toolLabel = props.toolName && !label.includes(props.toolName) ? ` · ${props.toolName}` : "";
  const details = props.details?.slice(0, 40);
  const accessibleLabel = `Activity phase: ${label}${toolLabel}${details ? ` · ${details}` : ""}`;
  const orbState = phaseOrbState(props.phase);
  const paused = props.phase === "awaiting_approval";

  return (
    <span
      role="status"
      aria-atomic="true"
      aria-label={accessibleLabel}
      aria-live="polite"
      className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground"
      data-orb-paused={paused ? "true" : undefined}
      data-orb-state={orbState}
      data-role="composer-activity"
    >
      <ThinkingOrb
        aria-hidden="true"
        data-orb-state={orbState}
        data-role="activity-orb"
        paused={paused}
        role="presentation"
        size={20}
        speed={0.82}
        state={orbState}
        theme="auto"
      />
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      {details ? (
        <span aria-hidden="true" className="min-w-0 truncate text-muted-foreground/80">
          {details}
        </span>
      ) : null}
    </span>
  );
}
