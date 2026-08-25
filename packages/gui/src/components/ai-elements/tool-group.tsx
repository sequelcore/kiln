import type { ComponentProps, ReactNode } from "react";
import type { ToolActivitySummary } from "@kilnai/gateway-contracts";
import { CheckCircle2, ChevronDown, CircleX, LoaderCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
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
      <Marker
        render={(
          <CollapsibleTrigger
            aria-label={`${props.summary.label}. ${actionCount}. ${props.open ? "Hide" : "Show"} details`}
            className="group/tool-group rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70"
            type="button"
          />
        )}
      >
        <MarkerIcon>
          <Icon className={cn(props.summary.state === "running" ? "motion-safe:animate-spin text-primary" : props.summary.state === "failed" ? "text-destructive" : "text-success")} />
        </MarkerIcon>
        <MarkerContent className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-xs font-medium text-foreground", props.summary.state === "running" ? "shimmer" : null)}>
            {props.summary.label}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{actionCount}</span>
        </MarkerContent>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/tool-group:rotate-180" />
      </Marker>
      <CollapsibleContent className="ml-3 border-l border-border/55 py-1 pl-4 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity">
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
