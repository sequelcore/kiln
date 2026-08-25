import { useEffect, useMemo, useRef, useState } from "react";
import { getGuiProviderMetadata, resolveOperatorSessionLiveLifecycle, type OperatorSessionSummary } from "@kilnai/gateway-contracts";
import { ChevronRight, CircleAlert, CirclePause, CircleX, LoaderCircle, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ProviderGlyph } from "@/components/provider-glyph";
import {
  persistCollapsedSessionGroupIds,
  readCollapsedSessionGroupIds,
  type SessionHistoryGroupId,
} from "@/lib/session-list-preferences";
import { cn } from "@/lib/utils";

export type SessionHistoryLoadState = "loading" | "empty" | "ready" | "stale-error" | "fatal-error";

interface SessionListProps {
  readonly sessions: readonly OperatorSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly loadState: SessionHistoryLoadState;
  readonly onRetryLoad?: () => void;
  readonly onSelect: (sessionId: string) => void;
  readonly onStartNewSession: () => void;
}

type SessionIndicator = "running" | "paused" | "failed" | "cancelled";

interface SessionEntry {
  readonly session: OperatorSessionSummary;
  readonly indicator: SessionIndicator | null;
}

interface SessionGroup {
  readonly id: SessionHistoryGroupId;
  readonly label: string;
  readonly items: readonly SessionEntry[];
}

const SESSION_GROUP_DEFINITIONS: readonly Omit<SessionGroup, "items">[] = [
  { id: "active", label: "Active" },
  { id: "needs-attention", label: "Needs attention" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "previous-7-days", label: "Previous 7 days" },
  { id: "older", label: "Older" },
];
const OPERATIONAL_GROUP_IDS: readonly SessionHistoryGroupId[] = ["active", "needs-attention"];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

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

function sessionSearchText(session: OperatorSessionSummary): string {
  return [
    session.title,
    session.summary,
    ...session.routesUsed,
    session.lastRoute?.routeId,
    session.lastRoute?.provider,
    session.lastRoute?.model,
    ...session.tags,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function filterSessions(sessions: readonly OperatorSessionSummary[], query: string): readonly OperatorSessionSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return sessions;
  }
  return sessions.filter((session) => sessionSearchText(session).includes(normalizedQuery));
}

function chronologicalGroup(iso: string): SessionHistoryGroupId {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - (6 * 86_400_000);
  const timestamp = new Date(iso).getTime();
  return Number.isNaN(timestamp) || timestamp < weekStart
    ? "older"
    : timestamp >= todayStart
      ? "today"
      : timestamp >= yesterdayStart
        ? "yesterday"
        : "previous-7-days";
}

function groupSessionEntries(entries: readonly SessionEntry[]): readonly SessionGroup[] {
  const groups = new Map<SessionHistoryGroupId, SessionEntry[]>();

  for (const entry of entries) {
    const id = entry.indicator === "running"
      ? "active"
      : entry.indicator === "paused" || entry.indicator === "failed"
        ? "needs-attention"
        : chronologicalGroup(entry.session.updatedAt);
    const group = groups.get(id) ?? [];
    group.push(entry);
    groups.set(id, group);
  }

  return SESSION_GROUP_DEFINITIONS.flatMap((definition) => {
    const items = groups.get(definition.id);
    return items ? [{ ...definition, items }] : [];
  });
}

