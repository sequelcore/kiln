import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useKilnContext } from "@kilnai/react";

interface EvalExperiment {
  name: string;
  dataset?: string;
  scorers: string[];
}

export function EvalView(): ReactNode {
  const { client } = useKilnContext();
  const [selectedExp, setSelectedExp] = useState<string | null>(null);

  const { data: experiments, isLoading } = useQuery({
    queryKey: ["eval-experiments"],
    queryFn: () => client.get<EvalExperiment[]>("/dev/eval/experiments"),
  });

  const { data: results } = useQuery({
    queryKey: ["eval-results", selectedExp],
    queryFn: () => client.get<Record<string, unknown>>(`/dev/eval/experiments/${selectedExp}/results`),
    enabled: !!selectedExp,
  });

  if (isLoading) return <div className="empty-state">Loading experiments...</div>;

  return (
    <div>
      <div className="card-header mb-16">Eval Dashboard</div>

      {!experiments || experiments.length === 0 ? (
        <div className="empty-state">No experiments configured. Add an eval section to your app.yaml.</div>
      ) : (
        <div className="flex gap-16">
          <div className="card" style={{ width: 300 }}>
            <div className="card-header">Experiments</div>
            {experiments.map((exp) => (
              <div
                key={exp.name}
                onClick={() => setSelectedExp(exp.name)}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  borderRadius: 4,
                  background: selectedExp === exp.name ? "rgba(74, 158, 255, 0.1)" : "transparent",
                  marginBottom: 4,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{exp.name}</div>
                {exp.dataset && <div className="text-muted" style={{ fontSize: 11 }}>Dataset: {exp.dataset}</div>}
                <div style={{ marginTop: 4 }}>
                  {exp.scorers.map((s) => (
                    <span key={s} className="badge badge-info" style={{ marginRight: 4, fontSize: 10 }}>{s}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="card flex-1">
            <div className="card-header">Results</div>
            {!selectedExp && (
              <div className="text-muted">Select an experiment to view results</div>
            )}
            {selectedExp && !results && (
              <div className="text-muted">No results available for this experiment. Run the experiment first.</div>
            )}
            {selectedExp && results && (
              <pre className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "auto" }}>
                {JSON.stringify(results, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
