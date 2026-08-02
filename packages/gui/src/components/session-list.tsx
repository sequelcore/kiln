import { useEffect, useMemo, useRef, useState } from "react";
import type { GuiSessionSummary } from "@kilnai/gateway-contracts";
import { CircleAlert, LoaderCircle, Plus, Search, Unplug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionContinuity } from "@/lib/session-continuity";
import { buildSessionRowBadges } from "@/lib/session-continuity-view";
import { cn } from "@/lib/utils";

interface SessionListProps {
  readonly sessions: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly continuity: SessionContinuity;
  readonly onSelect: (sessionId: string) => void;
  readonly onStartNewSession: () => void;
}

type SessionIndicator = "running" | "detached" | "failed" | "cancelled";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function sessionTitle(session: GuiSessionSummary): string {
  return session.title ?? session.taskSummary;
}

function formatSessionAge(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return "";
  }
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d`;
  return dateFormatter.format(new Date(timestamp));
}

function sessionSearchText(session: GuiSessionSummary): string {
  return [
    session.title,
    session.taskSummary,
    session.summary,
    ...session.providersUsed,
    session.lastProvider,
    ...(session.tags ?? []),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function filterSessions(sessions: readonly GuiSessionSummary[], query: string): readonly GuiSessionSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return sessions;
  }
  return sessions.filter((session) => sessionSearchText(session).includes(normalizedQuery));
}

function groupSessions(sessions: readonly GuiSessionSummary[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - (6 * 86_400_000);
  const groups = new Map<string, GuiSessionSummary[]>();

  for (const session of sessions) {
    const timestamp = new Date(session.completedAt).getTime();
    const label = Number.isNaN(timestamp) || timestamp < weekStart
      ? "Older"
      : timestamp >= todayStart
        ? "Today"
        : timestamp >= yesterdayStart
          ? "Yesterday"
          : "Previous 7 days";
    const group = groups.get(label) ?? [];
    group.push(session);
    groups.set(label, group);
  }

  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function resolveSessionIndicator(
  session: GuiSessionSummary,
  continuity: SessionContinuity,
): SessionIndicator | null {
  if (session.lastTurnOutcome === "failed" || session.lastTurnOutcome === "cancelled") {
    return session.lastTurnOutcome;
  }
  const badges = buildSessionRowBadges({
    sessionId: session.id,
    continuity,
    outcome: null,
  });
  if (badges.some((badge) => badge.label === "Running")) return "running";
  if (badges.some((badge) => badge.label === "Detached")) return "detached";
  return null;
}

function SessionStateIndicator({ state }: { readonly state: SessionIndicator }) {
  const label = `${state[0]!.toUpperCase()}${state.slice(1)} session`;
  const className = state === "failed" || state === "cancelled"
    ? "text-destructive"
    : state === "detached"
      ? "text-muted-foreground"
      : "text-[var(--color-accent)]";

  return (
    <span
      data-slot="session-status"
      aria-label={label}
      role="status"
      title={label}
      className={cn("grid size-4 shrink-0 place-items-center [&_svg]:size-3.5", className)}
    >
      {state === "running" ? (
        <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
      ) : state === "detached" ? (
        <Unplug aria-hidden="true" />
      ) : (
        <CircleAlert aria-hidden="true" />
      )}
    </span>
  );
}

export function SessionList(props: SessionListProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const visibleSessions = useMemo(() => filterSessions(props.sessions, query), [props.sessions, query]);
  const selectedIndex = useMemo(
    () => visibleSessions.findIndex((session) => session.id === props.selectedSessionId),
    [props.selectedSessionId, visibleSessions],
  );
  const sessionGroups = useMemo(() => groupSessions(visibleSessions), [visibleSessions]);
  const visibleIndexById = useMemo(
    () => new Map(visibleSessions.map((session, index) => [session.id, index])),
    [visibleSessions],
  );

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, visibleSessions.length);
  }, [visibleSessions.length]);

  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
    }
  }, [searchOpen]);

  function focusIndex(index: number): void {
    const bounded = Math.max(0, Math.min(index, visibleSessions.length - 1));
    const session = visibleSessions[bounded];
    if (!session) {
      return;
    }
    props.onSelect(session.id);
    itemRefs.current[bounded]?.focus();
  }

  function closeSearch(): void {
    setQuery("");
    setSearchOpen(false);
  }

  return (
    <section aria-label="Sessions" className="flex h-full min-h-0 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 px-3">
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">Recent</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Search sessions"
          aria-expanded={searchOpen}
          aria-controls="session-search"
          title="Search sessions"
          onClick={() => setSearchOpen((open) => !open)}
          className="text-muted-foreground"
        >
          <Search data-icon="inline-start" aria-hidden="true" />
        </Button>
      </header>

      {searchOpen ? (
        <div id="session-search" className="relative px-3 pb-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-[calc(50%+0.25rem)] text-muted-foreground"
          />
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search sessions"
            placeholder="Search sessions"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeSearch();
              }
            }}
            className="h-8 bg-transparent pl-8 pr-7 text-xs shadow-none"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Close session search"
            title="Close session search"
            onClick={closeSearch}
            className="absolute right-3.5 top-0.5 text-muted-foreground"
          >
            <X data-icon="inline-start" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {props.sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 py-10 text-center">
            <p className="text-pretty text-xs leading-5 text-muted-foreground">No sessions yet.</p>
            <Button type="button" variant="ghost" size="sm" onClick={props.onStartNewSession}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Start a session
            </Button>
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 py-10 text-center">
            <p className="text-pretty text-xs leading-5 text-muted-foreground">No matching sessions.</p>
            <Button type="button" variant="ghost" size="sm" onClick={closeSearch}>Clear search</Button>
          </div>
        ) : (
          <nav aria-label="Session history">
            {sessionGroups.map((group) => (
              <section key={group.label} className="pb-3">
                <h3 className="px-1 pb-1.5 pt-2 text-xs font-medium text-muted-foreground/75">{group.label}</h3>
                <ul className="flex flex-col gap-1">
                  {group.items.map((session) => {
                    const index = visibleIndexById.get(session.id) ?? -1;
                    const selected = props.selectedSessionId === session.id;
                    const indicator = resolveSessionIndicator(session, props.continuity);
                    return (
                      <li key={session.id}>
                        <button
                          type="button"
                          ref={(node) => {
                            itemRefs.current[index] = node;
                          }}
                          aria-current={selected ? "page" : undefined}
                          tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
                          title={session.summary ?? sessionTitle(session)}
                          onClick={() => props.onSelect(session.id)}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowDown" || event.key === "j") {
                              event.preventDefault();
                              focusIndex(index + 1 >= visibleSessions.length ? 0 : index + 1);
                              return;
                            }
                            if (event.key === "ArrowUp" || event.key === "k") {
                              event.preventDefault();
                              focusIndex(index <= 0 ? visibleSessions.length - 1 : index - 1);
                              return;
                            }
                            if (event.key === "Home") {
                              event.preventDefault();
                              focusIndex(0);
                              return;
                            }
                            if (event.key === "End") {
                              event.preventDefault();
                              focusIndex(visibleSessions.length - 1);
                            }
                          }}
                          className={cn(
                            "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors",
                            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                            selected ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80",
                          )}
                        >
                          <span
                            data-slot="session-title"
                            className="session-title-fade min-w-0 flex-1 overflow-hidden whitespace-nowrap"
                          >
                            {sessionTitle(session)}
                          </span>
                          {indicator ? (
                            <SessionStateIndicator state={indicator} />
                          ) : (
                            <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/65">
                              {formatSessionAge(session.completedAt)}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
        )}
      </div>
    </section>
  );
}
