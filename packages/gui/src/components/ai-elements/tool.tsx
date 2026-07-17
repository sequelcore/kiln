import type { ComponentProps } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, CircleX, LoaderCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <Badge
      className={cn(
        "shrink-0 gap-1 px-1.5 py-0 font-normal",
        props.state === "paused" ? "border-warning/40 text-warning" : null,
      )}
      data-slot="ai-tool-status"
      variant={props.state === "failed" ? "destructive" : "outline"}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          props.state === "running" ? "motion-safe:animate-spin text-primary" : null,
          props.state === "completed" ? "text-success" : null,
        )}
      />
      {label}
    </Badge>
  );
}

export type ToolProps = ComponentProps<typeof Collapsible> & {
  readonly state: ToolState;
  readonly variant?: "outline" | "ghost";
};

export function Tool({ className, state, variant = "outline", ...props }: ToolProps) {
  return (
    <Collapsible
      className={cn(
        "w-full min-w-0 overflow-hidden",
        variant === "outline" ? "rounded-lg border border-border/70 bg-card/65" : "bg-transparent",
        className,
      )}
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
        "group/tool-header flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        className,
      )}
      data-slot="ai-tool-header"
      type="button"
      {...props}
    >
      <span className="min-w-0 truncate font-mono text-[11px] font-medium text-foreground">{title}</span>
      <ToolStatus state={state} />
      {summary ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={summary}>
          {summary}
        </span>
      ) : <span className="flex-1" />}
      <time
        className="hidden shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70 sm:inline"
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

export type ToolContentProps = ComponentProps<typeof CollapsibleContent> & { readonly variant?: "outline" | "ghost" };

export function ToolContent({ className, variant = "outline", ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        "min-w-0 px-3 py-3 text-popover-foreground outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity",
        variant === "outline" ? "border-t border-border/60" : "border-t border-border/45",
        className,
      )}
      data-slot="ai-tool-content"
      {...props}
    />
  );
}