function resolveSessionIndicator(
  session: OperatorSessionSummary,
): SessionIndicator | null {
  if (resolveOperatorSessionLiveLifecycle(session.liveLifecycle).state === "running") return "running";
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
    : state === "cancelled"
      ? "text-muted-foreground"
      : state === "paused"
        ? "text-warning"
        : "text-[var(--color-accent)]";

  return (
    <span
      data-slot="session-status"
      role="img"
      aria-label={label}
      title={label}
      className={cn("flex shrink-0 items-center gap-1 text-[10px] font-medium [&_svg]:size-3", className)}
    >
      {state === "running" ? (
        <LoaderCircle aria-hidden="true" />
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

function sessionRouteLabel(session: OperatorSessionSummary): string | null {
  if (!session.lastRoute) return null;
  const provider = session.lastRoute.provider
    ? getGuiProviderMetadata(session.lastRoute.provider)?.label ?? session.lastRoute.provider
    : session.lastRoute.routeId;
  return `Last route: ${provider}${session.lastRoute.model ? ` · ${session.lastRoute.model}` : ""}`;
}

type SessionNavigationIntent = "next" | "previous" | "first" | "last";

function SessionRow(props: {
  readonly session: OperatorSessionSummary;
  readonly indicator: SessionIndicator | null;
  readonly selected: boolean;
  readonly tabIndex: number;
  readonly rowRef: (node: HTMLButtonElement | null) => void;
  readonly onSelect: () => void;
  readonly onNavigate: (intent: SessionNavigationIntent) => void;
}) {
  const routeLabel = sessionRouteLabel(props.session);
  return (
    <button
      type="button"
      data-slot="session-row"
      ref={props.rowRef}
      aria-current={props.selected ? "page" : undefined}
      tabIndex={props.tabIndex}
      title={props.session.summary ?? props.session.title}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        const intent = event.key === "ArrowDown" || event.key === "j"
          ? "next"
          : event.key === "ArrowUp" || event.key === "k"
            ? "previous"
            : event.key === "Home"
              ? "first"
              : event.key === "End"
                ? "last"
                : null;
        if (!intent) return;
        event.preventDefault();
        props.onNavigate(intent);
      }}
      className={cn(
        "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        props.selected ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80",
      )}
    >
      {props.session.lastRoute?.provider && routeLabel ? (
        <span
          data-slot="session-route"
          role="img"
          aria-label={routeLabel}
          title={routeLabel}
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ProviderGlyph providerId={props.session.lastRoute.provider} className="size-3.5" />
        </span>
      ) : null}
      <span
        data-slot="session-title"
        className="session-title-fade min-w-0 flex-1 overflow-hidden whitespace-nowrap"
      >
        {props.session.title}
      </span>
      {props.indicator ? (
        <SessionStateIndicator state={props.indicator} />
      ) : (
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/65">
          {formatSessionAge(props.session.updatedAt)}
        </span>
      )}
    </button>
  );
}

export function SessionList(props: SessionListProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedSessionGroupIds);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const collapsedOperationalMembershipRef = useRef<ReadonlyMap<SessionHistoryGroupId, ReadonlySet<string>>>(new Map());
  const visibleSessions = useMemo(() => filterSessions(props.sessions, query), [props.sessions, query]);
  const visibleEntries = useMemo(
    () => visibleSessions.map((session) => ({ session, indicator: resolveSessionIndicator(session) })),
    [visibleSessions],
  );
  const sessionGroups = useMemo(() => groupSessionEntries(visibleEntries), [visibleEntries]);
  const searching = query.trim().length > 0;
  const navigationSessions = useMemo(
    () => sessionGroups.flatMap((group) => (
      !searching && collapsedGroups.has(group.id)
        ? []
        : group.items.map((entry) => entry.session)
    )),
    [collapsedGroups, searching, sessionGroups],
  );
  const selectedIndex = useMemo(
    () => navigationSessions.findIndex((session) => session.sessionId === props.selectedSessionId),
    [navigationSessions, props.selectedSessionId],
  );
  const visibleIndexById = useMemo(
    () => new Map(navigationSessions.map((session, index) => [session.sessionId, index])),
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
    props.onSelect(session.sessionId);
    itemRefs.current[bounded]?.focus();
  }

  function closeSearch(): void {
    setQuery("");
    setSearchOpen(false);
  }

  function navigateFromIndex(index: number, intent: SessionNavigationIntent): void {
    const target = intent === "next"
      ? index + 1 >= navigationSessions.length ? 0 : index + 1
      : intent === "previous"
        ? index <= 0 ? navigationSessions.length - 1 : index - 1
        : intent === "first"
          ? 0
          : navigationSessions.length - 1;
    focusIndex(target);
  }

  function setGroupExpanded(group: SessionGroup, expanded: boolean): void {
    const next = new Set(collapsedGroups);
    if (expanded) {
      next.delete(group.id);
      if (OPERATIONAL_GROUP_IDS.includes(group.id)) {
        const memberships = new Map(collapsedOperationalMembershipRef.current);
        memberships.delete(group.id);
        collapsedOperationalMembershipRef.current = memberships;
      }
    } else {
      next.add(group.id);
      if (OPERATIONAL_GROUP_IDS.includes(group.id)) {
        const memberships = new Map(collapsedOperationalMembershipRef.current);
        memberships.set(group.id, new Set(group.items.map((entry) => entry.session.sessionId)));
        collapsedOperationalMembershipRef.current = memberships;
      }
    }
    persistCollapsedSessionGroupIds(next);
    setCollapsedGroups(next);
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
        {props.loadState === "stale-error" ? (
          <div className="mx-2 mb-1 flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1">Could not refresh sessions.</span>
            {props.onRetryLoad ? (
              <Button type="button" variant="ghost" size="xs" onClick={props.onRetryLoad}>Retry</Button>
            ) : null}
          </div>
        ) : null}
        {props.loadState === "fatal-error" ? (
          <div className="m-2 rounded-md border border-status-danger-border bg-status-danger-background px-3 py-3 text-xs text-error" role="alert">
            <p>Could not load session history.</p>
            {props.onRetryLoad ? (
              <Button type="button" variant="outline" size="xs" className="mt-2" onClick={props.onRetryLoad}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : props.loadState === "loading" ? (
          <div role="status" aria-label="Loading sessions" className="space-y-2 px-2 py-3">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-8 animate-pulse rounded-md bg-muted/45 motion-reduce:animate-none" />
            ))}
          </div>
        ) : props.loadState === "empty" ? (
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
            {sessionGroups.map((group) => {
              const collapsedMembership = collapsedOperationalMembershipRef.current.get(group.id);
              const hasNewOperationalSession = collapsedMembership
                ? group.items.some((entry) => !collapsedMembership.has(entry.session.sessionId))
                : false;
              const expanded = searching || !collapsedGroups.has(group.id) || hasNewOperationalSession;
              return (
                <section key={group.id} className="pb-3">
                  <Collapsible
                    open={expanded}
                    onOpenChange={(open) => {
                      if (!searching) setGroupExpanded(group, open);
                    }}
                  >
                      <h3 className="pt-1.5">
                        <CollapsibleTrigger
                          type="button"
                          aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label} sessions`}
                          title={searching ? "Session groups stay expanded while searching" : undefined}
                          disabled={searching}
                          className="group/session-group flex h-7 w-full items-center justify-start gap-1 rounded-md px-1 text-left text-xs font-medium text-muted-foreground/75 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className="size-3 transition-transform group-data-[panel-open]/session-group:rotate-90 motion-reduce:transition-none"
                          />
                          <span data-slot="session-group-label">{group.label}</span>
                          <span aria-hidden="true" className="ml-auto tabular-nums text-[10px] text-muted-foreground/55">
                            {group.items.length}
                          </span>
                        </CollapsibleTrigger>
                      </h3>
                      <CollapsibleContent>
                        <ul className="flex flex-col gap-1">
                  {group.items.map(({ session, indicator }) => {
                    const index = visibleIndexById.get(session.sessionId) ?? -1;
                    const selected = props.selectedSessionId === session.sessionId;
                    return (
                      <li key={session.sessionId}>
                        <SessionRow
                          session={session}
                          indicator={indicator}
                          selected={selected}
                          tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
                          rowRef={(node) => {
                            itemRefs.current[index] = node;
                          }}
                          onSelect={() => props.onSelect(session.sessionId)}
                          onNavigate={(intent) => navigateFromIndex(index, intent)}
                        />
                      </li>
                    );
                  })}
                        </ul>
                      </CollapsibleContent>
                  </Collapsible>
                </section>
              );
            })}
          </nav>
        )}
      </div>
    </section>
  );
}
