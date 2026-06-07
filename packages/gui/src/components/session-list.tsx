import { useEffect, useMemo, useRef } from "react";
import type { GuiSessionSummary } from "@kilnai/gateway-contracts";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionContinuity } from "@/lib/session-continuity";
import { buildSessionRowBadges, type SessionContinuityTone } from "@/lib/session-continuity-view";
import { cn } from "@/lib/utils";

interface SessionListProps {
  readonly sessions: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly continuity: SessionContinuity;
  readonly onSelect: (sessionId: string) => void;
  readonly onStartNewSession: () => void;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return dateFormatter.format(date);
}

function sessionProviders(session: GuiSessionSummary): readonly string[] {
  if (session.providersUsed.length > 0) {
    return session.providersUsed;
  }
  return session.lastProvider ? [session.lastProvider] : [];
}

function summarizeProviders(session: GuiSessionSummary): string {
  const providers = sessionProviders(session);
  if (providers.length === 0) {
    return "No provider yet";
  }
  if (providers.length <= 2) {
    return providers.join(" + ");
  }
  return `${providers.slice(0, 2).join(" + ")} +${providers.length - 2}`;
}

function groupSessions(sessions: readonly GuiSessionSummary[]) {
  const today = new Date().toDateString();
  const groups = new Map<string, GuiSessionSummary[]>();
  for (const session of sessions) {
    const date = new Date(session.completedAt);
    const label = !Number.isNaN(date.getTime()) && date.toDateString() === today ? "Today" : "Earlier";
    const current = groups.get(label) ?? [];
    current.push(session);
    groups.set(label, current);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function badgeClass(tone: SessionContinuityTone): string {
  switch (tone) {
    case "accent":
      return "border-[var(--color-accent)]/35 text-[var(--color-accent)]";
    case "info":
      return "border-blue-500/30 text-blue-600 dark:text-blue-300";
    case "warning":
      return "border-amber-500/35 text-amber-700 dark:text-amber-300";
    case "danger":
      return "border-destructive/30 text-destructive";
    case "muted":
      return "border-muted-foreground/30 text-muted-foreground";
  }
}

function railClass(tone: SessionContinuityTone | undefined): string {
  switch (tone) {
    case "accent":
      return "bg-[var(--color-accent)]/80";
    case "info":
      return "bg-blue-500/75";
    case "warning":
      return "bg-amber-500/80";
    case "danger":
      return "bg-destructive/80";
    case "muted":
    case undefined:
      return "bg-border";
  }
}

export function SessionList(props: SessionListProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = useMemo(
    () => props.sessions.findIndex((session) => session.id === props.selectedSessionId),
    [props.selectedSessionId, props.sessions],
  );
  const sessionGroups = useMemo(() => groupSessions(props.sessions), [props.sessions]);

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
    <section aria-label="Sessions" className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex min-h-11 items-center gap-2 border-b border-border/60 px-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">Sessions</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="New Session"
          title="New Session"
          onClick={props.onStartNewSession}
          className="text-muted-foreground"
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.sessions.length === 0 ? (
          <div className="grid h-full place-items-center px-5 py-12 text-center">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">No sessions yet</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Start a conversation to keep transcripts and handoffs here.
              </p>
            </div>
          </div>
        ) : (
          <div role="listbox" aria-label="Session history" className="py-1">
            {sessionGroups.map((group) => (
              <section key={group.label}>
                <div className="px-3 pb-1 pt-3 first:pt-2">
                  <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/65">{group.label}</p>
                </div>
                <ul className="flex flex-col gap-0.5 px-1.5">
                  {group.items.map((session) => {
                    const index = props.sessions.findIndex((item) => item.id === session.id);
                    const selected = props.selectedSessionId === session.id;
                    const badges = buildSessionRowBadges({
                      sessionId: session.id,
                      continuity: props.continuity,
                      outcome: session.lastTurnOutcome === "failed" || session.lastTurnOutcome === "cancelled"
                        ? session.lastTurnOutcome
                        : null,
                    });
                    const railTone = badges[0]?.tone;
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
                          className={cn(
                            "group grid w-full grid-cols-[1px_1fr] overflow-hidden rounded-md pr-2 text-left outline-none transition-colors",
                            "focus-visible:ring-3 focus-visible:ring-ring/50",
                            selected ? "bg-muted/60" : "bg-transparent hover:bg-muted/40",
                          )}
                        >
                          <span className="relative block">
                            {selected || badges.length > 0 ? (
                              <span
                                className={cn(
                                  "absolute inset-y-2 left-0 w-px rounded-r-full",
                                  railClass(railTone),
                                )}
                              />
                            ) : null}
                          </span>
                          <span className="block min-w-0 py-2 pl-2">
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground/95",
                                  selected ? "font-medium" : "font-normal",
                                )}
                              >
                                {session.title ?? session.taskSummary}
                              </span>
                              {badges.map((badge) => (
                                <span
                                  key={badge.label}
                                  className={cn(
                                    "shrink-0 rounded-sm border px-1 py-0.5 font-mono text-[9px] uppercase leading-none",
                                    badgeClass(badge.tone),
                                  )}
                                >
                                  {badge.label}
                                </span>
                              ))}
                            </span>
                            {session.summary ? (
                              <span className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">{session.summary}</span>
                            ) : null}
                            <span className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.01em] text-muted-foreground/65">
                              <span className="min-w-0 truncate">{summarizeProviders(session)}</span>
                              <span aria-hidden="true" className="text-muted-foreground/35">/</span>
                              <span className="shrink-0">{formatDate(session.completedAt)}</span>
                            </span>
                            {session.tags && session.tags.length > 0 ? (
                              <span className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground/60">
                                {session.tags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="max-w-full truncate">#{tag}</span>
                                ))}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
