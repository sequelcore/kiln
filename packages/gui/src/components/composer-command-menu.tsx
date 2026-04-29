import type { CommandPaletteItem } from "./command-menu-surface.js";
import { CommandMenuSurface } from "./command-menu-surface.js";

interface ComposerCommandMenuProps {
  readonly open: boolean;
  readonly query: string;
  readonly commands: readonly CommandPaletteItem[];
  readonly onQueryChange: (value: string) => void;
  readonly onExecute: (command: CommandPaletteItem) => void;
  readonly onOpenChange: (open: boolean) => void;
}

export function ComposerCommandMenu(props: ComposerCommandMenuProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Composer commands"
      className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
    >
      <CommandMenuSurface
        title="Composer Commands"
        placeholder="Filter commands"
        query={props.query}
        commands={props.commands}
        onQueryChange={props.onQueryChange}
        onExecute={props.onExecute}
        onOpenChange={props.onOpenChange}
      />
    </div>
  );
}
