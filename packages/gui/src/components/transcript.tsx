import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  projectConversationTurnItems,
  type ConversationProjectionInput,
  formatOperatorEventValue,
  operatorEmptyStatePhraseAt,
  type PresentationIntent,
  type ComparisonTablePresentationColumn,
  type ComparisonTablePresentationCell,
  type PresentationIntentResourceLink,
  type ToolResultOutputKind,
} from "@kilnai/gateway-contracts";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, FileText, Folder, LoaderCircle, Terminal } from "lucide-react";
import { BorderBeam } from "border-beam";
import { collapseAllNested, JsonView } from "react-json-view-lite";
import type { ActivityPhase, TimelineEntry, TimelineEventEntry } from "../lib/session-store.js";
import { ActivityPhaseIndicator } from "./activity-phase-indicator.js";
import { MarkdownMessageContent, MessageRow } from "./message-row.js";
import { TranscriptTimelineEditor } from "./transcript-timeline-editor.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TranscriptProps {
  readonly entries: readonly TimelineEntry[];
  readonly activityPhase?: ActivityPhase;
  readonly activityToolName?: string;
  readonly activityDetails?: string;
  readonly loadResourceDataUrl?: (uri: string) => Promise<string | null>;
  readonly onApprove?: (approvalId: string) => void;
  readonly onDeny?: (approvalId: string) => void;
}

