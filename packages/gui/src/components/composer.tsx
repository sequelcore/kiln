import { useState, type ReactNode } from "react";
import type { SessionStatus } from "../lib/session-store.js";
import { ComposerCommandMenu } from "./composer-command-menu.js";
import type { CommandPaletteItem } from "./command-menu-surface.js";
import { ArrowUp, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ComposerCommandMenuState {
  readonly open: boolean;
  readonly query: string;
  readonly commands: readonly CommandPaletteItem[];
  readonly onQueryChange: (value: string) => void;
  readonly onExecute: (command: CommandPaletteItem) => void;
  readonly onOpenChange: (open: boolean) => void;
}

interface ComposerProps {
  readonly status: SessionStatus;
  readonly planMode: boolean;
  readonly resumeTargetId: string | null;
  readonly providerControl?: ReactNode;
  readonly reasoningControl?: ReactNode;
  readonly commandMenu: ComposerCommandMenuState;
  readonly onSubmit: (text: string) => void;
  readonly onEmptySubmit: () => void;
  readonly onTogglePlanMode: (enabled: boolean) => void;
}

export function Composer(props: ComposerProps) {
  const [draft, setDraft] = useState("");
  const canSubmit = props.status === "ready" && draft.trim().length > 0;
  const isBusy = props.status === "running" || props.status === "connecting";

  function handleDraftChange(value: string): void {
    if (value.trim() === "/") {
      setDraft("");
      props.commandMenu.onOpenChange(true);
      return;
    }
    setDraft(value);
  }

  return (
    <section className="relative z-10 border-t border-border/60 bg-background/95 px-4 pb-3 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-background before:to-transparent before:content-[''] supports-[backdrop-filter]:bg-background/88">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          props.onSubmit(draft);
          setDraft("");
        }}
        className="relative mx-auto flex max-w-4xl flex-col gap-1.5"
      >
        <ComposerCommandMenu
          open={props.commandMenu.open}
          query={props.commandMenu.query}
          commands={props.commandMenu.commands}
          onQueryChange={props.commandMenu.onQueryChange}
          onExecute={props.commandMenu.onExecute}
          onOpenChange={props.commandMenu.onOpenChange}
        />
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
        <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-elevated)] transition-colors focus-within:border-ring/70">
          <Textarea
            id="composer-input"
            value={draft}
            wrap="soft"
            onChange={(event) => handleDraftChange(event.target.value)}
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
                props.commandMenu.onOpenChange(true);
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
            className="min-h-16 max-h-36 resize-none border-0 bg-transparent px-3 py-3 text-sm leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0"
            placeholder="Message Kiln"
          />
          <div className="flex min-h-10 flex-wrap items-center gap-2 border-t border-border/55 bg-background/55 px-2.5 py-1.5">
            {props.providerControl || props.reasoningControl ? (
              <div className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 sm:flex-none">
                {props.providerControl ? (
                  <div className="min-w-0 max-w-[min(100%,22rem)]">{props.providerControl}</div>
                ) : null}
                {props.reasoningControl}
              </div>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant={props.planMode ? "secondary" : "outline"}
              aria-pressed={props.planMode}
              aria-label="Plan"
              title="Plan"
              onClick={() => props.onTogglePlanMode(!props.planMode)}
            >
              <ListChecks aria-hidden="true" />
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || isBusy}
              variant="default"
              size="icon-sm"
              aria-label="Send message"
              title="Send message"
              className="ml-auto"
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
