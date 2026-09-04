import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { OrbState } from "thinking-orbs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { AgentActivityOrb } from "./agent-activity-orb.js";

interface TranscriptActivityIndicatorProps {
  readonly phase: "thinking" | "tool_running";
  readonly toolName?: string;
  readonly details?: string;
  readonly children?: ReactNode;
}

export function TranscriptActivityIndicator(props: TranscriptActivityIndicatorProps) {
  const [open, setOpen] = useState(false);
  const label = props.phase === "tool_running"
    ? `Using ${props.toolName ?? "tool"}`
    : "Thinking";
  const details = props.details?.slice(0, 40);
  const accessibleLabel = `Assistant activity: ${label}${details ? ` · ${details}` : ""}`;
  const orbState: OrbState = props.phase === "tool_running" ? "working" : "solving";
  const hasDetails = props.children !== undefined && props.children !== null;

  return (
    <Collapsible
      className="min-w-0"
      data-orb-state={orbState}
      data-role="transcript-activity"
      onOpenChange={setOpen}
      open={hasDetails && open}
    >
      <div
        className="flex min-w-0 items-center gap-2 py-1 text-xs text-muted-foreground"
        data-slot="transcript-activity-header"
      >
        <span
          role="status"
          aria-atomic="true"
          aria-label={accessibleLabel}
          aria-live="polite"
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <span
            className="flex size-5 shrink-0 items-center justify-center"
            data-slot="transcript-activity-identity"
          >
            <AgentActivityOrb state={orbState} />
          </span>
          <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
          {details ? (
            <span aria-hidden="true" className="min-w-0 truncate text-muted-foreground/80">
              {details}
            </span>
          ) : null}
        </span>
        {hasDetails ? (
          <CollapsibleTrigger
            aria-label={`${open ? "Hide" : "Show"} ${props.toolName ?? "tool"} details`}
            className="group/activity-trigger rounded-sm p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70"
            type="button"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3.5 transition-transform", open ? "rotate-180" : null)}
            />
          </CollapsibleTrigger>
        ) : null}
      </div>
      {hasDetails ? (
        <CollapsibleContent className="ml-2 min-w-0 border-l border-border/55 py-2 pl-5 text-popover-foreground outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity">
          {props.children}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
