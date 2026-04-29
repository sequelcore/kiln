import type { GuiResumeInfo, GuiTelemetrySnapshot } from "@kilnai/gateway-contracts";
import { useState, type ReactNode } from "react";
import type { RuntimeContinuityInfo } from "../lib/session-store.js";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

interface SessionTelemetryProps {
  readonly activeProvider: string | null;
  readonly resumeInfo: GuiResumeInfo | null;
  readonly runtimeContinuity: RuntimeContinuityInfo | null;
  readonly fieldTelemetry: GuiTelemetrySnapshot | null;
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
        <div className="grid gap-4 lg:grid-cols-2">
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

        </div>
      </PopoverContent>
    </Popover>
  );
}
