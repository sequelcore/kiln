import type { FormEventHandler, KeyboardEventHandler, ReactNode } from "react";
import type { ComposerContinuityHint } from "../lib/session-continuity-view.js";
import type { CommandPaletteItem } from "./command-menu-surface.js";
import { ComposerCommandMenu } from "./composer-command-menu.js";
import { ComposerContinuityChip } from "./composer-continuity-chip.js";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  readonly providerControl?: ReactNode;
  readonly reasoningControl?: ReactNode;
  readonly authorityControl?: ReactNode;
  readonly commandMenu: ComposerCommandMenuState;
  readonly leadingActions: ReactNode;
  readonly trailingActions: ReactNode;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly onDraftChange: (value: string) => void;
  readonly onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  const hasRuntimeControls = Boolean(props.providerControl || props.reasoningControl || props.authorityControl);

  return (
    <section className="relative z-10 bg-workspace-viewer px-4 pb-4 pt-2">
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
          onOpenChange={props.commandMenu.onOpenChange}
        />
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
        <InputGroup
          className="overflow-hidden rounded-xl border-border bg-workspace-viewer-panel shadow-[var(--shadow-elevated)] focus-within:border-ring/70"
          data-composer-surface="message"
        >
          <InputGroupTextarea
            id="composer-input"
            value={props.draft}
            wrap="soft"
            rows={1}
            onChange={(event) => props.onDraftChange(event.target.value)}
            onKeyDown={props.onKeyDown}
            className="min-h-14 max-h-44 px-3 py-2.5 text-sm leading-6"
            placeholder="Message Kiln"
          />
          <InputGroupAddon align="block-end" aria-label="Message options" className="px-2 py-1.5">
            <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 md:grid-cols-[auto_minmax(0,1fr)_auto]">
              <div className="flex min-w-0 items-center gap-1">
                {props.leadingActions}
                {props.authorityControl ? (
                  <div className="min-w-0">{props.authorityControl}</div>
                ) : null}
              </div>
              <div className="hidden min-w-0 md:block" />
              <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-1 md:col-span-1 md:flex-nowrap">
              <ComposerContinuityChip hint={props.continuityHint} />
                <ComposerContextIndicator />
              {hasRuntimeControls ? (
                  <>
                  {props.providerControl ? (
                      <div className="min-w-32 max-w-64 flex-1 md:flex-none">{props.providerControl}</div>
                  ) : null}
                  {props.reasoningControl ? (
                    <div className="shrink-0">{props.reasoningControl}</div>
                  ) : null}
                  </>
              ) : null}
                {props.trailingActions}
              </div>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  );
}

function ComposerContextIndicator() {
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={(
            <span
              role="status"
              aria-label="Context usage unavailable"
              className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-background/60 text-muted-foreground"
            >
              <span className="size-2 rounded-full border border-muted-foreground/45" aria-hidden="true" />
            </span>
          )}
        />
        <TooltipContent>Context usage unavailable</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
