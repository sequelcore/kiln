import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface CommandPaletteItem {
  readonly id: string;
  readonly trigger: string;
  readonly title: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly disabled?: boolean;
}

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

export function CommandPalette(props: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = useMemo(
    () => props.commands.filter((command) => matchesQuery(command, props.query)),
    [props.commands, props.query],
  );

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setSelectedIndex(0);
  }, [props.open, props.query, props.title]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    inputRef.current?.focus();
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const activeCommand = filteredCommands[selectedIndex] ?? null;

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent
        aria-label={props.title}
        className="top-1/3 max-w-md translate-y-0 overflow-hidden border border-border bg-card p-0 shadow-2xl"
        showCloseButton={false}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (props.canGoBack && props.onBack) {
              props.onBack();
              return;
            }
            props.onOpenChange(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((current) => (
              filteredCommands.length === 0
                ? 0
                : (current + 1) % filteredCommands.length
            ));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((current) => (
              filteredCommands.length === 0
                ? 0
                : current <= 0
                  ? filteredCommands.length - 1
                  : current - 1
            ));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (!activeCommand || activeCommand.disabled) {
              return;
            }
            props.onExecute(activeCommand);
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.placeholder}</DialogDescription>
        </DialogHeader>
      <Command shouldFilter={false}>
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
        <CommandInput
          ref={inputRef}
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
              {filteredCommands.map((command, index) => {
                const selected = index === selectedIndex;
                return (
                  <CommandItem
                    key={command.id}
                    value={command.id}
                    aria-selected={selected}
                    disabled={command.disabled}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onSelect={() => {
                      if (!command.disabled) {
                        props.onExecute(command);
                      }
                    }}
                    className={cn(
                      "items-start rounded-lg border border-transparent px-3 py-2",
                      selected ? "border-ring bg-secondary" : "hover:bg-secondary",
                    )}
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
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
      </DialogContent>
    </Dialog>
  );
}
