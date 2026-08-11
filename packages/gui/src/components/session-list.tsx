import { useEffect, useMemo, useRef, useState } from "react";
import type { GuiSessionSummary } from "@kilnai/gateway-contracts";
import { CircleAlert, CirclePause, CircleX, LoaderCircle, Plus, Search, Unplug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionContinuity } from "@/lib/session-continuity";
import { buildSessionRowBadges } from "@/lib/session-continuity-view";
import { cn } from "@/lib/utils";

interface SessionListProps {
  readonly sessions: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly continuity: SessionContinuity;
  readonly loadError?: string;
  readonly onRetryLoad?: () => void;
  readonly onSelect: (sessionId: string) => void;
  readonly onStartNewSession: () => void;
}

type SessionIndicator = "running" | "background" | "paused" | "failed" | "cancelled";

interface SessionEntry {
  readonly session: GuiSessionSummary;
  readonly indicator: SessionIndicator | null;
}

const ATTENTION_GROUP_ORDER = ["Active", "Needs attention"] as const;

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

function chronologicalGroup(iso: string): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - (6 * 86_400_000);
  const timestamp = new Date(iso).getTime();
  return Number.isNaN(timestamp) || timestamp < weekStart
    ? "Older"
    : timestamp >= todayStart
      ? "Today"
      : timestamp >= yesterdayStart
        ? "Yesterday"
        : "Previous 7 days";
}

function groupSessionEntries(entries: readonly SessionEntry[]) {
  const groups = new Map<string, SessionEntry[]>();

  for (const entry of entries) {
    const label = entry.indicator === "running" || entry.indicator === "background"
      ? "Active"
      : entry.indicator === "paused" || entry.indicator === "failed"
        ? "Needs attention"
        : chronologicalGroup(entry.session.completedAt);
    const group = groups.get(label) ?? [];
    group.push(entry);
    groups.set(label, group);
  }

  const orderedLabels = [
    ...ATTENTION_GROUP_ORDER,
    "Today",
    "Yesterday",
    "Previous 7 days",
    "Older",
  ];
  return orderedLabels.flatMap((label) => {
    const items = groups.get(label);
    return items ? [{ label, items }] : [];
  });
}

function resolveSessionIndicator(
  session: GuiSessionSummary,
  continuity: SessionContinuity,
): SessionIndicator | null {
  const badges = buildSessionRowBadges({
    sessionId: session.id,
    continuity,
    outcome: null,
  });
  if (badges.some((badge) => badge.label === "Running")) return "running";
  if (badges.some((badge) => badge.label === "Detached")) return "background";
  if (
    session.lastTurnOutcome === "paused"
    || session.lastTurnOutcome === "failed"
    || session.lastTurnOutcome === "cancelled"
  ) {
    return session.lastTurnOutcome;
  }
  return null;
}

function SessionStateIndicator({ state }: { readonly state: SessionIndicator }) {
  const visibleLabel = state[0]!.toUpperCase() + state.slice(1);
  const label = `${visibleLabel} session`;
  const className = state === "failed"
    ? "text-destructive"
    : state === "background" || state === "cancelled"
      ? "text-muted-foreground"
      : state === "paused"
        ? "text-warning"
        : "text-[var(--color-accent)]";

  return (
    <span
      data-slot="session-status"
      aria-label={label}
      role="status"
      title={label}
      className={cn("flex shrink-0 items-center gap-1 text-[10px] font-medium [&_svg]:size-3", className)}
    >
      {state === "running" ? (
        <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
      ) : state === "background" ? (
        <Unplug aria-hidden="true" />
      ) : state === "paused" ? (
        <CirclePause aria-hidden="true" />
      ) : state === "cancelled" ? (
        <CircleX aria-hidden="true" />
      ) : (
        <CircleAlert aria-hidden="true" />
      )}
      <span>{visibleLabel}</span>
    </span>
  );
}

export function SessionList(props: SessionListProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const visibleSessions = useMemo(() => filterSessions(props.sessions, query), [props.sessions, query]);
  const visibleEntries = useMemo(
    () => visibleSessions.map((session) => ({ session, indicator: resolveSessionIndicator(session, props.continuity) })),
    [props.continuity, visibleSessions],
  );
  const sessionGroups = useMemo(() => groupSessionEntries(visibleEntries), [visibleEntries]);
  const navigationSessions = useMemo(
    () => sessionGroups.flatMap((group) => group.items.map((entry) => entry.session)),
    [sessionGroups],
  );
  const selectedIndex = useMemo(
    () => navigationSessions.findIndex((session) => session.id === props.selectedSessionId),
    [navigationSessions, props.selectedSessionId],
  );
  const visibleIndexById = useMemo(
    () => new Map(navigationSessions.map((session, index) => [session.id, index])),
    [navigationSessions],
  );

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, navigationSessions.length);
  }, [navigationSessions.length]);

  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
    }
  }, [searchOpen]);

  function focusIndex(index: number): void {
    const bounded = Math.max(0, Math.min(index, navigationSessions.length - 1));
    const session = navigationSessions[bounded];
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
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">Sessions</h2>
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
        {props.loadError ? (
          <div className="m-2 rounded-md border border-status-danger-border bg-status-danger-background px-3 py-3 text-xs text-error" role="alert">
            <p>{props.loadError}</p>
            {props.onRetryLoad ? (
              <Button type="button" variant="outline" size="xs" className="mt-2" onClick={props.onRetryLoad}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : props.sessions.length === 0 ? (
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
                  {group.items.map(({ session, indicator }) => {
                    const index = visibleIndexById.get(session.id) ?? -1;
                    const selected = props.selectedSessionId === session.id;
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
                              focusIndex(index + 1 >= navigationSessions.length ? 0 : index + 1);
                              return;
                            }
                            if (event.key === "ArrowUp" || event.key === "k") {
                              event.preventDefault();
                              focusIndex(index <= 0 ? navigationSessions.length - 1 : index - 1);
                              return;
                            }
                            if (event.key === "Home") {
                              event.preventDefault();
                              focusIndex(0);
                              return;
                            }
                            if (event.key === "End") {
                              event.preventDefault();
                              focusIndex(navigationSessions.length - 1);
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
