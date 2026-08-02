import { lazy, Suspense, useState, type ReactNode } from "react";
import { Sidebar } from "./components/sidebar.js";
import type { View } from "./types.js";

const GraphView = lazy(async () => {
  const module = await import("./routes/graph.js");
  return { default: module.GraphView };
});
const PlaygroundView = lazy(async () => {
  const module = await import("./routes/playground.js");
  return { default: module.PlaygroundView };
});
const TimelineView = lazy(async () => {
  const module = await import("./routes/timeline.js");
  return { default: module.TimelineView };
});
const EvalView = lazy(async () => {
  const module = await import("./routes/eval.js");
  return { default: module.EvalView };
});
const CostView = lazy(async () => {
  const module = await import("./routes/cost.js");
  return { default: module.CostView };
});
const SafetyView = lazy(async () => {
  const module = await import("./routes/safety.js");
  return { default: module.SafetyView };
});

export function App(): ReactNode {
  const [view, setView] = useState<View>("graph");

  return (
    <div className="studio-layout">
      <Sidebar activeView={view} onNavigate={setView} />
      <main className="studio-main">
        <Suspense fallback={<p role="status">Loading Studio view.</p>}>
          {view === "graph" && <GraphView />}
          {view === "playground" && <PlaygroundView />}
          {view === "timeline" && <TimelineView />}
          {view === "eval" && <EvalView />}
          {view === "cost" && <CostView />}
          {view === "safety" && <SafetyView />}
        </Suspense>
      </main>
    </div>
  );
}
