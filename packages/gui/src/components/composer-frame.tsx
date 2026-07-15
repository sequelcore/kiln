import type { ClipboardEventHandler, FormEventHandler, KeyboardEventHandler, ReactNode } from "react";
import { BorderBeam } from "border-beam";
import type { ActivityPhase } from "../lib/session-store.js";
import type { ComposerContinuityHint } from "../lib/session-continuity-view.js";
import { resolveBorderBeamTheme } from "../lib/border-beam-theme.js";
import { useUiStore } from "../lib/ui-store.js";
import { ActivityPhaseAnnouncement } from "./activity-phase-announcement.js";
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

export interface ComposerActivity {
  readonly phase: Exclude<ActivityPhase, "idle">;
  readonly toolName?: string;
  readonly details?: string;
}

export function ComposerFrame(props: {
  readonly draft: string;
  readonly continuityHint: ComposerContinuityHint;
  readonly contextUsage?: ContextUsageProjection | null;
  readonly turnActive: boolean;
  readonly activity?: ComposerActivity;
  readonly providerControl?: ReactNode;
  readonly reasoningControl?: ReactNode;
  readonly authorityControl?: ReactNode;
  readonly commandMenu: ComposerCommandMenuState;
  readonly leadingActions: ReactNode;
  readonly trailingActions: ReactNode;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly onDraftChange: (value: string) => void;
  readonly onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  readonly onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
}) {
  const hasRuntimeControls = Boolean(props.providerControl || props.reasoningControl || props.authorityControl);
  const kilnTheme = useUiStore((state) => state.theme);
  const beamTheme = resolveBorderBeamTheme(kilnTheme);
  const beamActive = props.turnActive && props.activity?.phase !== "awaiting_approval";

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
        {props.activity ? (
          <ActivityPhaseAnnouncement
            phase={props.activity.phase}
            toolName={props.activity.toolName}
            details={props.activity.details}
          />
        ) : null}
        <BorderBeam
          active={beamActive}
          className="w-full"
          colorVariant="colorful"
          data-beam-motion="pulse"
          data-beam-palette="colorful"
          data-beam-theme={beamTheme}
          data-role="composer-activity-beam"
          data-state={props.activity?.phase ?? "idle"}
          duration={2.8}
          size="pulse-outside"
          strength={0.7}
          theme={beamTheme}
        >
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
              onPaste={props.onPaste}
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
                  <ContextMeter usage={props.contextUsage} />
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
        </BorderBeam>
      </form>
    </section>
  );
}
