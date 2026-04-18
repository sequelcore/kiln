import { useMemo, useState } from "react";
import type { SessionStatus } from "../lib/session-store.js";

interface ComposerProps {
  readonly status: SessionStatus;
  readonly planMode: boolean;
  readonly activityLabel: string | null;
  readonly resumeTargetId: string | null;
  readonly onSubmit: (text: string) => void;
  readonly onTogglePlanMode: (enabled: boolean) => void;
}

export function Composer(props: ComposerProps) {
  const [draft, setDraft] = useState("");
  const canSubmit = props.status === "ready" && draft.trim().length > 0;
  const isBusy = props.status === "running" || props.status === "connecting";

  const statusText = useMemo(() => {
    if (props.activityLabel) {
      return props.activityLabel;
    }
    if (props.status === "running") return "Working...";
    if (props.status === "connecting") return "Connecting...";
    if (props.status === "error") return "Recovering...";
    return "Ready";
  }, [props.activityLabel, props.status]);

  return (
    <section className="border-t border-[var(--color-border)] bg-[var(--color-background-panel)] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span>{statusText}</span>
        {props.planMode ? (
          <span className="rounded border border-[var(--color-warning)]/60 bg-[var(--color-warning)]/10 px-2 py-0.5 text-[var(--color-warning)]">
            Plan mode
          </span>
        ) : null}
        {props.resumeTargetId ? (
          <span className="rounded border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[var(--color-accent)]">
            Resume set
          </span>
        ) : null}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          props.onSubmit(draft);
          setDraft("");
        }}
        className="flex items-end gap-2"
      >
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
        <textarea
          id="composer-input"
          value={draft}
          wrap="soft"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (event.shiftKey) return;
            event.preventDefault();
            if (props.status !== "ready") {
              return;
            }
            if (!draft.trim()) {
              return;
            }
            props.onSubmit(draft);
            setDraft("");
          }}
          rows={3}
          className="min-h-[56px] flex-1 resize-y break-words rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          placeholder="Send a message (Shift+Enter for newline)"
        />
        <button
          type="button"
          aria-pressed={props.planMode}
          onClick={() => props.onTogglePlanMode(!props.planMode)}
          className={[
            "rounded border px-3 py-2 text-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
            props.planMode
              ? "border-[var(--color-warning)] bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          Plan
        </button>
        <button
          type="submit"
          disabled={!canSubmit || isBusy}
          className="rounded border border-[var(--color-border-active)] bg-[var(--color-background-element)] px-4 py-2 text-sm text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
