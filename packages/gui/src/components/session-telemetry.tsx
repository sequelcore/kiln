import type { GuiResumeInfo, GuiTelemetrySnapshot } from "@kilnai/gateway-contracts";
import { useState, type ReactNode } from "react";
import type { ChangedFileEntry, RuntimeContinuityInfo } from "../lib/session-store.js";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

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
    <section className="flex flex-col gap-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{props.title}</p>
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
    <Popover open={expanded} onOpenChange={setExpanded}>
      <PopoverTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
          />
        )}
      >
        {expanded ? "Hide" : "Details"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(48rem,calc(100vw-2rem))]">
        <PopoverHeader>
          <PopoverTitle>Session details</PopoverTitle>
        </PopoverHeader>
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="Continuity">
            <div className="flex flex-col gap-1 text-xs text-foreground">
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
            <div className="flex flex-col gap-1 text-xs text-foreground">
              <p>field [{fieldStatus}]</p>
              <p>dom: {dominantRegions}</p>
              <p>sat: {saturation}  H: {entropy}</p>
            </div>
          </Section>

          <Section title="Changed Files">
            {props.changedFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground">(none)</p>
            ) : (
              <ul className="flex flex-col gap-1 text-xs text-foreground">
                {props.changedFiles.slice(0, 8).map((entry) => (
                  <li key={`${entry.recordedAt}:${entry.path}`}>{formatChange(entry)}</li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
