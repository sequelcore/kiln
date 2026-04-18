import type { GuiConnectionState } from "../lib/ws-client.js";

interface ConnectionStatusProps {
  readonly state: GuiConnectionState;
}

function labelForState(state: GuiConnectionState): string {
  switch (state) {
    case "open":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "closed":
      return "Disconnected";
    default:
      return "Idle";
  }
}

function dotClassForState(state: GuiConnectionState): string {
  switch (state) {
    case "open":
      return "bg-[var(--color-success)]";
    case "reconnecting":
      return "bg-[var(--color-warning)]";
    case "connecting":
      return "bg-[var(--color-info)]";
    case "closed":
      return "bg-[var(--color-error)]";
    default:
      return "bg-[var(--color-text-muted)]";
  }
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const label = labelForState(props.state);
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
      <span className={`h-2 w-2 rounded-full ${dotClassForState(props.state)}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

