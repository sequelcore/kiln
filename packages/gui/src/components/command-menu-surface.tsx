import { useMemo, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

export interface CommandPaletteItem {
  readonly id: string;
  readonly trigger: string;
  readonly title: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly disabled?: boolean;
}

interface CommandMenuSurfaceProps {
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

function matchesQuery(command: CommandPaletteItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    command.trigger,
    command.title,
    command.description ?? "",
    ...(command.keywords ?? []),
  ].join(" ").toLowerCase();
  return haystack.includes(normalized);
}

export function CommandMenuSurface(props: CommandMenuSurfaceProps) {
  const filteredCommands = useMemo(
    () => props.commands.filter((command) => matchesQuery(command, props.query)),
    [props.commands, props.query],
  );

  const onCommandKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (props.canGoBack && props.onBack) {
        props.onBack();
        return;
      }
      props.onOpenChange(false);
    }
  };

  return (
    <div role="presentation" className="overflow-hidden rounded-xl bg-popover text-popover-foreground">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{props.title}</p>
        <div className="flex items-center gap-2">
          {props.canGoBack ? (
            <Button type="button" size="xs" variant="outline" onClick={() => props.onBack?.()}>
              Back
            </Button>
          ) : null}
          <Button type="button" size="xs" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
        </div>
      </div>
      <Command shouldFilter={false} onKeyDown={onCommandKeyDown}>
        <CommandInput
          autoFocus
          value={props.query}
          onValueChange={props.onQueryChange}
          placeholder={props.placeholder}
        />
        <CommandList aria-label={`${props.title} commands`} className="p-2">
          {filteredCommands.length === 0 ? (
            <CommandEmpty className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-4 text-muted-foreground">
              No commands match.
            </CommandEmpty>
          ) : (
            <CommandGroup>
              {filteredCommands.map((command) => (
                  <CommandItem
                    key={command.id}
                    value={command.id}
                    disabled={command.disabled}
                    onSelect={() => {
                      if (!command.disabled) {
                        props.onExecute(command);
                      }
                    }}
                    className="items-start rounded-lg border border-transparent px-3 py-2 data-selected:border-ring data-selected:bg-secondary"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-foreground">{command.title}</span>
                        <CommandShortcut>/{command.trigger}</CommandShortcut>
                      </div>
                      {command.description ? (
                        <p className="mt-1 text-xs text-muted-foreground">{command.description}</p>
                      ) : null}
                    </div>
                  </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  );
}
