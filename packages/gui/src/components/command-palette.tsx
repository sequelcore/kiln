import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CommandMenuSurface, type CommandPaletteItem } from "./command-menu-surface.js";

export type { CommandPaletteItem } from "./command-menu-surface.js";

interface CommandPaletteProps {
  readonly open: boolean;
  readonly title: string;
  readonly placeholder: string;
  readonly query: string;
  readonly commands: readonly CommandPaletteItem[];
  readonly canGoBack?: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onExecute: (command: CommandPaletteItem) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onBack?: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) {
    return null;
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent
        aria-label={props.title}
        className="top-1/3 max-w-md translate-y-0 overflow-hidden border border-border bg-card p-0 shadow-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.placeholder}</DialogDescription>
        </DialogHeader>
        <CommandMenuSurface
          title={props.title}
          placeholder={props.placeholder}
          query={props.query}
          commands={props.commands}
          canGoBack={props.canGoBack}
          onQueryChange={props.onQueryChange}
          onExecute={props.onExecute}
          onOpenChange={props.onOpenChange}
          onBack={props.onBack}
        />
      </DialogContent>
    </Dialog>
  );
}