const TRANSCRIPT_TOOL_DETAIL_LABELS = new Set([
  "Profile",
  "Provider",
  "Model",
  "Surface",
  "Context mode",
  "Agent profile",
  "Skills",
  "Task",
]);
const KILN_LOGO_URL = new URL("../../../../docs/assets/logo.svg", import.meta.url).href;
const KILN_JSON_VIEW_STYLE = {
  container: "kiln-json-view",
  childFieldsContainer: "kiln-json-view__children",
  basicChildStyle: "kiln-json-view__row",
  collapseIcon: "kiln-json-view__collapse",
  expandIcon: "kiln-json-view__expand",
  collapsedContent: "kiln-json-view__collapsed",
  label: "kiln-json-view__label",
  clickableLabel: "kiln-json-view__clickable-label",
  nullValue: "kiln-json-view__null",
  undefinedValue: "kiln-json-view__undefined",
  numberValue: "kiln-json-view__number",
  stringValue: "kiln-json-view__string",
  booleanValue: "kiln-json-view__boolean",
  otherValue: "kiln-json-view__other",
  punctuation: "kiln-json-view__punctuation",
  ariaLables: {
    collapseJson: "Collapse JSON node",
    expandJson: "Expand JSON node",
  },
  quotesForFieldNames: true,
  stringifyStringValues: true,
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatUsd(value: number | null): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function compactDisplayText(value: string, maxLength = 140): string {
  const parsed = parseJsonRecord(value);
  const source = readString(parsed?.output) ?? value;
  const firstLine = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? source.trim();
  const normalized = firstLine.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function eventSummaryText(entry: TimelineEventEntry): string | null {
  if (!entry.summary) return null;
  return compactDisplayText(entry.summary, 150);
}

function detailDisplayText(value: unknown, maxLength = 180): string | null {
  const formatted = formatOperatorEventValue(value);
  if (!formatted) return null;
  return compactDisplayText(formatted, maxLength);
}

function MetaList(props: { readonly items: readonly { label: string; value: string }[] }) {
  if (props.items.length === 0) return null;
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs">
      {props.items.map((item) => (
        <div key={`${item.label}:${item.value}`} className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm leading-5 text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ToolPreviewText(props: { readonly text: string; readonly outputKind: string }) {
  const lines = props.text.replace(/\r\n/g, "\n").split("\n");
  return (
    <pre
      className={cn(
        "max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground",
        props.outputKind === "tree"
          ? "rounded-md bg-background/35 px-3 py-2"
          : "border-l border-border/70 bg-transparent px-3 py-1.5",
      )}
    >
      {lines.map((line, index) => (
        <span
          key={`${index}:${line}`}
          className={cn(
            "block min-h-5",
            props.outputKind === "diff" && line.startsWith("+") ? "text-success" : null,
            props.outputKind === "diff" && line.startsWith("-") ? "text-destructive" : null,
            props.outputKind === "diff" && line.startsWith("@@") ? "text-primary" : null,
          )}
        >
          {line.length > 0 ? line : " "}
        </span>
      ))}
    </pre>
  );
}

interface TreePreviewEntry {
  readonly key: string;
  readonly label: string;
  readonly depth: number;
  readonly kind: "directory" | "file";
}

function normalizeTreeLine(line: string): { label: string; depth: number } | null {
  if (line.trim().length === 0) return null;
  const leadingWhitespace = line.match(/^\s*/u)?.[0] ?? "";
  const connectorMatch = line.match(/[├└]\s*(?:──|--)?\s*(.+)$/u);
  const rawLabel = connectorMatch?.[1] ?? line.trim();
  const label = rawLabel.replace(/^[│|]\s*/u, "").trim();
  if (label === "." || label.length === 0) return null;
  const connectorDepth = connectorMatch ? Math.max(0, Math.floor(line.search(/[├└]/u) / 4)) : 0;
  const whitespaceDepth = Math.max(0, Math.floor(leadingWhitespace.replace(/\t/gu, "  ").length / 2));
  return {
    label,
    depth: connectorMatch ? connectorDepth : whitespaceDepth,
  };
}

function parseTreePreview(text: string): TreePreviewEntry[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, index) => {
      const normalized = normalizeTreeLine(line);
      if (!normalized) return null;
      const directory = /[/\\]$/u.test(normalized.label);
      const label = normalized.label.replace(/[/\\]$/u, "");
      return {
        key: `${index}:${normalized.depth}:${label}`,
        label,
        depth: normalized.depth,
        kind: directory ? "directory" : "file",
      } satisfies TreePreviewEntry;
    })
    .filter((entry): entry is TreePreviewEntry => entry !== null);
}

function TreePreviewList(props: { readonly text: string }) {
  const entries = parseTreePreview(props.text);
  if (entries.length === 0) return <ToolPreviewText text={props.text} outputKind="tree" />;
  return (
    <ul
      aria-label="Directory tree output"
      className="max-h-56 overflow-auto rounded-md bg-background/35 px-2 py-2 font-mono text-[11px] leading-5 text-foreground"
      data-output-kind="tree"
    >
      {entries.map((entry) => {
        const Icon = entry.kind === "directory" ? Folder : FileText;
        return (
          <li
            key={entry.key}
            className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5"
            data-tree-depth={entry.depth}
            data-tree-entry-kind={entry.kind}
            style={{ paddingInlineStart: `${0.25 + entry.depth * 1.15}rem` }}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0",
                entry.kind === "directory" ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className="min-w-0 truncate">{entry.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function parseJsonPreview(text: string): object | unknown[] | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function JsonPreviewText(props: { readonly text: string }) {
  const data = parseJsonPreview(props.text);
  if (!data) return <ToolPreviewText text={props.text} outputKind="code" />;
  return (
    <div className="max-h-56 max-w-full overflow-auto rounded-md bg-background/35 px-3 py-2 font-mono text-[11px] leading-5 text-foreground">
      <JsonView
        aria-label="JSON output"
        compactTopLevel
        data={data}
        shouldExpandNode={collapseAllNested}
        style={KILN_JSON_VIEW_STYLE}
      />
    </div>
  );
}

function toolResultContentLabel(outputKind: ToolResultOutputKind): string {
  switch (outputKind) {
    case "command":
      return "Command output";
    case "diff":
      return "Diff";
    case "markdown":
      return "Document";
    case "text":
      return "Text output";
    case "tree":
      return "Directory tree";
    case "code":
      return "Source";
    case "table":
      return "Table";
    case "image":
      return "Image";
    case "resource_links":
      return "Resource";
    case "form":
      return "Form";
    case "empty":
      return "No output";
    default:
      return "Output";
  }
}

function ToolResultContent(props: {
  readonly outputKind: ToolResultOutputKind;
  readonly preview: NonNullable<NonNullable<TimelineEventEntry["toolPresentation"]>["preview"]>;
}) {
  const label = toolResultContentLabel(props.outputKind);
  return (
    <section aria-label={label}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
          {props.preview.language ? (
            <Badge variant="outline" className="h-5 max-w-32 truncate px-1.5 py-0 font-mono text-[10px]">
              {props.preview.language}
            </Badge>
          ) : null}
        </div>
        {props.preview.truncated ? (
          <span className="font-mono text-[10px] text-muted-foreground">truncated</span>
        ) : null}
      </div>
      {props.outputKind === "markdown" ? (
        <div className="markdown-body max-h-64 overflow-auto border-l border-border/70 px-3 py-1 text-sm leading-6">
          <MarkdownMessageContent content={props.preview.text} />
        </div>
      ) : props.outputKind === "tree" ? (
        <TreePreviewList text={props.preview.text} />
      ) : props.preview.language === "json" ? (
        <JsonPreviewText text={props.preview.text} />
      ) : (
        <ToolPreviewText text={props.preview.text} outputKind={props.outputKind} />
      )}
    </section>
  );
}

function formatBytes(value: number | undefined): string | null {
  if (value === undefined) return null;
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${Number(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} KB`;
  return `${Number(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`;
}

function tableCellAlignment(column: ComparisonTablePresentationColumn): string {
  if (column.align === "center") return "text-center";
  if (column.align === "right" || column.valueKind === "number") return "text-right tabular-nums";
  return "text-left";
}

function TableCellValue(props: {
  readonly column: ComparisonTablePresentationColumn;
  readonly value: ComparisonTablePresentationCell | undefined;
}) {
  const formatted = formatOperatorEventValue(props.value ?? null) ?? "";
  if (props.column.valueKind === "boolean") {
    const positive = props.value === true;
    const label = positive ? "yes" : "no";
    return (
      <Badge
        data-cell-kind="boolean"
        variant={positive ? "secondary" : "outline"}
        aria-label={`${props.column.label}: ${label}`}
        className="justify-center"
      >
        {label}
      </Badge>
    );
  }
  if (props.column.valueKind === "status") {
    const value = formatted.toLowerCase();
    const isError = value === "failed" || value === "error" || value === "denied" || value === "unavailable";
    return (
      <Badge data-cell-kind="status" variant={isError ? "destructive" : "secondary"}>
        {formatted}
      </Badge>
    );
  }
  if (props.column.valueKind === "number" && typeof props.value === "number") {
    return (
      <span data-cell-kind="number" className="tabular-nums">
        {props.value.toLocaleString("en-US")}
      </span>
    );
  }
  return <>{formatted}</>;
}

function ResourceBundleList(props: {
  readonly title: string;
  readonly resources: readonly PresentationIntentResourceLink[];
}) {
  return (
    <ul
      aria-label={`${props.title} resources`}
      className="mt-2 grid gap-2"
    >
      {props.resources.map((resource) => {
        const size = formatBytes(resource.size);
        return (
          <li key={resource.uri} className="min-w-0 rounded-lg border border-border/70 bg-background/55 px-2.5 py-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
                {resource.title ?? resource.uri}
              </p>
              {resource.relation ? (
                <Badge variant="outline" className="shrink-0">
                  {resource.relation}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 break-all font-mono text-[11px] leading-5 text-muted-foreground">{resource.uri}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {resource.mimeType ? <span>{resource.mimeType}</span> : null}
              {size ? <span>{size}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PresentationIntentDetails(props: { readonly intent: PresentationIntent }) {
  if (props.intent.kind === "summary") {
    return (
      <div className="mt-2 rounded-lg border border-border/70 bg-background/55 px-2.5 py-2">
        {props.intent.fields ? <MetaList items={props.intent.fields.map((field) => ({
          label: field.label,
          value: formatOperatorEventValue(field.value) ?? "",
        }))} /> : null}
        {props.intent.bullets ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-5 text-foreground">
            {props.intent.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
          </ul>
        ) : null}
      </div>
    );
  }

  if (props.intent.kind === "comparison_table") {
    const intent = props.intent;
    return (
      <div
        data-output-kind="table"
        data-testid="tool-output-table"
        className="mt-2 max-w-full overflow-x-auto rounded-lg border border-border/70 bg-background/55"
      >
        <table className="min-w-full table-fixed border-collapse text-left text-xs">
          <thead className="bg-muted/40 text-[10px] font-semibold uppercase text-muted-foreground">
            <tr>
              {intent.columns.map((column) => (
                <th key={column.key} scope="col" className={cn("px-2.5 py-2 align-bottom", tableCellAlignment(column))}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {intent.rows.map((row, index) => (
              <tr key={index} className="border-t border-border/60">
                {intent.columns.map((column) => (
                  <td key={column.key} className={cn("break-words px-2.5 py-2 align-top text-foreground", tableCellAlignment(column))}>
                    <TableCellValue column={column} value={row[column.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (props.intent.kind === "risk_matrix") {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {props.intent.risks.map((risk) => (
          <section key={risk.id ?? risk.risk} className="rounded-lg border border-border/70 bg-background/55 px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={risk.severity === "critical" || risk.severity === "high" ? "destructive" : "outline"} className="shrink-0">
                {risk.severity}
              </Badge>
              <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">{risk.risk}</p>
            </div>
            {risk.evidence ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{risk.evidence}</p> : null}
            {risk.recommendation ? <p className="mt-1 text-sm leading-5 text-foreground">{risk.recommendation}</p> : null}
          </section>
        ))}
      </div>
    );
  }

  if (props.intent.kind === "timeline") {
    return (
      <>
        <TranscriptTimelineEditor intent={props.intent} />
        <ol className="mt-2 flex flex-col gap-2">
          {props.intent.items.map((item, index) => (
            <li key={item.id ?? `${index}:${item.label}`} className="rounded-lg border border-border/70 bg-background/55 px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">{item.timestamp ?? item.order ?? index + 1}</span>
                {item.status ? <Badge variant="outline" className="shrink-0">{item.status}</Badge> : null}
                <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">{item.label}</p>
              </div>
              {item.summary ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.summary}</p> : null}
            </li>
          ))}
        </ol>
      </>
    );
  }

  if (props.intent.kind === "resource_bundle") {
    return <ResourceBundleList title={props.intent.title} resources={props.intent.resources} />;
  }

  if (props.intent.kind === "diagnostic_report") {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {props.intent.sections.map((section) => (
          <section key={section.title} className="rounded-lg border border-border/70 bg-background/55 px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{section.title}</p>
              {section.status ? (
                <Badge variant={section.status === "error" ? "destructive" : "outline"} className="shrink-0">
                  {section.status}
                </Badge>
              ) : null}
            </div>
            {section.summary ? (
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{section.summary}</p>
            ) : null}
            {section.fields ? <MetaList items={section.fields.map((field) => ({
              label: field.label,
              value: formatOperatorEventValue(field.value) ?? "",
            }))} /> : null}
          </section>
        ))}
      </div>
    );
  }

  return null;
}

function ToolResultPresentationDetails(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const presentation = props.entry.toolPresentation;
  if (!presentation) return null;
  const contentLabel = toolResultContentLabel(presentation.outputKind);
  const preview = presentation.presentationIntent ? undefined : presentation.preview;
  const showTitle = !presentation.fields.some((item) => item.value === presentation.title);
  return (
    <div
      data-testid="tool-output-details"
      className="mt-3 flex max-w-full flex-col gap-2 overflow-hidden border-l border-border/60 pl-3"
    >
      {showTitle ? (
        <p className="truncate text-sm font-medium leading-5 text-foreground">{presentation.title}</p>
      ) : null}
      <MetaList items={presentation.fields} />
      {presentation.presentationIntent ? (
        <PresentationIntentDetails intent={presentation.presentationIntent} />
      ) : null}
      {isBrowserCapturePresentation(presentation) ? (
        <>
          <BrowserCaptureGallery
            resources={presentation.resourceLinks ?? []}
            loadResourceDataUrl={props.loadResourceDataUrl}
          />
          {presentation.resourceLinks
            ?.filter((resource) => resource.relation !== "snapshot")
            .map((resource) => (
              <ResourceLinkCard key={resource.uri} resource={resource} label={contentLabel} />
            ))}
        </>
      ) : presentation.resourceLinks?.map((resource) => (
          <ResourceLinkCard key={resource.uri} resource={resource} label={contentLabel} />
        ))}
      {preview ? (
        <ToolResultContent outputKind={presentation.outputKind} preview={preview} />
      ) : null}
    </div>
  );
}

function isBrowserCapturePresentation(
  presentation: NonNullable<TimelineEventEntry["toolPresentation"]>,
): boolean {
  return presentation.outputKind === "image"
    && !!presentation.resourceLinks?.some((resource) => resource.relation === "snapshot");
}

function ResourceLinkCard(props: {
  readonly resource: NonNullable<NonNullable<TimelineEventEntry["toolPresentation"]>["resourceLinks"]>[number];
  readonly label: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-background/55 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{props.label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground">{props.resource.title ?? props.resource.uri}</p>
      <p className="mt-1 break-all font-mono text-[11px] leading-5 text-muted-foreground">{props.resource.uri}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {props.resource.mimeType ? <span>{props.resource.mimeType}</span> : null}
        {props.resource.size !== undefined ? <span>{props.resource.size} bytes</span> : null}
        {props.resource.relation ? <span>{props.resource.relation}</span> : null}
      </div>
    </div>
  );
}

function BrowserCaptureGallery(props: {
  readonly resources: NonNullable<NonNullable<TimelineEventEntry["toolPresentation"]>["resourceLinks"]>;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const loadResourceDataUrl = props.loadResourceDataUrl;
  const resources = props.resources;
  const captures = resources.filter((resource) => resource.relation === "snapshot");
  const [previewDataUrls, setPreviewDataUrls] = useState<Record<string, string | null>>({});
  const loadingCaptureUrisRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const loadableCaptureUris = resources
      .filter((resource) => (
        resource.relation === "snapshot"
        && (resource.mimeType === undefined || resource.mimeType.toLowerCase().startsWith("image/"))
      ))
      .map((resource) => resource.uri);
    if (!loadResourceDataUrl || loadableCaptureUris.length === 0) return;
    let cancelled = false;
    const loadingCaptureUris = loadingCaptureUrisRef.current;
    for (const uri of loadableCaptureUris) {
      if (Object.prototype.hasOwnProperty.call(previewDataUrls, uri)) continue;
      if (loadingCaptureUris.has(uri)) continue;
      loadingCaptureUris.add(uri);
      loadResourceDataUrl(uri)
        .then((dataUrl) => {
          if (cancelled) return;
          setPreviewDataUrls((current) => {
            const nextDataUrl = dataUrl ?? null;
            return current[uri] === nextDataUrl ? current : { ...current, [uri]: nextDataUrl };
          });
        })
        .catch(() => {
          if (cancelled) return;
          setPreviewDataUrls((current) => (
            Object.prototype.hasOwnProperty.call(current, uri) ? current : { ...current, [uri]: null }
          ));
        })
        .finally(() => {
          loadingCaptureUris.delete(uri);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [loadResourceDataUrl, previewDataUrls, resources]);

  return (
    <div role="list" aria-label="Browser screenshot captures" className="grid gap-2 sm:grid-cols-2">
      {captures.map((resource, index) => {
        const captureLabel = resource.label ?? (resource.sequence !== undefined ? `Capture ${resource.sequence}` : `Capture ${index + 1}`);
        const previewDataUrl = previewDataUrls[resource.uri] ?? null;
        return (
          <div
            key={resource.uri}
            role="listitem"
            className="min-w-0 rounded-lg border border-border/70 bg-background/55 px-2.5 py-2"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-foreground">
                {captureLabel}
              </p>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {resource.mimeType ?? "image"}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{resource.title ?? "Browser screenshot"}</p>
            {previewDataUrl ? (
              <div className="mt-2 aspect-video w-full overflow-hidden rounded-md border border-border bg-muted/30">
                <img
                  src={previewDataUrl}
                  alt={`Browser screenshot ${captureLabel}`}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : null}
            <p className="mt-2 break-all font-mono text-[11px] leading-5 text-muted-foreground">{resource.uri}</p>
            {resource.size !== undefined ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{resource.size} bytes</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ToolEventDetails(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const presentationDetails = filterTranscriptToolDetails(props.entry.presentationDetails ?? []);
  if (props.entry.toolPresentation) {
    return (
      <>
        <MetaList items={presentationDetails} />
        <ToolResultPresentationDetails entry={props.entry} loadResourceDataUrl={props.loadResourceDataUrl} />
      </>
    );
  }
  if (presentationDetails.length > 0) {
    return <MetaList items={presentationDetails} />;
  }
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const input = asRecord(details.input) ?? details;
  const items: { label: string; value: string }[] = [];
  const status = readString(details.status);
  const result = readString(details.result);
  if (status) items.push({ label: "Status", value: status });
  if (result) items.push({ label: "Result", value: compactDisplayText(result, 180) });
  for (const [key, value] of Object.entries(input)
    .filter(([key]) => key !== "status" && key !== "result" && key !== "toolCallId" && key !== "toolName")
    .slice(0, 4)) {
    const formatted = detailDisplayText(value);
    if (formatted) {
      items.push({ label: key, value: formatted });
    }
  }
  return <MetaList items={items} />;
}

function filterTranscriptToolDetails(
  details: readonly { readonly label: string; readonly value: string }[],
): readonly { readonly label: string; readonly value: string }[] {
  return details.filter((item) => TRANSCRIPT_TOOL_DETAIL_LABELS.has(item.label));
}

function ApprovalEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const resolution = asRecord(details.resolution);
  const items = [
    readString(details.action) ? { label: "Action", value: readString(details.action)! } : null,
    readString(details.justification) ? { label: "Why", value: readString(details.justification)! } : null,
    readString(details.approvalId) ? { label: "Approval ID", value: readString(details.approvalId)! } : null,
    readString(resolution?.decision) ? { label: "Decision", value: readString(resolution?.decision)! } : null,
    readString(resolution?.resolvedBy) ? { label: "Resolved by", value: readString(resolution?.resolvedBy)! } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function FileChangedDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const diffPreview = readString(details.diffPreview);
  const diffTruncated = details.diffTruncated === true;
  const items = [
    readString(details.path) ? { label: "Path", value: readString(details.path)! } : null,
    readString(details.changeType) ? { label: "Change", value: readString(details.changeType)! } : null,
    readNumber(details.linesAdded) !== null ? { label: "Lines added", value: String(readNumber(details.linesAdded)) } : null,
    readNumber(details.linesRemoved) !== null ? { label: "Lines removed", value: String(readNumber(details.linesRemoved)) } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return (
    <>
      <MetaList items={items} />
      {diffPreview ? (
        <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-background-element)] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">Diff</p>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-[11px] leading-5 text-[var(--color-text)]">
            {diffPreview}
          </pre>
          {diffTruncated ? (
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Preview truncated.</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CostEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const provider = asRecord(details.provider);
  const usage = asRecord(details.usage);
  const cost = asRecord(details.cost);
  const items = [
    readString(provider?.provider) ? { label: "Provider", value: readString(provider?.provider)! } : null,
    readString(provider?.model) ? { label: "Model", value: readString(provider?.model)! } : null,
    formatUsd(readNumber(cost?.deltaUsd)) ? { label: "Cost", value: formatUsd(readNumber(cost?.deltaUsd))! } : null,
    readNumber(usage?.inputTokens) !== null ? { label: "Input tokens", value: String(readNumber(usage?.inputTokens)) } : null,
    readNumber(usage?.outputTokens) !== null ? { label: "Output tokens", value: String(readNumber(usage?.outputTokens)) } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function ProviderEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const provider = asRecord(details.provider);
  const items = [
    readString(provider?.provider) ? { label: "Provider", value: readString(provider?.provider)! } : null,
    readString(provider?.model) ? { label: "Model", value: readString(provider?.model)! } : null,
    readString(details.reason) ? { label: "Why", value: readString(details.reason)! } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function ContinuityEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const runtimeContinuity = asRecord(details.runtimeContinuity);
  const items = [
    readString(details.decision) ? { label: "Decision", value: readString(details.decision)! } : null,
    readString(details.reason) ? { label: "Reason", value: readString(details.reason)! } : null,
    readString(runtimeContinuity?.strategy) ? { label: "Strategy", value: readString(runtimeContinuity?.strategy)! } : null,
    readString(runtimeContinuity?.selectionReason) ? { label: "Selection", value: readString(runtimeContinuity?.selectionReason)! } : null,
    readString(runtimeContinuity?.feedbackLabel) ? { label: "Feedback", value: readString(runtimeContinuity?.feedbackLabel)! } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function TurnCompletedDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const authority = asRecord(details.authorityStatus);
  const runtimeContinuity = asRecord(details.runtimeContinuity);
  const items = [
    readString(details.routedProvider) ? { label: "Provider", value: readString(details.routedProvider)! } : null,
    readString(details.routedModel) ? { label: "Model", value: readString(details.routedModel)! } : null,
    readString(runtimeContinuity?.strategy) ? { label: "Continuity", value: readString(runtimeContinuity?.strategy)! } : null,
    readString(runtimeContinuity?.selectionReason) ? { label: "Why", value: readString(runtimeContinuity?.selectionReason)! } : null,
    readString(authority?.effective) ? { label: "Authority", value: readString(authority?.effective)! } : null,
    readNumber(details.inputTokens) !== null ? { label: "Input tokens", value: String(readNumber(details.inputTokens)) } : null,
    readNumber(details.outputTokens) !== null ? { label: "Output tokens", value: String(readNumber(details.outputTokens)) } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function canRenderEventDetails(entry: TimelineEventEntry): boolean {
  if (entry.details === undefined && (entry.presentationDetails?.length ?? 0) === 0 && !entry.toolPresentation) return false;
  switch (entry.eventKind) {
    case "tool_call_started":
    case "tool_call_completed":
    case "approval_requested":
    case "approval_resolved":
    case "file_changed":
    case "cost_updated":
    case "provider_routed":
    case "continuity_decided":
    case "turn_completed":
      return true;
    default:
      return false;
  }
}

function EventDetails(props: {
  readonly entry: TimelineEventEntry;
  readonly open: boolean;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  if (!props.open) return null;
  switch (props.entry.eventKind) {
    case "tool_call_started":
    case "tool_call_completed":
      return <ToolEventDetails entry={props.entry} loadResourceDataUrl={props.loadResourceDataUrl} />;
    case "approval_requested":
    case "approval_resolved":
      return <ApprovalEventDetails entry={props.entry} />;
    case "file_changed":
      return <FileChangedDetails entry={props.entry} />;
    case "cost_updated":
      return <CostEventDetails entry={props.entry} />;
    case "provider_routed":
      return <ProviderEventDetails entry={props.entry} />;
    case "continuity_decided":
      return <ContinuityEventDetails entry={props.entry} />;
    case "turn_completed":
      return <TurnCompletedDetails entry={props.entry} />;
    default:
      return null;
  }
}

function isToolEvent(entry: TimelineEventEntry): boolean {
  return entry.eventKind === "tool_call_started" || entry.eventKind === "tool_call_completed";
}

function eventIcon(entry: TimelineEventEntry) {
  return {
    info: Terminal,
    running: LoaderCircle,
    success: CheckCircle2,
    warning: CircleAlert,
    error: CircleAlert,
  }[entry.tone];
}

function eventBadgeVariant(entry: TimelineEventEntry): "outline" | "secondary" | "destructive" {
  return {
    info: "outline",
    running: "secondary",
    success: "secondary",
    warning: "outline",
    error: "destructive",
  }[entry.tone] as "outline" | "secondary" | "destructive";
}

function toolEventTooltipText(entry: TimelineEventEntry): string {
  const toolName = entry.title.replace(/^(Using|Completed)\s+/u, "").trim();
  if (entry.eventKind === "tool_call_started") {
    return `${toolName} is running for this assistant turn.`;
  }
  return `${toolName} result attached to this assistant turn. Expand for details.`;
}

function ActiveToolBeamFrame(props: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  if (!props.active) return <>{props.children}</>;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return (
      <div
        className="max-w-full overflow-visible rounded-lg"
        data-motion="decorative"
        data-role="active-tool-beam"
      >
        {props.children}
      </div>
    );
  }
  return (
    <BorderBeam
      active
      borderRadius={8}
      className="max-w-full overflow-visible rounded-lg"
      colorVariant="ocean"
      data-motion="decorative"
      data-role="active-tool-beam"
      duration={2.3}
      size="pulse-inner"
      staticColors
      strength={0.55}
      theme="auto"
    >
      {props.children}
    </BorderBeam>
  );
}

function ToolEventCard(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
  readonly nested?: boolean;
}) {
  const [open, setOpen] = useState(() => props.nested || shouldAutoOpenToolEventDetails(props.entry));
  const Icon = eventIcon(props.entry);
  const summary = eventSummaryText(props.entry);
  const hasDetails = canRenderEventDetails(props.entry);
  const state = props.entry.tone === "running"
    ? "running"
    : props.entry.tone === "error"
      ? "error"
      : props.entry.tone === "warning"
        ? "interrupted"
        : "complete";
  const activeBeam = props.entry.tone === "running" && !props.nested;

  return (
    <div className="w-full min-w-0 flex-1">
      <ActiveToolBeamFrame active={activeBeam}>
        <div
          data-role="tool-event"
          data-state={state}
          className={cn(
            "relative flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-transparent bg-background/70 px-2.5 py-1.5 text-sm",
            props.nested ? "bg-transparent px-0" : "shadow-sm",
            props.entry.tone === "running"
              ? "border-primary/35 bg-primary/5 before:absolute before:inset-y-1 before:left-0 before:w-px before:rounded-full before:bg-primary"
              : null,
            props.entry.tone === "warning" ? "border-warning/45 bg-warning/5" : null,
            props.entry.tone === "error" ? "border-destructive/45 bg-destructive/5" : null,
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "shrink-0 text-muted-foreground",
              props.entry.tone === "running" ? "animate-spin" : null,
              props.entry.tone === "error" ? "text-destructive" : null,
            )}
          />
          <TooltipProvider delay={400}>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Badge
                    variant={eventBadgeVariant(props.entry)}
                    className="max-w-[11rem] cursor-default truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                )}
              >
                {props.entry.title}
              </TooltipTrigger>
              <TooltipContent side="top" align="start">
                {toolEventTooltipText(props.entry)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {summary ? (
            <span
              className={cn(
                "relative z-10 min-w-0 flex-1 truncate text-muted-foreground",
                props.entry.tone === "running" ? "shimmer" : null,
              )}
              title={summary}
            >
              {summary}
            </span>
          ) : null}
          <time
            dateTime={props.entry.createdAt}
            className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/70 sm:inline"
            title={props.entry.createdAt}
          >
            {new Date(props.entry.createdAt).toLocaleTimeString()}
          </time>
          {hasDetails ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={open ? "Hide details" : "Show details"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
            </Button>
          ) : null}
        </div>
      </ActiveToolBeamFrame>
      {open ? (
        <div className={cn("w-full min-w-0", props.nested ? "mt-2 pl-7" : "mt-3")}>
          <EventDetails entry={props.entry} open={open} loadResourceDataUrl={props.loadResourceDataUrl} />
        </div>
      ) : null}
    </div>
  );
}

function InlineToolEventRow(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  return (
    <article data-role="tool" className="mx-auto flex w-full max-w-3xl justify-start px-1">
      <div className="flex min-w-0 max-w-[min(42rem,94%)] flex-1 gap-2">
        <span className="mt-2 h-auto w-px shrink-0 rounded-full bg-border" aria-hidden="true" />
        <ToolEventCard entry={props.entry} loadResourceDataUrl={props.loadResourceDataUrl} />
      </div>
    </article>
  );
}

function TimelineEventRow(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const [open, setOpen] = useState(false);
  const toneClasses: Record<TimelineEventEntry["tone"], string> = {
    info: "border-border bg-card text-foreground",
    running: "border-border bg-card text-foreground",
    success: "border-border bg-card text-foreground",
    warning: "border-border bg-card text-foreground",
    error: "border-destructive/60 bg-card text-foreground",
  };
  const Icon = eventIcon(props.entry);
  const hasDetails = canRenderEventDetails(props.entry);
  const summary = eventSummaryText(props.entry);

  return (
    <article className={`mx-auto w-full max-w-3xl rounded-lg border px-3 py-2 shadow-sm ${toneClasses[props.entry.tone]}`}>
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground" aria-hidden="true">
            <Icon className={props.entry.tone === "running" ? "animate-spin" : ""} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant={eventBadgeVariant(props.entry)} className="max-w-full truncate">
                {props.entry.title}
              </Badge>
              <time dateTime={props.entry.createdAt} className="shrink-0 font-mono text-[10px] text-muted-foreground" title={props.entry.createdAt}>
                {new Date(props.entry.createdAt).toLocaleTimeString()}
              </time>
            </div>
            {summary ? (
              <p className="mt-1 max-w-full truncate text-sm leading-5 text-muted-foreground">{summary}</p>
            ) : null}
          </div>
        </div>
        {hasDetails ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={open ? "Hide details" : "Show details"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
          </Button>
        ) : null}
      </header>
      <EventDetails entry={props.entry} open={open} loadResourceDataUrl={props.loadResourceDataUrl} />
    </article>
  );
}

function ApprovalEventRow(props: {
  readonly entry: TimelineEventEntry;
  readonly onApprove?: (approvalId: string) => void;
  readonly onDeny?: (approvalId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = eventSummaryText(props.entry);
  const details = asRecord(props.entry.details);
  const approvalId = readString(details?.approvalId) ?? props.entry.id;
  const canResolveApproval = approvalId.trim().length > 0;
  const action = readString(details?.action) ?? summary ?? props.entry.title;
  const justification = readString(details?.justification);

  return (
    <article className="mx-auto w-full max-w-3xl border border-[var(--color-warning)]/45 bg-card px-3 py-3 shadow-sm">
      <header className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <CircleAlert className="size-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
            <p className="truncate text-sm font-semibold text-foreground">Approval required</p>
            <time dateTime={props.entry.createdAt} className="shrink-0 font-mono text-[10px] text-muted-foreground" title={props.entry.createdAt}>
              {new Date(props.entry.createdAt).toLocaleTimeString()}
            </time>
          </div>
          <p className="mt-2 text-sm leading-5 text-foreground">{action}</p>
          {justification ? (
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{justification}</p>
          ) : null}
          {props.entry.sessionId ? (
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/80">{props.entry.sessionId}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canResolveApproval ? (
            <>
              <Button
                type="button"
                size="xs"
                onClick={() => props.onApprove?.(approvalId)}
              >
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => props.onDeny?.(approvalId)}
              >
                Deny
              </Button>
            </>
          ) : null}
          {canRenderEventDetails(props.entry) ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={open ? "Hide details" : "Show details"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Hide details" : "Details"}
            </Button>
          ) : null}
        </div>
      </header>
      <EventDetails entry={props.entry} open={open} />
    </article>
  );
}

function AssistantActivityRow(props: {
  readonly phase: ActivityPhase;
  readonly toolName?: string;
  readonly details?: string;
}) {
  return (
    <article data-role="assistant" className="mx-auto flex w-full max-w-3xl justify-start">
      <div className="min-w-0 max-w-[min(44rem,90%)] rounded-2xl rounded-tl-md bg-muted/35 px-3.5 py-2.5 shadow-sm">
        <header className="sr-only">
          <span>Assistant</span>
        </header>
        <ActivityPhaseIndicator
          phase={props.phase}
          toolName={props.toolName}
          details={props.details}
        />
      </div>
    </article>
  );
}

function EmptyTranscript() {
  const phraseRef = useRef<string | null>(null);
  if (phraseRef.current === null) {
    phraseRef.current = operatorEmptyStatePhraseAt(Date.now());
  }
  const phrase = phraseRef.current;

  return (
    <div className="grid min-h-full place-items-center px-4 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <img
          src={KILN_LOGO_URL}
          alt=""
          className="size-12 object-contain opacity-95"
          draggable={false}
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1" aria-live="off">
          <p className="text-2xl font-semibold tracking-normal text-foreground">{phrase}</p>
          <p className="text-sm text-muted-foreground">Kiln</p>
        </div>
      </div>
    </div>
  );
}

function toolCallIdFromTimelineEntry(entry: TimelineEventEntry): string | null {
  const details = asRecord(entry.details);
  return readString(details?.toolCallId);
}

function toConversationProjectionInput(entry: TimelineEntry): ConversationProjectionInput {
  if (entry.type === "message") {
    return {
      id: entry.id,
      kind: "message",
      role: entry.message.role,
      ...(entry.turnId ? { turnId: entry.turnId } : {}),
      ...(entry.message.streaming !== undefined ? { streaming: entry.message.streaming } : {}),
    };
  }
  const toolCallId = toolCallIdFromTimelineEntry(entry);
  return {
    id: entry.id,
    kind: "event",
    eventKind: entry.eventKind,
    ...(entry.turnId ? { turnId: entry.turnId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
}

function shouldAutoOpenToolEventDetails(entry: TimelineEventEntry): boolean {
  return entry.eventKind === "tool_call_completed" && entry.tone === "error";
}

function renderTranscriptEntries(
  entries: readonly TimelineEntry[],
  onApprove: TranscriptProps["onApprove"],
  onDeny: TranscriptProps["onDeny"],
  loadResourceDataUrl: TranscriptProps["loadResourceDataUrl"],
  activity?: {
    readonly phase: ActivityPhase;
    readonly toolName?: string;
    readonly details?: string;
  },
): ReactNode[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const items = projectConversationTurnItems<ActivityPhase>(
    entries.map((entry) => toConversationProjectionInput(entry)),
    { ...(activity ? { activity } : {}), anchorToolEventsToAssistant: false },
  );

  return items.map((item) => {
    if (item.kind === "event") {
      const entry = entriesById.get(item.entryId);
      if (!entry || entry.type !== "event") return null;
      let row: ReactNode;
      if (entry.eventKind === "approval_requested") {
        row = <ApprovalEventRow entry={entry} onApprove={onApprove} onDeny={onDeny} />;
      } else {
        row = isToolEvent(entry)
          ? <InlineToolEventRow entry={entry} loadResourceDataUrl={loadResourceDataUrl} />
          : <TimelineEventRow entry={entry} loadResourceDataUrl={loadResourceDataUrl} />;
      }
      return (
        <MessageScrollerItem key={entry.id} messageId={entry.id}>
          {row}
        </MessageScrollerItem>
      );
    }
    if (item.kind === "activity") {
      return (
        <MessageScrollerItem key="assistant-activity" messageId="assistant-activity">
          <AssistantActivityRow
            phase={item.phase}
            toolName={item.toolName}
            details={item.details}
          />
        </MessageScrollerItem>
      );
    }
    const entry = entriesById.get(item.entryId);
    if (!entry || entry.type !== "message") return null;
    return (
      <MessageScrollerItem
        key={entry.id}
        messageId={entry.id}
        scrollAnchor={entry.message.role === "user"}
      >
        <MessageRow
          message={entry.message}
          loadResourceDataUrl={loadResourceDataUrl}
        />
      </MessageScrollerItem>
    );
  });
}

export function Transcript(props: TranscriptProps) {
  const hasStreamingAssistant = props.entries.some((entry) => (
    entry.type === "message"
    && entry.message.role === "assistant"
    && entry.message.streaming === true
  ));
  const showAssistantActivity = props.activityPhase
    && props.activityPhase !== "idle"
    && !hasStreamingAssistant;
  const hasLiveActivity = hasStreamingAssistant || Boolean(showAssistantActivity);

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      <MessageScrollerProvider
        autoScroll
        defaultScrollPosition="last-anchor"
        scrollEdgeThreshold={24}
        scrollPreviousItemPeek={64}
      >
        <MessageScroller>
          <MessageScrollerViewport aria-label="Transcript" preserveScrollOnPrepend>
            <MessageScrollerContent className="gap-3 px-4 py-4">
              {props.entries.length === 0 && !showAssistantActivity ? (
                <MessageScrollerItem>
                  <EmptyTranscript />
                </MessageScrollerItem>
              ) : (
                renderTranscriptEntries(
                  props.entries,
                  props.onApprove,
                  props.onDeny,
                  props.loadResourceDataUrl,
                  showAssistantActivity
                    ? {
                        phase: props.activityPhase!,
                        toolName: props.activityToolName,
                        details: props.activityDetails,
                      }
                    : undefined,
                )
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton
            direction="end"
            aria-label={hasLiveActivity ? "Live response below" : "Jump to latest"}
            variant={hasLiveActivity ? "default" : "secondary"}
            className="shadow-[var(--shadow-elevated)]"
          />
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  );
}
