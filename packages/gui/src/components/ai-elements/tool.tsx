import type { ComponentProps } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, CircleX, LoaderCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ToolState = "running" | "completed" | "paused" | "failed";

const TOOL_STATE_LABELS: Record<ToolState, string> = {
  running: "Running",
  completed: "Completed",
  paused: "Paused",
  failed: "Failed",
};

const TOOL_STATE_ICONS: Record<ToolState, LucideIcon> = {
  running: LoaderCircle,
  completed: CheckCircle2,
  paused: CircleAlert,
  failed: CircleX,
};

function ToolStatus(props: { readonly state: ToolState }) {
  const label = TOOL_STATE_LABELS[props.state];
  const Icon = TOOL_STATE_ICONS[props.state];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground",
        props.state === "paused" ? "text-warning" : null,
        props.state === "failed" ? "text-destructive" : null,
      )}
      data-slot="ai-tool-status"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          props.state === "running" ? "motion-safe:animate-spin text-primary" : null,
          props.state === "completed" ? "text-success" : null,
        )}
      />
      <span className={props.state === "completed" ? "sr-only" : undefined}>{label}</span>
    </span>
  );
}

export type ToolProps = ComponentProps<typeof Collapsible> & { readonly state: ToolState };

export function Tool({ className, state, ...props }: ToolProps) {
  return (
    <Collapsible
      className={cn("w-full min-w-0", className)}
      data-framing="none"
      data-presentation="trace"
      data-slot="ai-tool"
      data-state={state}
      {...props}
    />
  );
}

export type ToolHeaderProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "children"> & {
  readonly title: string;
  readonly summary?: string;
  readonly state: ToolState;
  readonly expanded: boolean;
  readonly dateTime: string;
  readonly timeLabel: string;
};

export function ToolHeader({
  className,
  dateTime,
  expanded,
  state,
  summary,
  timeLabel,
  title,
  ...props
}: ToolHeaderProps) {
  const stateLabel = TOOL_STATE_LABELS[state];
  return (
    <CollapsibleTrigger
      aria-label={`${title}. ${stateLabel}. ${expanded ? "Hide" : "Show"} details`}
      className={cn(
        "group/tool-header flex w-full min-w-0 items-center gap-2 py-1.5 text-left text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/70",
        className,
      )}
      data-slot="ai-tool-header"
      type="button"
      {...props}
    >
      <span className="min-w-0 truncate text-xs font-medium text-current">{title}</span>
      <ToolStatus state={state} />
      {summary ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={summary}>
          {summary}
        </span>
      ) : <span className="flex-1" />}
      <time
        className="sr-only"
        dateTime={dateTime}
        title={dateTime}
      >
        {timeLabel}
      </time>
      <ChevronDown
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/tool-header:rotate-180"
      />
    </CollapsibleTrigger>
  );
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        "ml-1.5 min-w-0 border-l border-border/55 py-2 pl-5 text-popover-foreground outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity",
        className,
      )}
      data-slot="ai-tool-content"
      {...props}
    />
  );
}
