import { z } from "zod";

export const PRESENTATION_INTENT_KINDS = [
  "summary",
  "comparison_table",
  "risk_matrix",
  "timeline",
  "resource_bundle",
  "diagnostic_report",
] as const;

export type PresentationIntentKind = typeof PRESENTATION_INTENT_KINDS[number];

export type PresentationIntentConfidence = "low" | "medium" | "high";
export type PresentationIntentSeverity = "low" | "medium" | "high" | "critical";
export type PresentationIntentStatus = "success" | "warning" | "error" | "info" | "running" | "unknown";

export interface PresentationIntentResourceLink {
  readonly uri: string;
  readonly title?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation?: string;
}

export interface PresentationIntentField {
  readonly label: string;
  readonly value: string | number | boolean | null;
}

export interface PresentationIntentBase {
  readonly kind: PresentationIntentKind;
  readonly title: string;
  readonly summary?: string;
  readonly source?: string;
  readonly confidence?: PresentationIntentConfidence;
  readonly resourceLinks?: readonly PresentationIntentResourceLink[];
}

export interface SummaryPresentationIntent extends PresentationIntentBase {
  readonly kind: "summary";
  readonly fields?: readonly PresentationIntentField[];
  readonly bullets?: readonly string[];
}

export interface ComparisonTablePresentationColumn {
  readonly key: string;
  readonly label: string;
  readonly valueKind?: "text" | "number" | "status" | "boolean";
  readonly align?: "left" | "center" | "right";
}

export type ComparisonTablePresentationCell = string | number | boolean | null;

export interface ComparisonTablePresentationIntent extends PresentationIntentBase {
  readonly kind: "comparison_table";
  readonly columns: readonly ComparisonTablePresentationColumn[];
  readonly rows: readonly Record<string, ComparisonTablePresentationCell>[];
}

export interface RiskMatrixPresentationItem {
  readonly id?: string;
  readonly risk: string;
  readonly severity: PresentationIntentSeverity;
  readonly confidence?: PresentationIntentConfidence;
  readonly evidence?: string;
  readonly recommendation?: string;
}

export interface RiskMatrixPresentationIntent extends PresentationIntentBase {
  readonly kind: "risk_matrix";
  readonly risks: readonly RiskMatrixPresentationItem[];
}

export interface TimelinePresentationItem {
  readonly id?: string;
  readonly order?: number;
  readonly timestamp?: string;
  readonly label: string;
  readonly status?: PresentationIntentStatus;
  readonly summary?: string;
  readonly resourceLinks?: readonly PresentationIntentResourceLink[];
}

export interface TimelinePresentationIntent extends PresentationIntentBase {
  readonly kind: "timeline";
  readonly items: readonly TimelinePresentationItem[];
}

export interface ResourceBundlePresentationIntent extends PresentationIntentBase {
  readonly kind: "resource_bundle";
  readonly resources: readonly PresentationIntentResourceLink[];
}

export interface DiagnosticReportPresentationSection {
  readonly title: string;
  readonly status?: PresentationIntentStatus;
  readonly summary?: string;
  readonly fields?: readonly PresentationIntentField[];
}

export interface DiagnosticReportPresentationIntent extends PresentationIntentBase {
  readonly kind: "diagnostic_report";
  readonly sections: readonly DiagnosticReportPresentationSection[];
}

export type PresentationIntent =
  | SummaryPresentationIntent
  | ComparisonTablePresentationIntent
  | RiskMatrixPresentationIntent
  | TimelinePresentationIntent
  | ResourceBundlePresentationIntent
  | DiagnosticReportPresentationIntent;

export type PresentationIntentParseResult =
  | { readonly ok: true; readonly intent: PresentationIntent }
  | { readonly ok: false; readonly error: string };

