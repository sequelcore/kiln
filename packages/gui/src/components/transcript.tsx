import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  projectConversationTurnItems,
  type ConversationProjectionInput,
  type ConversationProjectionItem,
  formatOperatorEventValue,
  OPERATOR_ENTRY_PROMPT,
  type PresentationIntent,
  type ComparisonTablePresentationColumn,
  type ComparisonTablePresentationCell,
  type PresentationIntentResourceLink,
  type ToolResultOutputKind,
  type ToolResultSearchResult,
  type WorkflowActivityProjection,
  type WorkflowGoalActivity,
  type WorkflowToolCallActivity,
  type WorkflowWorkItemActivity,
} from "@kilnai/gateway-contracts";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, ExternalLink, FileText, Folder, LoaderCircle, Terminal as TerminalIcon } from "lucide-react";
import { collapseAllNested, JsonView } from "react-json-view-lite";
import type { TimelineEntry, TimelineEventEntry } from "../lib/session-store/index.js";
import { MarkdownMessageContent, MessageRow } from "./message-row.js";
import { TranscriptTimelineEditor } from "./transcript-timeline-editor.js";
import { TranscriptSurface } from "./transcript-surface.js";
import { Task, TaskContent, TaskItem, TaskTrigger, type TaskStatus } from "@/components/ai-elements/task";
import { Tool, ToolContent, ToolHeader, type ToolState } from "@/components/ai-elements/tool";
import { ToolGroup, ToolGroupItem } from "@/components/ai-elements/tool-group";
import { Terminal as OutputTerminal } from "@/components/ai-elements/terminal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";

interface TranscriptProps {
  readonly entries: readonly TimelineEntry[];
  readonly workflowActivity?: WorkflowActivityProjection;
  readonly loadResourceDataUrl?: (uri: string) => Promise<string | null>;
  readonly onApprove?: (approvalId: string) => void;
  readonly onDeny?: (approvalId: string) => void;
  readonly loadError?: string;
  readonly onRetryLoad?: () => void;
}

