import { useMemo } from "react";
import { useKilnEvents } from "@kilnai/react";

export interface TimelineSpan {
  id: string;
  type: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: string;
  metadata: Record<string, unknown>;
}

export function useTimeline() {
  const { events, connected, clear } = useKilnEvents();

  const spans = useMemo(() => {
    const spanMap = new Map<string, TimelineSpan>();

    for (const event of events) {
      if (event.type !== "trace_span") continue;
      const data = event.data;
      const id = (data.spanId as string) ?? (data.name as string) ?? event.timestamp;

      const existing = spanMap.get(id);
      if (existing) {
        if (data.endTime) {
          existing.endTime = new Date(data.endTime as string).getTime();
          existing.duration = existing.endTime - existing.startTime;
          existing.status = data.status as string | undefined;
        }
      } else {
        spanMap.set(id, {
          id,
          type: (data.kind as string) ?? "unknown",
          name: (data.name as string) ?? "unknown",
          startTime: new Date(event.timestamp).getTime(),
          endTime: data.endTime ? new Date(data.endTime as string).getTime() : undefined,
          duration: data.durationMs as number | undefined,
          status: data.status as string | undefined,
          metadata: data,
        });
      }
    }

    return [...spanMap.values()].sort((a, b) => a.startTime - b.startTime);
  }, [events]);

  return { spans, events, connected, clear };
}
