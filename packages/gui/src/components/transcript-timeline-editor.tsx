import { useMemo, useState } from "react";
import type { TimelinePresentationIntent, TimelinePresentationItem } from "@kilnai/gateway-contracts";
import { Captions, EyeOff, Scissors, ZoomIn } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type RecorderTimelineEditKind = "auto_zoom" | "cut" | "caption" | "redaction";

interface RecorderTimelineEditItem {
  readonly key: string;
  readonly kind: RecorderTimelineEditKind;
  readonly label: string;
  readonly timestamp?: string;
  readonly summary?: string;
  readonly initialCaption: string;
}

interface RecorderTimelineAdjustment {
  readonly zoomDepth: string;
  readonly cutSelected: boolean;
  readonly captionText: string;
  readonly redacted: boolean;
}

const EDIT_KIND_LABELS: Record<RecorderTimelineEditKind, string> = {
  auto_zoom: "Zoom",
  cut: "Cut",
  caption: "Caption",
  redaction: "Redaction",
};

function inferEditKind(item: TimelinePresentationItem): RecorderTimelineEditKind | null {
  const source = `${item.id ?? ""} ${item.label} ${item.summary ?? ""}`.toLowerCase();
  if (/\b(redaction|redact|mask)\b/u.test(source)) return "redaction";
  if (/\b(caption|subtitle)\b/u.test(source)) return "caption";
  if (/\b(cut|trim)\b/u.test(source) || source.includes("idle gap")) return "cut";
  if (/\b(auto[_ -]?zoom|zoom)\b/u.test(source) || source.includes("click target")) return "auto_zoom";
  return null;
}

function captionText(item: TimelinePresentationItem): string {
  const match = /^caption\s*[:\-]\s*(?<caption>.+)$/iu.exec(item.label);
  return match?.groups?.caption?.trim() ?? item.summary ?? item.label;
}

function defaultAdjustment(item: RecorderTimelineEditItem): RecorderTimelineAdjustment {
  return {
    zoomDepth: "1.6",
    cutSelected: false,
    captionText: item.initialCaption,
    redacted: false,
  };
}

function isRecorderTimelineIntent(intent: TimelinePresentationIntent): boolean {
  const resourceText = [
    ...(intent.resourceLinks ?? []),
    ...intent.items.flatMap((item) => item.resourceLinks ?? []),
  ]
    .map((resource) => `${resource.title ?? ""} ${resource.relation ?? ""} ${resource.mimeType ?? ""}`)
    .join(" ");
  const source = `${intent.title} ${intent.summary ?? ""} ${intent.source ?? ""} ${resourceText}`.toLowerCase();
  return /\b(recorder|recording|capture|showcase|video)\b/u.test(source);
}

function projectRecorderTimelineItems(intent: TimelinePresentationIntent): readonly RecorderTimelineEditItem[] {
  if (!isRecorderTimelineIntent(intent)) return [];
  return intent.items.flatMap((item, index) => {
    const kind = inferEditKind(item);
    if (!kind) return [];
    return [{
      key: item.id ?? `${index}:${item.label}`,
      kind,
      label: item.label,
      ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      ...(item.summary ? { summary: item.summary } : {}),
      initialCaption: captionText(item),
    }];
  });
}

function editIcon(kind: RecorderTimelineEditKind) {
  return {
    auto_zoom: ZoomIn,
    cut: Scissors,
    caption: Captions,
    redaction: EyeOff,
  }[kind];
}

