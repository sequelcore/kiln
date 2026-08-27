import { useRef, type ClipboardEventHandler, type FormEventHandler, type KeyboardEventHandler, type ReactNode } from "react";
import type { ComposerContinuityHint } from "../lib/session-continuity-view.js";
import type { CommandPaletteItem } from "./command-menu-surface.js";
import { ComposerCommandMenu } from "./composer-command-menu.js";
import { ComposerContinuityChip } from "./composer-continuity-chip.js";
import { ContextMeter } from "@/components/ai-elements/context";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import type { ContextUsageProjection } from "@kilnai/gateway-contracts";

export interface ComposerCommandMenuState {
  readonly open: boolean;
  readonly query: string;
  readonly commands: readonly CommandPaletteItem[];
  readonly onQueryChange: (value: string) => void;
  readonly onExecute: (command: CommandPaletteItem) => void;
  readonly onOpenChange: (open: boolean) => void;
}

export function ComposerFrame(props: {
  readonly draft: string;
  readonly continuityHint: ComposerContinuityHint;
  readonly contextUsage?: ContextUsageProjection | null;
  readonly activeGoal?: ReactNode;
  readonly providerControl?: ReactNode;
  readonly authorityControl?: ReactNode;
  readonly commandMenu: ComposerCommandMenuState;
  readonly attachments?: ReactNode;
  readonly feedback?: ReactNode;
  readonly leadingActions: ReactNode;
  readonly turnSettings?: ReactNode;
  readonly trailingActions: ReactNode;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly onDraftChange: (value: string) => void;
  readonly onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  readonly onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <section className="relative z-10 bg-transparent px-4 pb-4 pt-2">
      <form
        onSubmit={props.onSubmit}
        className="relative mx-auto flex w-full max-w-3xl flex-col gap-2"
      >
        <ComposerCommandMenu
          open={props.commandMenu.open}
          query={props.commandMenu.query}
          commands={props.commandMenu.commands}
          onQueryChange={props.commandMenu.onQueryChange}
          onExecute={props.commandMenu.onExecute}
          onOpenChange={(open) => {
            props.commandMenu.onOpenChange(open);
            if (!open) {
              inputRef.current?.focus();
            }
          }}
        />
        {props.activeGoal}
        {props.feedback}
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
        <InputGroup
          className="overflow-hidden rounded-xl border-border bg-workspace-viewer-panel focus-within:border-ring/70"
          data-composer-surface="message"
        >
          <InputGroupTextarea
            ref={inputRef}
            id="composer-input"
            value={props.draft}
            wrap="soft"
            rows={1}
            onChange={(event) => props.onDraftChange(event.target.value)}
            onKeyDown={props.onKeyDown}
            onPaste={props.onPaste}
            className="min-h-14 max-h-44 px-3 py-2.5 text-sm leading-6"
            placeholder="Describe the outcome or ask a follow-up…"
          />
          {props.attachments}
          <InputGroupAddon align="block-end" aria-label="Message options" className="px-2 py-1.5">
            <div className="flex w-full min-w-0 flex-wrap items-center gap-1">
              <div
                className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
                data-role="composer-secondary-controls"
              >
                <div className="shrink-0" data-role="composer-leading-actions">
                  {props.leadingActions}
                </div>
                {props.authorityControl ? (
                  <div className="min-w-0 shrink-0">{props.authorityControl}</div>
                ) : null}
                {props.providerControl ? (
                  <div className="min-w-32 max-w-64 flex-1 sm:flex-none">{props.providerControl}</div>
                ) : null}
                {props.turnSettings ? <div className="shrink-0">{props.turnSettings}</div> : null}
                <ComposerContinuityChip hint={props.continuityHint} />
                <ContextMeter usage={props.contextUsage} />
              </div>
              <div className="flex shrink-0 items-center justify-end">
                {props.trailingActions}
              </div>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  );
}
