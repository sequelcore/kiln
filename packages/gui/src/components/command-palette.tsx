import { useEffect, useMemo, useRef, useState } from "react";

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
    <div className="absolute right-3 top-14 z-30 w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-background-panel)] p-2 shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{props.title}</p>
        <div className="flex items-center gap-2">
          {props.canGoBack ? (
            <button
              type="button"
              onClick={() => props.onBack?.()}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => props.onOpenChange(false)}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            Close
          </button>
        </div>
      </div>
      <div
        role="dialog"
        aria-modal="false"
        aria-label={props.title}
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
        <label className="sr-only" htmlFor="command-palette-input">
          Filter commands
        </label>
        <input
          id="command-palette-input"
          ref={inputRef}
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={props.placeholder}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
        />
        <div role="listbox" aria-label={`${props.title} commands`} className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <p className="rounded border border-dashed border-[var(--color-border)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
              No commands match.
            </p>
          ) : (
            filteredCommands.map((command, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={command.disabled}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    if (!command.disabled) {
                      props.onExecute(command);
                    }
                  }}
                  className={[
                    "w-full rounded border px-3 py-2 text-left",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
                    command.disabled
                      ? "cursor-not-allowed border-[var(--color-border)] bg-[var(--color-background)]/70 text-[var(--color-text-muted)] opacity-60"
                      : selected
                        ? "border-[var(--color-border-active)] bg-[var(--color-background-element)]"
                        : "border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-background-element)]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[var(--color-text)]">{command.title}</span>
                    <span className="font-mono text-xs text-[var(--color-text-muted)]">/{command.trigger}</span>
                  </div>
                  {command.description ? (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{command.description}</p>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