function OperationalTranscriptSurface(props: {
  readonly children: ReactNode;
  readonly dataRole?: string;
  readonly kind: "tool" | "workflow";
}) {
  return (
    <TranscriptSurface data-role={props.dataRole} kind={props.kind} className="flex justify-start px-1">
      <div
        className="min-w-0 max-w-[min(42rem,94%)] flex-1 pl-5 sm:pl-8"
        data-slot="transcript-operational-content"
      >
        {props.children}
      </div>
    </TranscriptSurface>
  );
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
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const TIMELINE_TONE_CLASSES: Record<TimelineEventEntry["tone"], string> = {
  info: "border-border bg-card text-foreground",
  running: "border-border bg-card text-foreground",
  success: "border-border bg-card text-foreground",
  warning: "border-border bg-card text-foreground",
  error: "border-destructive/60 bg-card text-foreground",
};
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

interface TranscriptNavigationAnchor {
  readonly id: string;
  readonly label: string;
  readonly preview: string;
  readonly kind: "user" | "assistant" | "tool" | "failure" | "milestone";
}

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
  return USD_FORMATTER.format(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function withStableOccurrenceKeys<T>(
  values: readonly T[],
  signatureOf: (value: T) => string,
): readonly { readonly key: string; readonly value: T }[] {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const signature = signatureOf(value);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    return { key: `${signature}:${occurrence}`, value };
  });
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
        "max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5",
        props.outputKind === "code" || props.outputKind === "diff"
          ? "bg-code-background text-code-foreground"
          : props.outputKind === "command"
            ? "bg-terminal-background text-terminal-foreground"
            : "text-foreground",
        props.outputKind === "tree"
          ? "rounded-md bg-background/35 px-3 py-2"
          : "border-l border-border/70 px-3 py-1.5",
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
    <div className="max-h-56 max-w-full overflow-auto rounded-md bg-code-background px-3 py-2 font-mono text-[11px] leading-5 text-code-foreground">
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
    case "task":
      return "Task status";
    case "work_item":
      return "Work item";
    case "goal":
      return "Goal";
    case "diagnostic":
      return "Diagnostic";
    case "diff":
      return "Diff";
    case "markdown":
      return "Document";
    case "text":
      return "Text output";
    case "data":
      return "Structured data";
    case "tree":
      return "Directory tree";
    case "code":
      return "Source";
    case "search_results":
      return "Search results";
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

function SearchResultsList(props: { readonly results: readonly ToolResultSearchResult[] }) {
  const results = withStableOccurrenceKeys(
    props.results,
    (result) => JSON.stringify([result.url, result.title, result.snippet]),
  );
  return (
    <section aria-label="Search results">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Search results</p>
        <Badge variant="outline" className="h-5 px-1.5 py-0 font-mono text-[10px]">
          {props.results.length} {props.results.length === 1 ? "result" : "results"}
        </Badge>
      </div>
      <ol className="max-h-72 overflow-auto rounded-md border border-border/70 bg-background/35">
        {results.map(({ key, value: result }, index) => (
          <li key={key} className="border-t border-border/50 first:border-t-0">
            <div className="grid grid-cols-[2ch_1fr] gap-3 px-3 py-2.5">
              <span className="pt-0.5 text-right font-mono text-[10px] leading-5 text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0">
                <a
                  className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium leading-5 text-foreground underline-offset-4 hover:text-primary hover:underline"
                  href={result.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="truncate">{result.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                </a>
                <p className="mt-0.5 truncate font-mono text-[10px] leading-4 text-muted-foreground">
                  {result.source ?? hostForUrl(result.url) ?? result.url}
                </p>
                {result.snippet ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{result.snippet}</p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function hostForUrl(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
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
    const rows = withStableOccurrenceKeys(intent.rows, (row) => JSON.stringify(row));
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
            {rows.map(({ key, value: row }) => (
              <tr key={key} className="border-t border-border/60">
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
            <li
              key={item.id ?? `${item.timestamp ?? item.order ?? "unordered"}:${item.label}:${item.summary ?? ""}`}
              className="rounded-lg border border-border/70 bg-background/55 px-2.5 py-2"
            >
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

export function ToolEvidence(props: {
  readonly presentation: NonNullable<TimelineEventEntry["toolPresentation"]>;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const presentation = props.presentation;
  const contentLabel = toolResultContentLabel(presentation.outputKind);
  const preview = presentation.presentationIntent || presentation.searchResults?.length ? undefined : presentation.preview;
  const fields = presentation.fields ?? [];
  const hasStructuredBody = presentation.diagnostic !== undefined;
  const showTitle = !hasStructuredBody
    && !fields.some((item) => item.value === presentation.title);
  return (
    <div
      data-testid="tool-output-details"
      className="flex max-w-full flex-col gap-3 overflow-hidden"
    >
      {showTitle ? (
        <p className="truncate text-sm font-medium leading-5 text-foreground">{presentation.title}</p>
      ) : null}
      <MetaList items={hasStructuredBody ? [] : fields} />
      {presentation.diagnostic ? (
        <ToolDiagnosticResult title={presentation.title} diagnostic={presentation.diagnostic} fields={fields} />
      ) : null}
      {presentation.presentationIntent ? (
        <PresentationIntentDetails intent={presentation.presentationIntent} />
      ) : null}
      {presentation.searchResults?.length ? (
        <SearchResultsList results={presentation.searchResults} />
      ) : null}
      {isBrowserCapturePresentation(presentation) ? (
        <>
          <BrowserCaptureGallery
            resources={presentation.resourceLinks ?? []}
            loadResourceDataUrl={props.loadResourceDataUrl}
          />
          {presentation.resourceLinks?.flatMap((resource) => (
            resource.relation === "snapshot"
              ? []
              : [<ResourceLinkCard key={resource.uri} resource={resource} label={contentLabel} />]
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

function formatTaskStatus(status: string): string {
  return status.replace(/_/gu, " ").replace(/^\w/u, (letter) => letter.toUpperCase());
}

function ToolDiagnosticResult(props: {
  readonly title: string;
  readonly diagnostic: NonNullable<NonNullable<TimelineEventEntry["toolPresentation"]>["diagnostic"]>;
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{props.title}</AlertTitle>
      <AlertDescription>
        <p>{props.diagnostic.message}</p>
        <MetaList items={props.fields} />
        {props.diagnostic.recoverable !== undefined || props.diagnostic.suggestedNextTool ? (
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {props.diagnostic.recoverable !== undefined ? (
              <>
                <dt>Recovery</dt>
                <dd className="text-foreground">{props.diagnostic.recoverable ? "Recoverable" : "Manual intervention required"}</dd>
              </>
            ) : null}
            {props.diagnostic.suggestedNextTool ? (
              <>
                <dt>Next tool</dt>
                <dd className="truncate font-mono text-foreground">{props.diagnostic.suggestedNextTool}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {props.diagnostic.requiredInput.length > 0 ? (
          <div className="mt-3">
            <p className="font-medium text-foreground">Required input</p>
            <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
              {props.diagnostic.requiredInput.map((item) => (
                <div className="contents" key={item.name}>
                  <dt className="truncate font-mono text-foreground">{item.name}</dt>
                  <dd className="min-w-0 break-words">{item.expected}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
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
    const loadableCaptureUris = resources.flatMap((resource) => (
      resource.relation === "snapshot"
      && (resource.mimeType === undefined || resource.mimeType.toLowerCase().startsWith("image/"))
        ? [resource.uri]
        : []
    ));
    if (!loadResourceDataUrl || loadableCaptureUris.length === 0) return;
    let cancelled = false;
    const loadingCaptureUris = loadingCaptureUrisRef.current;
    for (const uri of loadableCaptureUris) {
      if (Object.hasOwn(previewDataUrls, uri)) continue;
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
            Object.hasOwn(current, uri) ? current : { ...current, [uri]: null }
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
    <ul aria-label="Browser screenshot captures" className="grid list-none gap-2 p-0 sm:grid-cols-2">
      {captures.map((resource, index) => {
        const captureLabel = resource.label ?? (resource.sequence !== undefined ? `Capture ${resource.sequence}` : `Capture ${index + 1}`);
        const previewDataUrl = previewDataUrls[resource.uri] ?? null;
        return (
          <li
            key={resource.uri}
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
          </li>
        );
      })}
    </ul>
  );
}

function ToolEventDetails(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const presentationDetails = filterTranscriptToolDetails(props.entry.presentationDetails ?? []);
  const details = asRecord(props.entry.details);
  const liveOutput = readString(details?.liveOutput);
  const terminal = liveOutput ? (
    <OutputTerminal
      aria-label="Live command output"
      className="mt-3"
      isStreaming={props.entry.tone === "running"}
      output={liveOutput}
    />
  ) : null;
  if (props.entry.toolPresentation) {
    return (
      <>
        <MetaList items={presentationDetails} />
        {terminal}
        <ToolEvidence presentation={props.entry.toolPresentation} loadResourceDataUrl={props.loadResourceDataUrl} />
      </>
    );
  }
  if (presentationDetails.length > 0) {
    return <><MetaList items={presentationDetails} />{terminal}</>;
  }
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
  return <><MetaList items={items} />{terminal}</>;
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
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-code-background px-2 py-1.5 text-[11px] leading-5 text-code-foreground">
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

function toolEventIdentifier(entry: TimelineEventEntry): string {
  return entry.presentationDetails?.find((item) => item.label === "Tool")?.value ?? entry.title;
}

function eventIcon(entry: TimelineEventEntry) {
  return {
    info: TerminalIcon,
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

function ToolEventCard(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const [open, setOpen] = useState(() => shouldAutoOpenToolEventDetails(props.entry));
  const summary = eventSummaryText(props.entry);
  const hasDetails = canRenderEventDetails(props.entry);
  const state: ToolState = props.entry.tone === "running"
    ? "running"
    : props.entry.tone === "error"
      ? "failed"
      : props.entry.tone === "warning"
        ? "paused"
        : "completed";

  return (
    <Tool className="flex-1" onOpenChange={setOpen} open={open} state={state}>
      <ToolHeader
        data-role="tool-event"
        dateTime={props.entry.createdAt}
        expanded={open}
        state={state}
        summary={summary ?? undefined}
        timeLabel={new Date(props.entry.createdAt).toLocaleTimeString()}
        title={props.entry.title}
      />
      {hasDetails ? (
        <ToolContent>
          <EventDetails entry={props.entry} open loadResourceDataUrl={props.loadResourceDataUrl} />
        </ToolContent>
      ) : null}
    </Tool>
  );
}

function InlineToolEventRow(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  return (
    <OperationalTranscriptSurface dataRole="tool" kind="tool">
      <ToolEventCard entry={props.entry} loadResourceDataUrl={props.loadResourceDataUrl} />
    </OperationalTranscriptSurface>
  );
}

function ToolActivityGroupRow(props: {
  readonly entries: readonly TimelineEventEntry[];
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const [operatorOpen, setOperatorOpen] = useState<boolean | null>(null);
  const active = props.entries.some((entry) => entry.tone === "running");
  const open = operatorOpen ?? active;
  const completedCount = props.entries.filter((entry) => entry.tone === "success").length;
  const failedCount = props.entries.filter((entry) => entry.tone === "error").length;
  return (
    <OperationalTranscriptSurface dataRole="tool-group" kind="tool">
      <ToolGroup
        active={active}
        completedCount={completedCount}
        failedCount={failedCount}
        onOpenChange={setOperatorOpen}
        open={open}
        totalCount={props.entries.length}
      >
        {props.entries.map((entry) => (
          <ToolGroupItem key={entry.id}>
            <ToolEventCard entry={entry} loadResourceDataUrl={props.loadResourceDataUrl} />
          </ToolGroupItem>
        ))}
      </ToolGroup>
    </OperationalTranscriptSurface>
  );
}

function TimelineEventRow(props: {
  readonly entry: TimelineEventEntry;
  readonly loadResourceDataUrl?: TranscriptProps["loadResourceDataUrl"];
}) {
  const [open, setOpen] = useState(false);
  const Icon = eventIcon(props.entry);
  const hasDetails = canRenderEventDetails(props.entry);
  const summary = eventSummaryText(props.entry);

  return (
    <TranscriptSurface kind="event" className={cn("rounded-lg border px-3 py-2 shadow-sm", TIMELINE_TONE_CLASSES[props.entry.tone])}>
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
    </TranscriptSurface>
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
    <TranscriptSurface kind="approval" className="border border-status-warning-border bg-status-warning-background px-3 py-3 shadow-sm">
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
    </TranscriptSurface>
  );
}

function EmptyTranscript() {
  return (
    <div className="grid min-h-full place-items-end px-4 pb-3 text-center sm:pb-4">
      <h1 className="mx-auto max-w-3xl text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {OPERATOR_ENTRY_PROMPT}
      </h1>
    </div>
  );
}

function transcriptAnchorLabel(entry: TimelineEntry): string | null {
  if (entry.type === "message") {
    if (entry.message.role === "user") return "User turn";
    if (entry.message.role === "assistant") return "Assistant reply";
    if (entry.message.role === "error") return "Error";
    return null;
  }
  if (isToolEvent(entry)) {
    return entry.tone === "error" ? "Tool failure" : "Tool execution";
  }
  if (entry.eventKind === "approval_requested") return "Approval";
  if (entry.tone === "error") return "Failure";
  return null;
}

function transcriptAnchorKind(entry: TimelineEntry): TranscriptNavigationAnchor["kind"] {
  if (entry.type === "message") {
    if (entry.message.role === "user") return "user";
    if (entry.message.role === "assistant") return "assistant";
    return "failure";
  }
  if (isToolEvent(entry)) {
    return entry.tone === "error" ? "failure" : "tool";
  }
  return entry.tone === "error" ? "failure" : "milestone";
}

function transcriptAnchorPreview(entry: TimelineEntry): string {
  if (entry.type === "message") {
    return compactDisplayText(entry.message.content, 96);
  }
  return compactDisplayText(entry.summary ?? entry.title, 96);
}

type TranscriptProjectionItem = Exclude<ConversationProjectionItem<never>, { readonly kind: "activity" }>;
type TranscriptToolGroupItem = {
  readonly kind: "tool-group";
  readonly id: string;
  readonly entryIds: readonly string[];
};
type TranscriptWorkflowItem = {
  readonly kind: "workflow";
  readonly id: string;
  readonly firstSequence: number;
  readonly goal?: WorkflowGoalActivity;
  readonly workItem?: WorkflowWorkItemActivity;
};
type TranscriptRenderItem = TranscriptProjectionItem | TranscriptToolGroupItem | TranscriptWorkflowItem;

const STANDALONE_TOOL_OUTPUTS = new Set<ToolResultOutputKind>([
  "goal",
  "task",
  "work_item",
]);

function isGovernanceToolEvent(entry: TimelineEventEntry): boolean {
  const toolName = toolEventIdentifier(entry);
  return toolName.startsWith("goal.")
    || toolName.startsWith("work_item.")
    || toolName.startsWith("managed_agent.")
    || toolName.startsWith("task_");
}

function isGroupableToolItem(
  item: TranscriptProjectionItem,
  entriesById: ReadonlyMap<string, TimelineEntry>,
): item is Extract<TranscriptProjectionItem, { readonly kind: "event" }> {
  if (item.kind !== "event") return false;
  const entry = entriesById.get(item.entryId);
  return Boolean(
    entry
    && entry.type === "event"
    && isToolEvent(entry)
    && !isGovernanceToolEvent(entry)
    && (!entry.toolPresentation || !STANDALONE_TOOL_OUTPUTS.has(entry.toolPresentation.outputKind)),
  );
}

function groupRoutineToolItems(
  items: readonly TranscriptProjectionItem[],
  entriesById: ReadonlyMap<string, TimelineEntry>,
): readonly TranscriptRenderItem[] {
  const grouped: TranscriptRenderItem[] = [];
  let routineRun: Extract<TranscriptProjectionItem, { readonly kind: "event" }>[] = [];
  const flush = () => {
    if (routineRun.length === 1) grouped.push(routineRun[0]!);
    if (routineRun.length > 1) {
      const entryIds = routineRun.map((item) => item.entryId);
      grouped.push({ kind: "tool-group", id: `tool-group:${entryIds.join(":")}`, entryIds });
    }
    routineRun = [];
  };
  for (const item of items) {
    if (isGroupableToolItem(item, entriesById)) {
      routineRun.push(item);
      continue;
    }
    flush();
    grouped.push(item);
  }
  flush();
  return grouped;
}

function workflowRenderItems(projection?: WorkflowActivityProjection): readonly TranscriptWorkflowItem[] {
  if (!projection) return [];
  const foregroundGoalId = projection.foregroundGoal?.goal.id;
  return [
    ...projection.goals.flatMap((goal): readonly TranscriptWorkflowItem[] =>
      goal.goal.id === foregroundGoalId
        ? []
        : [{
            kind: "workflow",
            id: `workflow:goal:${goal.goal.id}`,
            firstSequence: goal.firstSequence,
            goal,
          }]),
    ...projection.standaloneWorkItems.map((workItem): TranscriptWorkflowItem => ({
      kind: "workflow",
      id: `workflow:work-item:${workItem.item.id}`,
      firstSequence: workItem.firstSequence,
      workItem,
    })),
  ];
}

function mergeWorkflowRenderItems(
  items: readonly TranscriptRenderItem[],
  workflowItems: readonly TranscriptWorkflowItem[],
  sourceEntries: readonly TimelineEntry[],
): readonly TranscriptRenderItem[] {
  const entryOrder = new Map(sourceEntries.map((entry, index) => [entry.id, index]));
  const orderOf = (item: TranscriptRenderItem): number => {
    if (item.kind === "workflow") {
      const anchorIndex = sourceEntries.findIndex((entry) => (
        entry.sequence !== undefined && entry.sequence >= item.firstSequence
      ));
      return anchorIndex === -1 ? sourceEntries.length : anchorIndex;
    }
    if (item.kind === "tool-group") {
      return Math.min(...item.entryIds.map((id) => entryOrder.get(id) ?? Number.MAX_SAFE_INTEGER));
    }
    return entryOrder.get(item.entryId) ?? Number.MAX_SAFE_INTEGER;
  };
  return [...items, ...workflowItems].toSorted((left, right) => {
    const order = orderOf(left) - orderOf(right);
    return order === 0 ? ("id" in left ? left.id : left.entryId).localeCompare("id" in right ? right.id : right.entryId) : order;
  });
}

function workflowStatus(status: string): TaskStatus {
  switch (status) {
    case "running":
    case "started":
    case "active":
      return "in_progress";
    case "complete":
    case "succeeded":
      return "completed";
    case "pending":
    case "in_progress":
    case "completed":
    case "paused":
    case "blocked":
    case "cancelled":
    case "failed":
      return status;
    default:
      return "pending";
  }
}

function workflowToolCalls(workItem: WorkflowWorkItemActivity): readonly WorkflowToolCallActivity[] {
  const byId = new Map<string, WorkflowToolCallActivity>();
  for (const tool of [...workItem.toolCalls, ...workItem.attempts.flatMap((attempt) => attempt.toolCalls)]) {
    const current = byId.get(tool.toolCallId);
    if (!current || tool.lastSequence >= current.lastSequence) byId.set(tool.toolCallId, tool);
  }
  return [...byId.values()].toSorted((left, right) => left.firstSequence - right.firstSequence);
}

function WorkflowToolActivityGroup(props: {
  readonly className?: string;
  readonly tools: readonly WorkflowToolCallActivity[];
}) {
  const [operatorOpen, setOperatorOpen] = useState<boolean | null>(null);
  const active = props.tools.some((tool) => tool.state === "running");
  const completedCount = props.tools.filter((tool) => tool.state === "completed").length;
  const failedCount = props.tools.filter((tool) => tool.state === "failed").length;
  const open = operatorOpen ?? active;
  return (
    <div className={props.className} data-role="workflow-tool-activity">
      <ToolGroup
        active={active}
        completedCount={completedCount}
        failedCount={failedCount}
        onOpenChange={setOperatorOpen}
        open={open}
        totalCount={props.tools.length}
      >
        {props.tools.map((tool) => {
          const Icon = tool.state === "running" ? LoaderCircle : tool.state === "failed" ? CircleAlert : CheckCircle2;
          return (
            <ToolGroupItem key={tool.toolCallId}>
              <div className="flex min-w-0 items-center gap-2 px-2 py-2 text-xs">
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0",
                    tool.state === "running"
                      ? "motion-safe:animate-spin text-primary"
                      : tool.state === "failed"
                        ? "text-destructive"
                        : "text-success",
                  )}
                />
                <span className="max-w-[40%] shrink-0 truncate font-mono font-medium text-foreground">{tool.toolName}</span>
                {tool.summary ? <span className="min-w-0 flex-1 truncate text-muted-foreground">{tool.summary}</span> : null}
                <span className="sr-only">{formatTaskStatus(tool.state)}</span>
              </div>
            </ToolGroupItem>
          );
        })}
      </ToolGroup>
    </div>
  );
}

function WorkflowWorkItemRow(props: {
  readonly activity: WorkflowWorkItemActivity;
  readonly standalone?: boolean;
}) {
  const { item } = props.activity;
  const completedEvidence = item.evidence.filter((entry) => entry.status === "completed").length;
  const tools = workflowToolCalls(props.activity);
  const Root = props.standalone ? "div" : "li";
  const detailsInset = props.standalone ? "ml-0" : "ml-6";
  return (
    <Root className="border-b border-border/55 py-3 last:border-b-0" data-work-item-id={item.id}>
      {props.standalone ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.workflowProfile ? <span>{item.workflowProfile}</span> : null}
          {item.risk ? <span>Risk {item.risk}</span> : null}
          {item.surface ? <span>{item.surface}</span> : null}
        </div>
      ) : (
        <TaskItem className="transition-colors duration-150 motion-reduce:transition-none" status={workflowStatus(item.status)}>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-medium text-foreground">{item.summary}</span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{item.id}</span>
              {item.workflowProfile ? <span>{item.workflowProfile}</span> : null}
              {item.risk ? <span>Risk {item.risk}</span> : null}
              {item.surface ? <span>{item.surface}</span> : null}
            </span>
          </span>
        </TaskItem>
      )}
      {item.evidence.length > 0 ? (
        <div className={cn(detailsInset, "mt-2")}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Evidence</span>
            <span className="tabular-nums">{completedEvidence} / {item.evidence.length}</span>
          </div>
          <Progress aria-label={`Evidence completion for ${item.id}`} value={(completedEvidence / item.evidence.length) * 100} />
        </div>
      ) : null}
      {tools.length > 0 ? <WorkflowToolActivityGroup className={cn(detailsInset, "mt-2")} tools={tools} /> : null}
      {item.pauseRequirements.map((requirement) => (
        <p className={cn(detailsInset, "mt-2 text-xs text-warning")} key={requirement}>{requirement}</p>
      ))}
      {item.residualRisk ? (
        <p className={cn(detailsInset, "mt-2 text-xs text-muted-foreground")}><span className="text-foreground">Residual risk:</span> {item.residualRisk}</p>
      ) : null}
    </Root>
  );
}

function WorkflowActivityRow(props: { readonly item: TranscriptWorkflowItem }) {
  const goal = props.item.goal;
  const workItems = goal?.workItems ?? (props.item.workItem ? [props.item.workItem] : []);
  const title = goal?.goal.objective ?? props.item.workItem?.item.summary ?? "Governed work";
  const status = goal?.status ?? workflowStatus(props.item.workItem?.item.status ?? "pending");
  const completed = workItems.filter((entry) => workflowStatus(entry.item.status) === "completed").length;
  const description = goal
    ? `${completed} of ${workItems.length} work items completed${goal.statusReason ? `. ${goal.statusReason}` : ""}`
    : props.item.workItem?.item.id;
  return (
    <OperationalTranscriptSurface kind="workflow">
      <Task
        aria-label={goal ? `Goal ${goal.goal.id}` : `Work item ${props.item.workItem?.item.id ?? "unknown"}`}
        className="w-full min-w-0 overflow-hidden"
        data-role="workflow-activity"
        defaultOpen
        status={status}
        variant="card"
      >
        <TaskTrigger description={description} status={status} title={title} />
        <TaskContent className="transition-opacity duration-150 motion-reduce:transition-none">
          <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
            {title}: {formatTaskStatus(status)}. {description}
          </span>
          {goal && goal.toolCalls.length > 0 ? (
            <WorkflowToolActivityGroup className="mb-2" tools={goal.toolCalls} />
          ) : null}
          {goal && workItems.length > 0 ? (
            <ul aria-label={goal ? "Goal work items" : "Work item progress"}>
              {workItems.map((workItem) => <WorkflowWorkItemRow activity={workItem} key={workItem.item.id} />)}
            </ul>
          ) : props.item.workItem ? (
            <WorkflowWorkItemRow activity={props.item.workItem} standalone />
          ) : (
            <p className="text-sm text-muted-foreground">No work items have been materialized.</p>
          )}
        </TaskContent>
      </Task>
    </OperationalTranscriptSurface>
  );
}

function deriveTranscriptNavigationAnchors(
  items: readonly TranscriptProjectionItem[],
  entriesById: ReadonlyMap<string, TimelineEntry>,
): readonly TranscriptNavigationAnchor[] {
  return items
    .map((item) => {
      const entry = entriesById.get(item.entryId);
      if (!entry) return null;
      const label = transcriptAnchorLabel(entry);
      if (!label) return null;
      return {
        id: item.entryId,
        label,
        preview: transcriptAnchorPreview(entry),
        kind: transcriptAnchorKind(entry),
      } satisfies TranscriptNavigationAnchor;
    })
    .filter((entry): entry is TranscriptNavigationAnchor => entry !== null);
}

function TranscriptNavigationRail(props: {
  readonly anchors: readonly TranscriptNavigationAnchor[];
}) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { scrollToMessage } = useMessageScroller();
  const { currentAnchorId, visibleMessageIds } = useMessageScrollerVisibility();
  if (props.anchors.length < 3) return null;

  const jumpToAnchor = (anchorId: string) => {
    scrollToMessage(anchorId, { align: "center", behavior: "smooth" });
  };

  const latest = props.anchors.at(-1);
  const inspectedIndex = hoveredIndex ?? focusedIndex;
  const fallbackVisibleAnchorId = visibleMessageIds.find((messageId) => (
    props.anchors.some((anchor) => anchor.id === messageId)
  ));
  const activeAnchorId = fallbackVisibleAnchorId ?? currentAnchorId ?? latest?.id;
  const expanded = inspectedIndex !== null;

  return (
    <nav
      aria-label="Thread navigation"
      data-expanded={expanded ? "true" : "false"}
      data-role="thread-navigation-trail"
      className="pointer-events-none absolute inset-y-4 left-2 z-10 hidden w-10 flex-col items-start justify-center sm:flex"
    >
      <div className="flex max-h-full flex-col items-start gap-1.5 py-2">
        {props.anchors.map((anchor, index) => {
          const isCurrent = activeAnchorId === anchor.id;
          const isSelected = inspectedIndex === index;
          const proximity = inspectedIndex === null
            ? "far"
            : String(Math.min(Math.abs(inspectedIndex - index), 3));
          return (
            <button
              key={anchor.id}
              type="button"
              aria-label={`Jump to ${anchor.label.toLowerCase()} ${index + 1}`}
              aria-current={isCurrent ? "location" : undefined}
              title={anchor.label}
              data-thread-anchor-kind={anchor.kind}
              data-current={isCurrent ? "true" : "false"}
              data-proximity={proximity}
              data-selected={isSelected ? "true" : "false"}
              className={cn(
                "group/anchor pointer-events-auto relative flex h-2 w-8 origin-left items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              onBlur={() => setFocusedIndex(null)}
              onClick={() => jumpToAnchor(anchor.id)}
              onFocus={() => setFocusedIndex(index)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <span
                aria-hidden="true"
                className="thread-navigation-mark"
              />
              <span
                data-role="thread-anchor-preview"
                className="pointer-events-none absolute left-full top-1/2 ml-2 hidden w-64 -translate-y-1/2 rounded-md border border-border bg-popover px-3 py-2 text-left shadow-[var(--shadow-elevated)] group-hover/anchor:block group-focus-visible/anchor:block"
              >
                <span className="block text-xs font-semibold text-foreground">{anchor.label}</span>
                <span className="mt-1 block line-clamp-3 text-xs leading-5 text-muted-foreground">{anchor.preview}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function toolCallIdFromTimelineEntry(entry: TimelineEventEntry): string | null {
  const details = asRecord(entry.details);
  return readString(details?.toolCallId);
}

function toolCallScopeIdFromTimelineEntry(entry: TimelineEventEntry): string | null {
  const details = asRecord(entry.details);
  return readString(details?.toolCallScopeId);
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
  const toolCallScopeId = toolCallScopeIdFromTimelineEntry(entry);
  return {
    id: entry.id,
    kind: "event",
    eventKind: entry.eventKind,
    ...(entry.turnId ? { turnId: entry.turnId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolCallScopeId ? { toolCallScopeId } : {}),
  };
}

function projectTranscriptItems(
  entries: readonly TimelineEntry[],
): readonly TranscriptProjectionItem[] {
  return projectConversationTurnItems<never>(
    entries.map((entry) => toConversationProjectionInput(entry)),
    { anchorToolEventsToAssistant: false },
  ).filter((item): item is TranscriptProjectionItem => item.kind !== "activity");
}

function shouldAutoOpenToolEventDetails(entry: TimelineEventEntry): boolean {
  if (entry.eventKind === "tool_call_completed" && entry.tone === "error") return true;
  const details = asRecord(entry.details);
  const input = asRecord(details?.input);
  return entry.eventKind === "tool_call_started" && typeof input?.command === "string";
}

function renderTranscriptEntries(
  entries: readonly TimelineEntry[],
  items: readonly TranscriptRenderItem[],
  onApprove: TranscriptProps["onApprove"],
  onDeny: TranscriptProps["onDeny"],
  loadResourceDataUrl: TranscriptProps["loadResourceDataUrl"],
): ReactNode[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  return items.map((item) => {
    if (item.kind === "workflow") {
      return (
        <MessageScrollerItem key={item.id} messageId={item.id} data-thread-anchor-id={item.id}>
          <WorkflowActivityRow item={item} />
        </MessageScrollerItem>
      );
    }
    if (item.kind === "tool-group") {
      const groupEntries = item.entryIds
        .map((entryId) => entriesById.get(entryId))
        .filter((entry): entry is TimelineEventEntry => entry?.type === "event");
      return (
        <MessageScrollerItem key={item.id} messageId={item.id} data-thread-anchor-id={item.id}>
          <ToolActivityGroupRow
            entries={groupEntries}
            loadResourceDataUrl={loadResourceDataUrl}
          />
        </MessageScrollerItem>
      );
    }
    if (item.kind === "event") {
      const entry = entriesById.get(item.entryId);
      if (entry?.type !== "event") return null;
      let row: ReactNode;
      if (entry.eventKind === "approval_requested") {
        row = <ApprovalEventRow entry={entry} onApprove={onApprove} onDeny={onDeny} />;
      } else {
        row = isToolEvent(entry)
          ? <InlineToolEventRow entry={entry} loadResourceDataUrl={loadResourceDataUrl} />
          : <TimelineEventRow entry={entry} loadResourceDataUrl={loadResourceDataUrl} />;
      }
      return (
        <MessageScrollerItem key={entry.id} messageId={entry.id} data-thread-anchor-id={entry.id}>
          {row}
        </MessageScrollerItem>
      );
    }
    const entry = entriesById.get(item.entryId);
    if (entry?.type !== "message") return null;
    return (
      <MessageScrollerItem
        key={entry.id}
        messageId={entry.id}
        data-thread-anchor-id={entry.id}
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
  const consumedEntryIds = new Set(props.workflowActivity?.consumedEventIds.map((eventId) => `timeline:${eventId}`) ?? []);
  const visibleEntries = props.entries.filter((entry) => !consumedEntryIds.has(entry.id));
  const hasStreamingAssistant = visibleEntries.some((entry) => (
    entry.type === "message"
    && entry.message.role === "assistant"
    && entry.message.streaming === true
  ));
  const projectedItems = projectTranscriptItems(visibleEntries);
  const entriesById = new Map(visibleEntries.map((entry) => [entry.id, entry]));
  const routineItems = groupRoutineToolItems(projectedItems, entriesById);
  const renderItems = mergeWorkflowRenderItems(routineItems, workflowRenderItems(props.workflowActivity), props.entries);
  const navigationAnchors = deriveTranscriptNavigationAnchors(projectedItems, entriesById);

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      <MessageScrollerProvider
        autoScroll
        defaultScrollPosition="last-anchor"
        scrollEdgeThreshold={24}
        scrollPreviousItemPeek={64}
      >
        <MessageScroller>
          <TranscriptNavigationRail anchors={navigationAnchors} />
          <MessageScrollerViewport aria-label="Transcript" preserveScrollOnPrepend>
            <MessageScrollerContent className="gap-3 px-4 py-4">
              {props.loadError ? (
                <MessageScrollerItem>
                  <Alert variant="destructive">
                    <AlertTitle>Session transcript unavailable</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center gap-2">
                      <span>{props.loadError}</span>
                      {props.onRetryLoad ? (
                        <Button type="button" size="xs" variant="outline" onClick={props.onRetryLoad}>Retry</Button>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                </MessageScrollerItem>
              ) : visibleEntries.length === 0 && renderItems.length === 0 ? (
                <MessageScrollerItem>
                  <EmptyTranscript />
                </MessageScrollerItem>
              ) : (
                renderTranscriptEntries(
                  visibleEntries,
                  renderItems,
                  props.onApprove,
                  props.onDeny,
                  props.loadResourceDataUrl,
                )
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton
            direction="end"
            aria-label={hasStreamingAssistant ? "Live response below" : "Jump to latest"}
            variant="outline"
            className={cn(
              "border-border/70 bg-background/95 text-muted-foreground shadow-[var(--shadow-elevated)] backdrop-blur hover:bg-muted hover:text-foreground",
              hasStreamingAssistant ? "border-primary/35 bg-primary/10 text-primary hover:border-border/70 hover:bg-muted hover:text-foreground" : null,
            )}
          />
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  );
}
