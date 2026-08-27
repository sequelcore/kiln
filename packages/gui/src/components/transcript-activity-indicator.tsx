import { ThinkingOrb } from "thinking-orbs";

interface TranscriptActivityIndicatorProps {
  readonly details?: string;
}

export function TranscriptActivityIndicator(props: TranscriptActivityIndicatorProps) {
  const details = props.details?.slice(0, 40);
  const accessibleLabel = `Assistant activity: Thinking${details ? ` · ${details}` : ""}`;

  return (
    <span
      role="status"
      aria-atomic="true"
      aria-label={accessibleLabel}
      aria-live="polite"
      className="flex min-w-0 items-center gap-2 py-1 text-xs text-muted-foreground"
      data-orb-state="solving"
      data-role="transcript-activity"
    >
      <ThinkingOrb
        aria-hidden="true"
        data-orb-state="solving"
        data-role="activity-orb"
        role="presentation"
        size={20}
        speed={0.82}
        state="solving"
        theme="auto"
      />
      <span className="shrink-0 font-medium text-foreground">Thinking</span>
      {details ? (
        <span aria-hidden="true" className="min-w-0 truncate text-muted-foreground/80">
          {details}
        </span>
      ) : null}
    </span>
  );
}
