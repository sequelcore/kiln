import type { GuiConnectionState } from "../lib/ws-client.js";
import { cn } from "@/lib/utils";

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
    <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dotClassForState(props.state))} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
