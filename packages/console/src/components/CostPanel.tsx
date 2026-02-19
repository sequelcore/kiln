import type { CostSummary } from "../lib/protocol";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DollarSign, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const ROLE_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

function costColor(total: number): string {
  if (total >= 5) return "text-red-400";
  if (total >= 1) return "text-amber-400";
  return "text-emerald-400";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface CostPanelProps {
  cost: CostSummary;
}

export function CostPanel({ cost }: CostPanelProps) {
  const roles = Object.entries(cost.byRole);
  const chartData = roles.map(([role, amount]) => ({
    name: role.charAt(0).toUpperCase() + role.slice(1),
    cost: Number(amount.toFixed(4)),
  }));

  return (
    <Card>
      <CardHeader className="pb-2 p-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5" />
          Cost
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {/* Total Cost */}
        <p className={cn("text-2xl font-mono font-bold tabular-nums", costColor(cost.total))}>
          ${cost.total.toFixed(4)}
        </p>

        {/* Token Breakdown */}
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ArrowDownToLine className="h-3 w-3" />
            {formatTokens(cost.inputTokens)} in
          </span>
          <span className="flex items-center gap-1">
            <ArrowUpFromLine className="h-3 w-3" />
            {formatTokens(cost.outputTokens)} out
          </span>
        </div>

        {/* Per-Role Chart */}
        {chartData.length > 0 && (
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={chartData.length * 28 + 16}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={70}
                  tick={{ fill: "#a3a3a3", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={false}
                  contentStyle={{
                    background: "#171717",
                    border: "1px solid #262626",
                    borderRadius: "6px",
                    fontSize: "12px",
                    color: "#fafafa",
                  }}
                  formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cost"]}
                />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]} barSize={14}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]!} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
