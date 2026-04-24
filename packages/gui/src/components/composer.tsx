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

  function handleDraftChange(value: string): void {
    if (value.trim() === "/") {
      setDraft("");
      props.onOpenCommandPalette();
      return;
    }
    setDraft(value);
  }

  return (
    <section className="border-t border-border bg-background px-4 py-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          props.onSubmit(draft);
          setDraft("");
        }}
        className="rounded-lg border border-border/90 bg-card px-3 py-2.5 shadow-[0_10px_34px_rgba(0,0,0,0.12)]"
      >
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
        <Textarea
          id="composer-input"
          ref={textareaRef}
          value={draft}
          wrap="soft"
          onChange={(event) => handleDraftChange(event.target.value)}
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
          rows={2}
          className="!min-h-11 max-h-40 resize-y border-0 bg-transparent px-0 py-0 text-sm leading-6 text-foreground shadow-none focus-visible:ring-0"
          placeholder="Message Kiln. Type / for commands, @ for files, Shift+Enter for newline."
        />
        <div className="mt-2 flex items-center gap-1.5 border-t border-border/70 pt-2">
          <button
            type="button"
            aria-label="Open command palette"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onOpenCommandPalette()}
            className="rounded border border-border px-2 py-1 font-mono text-[10px] leading-4 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            /command
          </button>
          <span className="rounded border border-border px-2 py-1 font-mono text-[10px] leading-4 text-muted-foreground">@files</span>
          <span className="hidden rounded border border-border px-2 py-1 font-mono text-[10px] leading-4 text-muted-foreground sm:inline-flex">approvals</span>
          <div className="mx-1 h-5 w-px bg-border/70" />
          <ActivityPhaseIndicator
            phase={props.activityPhase}
            toolName={props.activityToolName}
            details={props.activityDetails}
          />
          {props.resumeTargetId ? (
            <Badge variant="outline" className="hidden border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-accent)] md:inline-flex">
              Continuing
            </Badge>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant={props.planMode ? "secondary" : "outline"}
            aria-pressed={props.planMode}
            onClick={() => props.onTogglePlanMode(!props.planMode)}
            className={props.planMode ? "border-[var(--color-warning)] bg-[var(--color-warning)]/10 text-[var(--color-warning)]" : undefined}
          >
            Plan
          </Button>
          <div className="ml-auto hidden items-center gap-2 font-mono text-[10px] text-muted-foreground lg:flex">
            <span>
              route <span className="text-[var(--color-accent)]">{props.resumeTargetId ? "selected" : "new"}</span>
            </span>
          </div>
          <Button
            type="submit"
            disabled={!canSubmit || isBusy}
            variant="default"
            className="px-4"
          >
            Send
            <span aria-hidden="true" className="hidden font-mono text-[10px] opacity-70 sm:inline">Enter</span>
          </Button>
        </div>
      </form>
    </section>
  );
}
