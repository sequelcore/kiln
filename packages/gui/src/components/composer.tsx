import { useRef, useState } from "react";
import type { ActivityPhase, SessionStatus } from "../lib/session-store.js";
import { ActivityPhaseIndicator } from "./activity-phase-indicator.js";

interface ComposerProps {
  readonly status: SessionStatus;
  readonly planMode: boolean;
  readonly activityLabel: string | null;
  readonly activityPhase: ActivityPhase;
  readonly activityToolName?: string;
  readonly activityDetails?: string;
  readonly resumeTargetId: string | null;
  readonly onSubmit: (text: string) => void;
  readonly onEmptySubmit: () => void;
  readonly onTogglePlanMode: (enabled: boolean) => void;
  readonly onOpenCommandPalette: () => void;
}

export function Composer(props: ComposerProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const nextSelectionRef = useRef<number | null>(null);
  const canSubmit = props.status === "ready" && draft.trim().length > 0;
  const isBusy = props.status === "running" || props.status === "connecting";

  function normalizePastedText(value: string): string {
    return value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
  }

  return (
    <section className="border-t border-[var(--color-border)] bg-[var(--color-background-panel)] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <ActivityPhaseIndicator
          phase={props.activityPhase}
          toolName={props.activityToolName}
          details={props.activityDetails}
        />
        {props.planMode ? (
          <span className="rounded border border-[var(--color-warning)]/60 bg-[var(--color-warning)]/10 px-2 py-0.5 text-[var(--color-warning)]">
            Plan mode
          </span>
        ) : null}
        {props.resumeTargetId ? (
          <span className="rounded border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[var(--color-accent)]">
            Continuing session
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
          ref={textareaRef}
          value={draft}
          wrap="soft"
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (!pasted) {
              return;
            }
            const normalized = normalizePastedText(pasted);
            event.preventDefault();
            const target = event.currentTarget;
            const selectionStart = target.selectionStart ?? draft.length;
            const selectionEnd = target.selectionEnd ?? draft.length;
            const nextDraft = `${draft.slice(0, selectionStart)}${normalized}${draft.slice(selectionEnd)}`;
            nextSelectionRef.current = selectionStart + normalized.length;
            setDraft(nextDraft);
            queueMicrotask(() => {
              const nextSelection = nextSelectionRef.current;
              const textarea = textareaRef.current;
              if (nextSelection === null || !textarea) {
                return;
              }
              textarea.setSelectionRange(nextSelection, nextSelection);
              nextSelectionRef.current = null;
            });
          }}
          onKeyDown={(event) => {
            if (
              event.key === "/"
              && !event.shiftKey
              && !event.altKey
              && !event.ctrlKey
              && !event.metaKey
              && draft.trim().length === 0
            ) {
              event.preventDefault();
              props.onOpenCommandPalette();
              return;
            }
            if (event.key !== "Enter") return;
            if (event.shiftKey) return;
            event.preventDefault();
            if (props.status !== "ready") {
              return;
            }
            if (!draft.trim()) {
              props.onEmptySubmit();
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