const safeText = z.string().trim().min(1).max(500);
const shortText = z.string().trim().min(1).max(120);
const mediumText = z.string().trim().min(1).max(240);
const scalarValue = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
const confidenceSchema = z.enum(["low", "medium", "high"]);
const statusSchema = z.enum(["success", "warning", "error", "info", "running", "unknown"]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);

const resourceLinkSchema = z.object({
  uri: z.string().trim().min(1).max(1_000).refine((value) => !/^(javascript|data):/iu.test(value), "executable URI schemes are not allowed"),
  title: shortText.optional(),
  mimeType: z.string().trim().min(1).max(120).optional(),
  size: z.number().int().nonnegative().optional(),
  relation: z.string().trim().min(1).max(80).optional(),
}).strict();

const fieldSchema = z.object({
  label: shortText,
  value: scalarValue,
}).strict();

const baseShape = {
  title: shortText,
  summary: mediumText.optional(),
  source: shortText.optional(),
  confidence: confidenceSchema.optional(),
  resourceLinks: z.array(resourceLinkSchema).max(12).optional(),
};

const summarySchema = z.object({
  kind: z.literal("summary"),
  ...baseShape,
  fields: z.array(fieldSchema).max(16).optional(),
  bullets: z.array(safeText).max(12).optional(),
}).strict();

const comparisonColumnSchema = z.object({
  key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u),
  label: shortText,
  valueKind: z.enum(["text", "number", "status", "boolean"]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
}).strict();

const comparisonTableSchema = z.object({
  kind: z.literal("comparison_table"),
  ...baseShape,
  columns: z.array(comparisonColumnSchema).min(1).max(12),
  rows: z.array(z.record(z.string(), scalarValue)).max(50),
}).strict();

const riskMatrixSchema = z.object({
  kind: z.literal("risk_matrix"),
  ...baseShape,
  risks: z.array(z.object({
    id: z.string().trim().min(1).max(80).optional(),
    risk: safeText,
    severity: severitySchema,
    confidence: confidenceSchema.optional(),
    evidence: safeText.optional(),
    recommendation: safeText.optional(),
  }).strict()).min(1).max(25),
}).strict();

const timelineSchema = z.object({
  kind: z.literal("timeline"),
  ...baseShape,
  items: z.array(z.object({
    id: z.string().trim().min(1).max(80).optional(),
    order: z.number().int().optional(),
    timestamp: z.string().trim().min(1).max(80).optional(),
    label: safeText,
    status: statusSchema.optional(),
    summary: safeText.optional(),
    resourceLinks: z.array(resourceLinkSchema).max(6).optional(),
  }).strict()).min(1).max(50),
}).strict();

const resourceBundleSchema = z.object({
  kind: z.literal("resource_bundle"),
  ...baseShape,
  resources: z.array(resourceLinkSchema).min(1).max(25),
}).strict();

const diagnosticReportSchema = z.object({
  kind: z.literal("diagnostic_report"),
  ...baseShape,
  sections: z.array(z.object({
    title: shortText,
    status: statusSchema.optional(),
    summary: safeText.optional(),
    fields: z.array(fieldSchema).max(16).optional(),
  }).strict()).min(1).max(20),
}).strict();

const presentationIntentSchema = z.discriminatedUnion("kind", [
  summarySchema,
  comparisonTableSchema,
  riskMatrixSchema,
  timelineSchema,
  resourceBundleSchema,
  diagnosticReportSchema,
]);

