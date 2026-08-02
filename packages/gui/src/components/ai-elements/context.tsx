import { Gauge } from "lucide-react";
import {
  formatContextUsageProjection,
  type ContextUsageProjection,
} from "@kilnai/gateway-contracts";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const COMPACT_TOKEN_FORMAT = new Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: "compact" });
const TOKEN_FORMAT = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function formatTokens(tokens: number): string {
  return (tokens >= 1_000 ? COMPACT_TOKEN_FORMAT : TOKEN_FORMAT).format(tokens).toLowerCase();
}

function contextStateLabel(usage: ContextUsageProjection | null): string {
  if (!usage) return "Unavailable";
  if (usage.state === "authoritative") return "Provider reported";
  if (usage.state === "partial") return usage.measurement === "runtime_estimate" ? "Runtime estimate" : "Partial";
  return "Unavailable";
}

function contextTriggerValue(usage: ContextUsageProjection | null): string {
  if (usage?.usedPercentage !== undefined) return `${Math.round(usage.usedPercentage)}%`;
  if (usage?.usedTokens !== undefined) return formatTokens(usage.usedTokens);
  return "Context";
}

export function ContextMeter(props: { readonly usage?: ContextUsageProjection | null }) {
  const usage = props.usage ?? null;
  const historical = usage?.freshness === "historical";
  const baseLabel = usage ? formatContextUsageProjection(usage) : "Context usage unavailable";
  const label = historical ? `${baseLabel}; restored historical measurement` : baseLabel;
  const percentage = usage?.usedPercentage;
  const dashOffset = percentage === undefined ? 50 : 50 - (50 * Math.min(100, Math.max(0, percentage)) / 100);
  const detail = usage?.contextWindowTokens !== undefined && usage.usedTokens !== undefined
    ? `${formatTokens(usage.usedTokens)} / ${formatTokens(usage.contextWindowTokens)} tokens`
    : usage?.usedTokens !== undefined
      ? `${formatTokens(usage.usedTokens)} tokens observed`
      : "No context measurement is available for this turn.";

  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 text-[11px] font-medium tabular-nums text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative grid size-4 place-items-center" aria-hidden="true">
          {percentage === undefined ? (
            <Gauge className="size-3.5" />
          ) : (
            <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden="true">
              <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
              <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="50" strokeDashoffset={dashOffset} />
            </svg>
          )}
        </span>
        <span>{contextTriggerValue(usage)}</span>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={8} className="w-72 gap-3 p-3">
        <PopoverHeader>
          <div className="flex items-center justify-between gap-3">
            <PopoverTitle>Context window</PopoverTitle>
            <span className={cn("text-[11px] font-medium text-muted-foreground", usage?.state === "authoritative" ? "text-success" : null)}>
              {contextStateLabel(usage)}
            </span>
          </div>
          <PopoverDescription>{detail}</PopoverDescription>
        </PopoverHeader>
        {percentage !== undefined ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-2xl font-semibold tabular-nums text-foreground">{Math.round(percentage)}%</span>
              {usage?.remainingTokens !== undefined ? <span className="text-xs tabular-nums text-muted-foreground">{formatTokens(usage.remainingTokens)} remaining</span> : null}
            </div>
            <Progress aria-label="Context window used" value={percentage} className="gap-0" />
          </div>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs">
          {usage?.modelId ? <><dt className="text-muted-foreground">Model</dt><dd className="truncate text-right text-foreground">{usage.modelId}</dd></> : null}
          {usage ? <><dt className="text-muted-foreground">Freshness</dt><dd className="text-right text-foreground">{historical ? "Historical" : usage.freshness}</dd></> : null}
        </dl>
        {usage?.reason || usage?.caveat ? <p className="border-t border-border/60 pt-2 text-xs leading-5 text-muted-foreground">{usage.reason ?? usage.caveat}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
