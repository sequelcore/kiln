import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useKilnContext, useKilnEvents } from "@kilnai/react";
import "./cost.css";

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

  const { events } = useKilnEvents();
  const costEventCount = events.filter((e) => e.type === "cost_update").length;
  useEffect(() => {
    if (costEventCount > 0) void refetch();
  }, [costEventCount, refetch]);

  const roles = data ? Object.values(data.byRole) : [];

  return (
    <div>
      <div className="card-header">Cost</div>

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

    </div>
  );
}
