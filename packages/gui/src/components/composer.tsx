import { useRef, useState } from "react";
import type { ActivityPhase, SessionStatus } from "../lib/session-store.js";
import { ActivityPhaseIndicator } from "./activity-phase-indicator.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
    <section className="border-t border-border bg-card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <ActivityPhaseIndicator
          phase={props.activityPhase}
          toolName={props.activityToolName}
          details={props.activityDetails}
        />
        {props.planMode ? (
          <Badge variant="outline" className="border-[var(--color-warning)]/60 bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
            Plan mode
          </Badge>
        ) : null}
        {props.resumeTargetId ? (
          <Badge variant="outline" className="border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
            Continuing session
          </Badge>
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
        <Textarea
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
          className="min-h-14 flex-1 resize-y break-words bg-background text-foreground"
          placeholder="Send a message (Shift+Enter for newline)"
        />
        <Button
          type="button"
          variant={props.planMode ? "secondary" : "outline"}
          aria-pressed={props.planMode}
          onClick={() => props.onTogglePlanMode(!props.planMode)}
          className={props.planMode ? "border-[var(--color-warning)] bg-[var(--color-warning)]/10 text-[var(--color-warning)]" : undefined}
        >
          Plan
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit || isBusy}
          variant="default"
          className="px-4"
        >
          Send
        </Button>
      </form>
    </section>
  );
}
