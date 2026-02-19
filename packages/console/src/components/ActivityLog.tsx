import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Activity } from "lucide-react";

interface ActivityEvent {
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}

const MAX_VISIBLE_EVENTS = 20;

type EventFormat = { label: string; badgeLabel: string; color: string };

function formatEvent(evt: ActivityEvent): EventFormat {
  switch (evt.event) {
    case "phase_changed":
      return {
        badgeLabel: "Phase",
        label: String(evt.data["phaseName"] ?? evt.data["phase"] ?? "unknown"),
        color: "text-chart-1",
      };
    case "task_started":
      return {
        badgeLabel: "Task",
        label: `Started: ${String(evt.data["statement"] ?? evt.data["taskId"] ?? "")}`,
        color: "text-foreground",
      };
    case "task_completed":
      return {
        badgeLabel: "Task",
        label: `${String(evt.data["status"] ?? "done")}: ${String(evt.data["taskId"] ?? "")}`,
        color: "text-emerald-400",
      };
    case "tool_called":
      return {
        badgeLabel: "Tool",
        label: `${String(evt.data["toolName"] ?? "")}${evt.data["workerIndex"] != null ? ` (W${String(evt.data["workerIndex"])})` : ""}`,
        color: "text-muted-foreground",
      };
    case "cost_update":
      return {
        badgeLabel: "Cost",
        label: `$${Number(evt.data["totalCostUsd"] ?? 0).toFixed(4)}`,
        color: "text-amber-400",
      };
    case "error":
      return {
        badgeLabel: "Error",
        label: String(evt.data["message"] ?? "unknown"),
        color: "text-red-400",
      };
    case "verification_result":
      return {
        badgeLabel: "Verify",
        label: `${evt.data["passed"] ? "PASSED" : "FAILED"} (iter ${String(evt.data["iteration"] ?? "?")})`,
        color: evt.data["passed"] ? "text-emerald-400" : "text-red-400",
      };
    case "memory_saved":
      return {
        badgeLabel: "Memory",
        label: `Saved to ${String(evt.data["layer"] ?? "unknown")}`,
        color: "text-muted-foreground",
      };
    case "worker_assigned":
      return {
        badgeLabel: "Worker",
        label: `#${String(evt.data["workerIndex"] ?? "?")} -> ${String(evt.data["taskId"] ?? "")}`,
        color: "text-chart-1",
      };
    default:
      return {
        badgeLabel: evt.event,
        label: "",
        color: "text-muted-foreground/50",
      };
  }
}

interface ActivityLogProps {
  events: ActivityEvent[];
}

export function ActivityLog({ events }: ActivityLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = events.slice(-MAX_VISIBLE_EVENTS);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <Card>
      <CardHeader className="pb-2 p-4 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          Activity
        </CardTitle>
        {events.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {events.length} events
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground/50">No activity yet</p>
        ) : (
          <div
            ref={scrollRef}
            className="max-h-48 overflow-y-auto space-y-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
          >
            {visible.map((evt, i) => {
              const { label, badgeLabel, color } = formatEvent(evt);
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-2 text-xs",
                    i < visible.length - 5 && "opacity-50",
                    i >= visible.length - 5 && i < visible.length - 2 && "opacity-75",
                  )}
                >
                  <span className="text-muted-foreground/40 font-mono shrink-0 tabular-nums w-16">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 h-4">
                    {badgeLabel}
                  </Badge>
                  <span className={cn("truncate", color)}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
