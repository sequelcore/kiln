import type { ActivityPhase } from "../lib/session-store/index.js";

interface ActivityPhaseAnnouncementProps {
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

export function ActivityPhaseAnnouncement(props: ActivityPhaseAnnouncementProps) {
  const label = phaseLabel(props.phase, props.toolName);
  const toolLabel = props.toolName && !label.includes(props.toolName) ? ` · ${props.toolName}` : "";
  const details = props.details?.slice(0, 40);
  const accessibleLabel = `Activity phase: ${label}${toolLabel}${details ? ` · ${details}` : ""}`;

  return (
    <span
      role="status"
      aria-atomic="true"
      aria-label={accessibleLabel}
      aria-live="polite"
      className="sr-only"
    />
  );
}
