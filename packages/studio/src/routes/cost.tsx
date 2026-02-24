import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useKilnContext } from "@kilnai/react";

interface RoleCost {
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

interface CostData {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalToolCalls: number;
  byRole: Record<string, RoleCost>;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function CostView(): ReactNode {
  const { client } = useKilnContext();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dev-cost"],
    queryFn: () => client.get<CostData>("/dev/cost"),
  });

  const roles = data ? Object.values(data.byRole) : [];

  return (
    <div>
      <div className="flex justify-between items-center mb-16">
        <div className="card-header" style={{ marginBottom: 0 }}>Cost</div>
        <button className="btn" onClick={() => void refetch()} disabled={isLoading}>
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 16 }}>
          Failed to load cost data: {(error as Error).message}
        </div>
      )}

      {!data && !isLoading && !error && (
        <div className="empty-state">No cost data available.</div>
      )}

      {data && (
        <>
          <div className="summary-grid">
            <div className="card">
              <div className="card-header">Total Cost</div>
              <div className="stat-value accent">{formatUsd(data.totalCostUsd)}</div>
            </div>
            <div className="card">
              <div className="card-header">Input Tokens</div>
              <div className="stat-value">{formatNumber(data.totalInputTokens)}</div>
            </div>
            <div className="card">
              <div className="card-header">Output Tokens</div>
              <div className="stat-value">{formatNumber(data.totalOutputTokens)}</div>
            </div>
            <div className="card">
              <div className="card-header">Cache Read</div>
              <div className="stat-value">{formatNumber(data.totalCacheReadTokens)}</div>
            </div>
            <div className="card">
              <div className="card-header">Cache Write</div>
              <div className="stat-value">{formatNumber(data.totalCacheWriteTokens)}</div>
            </div>
            <div className="card">
              <div className="card-header">Tool Calls</div>
              <div className="stat-value">{formatNumber(data.totalToolCalls)}</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">By Role</div>
            {roles.length === 0 ? (
              <div className="text-muted" style={{ fontSize: 13 }}>No role data recorded yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="cost-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Model</th>
                      <th>Input Tokens</th>
                      <th>Output Tokens</th>
                      <th>Cache Read</th>
                      <th>Cache Write</th>
                      <th>Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r) => (
                      <tr key={r.role}>
                        <td className="mono" style={{ color: "var(--text-primary)", fontWeight: 600 }}>{r.role}</td>
                        <td className="text-secondary" style={{ fontSize: 12 }}>{r.model}</td>
                        <td>{formatNumber(r.inputTokens)}</td>
                        <td>{formatNumber(r.outputTokens)}</td>
                        <td>{formatNumber(r.cacheReadTokens)}</td>
                        <td>{formatNumber(r.cacheWriteTokens)}</td>
                        <td>{formatNumber(r.calls)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <style>{`
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 0;
        }
        .stat-value {
          font-size: 22px;
          font-weight: 700;
          font-family: var(--font-mono);
          color: var(--text-primary);
        }
        .stat-value.accent {
          color: var(--accent);
        }
        .cost-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .cost-table th {
          text-align: left;
          padding: 8px 12px;
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid var(--border);
        }
        .cost-table td {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border);
          color: var(--text-secondary);
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .cost-table tr:last-child td {
          border-bottom: none;
        }
        .cost-table tr:hover td {
          background: var(--bg-hover);
        }
      `}</style>
    </div>
  );
}