export function parsePresentationIntent(value: unknown): PresentationIntentParseResult {
  const parsed = presentationIntentSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "intent"}: ${issue.message}`).join("; "),
    };
  }
  return { ok: true, intent: parsed.data as PresentationIntent };
}

export function isPresentationIntent(value: unknown): value is PresentationIntent {
  return parsePresentationIntent(value).ok;
}

export function formatPresentationIntentAsText(intent: PresentationIntent): string {
  switch (intent.kind) {
    case "comparison_table":
      return formatComparisonTable(intent);
    case "risk_matrix":
      return formatRiskMatrix(intent);
    case "timeline":
      return formatTimeline(intent);
    case "resource_bundle":
      return formatResourceBundle(intent);
    case "diagnostic_report":
      return formatDiagnosticReport(intent);
    case "summary":
      return formatSummary(intent);
  }
}

export function presentationIntentBrief(intent: PresentationIntent): string {
  if (intent.summary) return intent.summary;
  if (intent.kind === "comparison_table") return `${intent.rows.length} row${intent.rows.length === 1 ? "" : "s"}`;
  if (intent.kind === "risk_matrix") return `${intent.risks.length} risk${intent.risks.length === 1 ? "" : "s"}`;
  if (intent.kind === "timeline") return `${intent.items.length} item${intent.items.length === 1 ? "" : "s"}`;
  if (intent.kind === "resource_bundle") return `${intent.resources.length} resource${intent.resources.length === 1 ? "" : "s"}`;
  if (intent.kind === "diagnostic_report") return `${intent.sections.length} section${intent.sections.length === 1 ? "" : "s"}`;
  return intent.title;
}

function formatSummary(intent: SummaryPresentationIntent): string {
  return [
    intent.title,
    intent.summary,
    ...(intent.fields ?? []).map((field) => `${field.label}: ${formatCell(field.value)}`),
    ...(intent.bullets ?? []).map((bullet) => `- ${bullet}`),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatComparisonTable(intent: ComparisonTablePresentationIntent): string {
  const headers = intent.columns.map((column) => column.label);
  const rows = intent.rows.map((row) => intent.columns.map((column) => formatCell(row[column.key] ?? null)));
  const widths = headers.map((header, index) => Math.min(
    42,
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  ));
  const renderRow = (cells: readonly string[]) => `| ${cells.map((cell, index) => compactCell(cell).padEnd(widths[index] ?? 0)).join(" | ")} |`;
  return [
    intent.title,
    intent.summary,
    renderRow(headers),
    renderRow(widths.map((width) => "-".repeat(Math.max(3, width)))),
    ...rows.map(renderRow),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatRiskMatrix(intent: RiskMatrixPresentationIntent): string {
  return [
    intent.title,
    intent.summary,
    ...intent.risks.map((risk) => [
      `- [${risk.severity}] ${risk.risk}`,
      risk.confidence ? `  confidence: ${risk.confidence}` : undefined,
      risk.evidence ? `  evidence: ${risk.evidence}` : undefined,
      risk.recommendation ? `  recommendation: ${risk.recommendation}` : undefined,
    ].filter((line): line is string => Boolean(line)).join("\n")),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatTimeline(intent: TimelinePresentationIntent): string {
  return [
    intent.title,
    intent.summary,
    ...intent.items.map((item, index) => {
      const marker = item.timestamp ?? item.order ?? index + 1;
      const status = item.status ? ` [${item.status}]` : "";
      return `${marker}.${status} ${item.label}${item.summary ? ` - ${item.summary}` : ""}`;
    }),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatResourceBundle(intent: ResourceBundlePresentationIntent): string {
  return [
    intent.title,
    intent.summary,
    ...intent.resources.map((resource) => `- ${resource.title ?? resource.uri}: ${resource.uri}`),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatDiagnosticReport(intent: DiagnosticReportPresentationIntent): string {
  return [
    intent.title,
    intent.summary,
    ...intent.sections.map((section) => [
      `## ${section.title}${section.status ? ` [${section.status}]` : ""}`,
      section.summary,
      ...(section.fields ?? []).map((field) => `${field.label}: ${formatCell(field.value)}`),
    ].filter((line): line is string => Boolean(line)).join("\n")),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatCell(value: ComparisonTablePresentationCell): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value).replace(/\s+/g, " ").trim();
}

function compactCell(value: string): string {
  const compacted = value.length > 42 ? `${value.slice(0, 24)}...${value.slice(-15)}` : value;
  return compacted.replace(/\|/g, "\\|");
}
