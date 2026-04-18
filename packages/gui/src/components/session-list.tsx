import type { GuiSessionSummary } from "@kilnai/gateway-contracts";

interface SessionListProps {
  readonly sessions: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly resumeTargetId: string | null;
  readonly activeProvider: string | null;
  readonly onSelect: (sessionId: string) => void;
  readonly onConfirmResume: (sessionId: string) => void;
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

export function SessionList(props: SessionListProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-background-panel)]">
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Sessions {props.activeProvider ? `(${props.activeProvider})` : ""}
        </p>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {props.sessions.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-background)]/60 px-3 py-4 text-sm text-[var(--color-text-muted)]">
            No recent sessions for this provider yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {props.sessions.map((session) => {
              const selected = props.selectedSessionId === session.id;
              const resume = props.resumeTargetId === session.id;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(session.id)}
                    onDoubleClick={() => props.onConfirmResume(session.id)}
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
                        {session.provider}
                      </span>
                      {resume ? (
                        <span className="text-[11px] text-[var(--color-accent)]">Resume target</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-[var(--color-text)]">{session.taskSummary}</p>
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
        <button
          type="button"
          disabled={!props.selectedSessionId}
          onClick={() => {
            if (props.selectedSessionId) {
              props.onConfirmResume(props.selectedSessionId);
            }
          }}
          className="w-full rounded border border-[var(--color-border-active)] bg-[var(--color-background-element)] px-3 py-2 text-sm text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Set Resume Target
        </button>
      </footer>
    </aside>
  );
}
