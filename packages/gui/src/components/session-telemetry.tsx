import type { GuiTelemetrySnapshot } from "@kilnai/gateway-contracts";
import type { ReactNode } from "react";
import type { ChangedFileEntry, ProviderUsage, RuntimeContinuityInfo, SessionStatus } from "../lib/session-store.js";

interface SessionTelemetryProps {
  readonly status: SessionStatus;
  readonly activeProvider: string | null;
  readonly turnCounter: number;
  readonly sessionCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly perProviderUsage: Readonly<Record<string, ProviderUsage>>;
  readonly runtimeContinuity: RuntimeContinuityInfo | null;
  readonly changedFiles: readonly ChangedFileEntry[];
  readonly fieldTelemetry: GuiTelemetrySnapshot | null;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatCompactTokens(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

function formatChange(entry: ChangedFileEntry): string {
  const icon = entry.changeType === "created" ? "+" : entry.changeType === "deleted" ? "-" : "~";
  const fileName = entry.path.replace(/\\/g, "/").split("/").pop() ?? entry.path;
  const delta = entry.linesAdded || entry.linesRemoved
    ? ` ${entry.linesAdded ? `+${entry.linesAdded}` : ""}${entry.linesRemoved ? `-${entry.linesRemoved}` : ""}`
    : "";
  return `${icon} ${fileName}${delta}`;
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background-panel)] p-3">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">{props.title}</p>
      {props.children}
    </section>
  );
}

export function SessionTelemetry(props: SessionTelemetryProps) {
  const providerEntries = Object.entries(props.perProviderUsage);
  const showProviderBreakdown = providerEntries.length >= 2;
  const fieldStatus = props.fieldTelemetry?.status ?? "idle";
  const dominantRegions = props.fieldTelemetry?.dominantRegions?.length
    ? props.fieldTelemetry.dominantRegions.slice(0, 3).join(", ")
    : "--";
  const saturation = `${Math.round((props.fieldTelemetry?.saturation ?? 0) * 100)}%`;
  const entropy = (props.fieldTelemetry?.entropy ?? 0).toFixed(2);

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3">
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
        <Section title="Cost">
          {props.status === "running" ? (
            <p className="text-sm text-[var(--color-text-muted)]">thinking...</p>
          ) : showProviderBreakdown ? (
            <ul className="space-y-1 text-xs text-[var(--color-text)]">
              {providerEntries.map(([provider, usage]) => (
                <li key={provider} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[var(--color-text-muted)]">{provider}</span>
                  <span>
                    {formatCurrency(usage.costUsd)} {formatCompactTokens(usage.inputTokens)}↑{formatCompactTokens(usage.outputTokens)}↓
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-text)]">{formatCurrency(props.sessionCostUsd)}</p>
          )}
        </Section>

        <Section title="Session">
          <div className="space-y-1 text-xs text-[var(--color-text)]">
            <p>turns: {props.turnCounter}</p>
            <p>tok: {formatCompactTokens(props.inputTokens)}/{formatCompactTokens(props.outputTokens)}</p>
            <p className="text-[var(--color-text-muted)]">provider: {props.activeProvider ?? "--"}</p>
          </div>
        </Section>

        <Section title="Continuity">
          <div className="space-y-1 text-xs text-[var(--color-text)]">
            <p>resume: {props.runtimeContinuity?.strategy ?? "--"}{props.runtimeContinuity?.feedbackLabel ? ` · ${props.runtimeContinuity.feedbackLabel}` : ""}</p>
            <p>runtime: {props.runtimeContinuity?.strategy ?? "--"}{props.runtimeContinuity?.feedbackLabel ? ` · ${props.runtimeContinuity.feedbackLabel}` : ""}</p>
            <p>ctx: {props.runtimeContinuity?.pressure ?? "--"}{props.runtimeContinuity?.supportArtifactCount !== undefined ? ` · src ${props.runtimeContinuity.supportArtifactCount}` : ""}</p>
            <p>srcs: {props.runtimeContinuity?.supportArtifactSources?.length ? props.runtimeContinuity.supportArtifactSources.join(", ") : "--"}</p>
            <p>why: {props.runtimeContinuity?.fallbackLabel ?? "--"}</p>
            <p>used: {props.runtimeContinuity?.supportArtifactSources?.length ? (props.runtimeContinuity.usedCachedSupport ? "selected" : "available-only") : "--"}</p>
            <p>sel: {props.runtimeContinuity?.selectionReason ?? "--"}</p>
          </div>
        </Section>

        <Section title="Field">
          <div className="space-y-1 text-xs text-[var(--color-text)]">
            <p>field [{fieldStatus}]</p>
            <p>dom: {dominantRegions}</p>
            <p>sat: {saturation}  H: {entropy}</p>
          </div>
        </Section>

        <Section title="Changed Files">
          {props.changedFiles.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">(none)</p>
          ) : (
            <ul className="space-y-1 text-xs text-[var(--color-text)]">
              {props.changedFiles.slice(0, 8).map((entry) => (
                <li key={`${entry.recordedAt}:${entry.path}`}>{formatChange(entry)}</li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
