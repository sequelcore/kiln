import type { GuiResumeInfo, GuiTelemetrySnapshot } from "@kilnai/gateway-contracts";
import { useState, type ReactNode } from "react";
import type { ChangedFileEntry, RuntimeContinuityInfo } from "../lib/session-store.js";
import { Button } from "@/components/ui/button";

interface SessionTelemetryProps {
  readonly activeProvider: string | null;
  readonly resumeInfo: GuiResumeInfo | null;
  readonly runtimeContinuity: RuntimeContinuityInfo | null;
  readonly changedFiles: readonly ChangedFileEntry[];
  readonly fieldTelemetry: GuiTelemetrySnapshot | null;
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
  const [expanded, setExpanded] = useState(false);
  const fieldStatus = props.fieldTelemetry?.status ?? "idle";
  const dominantRegions = props.fieldTelemetry?.dominantRegions?.length
    ? props.fieldTelemetry.dominantRegions.slice(0, 3).join(", ")
    : "--";
  const saturation = `${Math.round((props.fieldTelemetry?.saturation ?? 0) * 100)}%`;
  const entropy = (props.fieldTelemetry?.entropy ?? 0).toFixed(2);

  return (
    <section className="border-b border-border/60 bg-card/30">
      <div className="flex items-center gap-2 px-4 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Inspector</p>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-expanded={expanded}
          className="ml-auto"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide" : "Details"}
        </Button>
      </div>
      {expanded ? (
      <div className="grid gap-3 border-t border-border/60 px-4 py-3 lg:grid-cols-3">
        <Section title="Continuity">
          <div className="space-y-1 text-xs text-[var(--color-text)]">
            <p>resume: {props.resumeInfo?.strategy ?? "--"}{props.resumeInfo?.feedbackLabel ? ` · ${props.resumeInfo.feedbackLabel}` : ""}</p>
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
      ) : null}
    </section>
  );
}
