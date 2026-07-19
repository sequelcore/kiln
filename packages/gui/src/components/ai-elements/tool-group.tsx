import type { ComponentProps, ReactNode } from "react";
import { CheckCircle2, ChevronDown, CircleX, LoaderCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function ToolGroup(props: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly open: boolean;
  readonly totalCount: number;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const Icon = props.active ? LoaderCircle : props.failedCount > 0 ? CircleX : CheckCircle2;
  const actionCount = `${props.totalCount} ${props.totalCount === 1 ? "action" : "actions"}`;
  const label = props.active ? `Working · ${actionCount}` : actionCount;
  const summary = props.failedCount > 0
    ? `${props.failedCount} failed`
    : props.active
      ? `${props.completedCount} completed`
      : "Completed";
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
        aria-label={`${label}. ${props.open ? "Hide" : "Show"} actions`}
        className="group/tool-group flex w-full items-center gap-2 py-1.5 text-left text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/70"
        type="button"
      >
        <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", props.active ? "motion-safe:animate-spin text-primary" : props.failedCount > 0 ? "text-destructive" : "text-success")} />
        <span className="min-w-0 flex-1 text-xs font-medium text-current">{label}</span>
        <span className="text-[11px] text-muted-foreground">{summary}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/tool-group:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-1.5 border-l border-border/55 py-1 pl-5 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity">
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
