import { type ReactNode, useState } from "react";
import { useTimeline, type TimelineSpan } from "../hooks/use-timeline.js";

const SPAN_COLORS: Record<string, string> = {
  phase: "#4a9eff",
  tool: "#ff9800",
  agent: "#4caf50",
  task: "#9c27b0",
  trigger: "#e91e63",
  unknown: "#555",
};

export function TimelineView(): ReactNode {
  const { spans, connected, clear } = useTimeline();
  const [selectedSpan, setSelectedSpan] = useState<TimelineSpan | null>(null);

  const minTime = spans.length > 0 ? spans[0]!.startTime : 0;
  const maxTime = spans.length > 0
    ? Math.max(...spans.map((s) => s.endTime ?? s.startTime + (s.duration ?? 100)))
    : 1;
  const totalRange = Math.max(maxTime - minTime, 1);

  return (
    <div>
      <div className="flex justify-between items-center mb-16">
        <div className="card-header" style={{ marginBottom: 0 }}>
          Timeline
          <span className="badge badge-info" style={{ marginLeft: 8 }}>{connected ? "connected" : "disconnected"}</span>
        </div>
        <button className="btn" onClick={clear}>Clear</button>
      </div>

      {spans.length === 0 ? (
        <div className="empty-state">No spans recorded yet. Interact with the app to generate traces.</div>
      ) : (
        <div className="flex gap-16">
          <div className="card flex-1" style={{ overflow: "auto" }}>
            {spans.map((span) => {
              const left = ((span.startTime - minTime) / totalRange) * 100;
              const width = Math.max(
                (((span.endTime ?? span.startTime + (span.duration ?? 50)) - span.startTime) / totalRange) * 100,
                1,
              );
              const color = SPAN_COLORS[span.type] ?? SPAN_COLORS.unknown;

              return (
                <div
                  key={span.id}
                  onClick={() => setSelectedSpan(span)}
                  style={{
                    position: "relative",
                    height: 28,
                    marginBottom: 4,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      width: `${width}%`,
                      height: "100%",
                      background: color,
                      borderRadius: 4,
                      opacity: selectedSpan?.id === span.id ? 1 : 0.7,
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 8,
                      fontSize: 11,
                      color: "#fff",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {span.name}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedSpan && (
            <div className="card" style={{ width: 320 }}>
              <div className="card-header">Span Detail</div>
              <div className="flex-col gap-8">
                <div><strong>Name:</strong> {selectedSpan.name}</div>
                <div><strong>Type:</strong> <span className="badge badge-info">{selectedSpan.type}</span></div>
                {selectedSpan.duration !== undefined && (
                  <div><strong>Duration:</strong> {selectedSpan.duration.toFixed(1)}ms</div>
                )}
                {selectedSpan.status && (
                  <div><strong>Status:</strong> <span className={`badge badge-${selectedSpan.status === "ok" ? "success" : "error"}`}>{selectedSpan.status}</span></div>
                )}
                <div className="card-header mt-8">Metadata</div>
                <pre className="mono" style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "auto", maxHeight: 300 }}>
                  {JSON.stringify(selectedSpan.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