export function TranscriptTimelineEditor(props: { readonly intent: TimelinePresentationIntent }) {
  const editItems = useMemo(() => projectRecorderTimelineItems(props.intent), [props.intent]);
  const [adjustments, setAdjustments] = useState<Record<string, RecorderTimelineAdjustment>>({});

  if (editItems.length === 0) return null;

  const updateAdjustment = (
    item: RecorderTimelineEditItem,
    updater: (current: RecorderTimelineAdjustment) => RecorderTimelineAdjustment,
  ) => {
    setAdjustments((current) => {
      const existing = current[item.key] ?? defaultAdjustment(item);
      return { ...current, [item.key]: updater(existing) };
    });
  };

  return (
    <section
      role="region"
      aria-label="Recorder timeline editor"
      className="mt-2 rounded-lg border border-border/70 bg-background/55 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-foreground">Timeline edits</p>
        <Badge variant="outline" className="shrink-0">
          {editItems.length} track{editItems.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {editItems.map((item) => {
          const adjustment = adjustments[item.key] ?? defaultAdjustment(item);
          const Icon = editIcon(item.kind);
          return (
            <article
              key={item.key}
              className="rounded-md border border-border/70 bg-background/70 px-2.5 py-2"
            >
              <header className="flex min-w-0 flex-wrap items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Badge variant="outline" className="shrink-0">
                  {EDIT_KIND_LABELS[item.kind]}
                </Badge>
                {item.timestamp ? (
                  <span className="font-mono text-[10px] text-muted-foreground">{item.timestamp}</span>
                ) : null}
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.label}</p>
              </header>
              {item.summary ? (
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.summary}</p>
              ) : null}
              <TimelineEditControls
                item={item}
                adjustment={adjustment}
                onChange={(updater) => updateAdjustment(item, updater)}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TimelineEditControls(props: {
  readonly item: RecorderTimelineEditItem;
  readonly adjustment: RecorderTimelineAdjustment;
  readonly onChange: (updater: (current: RecorderTimelineAdjustment) => RecorderTimelineAdjustment) => void;
}) {
  if (props.item.kind === "auto_zoom") {
    return (
      <div className="mt-2 grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`${props.item.key}-zoom`}>
            Zoom depth
          </label>
          <span className="font-mono text-xs text-foreground">
            {Number(props.adjustment.zoomDepth).toFixed(1)}x
          </span>
        </div>
        <Input
          id={`${props.item.key}-zoom`}
          type="range"
          min="1"
          max="3"
          step="0.1"
          value={props.adjustment.zoomDepth}
          aria-label={`Zoom depth for ${props.item.label}`}
          className="h-7 px-0"
          onChange={(event) => props.onChange((current) => ({ ...current, zoomDepth: event.target.value }))}
        />
      </div>
    );
  }

  if (props.item.kind === "cut") {
    return (
      <label className="mt-2 flex w-fit items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={props.adjustment.cutSelected}
          aria-label={`Cut segment for ${props.item.label}`}
          className="size-4 rounded border-border accent-primary"
          onChange={(event) => props.onChange((current) => ({ ...current, cutSelected: event.target.checked }))}
        />
        <span className={cn(props.adjustment.cutSelected ? "text-foreground" : "text-muted-foreground")}>
          {props.adjustment.cutSelected ? "Cut selected" : "Keep segment"}
        </span>
      </label>
    );
  }

  if (props.item.kind === "caption") {
    return (
      <div className="mt-2 grid gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${props.item.key}-caption`}>
          Caption text
        </label>
        <Textarea
          id={`${props.item.key}-caption`}
          value={props.adjustment.captionText}
          aria-label={`Caption text for ${props.item.label}`}
          className="min-h-12 resize-y text-sm"
          onChange={(event) => props.onChange((current) => ({ ...current, captionText: event.target.value }))}
        />
      </div>
    );
  }

  return (
    <label className="mt-2 flex w-fit items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={props.adjustment.redacted}
        aria-label={`Redact region for ${props.item.label}`}
        className="size-4 rounded border-border accent-destructive"
        onChange={(event) => props.onChange((current) => ({ ...current, redacted: event.target.checked }))}
      />
      <span className={cn(props.adjustment.redacted ? "text-foreground" : "text-muted-foreground")}>
        {props.adjustment.redacted ? "Redaction marked" : "Visible region"}
      </span>
    </label>
  );
}
