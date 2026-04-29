import { useEffect, useMemo, useRef } from "react";
import type { GuiSessionSummary } from "@kilnai/gateway-contracts";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SidebarPanelShell } from "./sidebar-panel-shell.js";

interface SessionListProps {
  readonly sessions: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly resumeTargetId: string | null;
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

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
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

function providerGlyphKind(provider: string): "square" | "diamond" | "circle" | "dot" {
  const normalized = provider.toLowerCase();
  if (normalized.startsWith("codex-oauth")) return "dot";
  if (normalized.startsWith("codex")) return "square";
  if (normalized.startsWith("claude")) return "diamond";
  if (normalized.startsWith("opencode")) return "circle";
  return "circle";
}

function ProviderGlyph(props: { readonly provider: string }) {
  const kind = providerGlyphKind(props.provider);
  if (kind === "diamond") {
    return <span aria-hidden="true" className="size-1.5 rotate-45 rounded-[1px] border border-muted-foreground/70" />;
  }
  if (kind === "square") {
    return <span aria-hidden="true" className="size-1.5 rounded-[1px] border border-muted-foreground/70" />;
  }
  if (kind === "dot") {
    return (
      <span aria-hidden="true" className="relative size-1.5 rounded-[1px] border border-muted-foreground/70">
        <span className="absolute left-1/2 top-1/2 size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground" />
      </span>
    );
  }
  return <span aria-hidden="true" className="size-1.5 rounded-full border border-muted-foreground/70" />;
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

  const footer = (
    <Button
      type="button"
      variant="outline"
      aria-label="New Session"
      onClick={props.onStartNewSession}
      className="h-9 w-full justify-start border-border/80 bg-transparent font-medium hover:bg-secondary/50"
    >
      <Plus data-icon="inline-start" aria-hidden="true" />
      New Session
    </Button>
  );

  return (
    <SidebarPanelShell title="Sessions" meta={`${props.sessions.length} total`} footer={footer}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.sessions.length === 0 ? (
          <div className="grid h-full place-items-center px-6 py-16 text-center">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">no sessions yet</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Start a conversation to track transcripts, tool calls, costs, and changed files here.
              </p>
            </div>
          </div>
        ) : (
          <div role="listbox" aria-label="Session history">
            {sessionGroups.map((group) => (
              <section key={group.label}>
                <div className="flex items-center border-b border-t border-border/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/75 first:border-t-0">
                  <span>{group.label}</span>
                  <span className="ml-auto">{group.items.length}</span>
                </div>
                <ul>
                  {group.items.map((session) => {
                    const index = props.sessions.findIndex((item) => item.id === session.id);
                    const selected = props.selectedSessionId === session.id;
                    const active = props.resumeTargetId === session.id;
                    const providers = sessionProviders(session);
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
                            "group grid w-full grid-cols-[12px_1fr] overflow-hidden border-b border-border/60 pr-3 text-left outline-none transition-colors",
                            "focus-visible:ring-3 focus-visible:ring-ring/50",
                            selected ? "bg-secondary/65" : "bg-transparent hover:bg-secondary/35",
                          )}
                        >
                          <span className="relative block">
                            {selected || active ? (
                              <span
                                className={cn(
                                  "absolute inset-y-3 left-0 w-0.5 rounded-r-full",
                                  active ? "bg-[var(--color-accent)]" : "bg-foreground",
                                )}
                              />
                            ) : null}
                          </span>
                          <span className="block min-w-0 py-2.5">
                            <span className="mb-1 flex min-w-0 items-center gap-2">
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground",
                                  selected ? "font-semibold" : "font-medium",
                                )}
                              >
                                {session.title ?? session.taskSummary}
                              </span>
                              {active ? (
                                <>
                                  <span
                                    aria-label="Active continuation target"
                                    className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
                                  />
                                  <span className="sr-only">Active</span>
                                </>
                              ) : null}
                              {selected ? (
                                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                  Loaded
                                </span>
                              ) : null}
                            </span>
                            {session.summary ? (
                              <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">{session.summary}</span>
                            ) : null}
                            <span className="mt-2 flex min-w-0 items-center gap-2 font-mono text-[10.5px] tracking-[0.01em] text-muted-foreground/70">
                              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                                {providers.length > 0 ? (
                                  providers.map((provider, providerIndex) => (
                                    <span key={`${session.id}-${provider}`} className="inline-flex min-w-0 items-center gap-1">
                                      {providerIndex > 0 ? <span className="text-muted-foreground/40">+</span> : null}
                                      <ProviderGlyph provider={provider} />
                                      <span className="truncate">{provider}</span>
                                    </span>
                                  ))
                                ) : (
                                  <span>{summarizeProviders(session)}</span>
                                )}
                              </span>
                              <span className="ml-auto flex shrink-0 items-center gap-2">
                                <span>{formatDate(session.completedAt)}</span>
                                <span className="text-muted-foreground/40">·</span>
                                <span className="tabular-nums">{formatCurrency(session.cost)}</span>
                              </span>
                            </span>
                            {session.tags && session.tags.length > 0 ? (
                              <span className="mt-2 flex min-w-0 flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground/60">
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
    </SidebarPanelShell>
  );
}
