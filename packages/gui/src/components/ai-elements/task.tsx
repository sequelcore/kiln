import type { ComponentProps, ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  CircleX,
  LoaderCircle,
} from "lucide-react";
import { AgentActivityOrb } from "@/components/agent-activity-orb";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type TaskStatus = "pending" | "in_progress" | "completed" | "paused" | "blocked" | "cancelled" | "failed";

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  paused: "Paused",
  blocked: "Blocked",
  cancelled: "Cancelled",
  failed: "Failed",
};

function TaskStatusIcon(props: { readonly emphasizeActivity?: boolean; readonly status: TaskStatus }) {
  const iconClassName = "size-4 shrink-0";
  if (props.status === "in_progress") {
    if (props.emphasizeActivity) return <AgentActivityOrb state="working" />;
    return <LoaderCircle aria-hidden="true" className={cn(iconClassName, "motion-safe:animate-spin text-primary")} />;
  }
  if (props.status === "completed") {
    return <CheckCircle2 aria-hidden="true" className={cn(iconClassName, "text-success")} />;
  }
  if (props.status === "paused" || props.status === "blocked") {
    return <CircleAlert aria-hidden="true" className={cn(iconClassName, "text-warning")} />;
  }
  if (props.status === "cancelled" || props.status === "failed") {
    return <CircleX aria-hidden="true" className={cn(iconClassName, "text-destructive")} />;
  }
  return <CircleDashed aria-hidden="true" className={cn(iconClassName, "text-muted-foreground")} />;
}

export type TaskProps = ComponentProps<typeof Collapsible> & {
  readonly status: TaskStatus;
  readonly variant?: "inline" | "card" | "stream";
};

export function Task({ className, defaultOpen = true, status, variant = "inline", ...props }: TaskProps) {
  return (
    <Collapsible
      className={cn(
        "group/task",
        variant === "card" ? "rounded-xl border border-border/70 bg-card shadow-sm" : null,
        variant === "stream" ? "kiln-stream-row" : null,
        className,
      )}
      data-slot="ai-task"
      data-status={status}
      data-variant={variant}
      defaultOpen={defaultOpen}
      {...props}
    />
  );
}

export type TaskTriggerProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "children"> & {
  readonly title: string;
  readonly status: TaskStatus;
  readonly description?: string;
  readonly leading?: ReactNode;
};

export function TaskTrigger({ className, description, leading, status, title, ...props }: TaskTriggerProps) {
  const statusLabel = TASK_STATUS_LABELS[status];
  const accessibleLabel = [title, statusLabel, description].filter(Boolean).join(". ");
  return (
    <CollapsibleTrigger
      aria-label={accessibleLabel}
      className={cn(
        "group/task-trigger flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/70 group-data-[variant=card]/task:rounded-xl group-data-[variant=stream]/task:gap-2 group-data-[variant=stream]/task:rounded-md group-data-[variant=stream]/task:px-0 group-data-[variant=stream]/task:py-1 group-data-[variant=stream]/task:text-xs",
        className,
      )}
      data-slot="transcript-activity-header"
      type="button"
      {...props}
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center"
        data-slot="transcript-activity-identity"
      >
        {leading ?? <TaskStatusIcon emphasizeActivity status={status} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn(
          "truncate text-sm font-medium text-foreground group-data-[variant=stream]/task:text-xs",
          status === "in_progress" ? "kiln-active-status-text" : null,
        )}>{title}</span>
        {description ? <span className="truncate text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{statusLabel}</span>
      <ChevronDown
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/task-trigger:rotate-180"
      />
    </CollapsibleTrigger>
  );
}

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export function TaskContent({ children, className, ...props }: TaskContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        "text-popover-foreground outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity group-data-[variant=card]/task:border-t group-data-[variant=card]/task:border-border/60 group-data-[variant=inline]/task:border-l group-data-[variant=inline]/task:border-border/60 group-data-[variant=stream]/task:ml-2 group-data-[variant=stream]/task:border-l group-data-[variant=stream]/task:border-border/55",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-3 px-4 py-3 group-data-[variant=inline]/task:py-0 group-data-[variant=stream]/task:py-2 group-data-[variant=stream]/task:pr-0 group-data-[variant=stream]/task:pl-5">{children}</div>
    </CollapsibleContent>
  );
}

export type TaskItemProps = ComponentProps<"div"> & {
  readonly status?: TaskStatus;
};

export function TaskItem({ children, className, status, ...props }: TaskItemProps) {
  return (
    <div
      className={cn("flex min-w-0 items-start gap-2 text-sm leading-6 text-muted-foreground", className)}
      data-slot="ai-task-item"
      data-status={status}
      {...props}
    >
      {status ? <TaskStatusIcon status={status} /> : null}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
