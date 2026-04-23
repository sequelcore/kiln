import { useEffect, useMemo, useRef } from "react";
import type { GuiSessionSummary } from "@kilnai/gateway-contracts";

interface SessionListProps {
  readonly sessions: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly resumeTargetId: string | null;
  readonly onSelect: (sessionId: string) => void;
  readonly onStartNewSession: () => void;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeProviders(session: GuiSessionSummary): string {
  const providers = session.providersUsed.length > 0
    ? session.providersUsed
    : session.lastProvider
      ? [session.lastProvider]
      : [];
  if (providers.length === 0) {
    return "No provider yet";
  }
  if (providers.length <= 2) {
    return providers.join(" + ");
  }
  return `${providers.slice(0, 2).join(" + ")} +${providers.length - 2}`;
}

export function SessionList(props: SessionListProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = useMemo(
    () => props.sessions.findIndex((session) => session.id === props.selectedSessionId),
    [props.selectedSessionId, props.sessions],
  );

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, props.sessions.length);
  }, [props.sessions.length]);

  function focusIndex(index: number): void {
    const bounded = Math.max(0, Math.min(index, props.sessions.length - 1));
    const session = props.sessions[bounded];
    if (!session) {
      return;
    }
    props.onSelect(session.id);
    itemRefs.current[bounded]?.focus();
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-background-panel)]">
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Sessions
        </p>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {props.sessions.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-background)]/60 px-3 py-4 text-sm text-[var(--color-text-muted)]">
            No recent sessions yet.
          </p>
        ) : (
          <ul role="listbox" aria-label="Session history" className="space-y-2">
            {props.sessions.map((session, index) => {
              const selected = props.selectedSessionId === session.id;
              const resume = props.resumeTargetId === session.id;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    role="option"
                    aria-selected={selected}
                    tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
                    onClick={() => props.onSelect(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "j") {
                        event.preventDefault();
                        focusIndex(index + 1 >= props.sessions.length ? 0 : index + 1);
                        return;
                      }
                      if (event.key === "ArrowUp" || event.key === "k") {
                        event.preventDefault();
                        focusIndex(index <= 0 ? props.sessions.length - 1 : index - 1);
                        return;
                      }
                      if (event.key === "Home") {
                        event.preventDefault();
                        focusIndex(0);
                        return;
                      }
                      if (event.key === "End") {
                        event.preventDefault();
                        focusIndex(props.sessions.length - 1);
                      }
                    }}
                    className={[
                      "w-full rounded-md border px-3 py-2 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
                      selected
                        ? "border-[var(--color-border-active)] bg-[var(--color-background-element)]"
                        : "border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-background-element)]",
                    ].join(" ")}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                        {summarizeProviders(session)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {selected ? (
                          <span className="text-[11px] text-[var(--color-text-muted)]">Loaded</span>
                        ) : null}
                        {resume ? (
                          <span className="text-[11px] text-[var(--color-accent)]">Active</span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-sm text-[var(--color-text)]">{session.title ?? session.taskSummary}</p>
                    {session.summary ? (
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-muted)]">{session.summary}</p>
                    ) : null}
                    {session.tags && session.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {session.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                      <span>{formatDate(session.completedAt)}</span>
                      <span>{formatCurrency(session.cost)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="border-t border-[var(--color-border)] px-3 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={props.onStartNewSession}
            className="w-full rounded border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            New Session
          </button>
        </div>
      </footer>
    </aside>
  );
}
