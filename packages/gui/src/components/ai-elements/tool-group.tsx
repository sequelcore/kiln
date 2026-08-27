import type { ComponentProps, ReactNode } from "react";
import type { ToolActivitySummary } from "@kilnai/gateway-contracts";
import { CheckCircle2, ChevronDown, CircleX, LoaderCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function ToolGroup(props: {
  readonly children: ReactNode;
  readonly open: boolean;
  readonly summary: ToolActivitySummary;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const Icon = props.summary.state === "running" ? LoaderCircle : props.summary.state === "failed" ? CircleX : CheckCircle2;
  const actionCount = `${props.summary.actionCount} ${props.summary.actionCount === 1 ? "action" : "actions"}`;
  return (
    <Collapsible
      className="w-full min-w-0"
      data-framing="none"
      data-presentation="trace"
      data-slot="ai-tool-group"
      onOpenChange={props.onOpenChange}
      open={props.open}
    >
      <CollapsibleTrigger
        aria-label={`${props.summary.label}. ${actionCount}. ${props.open ? "Hide" : "Show"} details`}
        className="group/tool-group flex w-full min-w-0 items-center gap-2 py-1 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/70"
        data-slot="transcript-activity-header"
        type="button"
      >
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center"
          data-slot="transcript-activity-identity"
        >
          <Icon className={cn(
            "size-3.5",
            props.summary.state === "running"
              ? "motion-safe:animate-spin text-primary"
              : props.summary.state === "failed"
                ? "text-destructive"
                : "text-success",
          )} />
        </span>
        <span className={cn("min-w-0 truncate font-medium text-foreground", props.summary.state === "running" ? "shimmer" : null)}>
          {props.summary.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{actionCount}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/tool-group:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-2 min-w-0 border-l border-border/55 py-2 pl-5 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity">
        <ul className="flex flex-col" aria-label="Tool activity">
          {props.children}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolGroupItem(props: ComponentProps<"li">) {
  return <li {...props} className={cn("min-w-0", props.className)} />;
}
