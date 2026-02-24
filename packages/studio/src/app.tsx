import { useState, type ReactNode } from "react";
import { Sidebar } from "./components/sidebar.js";
import { GraphView } from "./routes/graph.js";
import { PlaygroundView } from "./routes/playground.js";
import { TimelineView } from "./routes/timeline.js";
import { MemoryView } from "./routes/memory.js";
import { EvalView } from "./routes/eval.js";
import { CostView } from "./routes/cost.js";
import { SafetyView } from "./routes/safety.js";

type View = "graph" | "playground" | "timeline" | "memory" | "eval" | "cost" | "safety";

export function App(): ReactNode {
  const [view, setView] = useState<View>("graph");

  return (
    <div className="studio-layout">
      <Sidebar activeView={view} onNavigate={setView} />
      <main className="studio-main">
        {view === "graph" && <GraphView />}
        {view === "playground" && <PlaygroundView />}
        {view === "timeline" && <TimelineView />}
        {view === "memory" && <MemoryView />}
        {view === "eval" && <EvalView />}
        {view === "cost" && <CostView />}
        {view === "safety" && <SafetyView />}
      </main>
    </div>
  );
}
