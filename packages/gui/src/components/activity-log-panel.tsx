import { useMemo, useState } from "react";
import {
  projectManagedAgentIdentity,
  type OperatorEventDetailItem,
  type OperatorIdentityProjection,
} from "@kilnai/gateway-contracts";
import type { TimelineEventEntry, TimelineEntry } from "../lib/session-store.js";
import { isActivityTimelineEntry } from "../lib/timeline-visibility.js";
import {
  OperatorIdentityMark,
  OperatorStatusIndicator,
  type OperatorStatus,
} from "./operator-identity-mark.js";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ToolEvidence } from "./transcript.js";

interface ActivityLogPanelProps {
  readonly entries: readonly TimelineEntry[];
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function activityKey(entry: TimelineEventEntry): string {
  return `${entry.createdAt}:${entry.id}`;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return timeFormatter.format(date);
}

function compactKind(value: string): string {
  return value.replace(/_/g, " ");
}

function detailsPayloadForEvent(entry: TimelineEventEntry): Record<string, unknown> {
  return typeof entry.details === "object" && entry.details !== null && !Array.isArray(entry.details)
    ? entry.details as Record<string, unknown>
    : {};
}

function identityForEvent(entry: TimelineEventEntry): OperatorIdentityProjection | null {
  return entry.eventKind.startsWith("agent_invocation_")
    ? projectManagedAgentIdentity(detailsPayloadForEvent(entry))
    : null;
}

function operatorStatusForTone(tone: TimelineEventEntry["tone"]): OperatorStatus {
  if (tone === "running") return "running";
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "error") return "error";
  return "idle";
}

function DetailList(props: { readonly items: readonly OperatorEventDetailItem[] }) {
  if (props.items.length === 0) return null;
  return (
    <dl className="grid gap-2 text-sm">
      {props.items.map((item) => (
        <div key={`${item.label}:${item.value}`} className="rounded-md border border-border/60 bg-background px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ActivityLogPanel(props: ActivityLogPanelProps) {
  const events = useMemo(
    () => props.entries.filter(isActivityTimelineEntry),
    [props.entries],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedEvent = events.find((entry) => activityKey(entry) === selectedKey) ?? events[0] ?? null;
  const selectedDetails = selectedEvent?.presentationDetails ?? [];
  const selectedIdentity = selectedEvent ? identityForEvent(selectedEvent) : null;

  return (
    <section
      aria-label="Activity"
      className="grid h-full min-h-0 min-w-0 bg-card lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]"
    >
      <div className="min-h-0 overflow-y-auto border-b border-border/60 lg:border-b-0 lg:border-r lg:border-border/60">
          {events.length === 0 ? (
            <div className="grid h-full place-items-center px-6 py-16 text-center">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">no activity yet</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Runtime events, routing, cost updates, tool calls, and turn metadata will appear here.
                </p>
              </div>
            </div>
          ) : (
            <ul aria-label="Activity log" className="divide-y divide-border/60">
              {events.map((entry) => {
                const active = selectedEvent ? activityKey(entry) === activityKey(selectedEvent) : false;
                const identity = identityForEvent(entry);
                return (
                  <li key={activityKey(entry)}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedKey(activityKey(entry))}
                      className={cn(
                        "grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        active ? "bg-secondary/60" : "hover:bg-secondary/35",
                      )}
                    >
                      {identity ? (
                        <OperatorIdentityMark
                          identity={identity}
                          size="sm"
                          className="row-span-2 mt-0.5"
                        />
                      ) : <span />}
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-foreground">
                          {entry.title}
                        </span>
                        <OperatorStatusIndicator state={operatorStatusForTone(entry.tone)} />
                        <Badge variant={entry.tone === "error" ? "destructive" : "outline"} className="shrink-0">
                          {compactKind(entry.eventKind)}
                        </Badge>
                      </span>
                      <span className="col-start-2 flex min-w-0 items-center gap-2 font-mono text-[10.5px] tracking-[0.01em] text-muted-foreground/75">
                        <span>{formatCreatedAt(entry.createdAt)}</span>
                        {entry.summary ? (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="truncate">{entry.summary}</span>
                          </>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
      </div>

      <div className="min-h-0 overflow-y-auto px-4 py-4">
          {selectedEvent ? (
            <section aria-label="Selected activity detail" className="flex flex-col gap-3">
              <div className="flex min-w-0 items-start gap-3">
                {selectedIdentity ? (
                  <OperatorIdentityMark
                    identity={selectedIdentity}
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium leading-6 text-foreground">{selectedEvent.title}</p>
                    <OperatorStatusIndicator state={operatorStatusForTone(selectedEvent.tone)} showLabel />
                  </div>
                  {selectedEvent.summary ? (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{selectedEvent.summary}</p>
                  ) : null}
                  <p className="mt-2 font-mono text-[10.5px] tracking-[0.01em] text-muted-foreground/75">
                    {formatCreatedAt(selectedEvent.createdAt)}
                  </p>
                </div>
              </div>
              <DetailList items={selectedDetails} />
              {selectedEvent.toolPresentation ? (
                <ToolEvidence presentation={selectedEvent.toolPresentation} />
              ) : null}
            </section>
          ) : (
            <div className="grid h-full place-items-center text-center">
              <p className="text-sm leading-6 text-muted-foreground">Select an activity event to inspect its runtime details.</p>
            </div>
          )}
      </div>
    </section>
  );
}
