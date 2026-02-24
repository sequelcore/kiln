import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useKilnContext } from "@kilnai/react";

interface SafetyData {
  enabled: boolean;
  apps?: Record<string, {
    scansInput: number; scansOutput: number;
    blocksInput: number; blocksOutput: number;
    piiDetections: number; contentBlocks: number; policyEvaluations: number;
  }>;
}

export function SafetyView(): ReactNode {
  const { client } = useKilnContext();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dev-safety"],
    queryFn: () => client.get<SafetyData>("/dev/safety"),
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="empty-state">Loading...</div>;
  if (error) return <div style={{ color: "var(--error)", fontSize: 13 }}>Failed to load: {(error as Error).message}</div>;
  if (!data?.enabled) return <div className="empty-state">Safety pipeline is not configured.</div>;

  return (
    <div>
      <div className="card-header">Safety</div>
      {Object.entries(data.apps ?? {}).map(([appName, m]) => (
        <div key={appName} className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">{appName}</div>
          <div className="safety-grid">
            <MetricCard label="Input Scans" value={m.scansInput} />
            <MetricCard label="Output Scans" value={m.scansOutput} />
            <MetricCard label="Input Blocks" value={m.blocksInput} warn />
            <MetricCard label="Output Blocks" value={m.blocksOutput} warn />
            <MetricCard label="PII Detections" value={m.piiDetections} warn />
            <MetricCard label="Content Blocks" value={m.contentBlocks} warn />
            <MetricCard label="Policy Evals" value={m.policyEvaluations} />
          </div>
        </div>
      ))}
      <style>{`
        .safety-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .safety-stat {
          font-size: 22px;
          font-weight: 700;
          font-family: var(--font-mono);
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}

function MetricCard({ label, value, warn }: { label: string; value: number; warn?: boolean }): ReactNode {
  return (
    <div className="card">
      <div className="card-header">{label}</div>
      <div className="safety-stat" style={warn && value > 0 ? { color: "var(--warning)" } : undefined}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
