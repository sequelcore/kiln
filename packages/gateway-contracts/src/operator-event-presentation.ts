import type { OperatorSessionEvent, OperatorSessionEventKind } from "./frames.js";
import {
  parsePresentationIntent,
  presentationIntentBrief,
  type PresentationIntent,
  type PresentationIntentResourceLink,
} from "./presentation-intent.js";
import {
  parseOperatorToolResultEnvelope,
  parseOperatorToolResultResourceLinks,
  type ToolResultResourceLinkPresentation,
} from "./operator-tool-result.js";
import {
  VerifiedEfficiencyEvidenceProjectionSchema,
  formatVerifiedEfficiencyEvidence,
} from "./verified-efficiency-evidence.js";
import {
  EffectivePromptObservationSchema,
  formatEffectivePromptObservation,
} from "./effective-prompt-observation.js";
import { presentToolActionTitle } from "./tool-activity-presentation.js";

export type OperatorEventTone = "info" | "running" | "success" | "warning" | "error";
export type OperatorEventSurface = "conversation_inline" | "activity_panel" | "inspector";
export type OperatorEventConversationDisposition = "none" | "activity" | "action" | "result" | "exception";

export interface OperatorEventDetailItem {
  readonly label: string;
  readonly value: string;
}

export type ToolResultOutputKind =
  | "text"
  | "data"
  | "markdown"
  | "code"
  | "search_results"
  | "table"
  | "tree"
  | "diff"
  | "image"
  | "resource_links"
  | "command"
  | "task"
  | "work_item"
  | "goal"
  | "verification"
  | "diagnostic"
  | "form"
  | "empty";

export interface ToolResultDiagnosticInputPresentation {
  readonly name: string;
  readonly expected: string;
}

export interface ToolResultDiagnosticPresentation {
  readonly code?: string;
  readonly message: string;
  readonly recoverable?: boolean;
  readonly suggestedNextTool?: string;
  readonly requiredInput: readonly ToolResultDiagnosticInputPresentation[];
}

export type ToolResultTaskStatus = "pending" | "in_progress" | "completed" | "paused" | "blocked" | "cancelled" | "failed";

export interface ToolResultTaskItemPresentation {
  readonly label: string;
  readonly status: "pending" | "in_progress" | "completed" | "blocked" | "failed";
}

export interface ToolResultTaskPresentation {
  readonly status: ToolResultTaskStatus;
  readonly reason?: string;
  readonly workItemId?: string;
  readonly routeId?: string;
  readonly nextTool?: string;
  readonly items: readonly ToolResultTaskItemPresentation[];
}

export interface ToolResultWorkItemPresentation {
  readonly id: string;
  readonly summary: string;
  readonly status: ToolResultTaskStatus;
  readonly workflowProfile?: string;
  readonly risk?: string;
  readonly surface?: string;
  readonly authority?: string;
  readonly access?: string;
  readonly evidence: readonly ToolResultTaskItemPresentation[];
  readonly nextTools: readonly string[];
  readonly pauseRequirements: readonly string[];
  readonly residualRisk?: string;
}

export interface ToolResultGoalEvidenceRequirementPresentation {
  readonly id: string;
  readonly description: string;
  readonly required: boolean;
}

export interface ToolResultGoalEvidencePresentation {
  readonly requirementId: string;
  readonly summary: string;
  readonly resourceUris: readonly string[];
  readonly workItemIds: readonly string[];
}

export interface ToolResultGoalPresentation {
  readonly id: string;
  readonly objective: string;
  readonly status: string;
  readonly phase?: string;
  readonly planId?: string;
  readonly workItemIds: readonly string[];
  readonly authority?: string;
  readonly escalationPolicy?: string;
  readonly workflowProfile?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly activeDurationMs?: number;
  readonly activeSince?: string;
  readonly evidenceRequirements: readonly ToolResultGoalEvidenceRequirementPresentation[];
  readonly evidence: readonly ToolResultGoalEvidencePresentation[];
}

export interface ToolResultVerificationSubjectPresentation {
  readonly path: string;
  readonly contentDigest?: string;
}

export interface ToolResultVerificationEnginePresentation {
  readonly name: string;
  readonly version: string;
  readonly buildRevision?: string;
}

export interface ToolResultVerificationAuthorityPresentation {
  readonly kind: "evidence_only";
  readonly establishes: readonly [];
}

export interface ToolResultFormalCheckPresentation {
  readonly label: string;
  readonly outcome: "proved" | "refuted" | "unresolved";
  readonly detail?: string;
  readonly durationMs: number;
  readonly resourceCount: number;
}

export interface ToolResultFormalVerificationPresentation {
  readonly kind: "formal";
  readonly engine: ToolResultVerificationEnginePresentation;
  readonly candidate: {
    readonly digest: string;
    readonly subjects: readonly ToolResultVerificationSubjectPresentation[];
  };
  readonly outcome: "proved" | "refuted" | "unresolved";
  readonly totals: {
    readonly total: number;
    readonly proved: number;
    readonly refuted: number;
    readonly unresolved: number;
  };
  readonly checks: readonly ToolResultFormalCheckPresentation[];
  readonly authority: ToolResultVerificationAuthorityPresentation;
}

export interface ToolResultStaticDiagnosticPresentation {
  readonly rule?: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ToolResultStaticVerificationPresentation {
  readonly kind: "static";
  readonly engine: ToolResultVerificationEnginePresentation;
  readonly candidate: {
    readonly digest: string;
    readonly subjects: readonly ToolResultVerificationSubjectPresentation[];
  };
  readonly outcome: "clean" | "violations";
  readonly profile: { readonly id: string; readonly rulesAnalyzed: number };
  readonly diagnostics: readonly ToolResultStaticDiagnosticPresentation[];
  readonly authority: ToolResultVerificationAuthorityPresentation;
}

export interface ToolResultInferentialVerificationPresentation {
  readonly kind: "inferential";
  readonly engine: ToolResultVerificationEnginePresentation;
  readonly candidate: {
    readonly digest: string;
    readonly subjects: readonly ToolResultVerificationSubjectPresentation[];
  };
  readonly outcome: {
    readonly applicability: string;
    readonly action: string;
    readonly replayability: string;
    readonly nextTransition?: { readonly kind: "execute" | "collect" | "stop"; readonly reasonCode: string };
  };
  readonly transaction: {
    readonly lineageId: string;
    readonly state: string;
    readonly generation: number;
    readonly revision: string;
  };
  readonly authority: ToolResultVerificationAuthorityPresentation;
}

export interface ToolResultQualityDiagnosticPresentation {
  readonly rule: { readonly name: string; readonly revision: string };
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface ToolResultQualityProfilePresentation {
  readonly name: string;
  readonly revision: string;
  readonly rules: readonly { readonly name: string; readonly revision: string }[];
  readonly diagnostics: readonly ToolResultQualityDiagnosticPresentation[];
}

export interface ToolResultQualityVerificationPresentation {
  readonly kind: "quality";
  readonly engine: ToolResultVerificationEnginePresentation & { readonly parser: ToolResultVerificationEnginePresentation };
  readonly candidate: { readonly digest: string; readonly subjects: readonly ToolResultVerificationSubjectPresentation[] };
  readonly artifactKind: "typescript";
  readonly outcome: "no_diagnostics" | "diagnostics";
  readonly profiles: readonly ToolResultQualityProfilePresentation[];
  readonly authority: ToolResultVerificationAuthorityPresentation;
}

export type ToolResultVerificationPresentation =
  | ToolResultFormalVerificationPresentation
  | ToolResultStaticVerificationPresentation
  | ToolResultQualityVerificationPresentation
  | ToolResultInferentialVerificationPresentation;

export interface ToolResultPreview {
  readonly text: string;
  readonly truncated?: boolean;
  readonly language?: string;
}

export interface ToolResultRawAvailability {
  readonly available: boolean;
  readonly resourceUri?: string;
  readonly reason?: string;
}

export interface ToolResultSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly source?: string;
}

export type ToolResultClassificationSource =
  | "presentation-intent"
  | "tool-metadata"
  | "resource-link"
  | "content-heuristic"
  | "fallback";

export interface ToolResultClassification {
  readonly source: ToolResultClassificationSource;
  readonly reason: string;
  readonly fallbackReason?: string;
  readonly confidence?: "low" | "medium" | "high";
}

export interface ToolResultPresentation {
  readonly outputKind: ToolResultOutputKind;
  readonly classification: ToolResultClassification;
  readonly title: string;
  readonly summary?: string;
  readonly fields: readonly OperatorEventDetailItem[];
  readonly presentationIntent?: PresentationIntent;
  readonly preview?: ToolResultPreview;
  readonly searchResults?: readonly ToolResultSearchResult[];
  readonly resourceLinks?: readonly ToolResultResourceLinkPresentation[];
  readonly task?: ToolResultTaskPresentation;
  readonly workItem?: ToolResultWorkItemPresentation;
  readonly goal?: ToolResultGoalPresentation;
  readonly verification?: ToolResultVerificationPresentation;
  readonly diagnostic?: ToolResultDiagnosticPresentation;
  readonly raw: ToolResultRawAvailability;
}

export interface OperatorEventPresentation {
  readonly title: string;
  readonly summary?: string;
  readonly tone: OperatorEventTone;
  readonly details: readonly OperatorEventDetailItem[];
  readonly compactText?: string;
  readonly surfaces: readonly OperatorEventSurface[];
  readonly conversationDisposition: OperatorEventConversationDisposition;
  readonly toolPresentation?: ToolResultPresentation;
}

const ACTIVITY_SURFACES = ["activity_panel", "inspector"] as const satisfies readonly OperatorEventSurface[];
const INLINE_ACTIVITY_SURFACES = ["conversation_inline", "activity_panel", "inspector"] as const satisfies readonly OperatorEventSurface[];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatOperatorEventValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length > 0 ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === null || value === undefined) return null;
  return "Structured value";
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

function labelFromKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function addItem(items: OperatorEventDetailItem[], label: string, value: unknown): void {
  const formatted = formatOperatorEventValue(value);
  if (formatted) {
    items.push({ label, value: formatted });
  }
}

function readStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatStringList(value: unknown): string | null {
  const items = readStringList(value);
  return items.length > 0 ? items.join(", ") : null;
}

function sentenceFromKey(value: string): string {
  const words = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function readRequiredStringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length === value.length ? items : null;
}

function addPrimitiveItems(
  items: OperatorEventDetailItem[],
  record: Record<string, unknown> | null,
  limit: number,
  excludedKeys: readonly string[] = [],
): void {
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    if (items.length >= limit) return;
    if (excludedKeys.includes(key)) continue;
    addItem(items, labelFromKey(key), value);
  }
}

function eventPayloadText(payload: Record<string, unknown>): string | null {
  return readString(payload.content)
    ?? readString(payload.outputSummary)
    ?? readString(payload.output)
    ?? readString(payload.result)
    ?? readString(payload.details)
    ?? readString(payload.delta)
    ?? readString(payload.toolName);
}

function toolResultEnvelopeText(payload: Record<string, unknown>): string | null {
  return readString(payload.output)
    ?? readString(payload.outputSummary)
    ?? eventPayloadText(payload);
}

function formatToolUsageSummary(payload: Record<string, unknown>): string | null {
  const toolUsage = asRecord(payload.toolUsage);
  if (!toolUsage) return null;
  const toolName = readString(toolUsage.toolName) ?? readString(payload.toolName);
  const calls = readNumber(toolUsage.calls);
  if (!toolName || calls === null || !Number.isSafeInteger(calls) || calls < 0) {
    return null;
  }
  return `${toolName} ${calls}`;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function compactText(value: string, maxLength = 140): string {
  const firstLine = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? value.trim();
  const normalized = firstLine.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function projectIntentResourceLinks(
  value: readonly PresentationIntentResourceLink[] | undefined,
): readonly ToolResultResourceLinkPresentation[] {
  if (!value) return [];
  return value.map((resource) => ({
    uri: resource.uri,
    ...(resource.title ? { title: resource.title } : {}),
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    ...(resource.size !== undefined ? { size: resource.size } : {}),
    ...(resource.relation ? { relation: resource.relation } : {}),
  }));
}

function plural(value: number, singular: string, pluralValue = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralValue}`;
}

function readMetadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | null {
  return metadata ? readNumber(metadata[key]) : null;
}

function formatReadManySummary(metadata: Record<string, unknown>): string {
  const fileCount = readMetadataNumber(metadata, "fileCount");
  const skippedCount = readMetadataNumber(metadata, "skippedCount");
  const totalBytes = readMetadataNumber(metadata, "totalBytes");
  const parts: string[] = [];
  if (fileCount !== null) parts.push(`${fileCount} files read`);
  if (skippedCount !== null) parts.push(`${skippedCount} skipped`);
  if (totalBytes !== null) parts.push(`${totalBytes} bytes`);
  if (metadata.truncated === true) parts.push("truncated");
  return parts.join(", ") || "read_many output";
}

function formatDiffSummary(metadata: Record<string, unknown>, output: string | undefined): string {
  if (output && /\bfiles?\s+changed\b/u.test(output)) {
    return compactText(output);
  }
  const fileCount = readMetadataNumber(metadata, "fileCount")
    ?? (Array.isArray(metadata.files) ? metadata.files.length : null)
    ?? (readString(metadata.filePath) ? 1 : null);
  const additions = readMetadataNumber(metadata, "linesAdded");
  const removals = readMetadataNumber(metadata, "linesRemoved");
  const parts: string[] = [];
  if (fileCount !== null) parts.push(`${plural(fileCount, "file")} changed`);
  if (additions !== null) parts.push(plural(additions, "addition"));
  if (removals !== null) parts.push(plural(removals, "removal"));
  return parts.join(", ") || output || "Diff applied";
}

function field(label: string, value: unknown): OperatorEventDetailItem | null {
  const formatted = formatOperatorEventValue(value);
  return formatted ? { label, value: formatted } : null;
}

function compactPreview(text: string | undefined, maxLength = 2_000): ToolResultPreview | undefined {
  if (!text || text.trim().length === 0) return undefined;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  return normalized.length > maxLength
    ? { text: normalized.slice(0, maxLength), truncated: true }
    : { text: normalized };
}

function parseOutputRecord(output: string | undefined): Record<string, unknown> | null {
  return output ? parseJsonRecord(output) : null;
}

function formatBytes(value: number | null): string | null {
  if (value === null) return null;
  return `${value} ${value === 1 ? "byte" : "bytes"}`;
}

function readDiffPreview(metadata: Record<string, unknown>): { readonly text?: string; readonly truncated: boolean } {
  const direct = readString(metadata.diffPreview);
  if (direct) {
    return { text: direct, truncated: metadata.diffTruncated === true };
  }
  if (!Array.isArray(metadata.files)) {
    return { truncated: metadata.diffTruncated === true };
  }
  const previews: string[] = [];
  let truncated = metadata.diffTruncated === true;
  for (const file of metadata.files) {
    const record = asRecord(file);
    const preview = readString(record?.diffPreview);
    if (!preview) continue;
    const filePath = readString(record?.filePath);
    previews.push(filePath ? `# ${filePath}\n${preview}` : preview);
    if (record?.diffTruncated === true) {
      truncated = true;
    }
  }
  return {
    ...(previews.length > 0 ? { text: previews.join("\n\n") } : {}),
    truncated,
  };
}

function toolResultRawAvailability(resourceLinks: readonly ToolResultResourceLinkPresentation[]): ToolResultRawAvailability {
  const fullOutput = resourceLinks.find((link) => link.relation === "full_output") ?? resourceLinks[0];
  return fullOutput
    ? { available: true, resourceUri: fullOutput.uri }
    : { available: false, reason: "No raw output resource" };
}

function toolResultClassification(
  source: ToolResultClassificationSource,
  reason: string,
  options: {
    readonly fallbackReason?: string;
    readonly confidence?: "low" | "medium" | "high";
  } = {},
): ToolResultClassification {
  return {
    source,
    reason,
    ...(options.fallbackReason ? { fallbackReason: options.fallbackReason } : {}),
    ...(options.confidence ? { confidence: options.confidence } : {}),
  };
}

function toolResultTitle(toolName: string, metadata: Record<string, unknown> | undefined, fallback: string): string {
  return readString(metadata?.filePath)
    ?? readString(metadata?.path)
    ?? readString(metadata?.command)
    ?? readString(metadata?.url)
    ?? readString(metadata?.query)
    ?? fallback
    ?? toolName;
}

function projectDiffPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const summary = formatDiffSummary(metadata, output);
  const files = readMetadataNumber(metadata, "fileCount")
    ?? (Array.isArray(metadata.files) ? metadata.files.length : null)
    ?? (readString(metadata.filePath) ? 1 : null);
  const additions = readMetadataNumber(metadata, "linesAdded");
  const removals = readMetadataNumber(metadata, "linesRemoved");
  const fields = [
    field("Files", files),
    field("Additions", additions),
    field("Removals", removals),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "diff",
    classification: toolResultClassification("tool-metadata", "file mutation metadata carries diff evidence", { confidence: "high" }),
    title: toolResultTitle(toolName, metadata, "Diff"),
    summary,
    fields,
    preview: (() => {
      const diffPreview = readDiffPreview(metadata);
      const preview = compactPreview(diffPreview.text);
      return preview && diffPreview.truncated ? { ...preview, truncated: true } : preview;
    })(),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectResourceLinkPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const summary = readString(metadata.operation) === "read_many"
    ? formatReadManySummary(metadata)
    : compactText(output ?? resourceLinks[0]?.title ?? `${toolName} output`);
  const reason = readString(metadata.operation) === "read_many"
    ? "large read_many output is represented by resource links"
    : "resource links carry external output evidence";
  const fileCount = readMetadataNumber(metadata, "fileCount");
  const skippedCount = readMetadataNumber(metadata, "skippedCount");
  const totalBytes = readMetadataNumber(metadata, "totalBytes");
  const fields = [
    fileCount !== null || skippedCount !== null
      ? field("Files", `${fileCount ?? 0} read${skippedCount !== null ? ` / ${skippedCount} skipped` : ""}`)
      : null,
    field("Bytes", totalBytes),
    field("MIME", resourceLinks[0]?.mimeType),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "resource_links",
    classification: toolResultClassification("resource-link", reason, { confidence: "high" }),
    title: resourceLinks[0]?.title ?? toolResultTitle(toolName, metadata, `${toolName} output`),
    summary,
    fields,
    resourceLinks,
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function browserSnapshotLinks(
  metadata: Record<string, unknown> | undefined,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): readonly ToolResultResourceLinkPresentation[] {
  if (readString(metadata?.kind) !== "interactive" || readString(metadata?.target) !== "browser") {
    return [];
  }
  return resourceLinks.filter((link) => link.relation === "snapshot" && link.uri.startsWith("kiln://artifacts/"));
}

function captureLabel(resource: ToolResultResourceLinkPresentation, index: number): string {
  return resource.label ?? (resource.sequence !== undefined ? `Capture ${resource.sequence}` : `Capture ${index + 1}`);
}

function isBrowserSnapshotResource(resource: ToolResultResourceLinkPresentation): boolean {
  return resource.relation === "snapshot" && resource.uri.startsWith("kiln://artifacts/");
}

function projectBrowserScreenshotPresentation(
  output: string | undefined,
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const captures = browserSnapshotLinks(metadata, resourceLinks);
  const observation = asRecord(metadata.observation);
  const pageTitle = readString(observation?.title);
  const url = readString(observation?.url);
  const sessionId = readString(metadata.sessionId);
  const provider = readString(metadata.provider);
  const captureNames = captures.map((resource, index) => captureLabel(resource, index));
  const summarySubject = pageTitle ?? url ?? compactText(output ?? captures[0]?.title ?? "browser screenshot");
  const summary = captures.length === 1
    ? `${captureNames[0]}: ${summarySubject}`
    : `${captures.length} captures: ${captureNames.join(", ")}`;
  const fields = [
    field("URL", url),
    field("Title", pageTitle),
    field("Session", sessionId),
    field("Provider", provider),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "image",
    classification: toolResultClassification("resource-link", "browser snapshot resource links identify image output", { confidence: "high" }),
    title: "Browser screenshots",
    summary,
    fields,
    resourceLinks: resourceLinks.map((resource) => {
      if (!isBrowserSnapshotResource(resource)) {
        return resource;
      }
      const captureIndex = captures.findIndex((capture) => capture.uri === resource.uri);
      return {
        ...resource,
        label: captureLabel(resource, captureIndex >= 0 ? captureIndex : 0),
        ...(resource.sequence !== undefined ? { sequence: resource.sequence } : {}),
      };
    }),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectCommandPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const timedOut = metadata.timedOut === true;
  const exitCode = metadata.exitCode ?? metadata.code ?? (timedOut ? "timeout" : undefined);
  const summary = timedOut
    ? `Command timed out${readNumber(metadata.timeoutMs) !== null ? ` after ${readNumber(metadata.timeoutMs)} ms` : ""}`
    : output
      ? compactText(output)
      : "Command completed";
  const streamPreview = [readString(metadata.stderr), readString(metadata.stdout), output]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const fields = [
    field("Command", metadata.command),
    field("CWD", metadata.cwd),
    field("Exit", exitCode),
    field("Elapsed", readNumber(metadata.durationMs) !== null ? `${readNumber(metadata.durationMs)} ms` : null),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "command",
    classification: toolResultClassification("tool-metadata", "command metadata identifies command output", { confidence: "high" }),
    title: toolResultTitle(toolName, metadata, "Command"),
    summary,
    fields,
    preview: compactPreview(streamPreview),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectTreePresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const entryCount = readMetadataNumber(metadata, "entryCount");
  const path = readString(metadata.path);
  const summary = `${entryCount ?? "Unknown"} entries${path ? ` under ${path}` : ""}`;
  const fields = [
    field("Path", path),
    field("Entries", entryCount),
    field("Depth", readMetadataNumber(metadata, "depth")),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "tree",
    classification: toolResultClassification("tool-metadata", "inspection metadata identifies tree output", { confidence: "high" }),
    title: path ?? toolName,
    summary,
    fields,
    preview: compactPreview(treePreviewText(output)),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function treePreviewText(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const structured = parseJsonRecord(output);
  if (structured) {
    const entries = Array.isArray(structured.entries) ? structured.entries : [];
    const lines = entries
      .map((entry) => {
        const record = asRecord(entry);
        const name = readString(record?.name);
        const depth = readNumber(record?.depth);
        const type = readString(record?.type);
        if (!name || depth === null) return null;
        return `${"  ".repeat(Math.max(0, depth - 1))}${name}${type === "directory" ? "/" : ""}`;
      })
      .filter((line): line is string => line !== null);
    return lines.length > 0 ? [".", ...lines].join("\n") : undefined;
  }
  const normalized = output.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized.includes("\n")) return undefined;
  return normalized;
}

function projectStatPresentation(
  toolName: string,
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const path = readString(metadata.path);
  const type = readString(metadata.type);
  const size = readMetadataNumber(metadata, "size");
  const modifiedTime = readString(metadata.modifiedTime);
  const hash = readString(metadata.hash);
  const fields = [
    field("Path", path),
    field("Type", type),
    field("Size", formatBytes(size)),
    field("Modified", modifiedTime),
    field("Hash", hash),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "text",
    classification: toolResultClassification("tool-metadata", "inspection metadata identifies stat output", { confidence: "high" }),
    title: path ?? toolName,
    summary: [type, formatBytes(size)].filter((value): value is string => Boolean(value)).join(" · ") || "Metadata read",
    fields,
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectOcrPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const outputRecord = parseOutputRecord(output);
  const text = readString(outputRecord?.text);
  const path = readString(metadata.path) ?? readString(outputRecord?.path);
  const mimeType = readString(metadata.mimeType) ?? readString(outputRecord?.mimeType);
  const language = readString(metadata.language) ?? readString(outputRecord?.language);
  const source = readString(metadata.source) ?? readString(outputRecord?.source);
  const confidence = readNumber(metadata.confidence) ?? readNumber(outputRecord?.confidence);
  const textLength = readMetadataNumber(metadata, "textLength") ?? (text ? text.length : null);
  const fallbackSummary = output && !outputRecord ? compactText(output) : "OCR completed";
  const fields = [
    field("Path", path),
    field("MIME", mimeType),
    field("Language", language),
    field("Text length", textLength),
    field("Confidence", confidence),
    field("Source", source),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: text ? "text" : "empty",
    classification: toolResultClassification("tool-metadata", "media metadata identifies OCR output", { confidence: "high" }),
    title: path ?? toolName,
    summary: text ? compactText(text) : fallbackSummary,
    fields,
    preview: compactPreview(text ?? (!outputRecord ? output : undefined)),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function isSearchResultTool(toolName: string, metadata: Record<string, unknown> | undefined): boolean {
  const metadataToolName = readString(metadata?.toolName);
  const kind = readString(metadata?.kind);
  const operation = readString(metadata?.operation);
  const normalizedNames = [toolName, metadataToolName]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return (kind === "web" && operation === "search")
    || normalizedNames.some((value) => value === "web_search" || value.endsWith("_web_search"));
}

function projectSearchResultsPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation | null {
  const outputRecord = parseOutputRecord(output);
  const outputMetadata = asRecord(outputRecord?.metadata);
  const effectiveMetadata = metadata || outputMetadata
    ? {
        ...(outputMetadata ?? {}),
        ...(metadata ?? {}),
      }
    : undefined;
  if (!isSearchResultTool(toolName, effectiveMetadata)) return null;
  const text = readSearchOutputText(output, outputRecord);
  const searchResults = dedupeSearchResults([
    ...readSearchResultsFromRecord(effectiveMetadata),
    ...readSearchResultsFromRecord(outputRecord),
    ...parseSearchResultsText(text),
  ]);
  const freshnessFields = projectSearchFreshnessFields(effectiveMetadata);
  if (searchResults.length === 0 && freshnessFields.length === 0) return null;
  const summary = compactText(text);
  const preview = compactPreview(text);
  const fields = [
    ...(searchResults.length > 0 ? [field("Results", searchResults.length)] : []),
    field("Query", effectiveMetadata?.query),
    field("Source", readString(effectiveMetadata?.toolName) ?? toolName),
    ...freshnessFields,
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "search_results",
    classification: toolResultClassification("tool-metadata", "web/search metadata identifies search result output", { confidence: "high" }),
    title: toolResultTitle(toolName, effectiveMetadata, "Search results"),
    ...(summary ? { summary } : {}),
    fields,
    ...(preview ? { preview } : {}),
    searchResults,
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectSearchFreshnessFields(metadata: Record<string, unknown> | undefined): readonly OperatorEventDetailItem[] {
  if (!metadata) return [];
  const required = metadata.freshnessRequired === true;
  const enforcement = readString(metadata.freshnessEnforcement);
  const freshness = required
    ? `required · ${enforcement === "enforced" ? "enforced" : "not enforced"}`
    : undefined;
  const sources = Array.isArray(metadata.sources) ? metadata.sources : [];
  const datedSources = sources.filter((source) => readString(asRecord(source)?.publishedAt) !== null).length;
  const attempts = Array.isArray(metadata.providerAttempts) ? metadata.providerAttempts : [];
  const omittedPreferences = [...new Set(attempts.flatMap((attempt) => {
    const values = asRecord(attempt)?.omittedPreferences;
    return Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string")
      : [];
  }))];
  const postcondition = asRecord(metadata.domainPostcondition);
  const acceptedCount = readNumber(postcondition?.acceptedCount);
  const rejectedCount = readNumber(postcondition?.rejectedCount);
  const postconditionEnforcement = readString(postcondition?.enforcement);
  const provider = readString(metadata.provider);
  const providerRequestId = readString(metadata.providerRequestId);
  const providerDurationMs = readNumber(metadata.providerDurationMs);
  return [
    field("Provider route", provider
      ? `${provider}${attempts.length > 0 ? ` via ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}` : ""}`
      : undefined),
    field("Omitted preferences", omittedPreferences.length > 0
      ? omittedPreferences.map((preference) => preference.replaceAll("_", " ")).join(", ")
      : undefined),
    field("Domain compliance", postconditionEnforcement && acceptedCount !== null && rejectedCount !== null
      ? `${postconditionEnforcement} · ${acceptedCount} accepted · ${rejectedCount} rejected`
      : undefined),
    field("Provider request", providerRequestId),
    field("Provider latency", providerDurationMs !== null ? `${providerDurationMs} ms` : undefined),
    field("Freshness", freshness),
    field("Freshness rejection", metadata.errorCode === "freshness_not_enforced"
      ? "Provider cannot enforce recency filtering"
      : undefined),
    field("Retrieved at", readString(metadata.retrievedAt)),
    ...projectTemporalEvidenceFields(metadata),
    ...(sources.length > 0 ? [field("Dated sources", `${datedSources} of ${sources.length}`)] : []),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
}

function projectTemporalEvidenceFields(metadata: Record<string, unknown> | undefined): readonly OperatorEventDetailItem[] {
  const temporalRequirement = asRecord(metadata?.temporalRequirement);
  const temporalEvidence = asRecord(metadata?.temporalEvidence);
  const recoveryDirective = asRecord(metadata?.recoveryDirective);
  const acceptedSourceIds = Array.isArray(temporalEvidence?.acceptedSourceIds)
    ? temporalEvidence.acceptedSourceIds.filter((value): value is string => typeof value === "string")
    : [];
  return [
    field("Event evidence", temporalEvidence?.accepted === true ? "verified" : temporalEvidence ? "rejected" : undefined),
    field("Independent sources", temporalEvidence ? acceptedSourceIds.length : undefined),
    field("Event date", readString(temporalRequirement?.exactLocalDate)),
    field("Recovery", recoveryDirective?.kind === "progressive_web_research"
      && recoveryDirective.action === "broaden_search"
      ? "Broaden search, then extract candidates"
      : undefined),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
}

function readSearchOutputText(output: string | undefined, outputRecord: Record<string, unknown> | null): string {
  const direct = readString(outputRecord?.output);
  if (direct) return direct;
  if (Array.isArray(outputRecord?.output)) {
    return outputRecord.output
      .filter((item): item is string => typeof item === "string")
      .join("\n");
  }
  return output ?? "";
}

function readSearchResultsFromRecord(value: Record<string, unknown> | null | undefined): readonly ToolResultSearchResult[] {
  if (!value) return [];
  const candidates = [value.results, value.sources, value.items, value.searchResults];
  return candidates.flatMap((candidate) => Array.isArray(candidate) ? candidate.map(readSearchResultRecord) : [])
    .filter((result): result is ToolResultSearchResult => result !== null);
}

function readSearchResultRecord(value: unknown): ToolResultSearchResult | null {
  const record = asRecord(value);
  if (!record) return null;
  const title = readString(record.title) ?? readString(record.name) ?? readString(record.label);
  const url = readString(record.url) ?? readString(record.uri) ?? readString(record.link) ?? readString(record.href);
  if (!title || !url || !isHttpUrl(url)) return null;
  const snippet = readString(record.snippet) ?? readString(record.summary) ?? readString(record.description);
  const source = readString(record.source) ?? readString(record.domain) ?? readString(record.provider);
  return {
    title: cleanSearchTitle(title),
    url,
    ...(snippet ? { snippet } : {}),
    ...(source ? { source } : {}),
  };
}

function parseSearchResultsText(text: string): readonly ToolResultSearchResult[] {
  const results: ToolResultSearchResult[] = [];
  let current: { title: string; url?: string; snippets: string[] } | null = null;
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const numbered = line.match(/^\d+[.)]\s+(.+)$/u);
    const link = readMarkdownLink(line);
    const url = link?.url ?? readFirstHttpUrl(line);
    if (numbered) {
      if (current) pushSearchResult(results, current);
      const numberedText = numbered[1] ?? "";
      const numberedLink = readMarkdownLink(numberedText);
      current = {
        title: cleanSearchTitle(numberedLink?.title ?? numberedText),
        ...(numberedLink?.url ? { url: numberedLink.url } : {}),
        snippets: [],
      };
      continue;
    }
    if (url) {
      if (current) {
        current.url = url;
        if (link?.title && current.title === cleanSearchTitle(link.title)) {
          continue;
        }
        if (link?.title && current.title.length === 0) {
          current.title = cleanSearchTitle(link.title);
        }
      } else if (link?.title) {
        current = { title: cleanSearchTitle(link.title), url, snippets: [] };
      }
      continue;
    }
    if (current && !/^\d+\s+sources?\s+for\s+/iu.test(line)) {
      current.snippets.push(line);
    }
  }
  if (current) pushSearchResult(results, current);
  return results;
}

function pushSearchResult(
  results: ToolResultSearchResult[],
  value: { title: string; url?: string; snippets: string[] },
): void {
  if (!value.url || !isHttpUrl(value.url)) return;
  const title = cleanSearchTitle(value.title);
  if (!title) return;
  const snippet = compactText(value.snippets.join(" "));
  results.push({
    title,
    url: value.url,
    ...(snippet ? { snippet } : {}),
    source: hostForUrl(value.url),
  });
}

function dedupeSearchResults(results: readonly ToolResultSearchResult[]): readonly ToolResultSearchResult[] {
  const seen = new Set<string>();
  const unique: ToolResultSearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    unique.push(result);
  }
  return unique.slice(0, 12);
}

function readMarkdownLink(value: string): { readonly title: string; readonly url: string } | null {
  const match = value.match(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/u);
  if (!match?.[1] || !match[2]) return null;
  return { title: match[1], url: match[2] };
}

function readFirstHttpUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s)]+/u);
  return match?.[0] ?? null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hostForUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return undefined;
  }
}

function cleanSearchTitle(value: string): string {
  return value
    .replace(/\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\)/u, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .trim();
}

function projectTextPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
  classificationOverride?: ToolResultClassification,
): ToolResultPresentation {
  const text = output ?? "";
  const filePath = readString(metadata?.filePath);
  const outputKind = classifyTextOutput(filePath, text);
  const language = outputKind === "data" ? "json" : languageForPath(filePath);
  const totalLines = readMetadataNumber(metadata, "totalLines");
  const totalBytes = readMetadataNumber(metadata, "totalBytes");
  const fields = [
    field("Path", filePath),
    field("Lines", totalLines),
    field("Bytes", totalBytes),
    ...projectTemporalEvidenceFields(metadata),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  const preview = compactPreview(text);
  const operation = readString(metadata?.operation);
  const classification = classificationOverride
    ?? (operation === "read" || toolName === "read"
      ? toolResultClassification("tool-metadata", "read output classified from file metadata and content", { confidence: "high" })
      : languageForPath(filePath)
        ? toolResultClassification("tool-metadata", "file extension metadata selected source renderer", { confidence: "medium" })
        : outputKind === "data"
          ? toolResultClassification("content-heuristic", "structured JSON output classified from content", { confidence: "high" })
          : toolResultClassification("content-heuristic", "text output classified from content", { confidence: "medium" }));
  return {
    outputKind,
    classification,
    title: toolResultTitle(toolName, metadata, toolName),
    summary: summarizeTextOutput(outputKind, text, totalLines, totalBytes),
    fields,
    ...(preview ? { preview: language ? { ...preview, language } : preview } : {}),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function classifyTextOutput(filePath: string | null, text: string): ToolResultOutputKind {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "empty";
  const language = languageForPath(filePath);
  if (language === "markdown" || isMarkdownLikeText(trimmed)) return "markdown";
  if (language) return "code";
  if (structuredJsonShape(trimmed)) return "data";
  return "text";
}

function structuredJsonShape(value: string): { readonly label: string } | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return { label: `${parsed.length} ${parsed.length === 1 ? "item" : "items"}` };
    }
    const record = asRecord(parsed);
    if (record) {
      const count = Object.keys(record).length;
      return { label: `${count} ${count === 1 ? "field" : "fields"}` };
    }
    return null;
  } catch {
    return null;
  }
}

function isMarkdownLikeText(trimmed: string): boolean {
  if (/^#{1,6}\s+\S/mu.test(trimmed)) return true;
  if (/```/u.test(trimmed)) return true;
  if (/^\s{0,3}>\s+\S/mu.test(trimmed)) return true;
  if (/\[[^\]\n]+\]\([^)]+\)/u.test(trimmed)) return true;
  if (/^\s{0,3}\|.+\|\s*$/mu.test(trimmed)) return true;
  const listLines = trimmed
    .split(/\r?\n/u)
    .filter((line) => /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)\S/u.test(line));
  return listLines.length >= 2;
}

function summarizeTextOutput(
  outputKind: ToolResultOutputKind,
  text: string,
  totalLines: number | null,
  totalBytes: number | null,
): string {
  if (text.trim().length === 0) return "No output";
  if (outputKind === "data") return structuredJsonShape(text)?.label ?? "Structured data";
  if (outputKind !== "code") return compactText(text);
  const metrics = [
    totalLines !== null ? `${totalLines} ${totalLines === 1 ? "line" : "lines"}` : null,
    totalBytes !== null ? `${totalBytes} ${totalBytes === 1 ? "byte" : "bytes"}` : null,
  ].filter((item): item is string => item !== null);
  return metrics.length > 0 ? metrics.join(" · ") : "Source file";
}

function languageForPath(filePath: string | null): string | undefined {
  if (!filePath) return undefined;
  const normalized = filePath.toLowerCase();
  const extension = normalized.match(/\.([a-z0-9]+)$/u)?.[1];
  switch (extension) {
    case "md":
    case "mdx":
      return "markdown";
    case "json":
    case "jsonc":
      return "json";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "css":
      return "css";
    case "html":
    case "xml":
    case "svg":
      return "xml";
    case "sh":
    case "bash":
      return "bash";
    case "ps1":
      return "powershell";
    case "py":
      return "python";
    case "sql":
      return "sql";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "rb":
      return "ruby";
    default:
      return undefined;
  }
}

function presentationIntentOutputKind(intent: PresentationIntent): ToolResultOutputKind {
  if (intent.kind === "comparison_table") return "table";
  if (intent.kind === "resource_bundle") return "resource_links";
  return "text";
}

function presentationIntentFields(intent: PresentationIntent): readonly OperatorEventDetailItem[] {
  const fields = [
    field("Intent", intent.kind),
    field("Source", intent.source),
    field("Confidence", intent.confidence),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  if (intent.kind === "comparison_table") {
    return [
      ...fields,
      field("Rows", intent.rows.length),
      field("Columns", intent.columns.length),
    ].filter((item): item is OperatorEventDetailItem => item !== null);
  }
  return fields;
}

function projectPresentationIntentToolPresentation(
  intent: PresentationIntent,
  fallbackResourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const intentResourceLinks = projectIntentResourceLinks(
    intent.kind === "resource_bundle" ? intent.resources : intent.resourceLinks,
  );
  const resourceLinks = intentResourceLinks.length > 0 ? intentResourceLinks : fallbackResourceLinks;
  return {
    outputKind: presentationIntentOutputKind(intent),
    classification: toolResultClassification("presentation-intent", "validated presentation intent selected renderer", { confidence: "high" }),
    title: intent.title,
    summary: presentationIntentBrief(intent),
    fields: presentationIntentFields(intent),
    presentationIntent: intent,
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function readPresentationIntent(
  payload: Record<string, unknown>,
  envelope: ReturnType<typeof parseOperatorToolResultEnvelope>,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
): { readonly intent?: PresentationIntent; readonly invalidReason?: string } {
  const outputRecord = parseOutputRecord(output);
  const candidates = [
    metadata?.presentationIntent,
    envelope?.presentationIntent,
    payload.presentationIntent,
    outputRecord?.presentationIntent,
  ];
  let invalidReason: string | undefined;
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const parsed = parsePresentationIntent(candidate);
    if (parsed.ok) return { intent: parsed.intent };
    invalidReason ??= parsed.error;
  }
  return invalidReason ? { invalidReason } : {};
}

function projectConfigToolPresentation(toolName: string, output: string | undefined): ToolResultPresentation | undefined {
  if (!toolName.startsWith("kiln_config.") || !output) {
    return undefined;
  }
  const record = parseOutputRecord(output);
  if (!record) {
    return undefined;
  }
  // An apply result reports through its settlement; a proposal reports directly.
  const settlement = asRecord(record.settlement) ?? record;
  const proposalId = readString(settlement.proposalId);
  const approvalId = readString(settlement.approvalId);
  const operation = readString(settlement.operation);
  const status = readString(settlement.outcome) ?? readString(record.status);
  const affectedPaths = readStringList(record.affectedCanonicalPaths);
  const appliedWrites = Array.isArray(settlement.appliedWrites)
    ? settlement.appliedWrites
      .map((write) => readString(asRecord(write)?.path))
      .filter((path): path is string => Boolean(path))
    : [];
  const diagnostics = Array.isArray(settlement.diagnostics) ? settlement.diagnostics.length : 0;
  const summary = [
    operation,
    status,
    appliedWrites.length > 0 ? `${appliedWrites.length} writes` : undefined,
    diagnostics > 0 ? `${diagnostics} diagnostics` : undefined,
  ].filter((value): value is string => Boolean(value)).join(" · ") || toolName;
  const fields = [
    field("Proposal", proposalId),
    field("Approval", approvalId),
    field("Operation", operation),
    field("Status", status),
    field("Authority", record.authorityImpact),
    field("Affected paths", affectedPaths.length > 0 ? affectedPaths.join(", ") : undefined),
    field("Applied writes", appliedWrites.length > 0 ? appliedWrites.join(", ") : undefined),
    field("Diagnostics", diagnostics > 0 ? diagnostics : undefined),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: toolName === "kiln_config.propose_change" ? "diff" : "text",
    classification: toolResultClassification("tool-metadata", "config tool output uses canonical config mutation metadata", { confidence: "high" }),
    title: toolName === "kiln_config.propose_change"
      ? "Kiln config proposal"
      : toolName === "kiln_config.apply_change"
        ? "Kiln config apply"
        : "Kiln config",
    summary,
    fields,
    preview: compactPreview(readString(record.previewDiff) ?? output, 4_000),
    raw: { available: false, reason: "Config mutation result is inline" },
  };
}

function normalizeWorkItemTaskStatus(value: string | null): ToolResultTaskStatus | null {
  switch (value) {
    case "pending":
    case "in_progress":
    case "completed":
    case "paused":
    case "blocked":
    case "cancelled":
    case "failed":
      return value;
    case "started":
    case "running":
      return "in_progress";
    case "success":
    case "succeeded":
      return "completed";
    case "error":
      return "failed";
    default:
      return null;
  }
}

function formatRequiredInputShape(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (Array.isArray(value)) {
    return value.length > 0 ? `${formatRequiredInputShape(value[0])}[]` : "array";
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (asRecord(value)) return "object";
  return "value";
}

function projectDiagnosticToolPresentation(output: string | undefined): ToolResultPresentation | undefined {
  const record = parseOutputRecord(output);
  const error = asRecord(record?.error);
  const message = readString(error?.message);
  if (!error || !message) return undefined;
  const code = readString(error.code) ?? undefined;
  const recoverable = typeof error.recoverable === "boolean" ? error.recoverable : undefined;
  const suggestedNextTool = readString(error.suggestedNextTool) ?? undefined;
  const requiredInputShape = asRecord(error.requiredInputShape);
  const requiredInput = requiredInputShape
    ? Object.entries(requiredInputShape).map(([name, expected]) => ({
        name,
        expected: formatRequiredInputShape(expected),
      }))
    : [];
  return {
    outputKind: "diagnostic",
    classification: toolResultClassification(
      "content-heuristic",
      "structured error envelope",
      { confidence: "high" },
    ),
    title: code ? sentenceFromKey(code) : "Tool error",
    summary: message,
    fields: [],
    diagnostic: {
      ...(code ? { code } : {}),
      message,
      ...(recoverable !== undefined ? { recoverable } : {}),
      ...(suggestedNextTool ? { suggestedNextTool } : {}),
      requiredInput,
    },
    raw: { available: false, reason: "Structured diagnostic is rendered inline" },
  };
}

function readPauseRequirementSummaries(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const requirement = asRecord(entry);
    const summary = readString(requirement?.summary);
    return summary ? [summary] : [];
  });
}

function projectWorkItemUpdateToolPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
): ToolResultPresentation | undefined {
  if (toolName !== "work_item.update") return undefined;
  const record = parseOutputRecord(output);
  const item = asRecord(record?.item) ?? asRecord(metadata?.item);
  const id = readString(item?.id) ?? readString(metadata?.id);
  const summary = readString(item?.summary);
  const status = normalizeWorkItemTaskStatus(readString(item?.status) ?? readString(metadata?.status));
  if (!item || !id || !summary || !status) return undefined;
  const expectedEvidence = readStringList(item.expectedEvidence);
  const providedEvidence = new Set(readStringList(item.providedEvidence));
  const nextTools = readStringList(record?.nextRequiredTools);
  const pauseRequirements = readPauseRequirementSummaries(item.pauseRequirements);
  const residualRisk = readString(item.residualRisk) ?? undefined;
  const workflowProfile = readString(item.workflowProfile) ?? undefined;
  const risk = readString(item.risk) ?? undefined;
  const surface = readString(item.surface) ?? undefined;
  const authority = readString(item.authority) ?? undefined;
  const access = readString(item.access) ?? undefined;
  const fields = [
    field("Work item", id),
    field("Workflow", workflowProfile),
    field("Risk", risk),
    field("Surface", surface),
    field("Authority", authority),
    field("Access", access),
    field("Evidence", `${providedEvidence.size} / ${expectedEvidence.length}`),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "work_item",
    classification: toolResultClassification(
      "tool-metadata",
      "canonical work item update envelope",
      { confidence: "high" },
    ),
    title: summary,
    summary,
    fields,
    workItem: {
      id,
      summary,
      status,
      ...(workflowProfile ? { workflowProfile } : {}),
      ...(risk ? { risk } : {}),
      ...(surface ? { surface } : {}),
      ...(authority ? { authority } : {}),
      ...(access ? { access } : {}),
      evidence: expectedEvidence.map((label) => ({
        label,
        status: providedEvidence.has(label) ? "completed" : "pending",
      })),
      nextTools,
      pauseRequirements,
      ...(residualRisk ? { residualRisk } : {}),
    },
    raw: { available: false, reason: "Canonical work item state is rendered inline" },
  };
}

function readGoalEvidenceRequirements(value: unknown): readonly ToolResultGoalEvidenceRequirementPresentation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const requirement = asRecord(entry);
    const id = readString(requirement?.id);
    const description = readString(requirement?.description);
    if (!id || !description) return [];
    return [{ id, description, required: requirement?.required === true }];
  });
}

function projectGoalToolPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
): ToolResultPresentation | undefined {
  if (toolName !== "goal.create" && toolName !== "goal.evidence.record" && toolName !== "goal.complete") {
    return undefined;
  }
  const record = parseOutputRecord(output);
  const goal = asRecord(record?.goal) ?? asRecord(metadata?.goal);
  const id = readString(goal?.id) ?? readString(metadata?.id);
  const objective = readString(goal?.objective);
  const status = readString(goal?.status);
  if (!goal || !id || !objective || !status) return undefined;
  const authorityEnvelope = asRecord(goal.authorityEnvelope);
  const routePolicy = asRecord(goal.routePolicy);
  const source = asRecord(goal.source);
  const phase = readString(goal.currentPhase) ?? undefined;
  const planId = source?.kind === "approved_plan" ? readString(source.planId) ?? undefined : undefined;
  const sourceLabel = source?.kind === "operator_direct"
    ? `Operator turn ${readString(source.turnId) ?? "unknown"}`
    : planId ? `Approved plan ${planId}` : undefined;
  const authority = readString(authorityEnvelope?.maximumAuthority) ?? undefined;
  const escalationPolicy = readString(authorityEnvelope?.escalationPolicy) ?? undefined;
  const workflowProfile = readString(routePolicy?.workflowProfile) ?? undefined;
  const createdAt = readString(goal.createdAt) ?? undefined;
  const updatedAt = readString(goal.updatedAt) ?? undefined;
  const activeDurationMs = readNumber(goal.activeDurationMs) ?? undefined;
  const activeSince = readString(goal.activeSince) ?? undefined;
  const workItemIds = readStringList(goal.workItemIds);
  const evidenceRequirements = readGoalEvidenceRequirements(goal.evidenceRequirements);
  const evidence = readGoalEvidence(goal.evidence);
  const fields = [
    field("Goal", id),
    field("Status", status),
    field("Phase", phase),
    field("Source", sourceLabel),
    field("Authority", authority),
    field("Escalation", escalationPolicy),
    field("Workflow", workflowProfile),
    field("Work items", workItemIds.length),
    field("Goal evidence", `${evidence.length}/${evidenceRequirements.filter((requirement) => requirement.required).length}`),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "goal",
    classification: toolResultClassification(
      "tool-metadata",
      "canonical governed goal envelope",
      { confidence: "high" },
    ),
    title: objective,
    summary: objective,
    fields,
    goal: {
      id,
      objective,
      status,
      ...(phase ? { phase } : {}),
      ...(planId ? { planId } : {}),
      workItemIds,
      ...(authority ? { authority } : {}),
      ...(escalationPolicy ? { escalationPolicy } : {}),
      ...(workflowProfile ? { workflowProfile } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(activeDurationMs !== undefined ? { activeDurationMs } : {}),
      ...(activeSince ? { activeSince } : {}),
      evidenceRequirements,
      evidence,
    },
    raw: { available: false, reason: "Canonical goal state is rendered inline" },
  };
}

function readGoalEvidence(value: unknown): readonly ToolResultGoalEvidencePresentation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const requirementId = readString(record?.requirementId);
    const summary = readString(record?.summary);
    return requirementId && summary
      ? [{
          requirementId,
          summary,
          resourceUris: readStringList(record?.resourceUris),
          workItemIds: readStringList(record?.workItemIds),
        }]
      : [];
  });
}

const VERIFICATION_AUTHORITY = {
  kind: "evidence_only",
  establishes: [],
} as const satisfies ToolResultVerificationAuthorityPresentation;

function readVerificationSubjects(value: unknown): readonly ToolResultVerificationSubjectPresentation[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const subjects = value.flatMap((entry) => {
    const record = asRecord(entry);
    const path = readString(record?.path);
    const contentDigest = readString(record?.contentDigest);
    return path ? [{ path, ...(contentDigest ? { contentDigest } : {}) }] : [];
  });
  return subjects.length === value.length ? subjects : null;
}

function hasEmptyAuthorityClaims(metadata: Record<string, unknown>): boolean {
  return Array.isArray(metadata.establishes) && metadata.establishes.length === 0;
}

function isCanonicalSha256(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isNonNegativeSafeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function projectFormalVerificationPresentation(
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation | undefined {
  if (
    readString(metadata.schema) !== "kiln.formal-verification-observation/v3"
    || readString(metadata.toolName) !== "formal_verify"
    || readString(metadata.kind) !== "formal_verification"
    || !hasEmptyAuthorityClaims(metadata)
  ) return undefined;
  const verifier = asRecord(metadata.verifier);
  const artifact = asRecord(metadata.artifact);
  const engineName = readString(verifier?.name);
  const engineVersion = readString(verifier?.version);
  const digest = readString(artifact?.contentDigest);
  const subjects = readVerificationSubjects(metadata.subjects);
  if (
    engineName !== "dafny"
    || !engineVersion
    || !isCanonicalSha256(digest)
    || !subjects
    || subjects.some((subject) => !isCanonicalSha256(subject.contentDigest))
    || !Array.isArray(metadata.checks)
    || metadata.checks.length === 0
  ) {
    return undefined;
  }
  const checks = metadata.checks.flatMap((entry): ToolResultFormalCheckPresentation[] => {
    const record = asRecord(entry);
    const label = readString(record?.symbol);
    const outcome = readString(record?.outcome);
    const checkKind = readString(record?.check);
    const detail = readString(record?.detail);
    const durationMs = readNumber(record?.durationMs);
    const resourceCount = readNumber(record?.resourceCount);
    if (
      !label
      || checkKind !== "correctness"
      || (outcome !== "proved" && outcome !== "refuted" && outcome !== "unresolved")
      || !isNonNegativeSafeInteger(durationMs)
      || !isNonNegativeSafeInteger(resourceCount)
      || (outcome === "proved" && detail !== null)
      || (outcome !== "proved" && detail === null)
    ) return [];
    return [{
      label,
      outcome,
      ...(detail ? { detail } : {}),
      durationMs,
      resourceCount,
    }];
  });
  if (checks.length !== metadata.checks.length) return undefined;
  const proved = checks.filter((check) => check.outcome === "proved").length;
  const refuted = checks.filter((check) => check.outcome === "refuted").length;
  const unresolved = checks.filter((check) => check.outcome === "unresolved").length;
  const resourceCount = checks.reduce((total, check) => total + check.resourceCount, 0);
  const outcome = refuted > 0 ? "refuted" : unresolved > 0 ? "unresolved" : "proved";
  const summary = `${proved}/${checks.length} obligations proved · ${resourceCount.toLocaleString("en-US")} RU`;
  return {
    outputKind: "verification",
    classification: toolResultClassification("tool-metadata", "formal verification observation identifies candidate-bound proof evidence", { confidence: "high" }),
    title: "Dafny formal verification",
    summary,
    fields: [
      { label: "Engine", value: `${engineName} ${engineVersion}` },
      { label: "Candidate", value: digest },
      { label: "Assurance", value: "Separate decision" },
    ],
    verification: {
      kind: "formal",
      engine: { name: engineName, version: engineVersion },
      candidate: { digest, subjects },
      outcome,
      totals: { total: checks.length, proved, refuted, unresolved },
      checks,
      authority: VERIFICATION_AUTHORITY,
    },
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectStaticVerificationPresentation(
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation | undefined {
  if (
    readString(metadata.schema) !== "kiln.static-analysis-observation/v1"
    || readString(metadata.toolName) !== "static_analyze"
    || readString(metadata.kind) !== "static_analysis"
    || !hasEmptyAuthorityClaims(metadata)
  ) return undefined;
  const analyzer = asRecord(metadata.analyzer);
  const profile = asRecord(metadata.profile);
  const engineName = readString(analyzer?.name);
  const engineVersion = readString(analyzer?.version);
  const profileId = readString(profile?.id);
  const rulesAnalyzed = readNumber(profile?.rulesAnalyzed);
  const outcome = readString(metadata.outcome);
  const subjects = readVerificationSubjects(metadata.subjects);
  const digest = subjects?.[0]?.contentDigest;
  if (
    engineName !== "oxlint"
    || !engineVersion
    || !profileId
    || !isPositiveSafeInteger(rulesAnalyzed)
    || (outcome !== "clean" && outcome !== "violations")
    || !subjects
    || subjects.length !== 1
    || !isCanonicalSha256(digest)
    || !Array.isArray(metadata.diagnostics)
  ) return undefined;
  const diagnostics = metadata.diagnostics.flatMap((entry): ToolResultStaticDiagnosticPresentation[] => {
    const record = asRecord(entry);
    const rule = readString(record?.rule);
    const severity = readString(record?.severity);
    const message = readString(record?.message);
    const file = readString(record?.file);
    const line = record?.line === undefined ? null : readNumber(record.line);
    const column = record?.column === undefined ? null : readNumber(record.column);
    if (
      (severity !== "error" && severity !== "warning")
      || !message
      || !file
      || (line !== null && !isPositiveSafeInteger(line))
      || (column !== null && (!isPositiveSafeInteger(column) || line === null))
    ) return [];
    return [{
      ...(rule ? { rule } : {}),
      severity,
      message,
      file,
      ...(line !== null ? { line } : {}),
      ...(column !== null ? { column } : {}),
    }];
  });
  if (diagnostics.length !== metadata.diagnostics.length) return undefined;
  if ((outcome === "clean") !== (diagnostics.length === 0)) return undefined;
  const summary = outcome === "clean"
    ? `${rulesAnalyzed} rules · no diagnostics`
    : `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"} across ${rulesAnalyzed} rules`;
  return {
    outputKind: "verification",
    classification: toolResultClassification("tool-metadata", "static analysis observation identifies candidate-bound diagnostic evidence", { confidence: "high" }),
    title: "Oxlint static analysis",
    summary,
    fields: [
      { label: "Engine", value: `${engineName} ${engineVersion}` },
      { label: "Candidate", value: digest },
      { label: "Assurance", value: "Separate decision" },
    ],
    verification: {
      kind: "static",
      engine: { name: engineName, version: engineVersion },
      candidate: { digest, subjects },
      outcome,
      profile: { id: profileId, rulesAnalyzed },
      diagnostics,
      authority: VERIFICATION_AUTHORITY,
    },
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectInferentialVerificationPresentation(
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation | undefined {
  if (
    readString(metadata.schema) !== "kiln.gentle-review-observation/v2"
    || readString(metadata.toolName) !== "gentle_review"
    || readString(metadata.kind) !== "inferential_review"
    || !hasEmptyAuthorityClaims(metadata)
    || !Array.isArray(metadata.findings)
    || metadata.findings.length !== 0
  ) return undefined;
  const engine = asRecord(metadata.engine);
  const candidate = asRecord(metadata.candidate);
  const reviewAuthority = asRecord(metadata.authority);
  const outcome = asRecord(metadata.outcome);
  const nextTransition = asRecord(outcome?.nextTransition);
  const engineName = readString(engine?.name);
  const engineVersion = readString(engine?.version);
  const digest = readString(candidate?.targetIdentity);
  const paths = readStringList(candidate?.paths);
  const applicability = readString(outcome?.applicability);
  const action = readString(outcome?.action);
  const replayability = readString(outcome?.replayability);
  const lineageId = readString(reviewAuthority?.lineageId);
  const state = readString(reviewAuthority?.state);
  const generation = readNumber(reviewAuthority?.generation);
  const revision = readString(reviewAuthority?.revision);
  if (engineName !== "gentle-ai" || !engineVersion || !isCanonicalSha256(digest) || paths.length === 0 || !applicability || !action || !replayability || !lineageId || !state || generation === null || !Number.isSafeInteger(generation) || generation < 1 || !isCanonicalSha256(revision)) {
    return undefined;
  }
  const transitionKind = readString(nextTransition?.kind);
  const transitionReason = readString(nextTransition?.reasonCode);
  const transition: ToolResultInferentialVerificationPresentation["outcome"]["nextTransition"] =
    transitionReason && (transitionKind === "execute" || transitionKind === "collect" || transitionKind === "stop")
      ? { kind: transitionKind, reasonCode: transitionReason }
      : undefined;
  const subjects = paths.map((path) => ({ path }));
  return {
    outputKind: "verification",
    classification: toolResultClassification("tool-metadata", "inferential review observation identifies candidate-bound provider status", { confidence: "high" }),
    title: "Gentle AI review status",
    summary: `${applicability} · ${state} · ${action}`,
    fields: [
      { label: "Engine", value: `${engineName} ${engineVersion}` },
      { label: "Candidate", value: digest },
      { label: "Assurance", value: "Separate decision" },
    ],
    verification: {
      kind: "inferential",
      engine: { name: engineName, version: engineVersion },
      candidate: { digest, subjects },
      outcome: { applicability, action, replayability, ...(transition ? { nextTransition: transition } : {}) },
      transaction: { lineageId, state, generation, revision },
      authority: VERIFICATION_AUTHORITY,
    },
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectQualityVerificationPresentation(
  metadata: Record<string, unknown>,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation | undefined {
  if (readString(metadata.schema) !== "kiln.quality-analysis-observation/v1" || readString(metadata.toolName) !== "quality_analyze" || readString(metadata.kind) !== "static_quality_analysis" || !hasEmptyAuthorityClaims(metadata)) return undefined;
  const analyzer = asRecord(metadata.analyzer);
  const parser = asRecord(analyzer?.parser);
  const artifact = asRecord(metadata.artifact);
  const engineVersion = readString(analyzer?.version);
  const parserVersion = readString(parser?.version);
  const path = readString(artifact?.path);
  const digest = readString(artifact?.contentDigest);
  const outcome = readString(metadata.outcome);
  if (readString(analyzer?.name) !== "kiln-quality" || readString(parser?.name) !== "@typescript/typescript6" || !engineVersion || !parserVersion || readString(artifact?.kind) !== "typescript" || !path || !isCanonicalSha256(digest) || (outcome !== "no_diagnostics" && outcome !== "diagnostics") || !Array.isArray(metadata.profiles) || metadata.profiles.length < 1 || metadata.profiles.length > QUALITY_PROFILE_CONTRACTS.length) return undefined;
  let previousProfileIndex = -1;
  const profiles = metadata.profiles.flatMap((entry): ToolResultQualityProfilePresentation[] => {
    const profile = asRecord(entry);
    const profileName = readString(profile?.name);
    const profileIndex = QUALITY_PROFILE_CONTRACTS.findIndex((candidate) => candidate.name === profileName);
    const contract = QUALITY_PROFILE_CONTRACTS[profileIndex];
    if (!contract || profileIndex <= previousProfileIndex || readString(profile?.revision) !== "v1" || !Array.isArray(profile?.rules) || !Array.isArray(profile?.diagnostics)) return [];
    previousProfileIndex = profileIndex;
    const rules = profile.rules.flatMap((ruleEntry) => {
      const rule = asRecord(ruleEntry);
      const name = readString(rule?.name);
      const revision = readString(rule?.revision);
      return name && revision ? [{ name, revision }] : [];
    });
    if (rules.length !== contract.rules.length || rules.some((rule, index) => rule.name !== contract.rules[index] || rule.revision !== "v1")) return [];
    const diagnostics = profile.diagnostics.flatMap((diagnosticEntry): ToolResultQualityDiagnosticPresentation[] => {
      const diagnostic = asRecord(diagnosticEntry);
      const rule = asRecord(diagnostic?.rule);
      const name = readString(rule?.name);
      const revision = readString(rule?.revision);
      const message = readString(diagnostic?.message);
      const line = readNumber(diagnostic?.line);
      const column = readNumber(diagnostic?.column);
      if (!name || !rules.some((candidate) => candidate.name === name && candidate.revision === revision) || !revision || !message || !isPositiveSafeInteger(line) || !isPositiveSafeInteger(column)) return [];
      return [{ rule: { name, revision }, message, line, column }];
    });
    if (diagnostics.length !== profile.diagnostics.length) return [];
    return [{ name: contract.name, revision: "v1", rules, diagnostics }];
  });
  if (profiles.length !== metadata.profiles.length) return undefined;
  const diagnosticCount = profiles.reduce((count, profile) => count + profile.diagnostics.length, 0);
  if ((outcome === "no_diagnostics") !== (diagnosticCount === 0)) return undefined;
  return {
    outputKind: "verification",
    classification: toolResultClassification("tool-metadata", "quality analysis observation identifies candidate-bound deterministic diagnostics", { confidence: "high" }),
    title: "TypeScript quality analysis",
    summary: outcome === "no_diagnostics" ? "No configured quality diagnostics" : `${diagnosticCount} configured quality diagnostic${diagnosticCount === 1 ? "" : "s"}`,
    fields: [{ label: "Profiles", value: `${profiles.length}` }, { label: "Candidate", value: digest }, { label: "Assurance", value: "Separate decision" }],
    verification: {
      kind: "quality",
      engine: { name: "kiln-quality", version: engineVersion, parser: { name: "@typescript/typescript6", version: parserVersion } },
      candidate: { digest, subjects: [{ path, contentDigest: digest }] },
      artifactKind: "typescript",
      outcome,
      profiles,
      authority: VERIFICATION_AUTHORITY,
    },
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

const QUALITY_PROFILE_CONTRACTS = [
  { name: "type-integrity", rules: ["chained-type-assertion", "widen-then-assert"] },
  { name: "complexity", rules: ["high-cyclomatic-complexity"] },
  { name: "test-integrity", rules: ["focused-test", "empty-test-body"] },
] as const;

function projectVerificationPresentation(
  metadata: Record<string, unknown> | undefined,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation | undefined {
  if (!metadata) return undefined;
  const kind = readString(metadata.kind);
  if (kind === "formal_verification") return projectFormalVerificationPresentation(metadata, resourceLinks);
  if (kind === "static_analysis") return projectStaticVerificationPresentation(metadata, resourceLinks);
  if (kind === "static_quality_analysis") return projectQualityVerificationPresentation(metadata, resourceLinks);
  if (kind === "inferential_review") return projectInferentialVerificationPresentation(metadata, resourceLinks);
  return undefined;
}

function projectFailedToolPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
): ToolResultPresentation | undefined {
  const message = readString(output);
  if (!message) return undefined;
  const code = readString(metadata?.code) ?? undefined;
  const filePath = readString(metadata?.filePath) ?? undefined;
  return {
    outputKind: "diagnostic",
    classification: toolResultClassification(
      "tool-metadata",
      "failed tool result with diagnostic metadata",
      { confidence: "high" },
    ),
    title: `${sentenceFromKey(toolName)} failed`,
    summary: message,
    fields: [field("Path", filePath), ...projectTemporalEvidenceFields(metadata)]
      .filter((item): item is OperatorEventDetailItem => item !== null),
    diagnostic: {
      ...(code ? { code } : {}),
      message,
      requiredInput: [],
    },
    raw: { available: false, reason: "Failed tool result is rendered as a diagnostic" },
  };
}

function projectWorkItemExecutionToolPresentation(
  toolName: string,
  output: string | undefined,
): ToolResultPresentation | undefined {
  if (toolName !== "work_item.execution.start" || !output) return undefined;
  const record = parseOutputRecord(output);
  if (!record) return undefined;
  const item = asRecord(record.item);
  const attempt = asRecord(record.attempt);
  const status = normalizeWorkItemTaskStatus(readString(item?.status) ?? readString(record.status));
  if (!status) return undefined;
  const managedInvocationRequest = asRecord(record.managedInvocationRequest);
  const reason = readString(record.reason) ?? undefined;
  const workItemId = readString(record.workItemId) ?? readString(item?.id) ?? undefined;
  const routeId = readString(record.routeId) ?? readString(managedInvocationRequest?.routeId) ?? undefined;
  const nextTool = readString(record.nextTool) ?? undefined;
  const requiredEvidence = readStringList(record.requiredEvidence).length > 0
    ? readStringList(record.requiredEvidence)
    : readStringList(item?.expectedEvidence).length > 0
      ? readStringList(item?.expectedEvidence)
      : readStringList(managedInvocationRequest?.expectedEvidence);
  const providedEvidence = new Set(readStringList(item?.providedEvidence));
  const items = requiredEvidence.map((label) => ({
    label,
    status: providedEvidence.has(label) ? "completed" as const : "pending" as const,
  }));
  const itemSummary = readString(item?.summary) ?? undefined;
  const attemptSummary = readString(attempt?.summary) ?? undefined;
  const summary = reason ?? itemSummary ?? attemptSummary ?? (items.length > 0 ? `${items.length} evidence requirements` : undefined) ?? workItemId;
  const fields = [
    field("Work item", workItemId),
    field("Route", routeId),
    field("Next tool", nextTool),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind: "task",
    classification: toolResultClassification(
      "tool-metadata",
      "work item execution output uses the governed task result contract",
      { confidence: "high" },
    ),
    title: itemSummary ?? "Work item execution",
    ...(summary ? { summary } : {}),
    fields,
    task: {
      status,
      ...(reason ? { reason } : {}),
      ...(workItemId ? { workItemId } : {}),
      ...(routeId ? { routeId } : {}),
      ...(nextTool ? { nextTool } : {}),
      items,
    },
    raw: { available: false, reason: "Structured work item result is rendered inline" },
  };
}

function projectToolResultPresentation(
  toolName: string,
  payload: Record<string, unknown>,
): ToolResultPresentation | undefined {
  const envelope = parseOperatorToolResultEnvelope(toolResultEnvelopeText(payload));
  const payloadMetadata = asRecord(payload.metadata);
  const output = envelope?.output ?? readString(payload.output) ?? readString(payload.outputSummary) ?? undefined;
  const metadata = envelope?.metadata || payloadMetadata
    ? {
        ...(envelope?.metadata ?? {}),
        ...(payloadMetadata ?? {}),
      }
    : undefined;
  const payloadResourceLinks = parseOperatorToolResultResourceLinks(payloadMetadata?.resourceLinks);
  const resourceLinks = payloadResourceLinks.length > 0 ? payloadResourceLinks : envelope?.resourceLinks ?? [];
  const presentationIntent = readPresentationIntent(payload, envelope, output, metadata);
  if (!output && !metadata && resourceLinks.length === 0 && !presentationIntent.intent && !presentationIntent.invalidReason) return undefined;
  if (presentationIntent.intent) {
    return projectPresentationIntentToolPresentation(presentationIntent.intent, resourceLinks);
  }
  const fallbackClassification = presentationIntent.invalidReason
    ? toolResultClassification("fallback", "invalid presentation intent fell back to textual output", {
        fallbackReason: presentationIntent.invalidReason,
        confidence: "medium",
      })
    : undefined;
  const verificationPresentation = toolResultIsError(payload)
    ? undefined
    : projectVerificationPresentation(metadata, resourceLinks);
  if (verificationPresentation) {
    return verificationPresentation;
  }
  const diagnosticPresentation = projectDiagnosticToolPresentation(output);
  if (diagnosticPresentation) {
    return diagnosticPresentation;
  }
  const workItemUpdatePresentation = projectWorkItemUpdateToolPresentation(toolName, output, metadata);
  if (workItemUpdatePresentation) {
    return workItemUpdatePresentation;
  }
  const goalPresentation = projectGoalToolPresentation(toolName, output, metadata);
  if (goalPresentation) {
    return goalPresentation;
  }
  const workItemExecutionPresentation = projectWorkItemExecutionToolPresentation(toolName, output);
  if (workItemExecutionPresentation) {
    return workItemExecutionPresentation;
  }
  const configPresentation = projectConfigToolPresentation(toolName, output);
  if (configPresentation) {
    return configPresentation;
  }
  const operation = readString(metadata?.operation);
  const kind = readString(metadata?.kind);
  if (browserSnapshotLinks(metadata, resourceLinks).length > 0 && metadata) {
    return projectBrowserScreenshotPresentation(output, metadata, resourceLinks);
  }
  const hasDiff = !!metadata && (
    readString(metadata.diffPreview) !== null
    || operation === "patch"
    || operation === "edit"
    || operation === "write"
  );
  if (hasDiff && metadata) {
    return projectDiffPresentation(toolName, output, metadata, resourceLinks);
  }
  if (kind === "command") {
    return projectCommandPresentation(toolName, output, metadata ?? {}, resourceLinks);
  }
  if (kind === "inspection" && operation === "tree") {
    return projectTreePresentation(toolName, output, metadata ?? {}, resourceLinks);
  }
  if (kind === "inspection" && operation === "stat" && metadata) {
    return projectStatPresentation(toolName, metadata, resourceLinks);
  }
  if (kind === "media" && operation === "ocr" && metadata) {
    return projectOcrPresentation(toolName, output, metadata, resourceLinks);
  }
  const searchResultsPresentation = projectSearchResultsPresentation(toolName, output, metadata, resourceLinks);
  if (searchResultsPresentation) {
    return searchResultsPresentation;
  }
  if (operation === "read_many" && resourceLinks.length > 0) {
    return projectResourceLinkPresentation(toolName, output, metadata ?? {}, resourceLinks);
  }
  if (toolResultIsError(payload)) {
    const failedPresentation = projectFailedToolPresentation(toolName, output, metadata);
    if (failedPresentation) {
      return failedPresentation;
    }
  }
  if (operation === "read" || toolName === "read") {
    return projectTextPresentation(toolName, output, metadata, resourceLinks, fallbackClassification);
  }
  if (resourceLinks.length > 0) {
    return projectResourceLinkPresentation(toolName, output, metadata ?? {}, resourceLinks);
  }
  return projectTextPresentation(toolName, output, metadata, resourceLinks, fallbackClassification);
}

function toolResultText(payload: Record<string, unknown>): string | null {
  const raw = toolResultEnvelopeText(payload);
  if (!raw) return null;
  const envelope = parseOperatorToolResultEnvelope(raw);
  const payloadMetadata = asRecord(payload.metadata);
  const metadata = envelope?.metadata || payloadMetadata
    ? {
        ...(envelope?.metadata ?? {}),
        ...(payloadMetadata ?? {}),
      }
    : undefined;
  if (metadata && readString(metadata.operation) === "read_many") {
    return formatReadManySummary(metadata);
  }
  if (envelope?.output) return compactText(envelope.output);
  const parsed = parseJsonRecord(raw);
  if (!parsed) return compactText(raw);
  const output = readString(parsed.output);
  if (output) return compactText(output);
  const parsedMetadata = asRecord(parsed.metadata) ?? metadata;
  const operation = readString(parsedMetadata?.operation) ?? readString(parsedMetadata?.toolName);
  const isError = parsed.isError === true;
  if (operation) return isError ? `${operation} failed` : `${operation} succeeded`;
  return compactText(raw);
}

function toolResultIsError(payload: Record<string, unknown>): boolean {
  const status = asRecord(payload.status);
  const state = readString(status?.state) ?? readString(payload.status);
  if (state === "failed" || state === "error") return true;
  const envelope = parseOperatorToolResultEnvelope(toolResultEnvelopeText(payload));
  return envelope?.isError === true;
}

function toolResultMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const envelope = parseOperatorToolResultEnvelope(toolResultEnvelopeText(payload));
  const payloadMetadata = asRecord(payload.metadata);
  if (!envelope?.metadata && !payloadMetadata) {
    return null;
  }
  return {
    ...(envelope?.metadata ?? {}),
    ...(payloadMetadata ?? {}),
  };
}

function managedInvocationToolIdentity(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (readString(payload.toolName) !== "managed_agent.invoke") {
    return null;
  }
  const input = asRecord(payload.input);
  const metadata = toolResultMetadata(payload);
  const providerRoute = asRecord(metadata?.providerRoute) ?? asRecord(input?.providerRoute);
  const access = readString(metadata?.access) ?? readString(input?.access);
  if (!access && !providerRoute) {
    return null;
  }
  return {
    ...(input ?? {}),
    ...(metadata ?? {}),
    ...(access ? { access } : {}),
    ...(providerRoute ? { providerRoute } : {}),
  };
}

function managedInvocationContext(identity: Record<string, unknown>): Record<string, unknown> | null {
  const context = asRecord(identity.context) ?? asRecord(identity.invocationContext);
  if (context) {
    return context;
  }
  const mode = readString(identity.contextMode);
  const agentProfile = readString(identity.agentProfile);
  const skills = readStringList(identity.skills);
  const instructionProfiles = readStringList(identity.instructionProfiles);
  if (!mode && !agentProfile && skills.length === 0 && instructionProfiles.length === 0) {
    return null;
  }
  return {
    ...(mode ? { mode } : {}),
    ...(agentProfile ? { agentProfile } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(instructionProfiles.length > 0 ? { instructionProfiles } : {}),
  };
}

function addManagedInvocationContextDetails(
  details: OperatorEventDetailItem[],
  identity: Record<string, unknown>,
  options: { readonly includeResolution: boolean },
): void {
  const context = managedInvocationContext(identity);
  addItem(details, "Context mode", context?.mode);
  addItem(details, "Agent profile", context?.agentProfile);
  addItem(details, "Skills", formatStringList(context?.skills));
  addItem(details, "Instruction profiles", formatStringList(context?.instructionProfiles));
  if (options.includeResolution) {
    addItem(details, "Admitted profile", context?.admittedAgentProfile);
    addItem(details, "Admitted skills", formatStringList(context?.admittedSkills));
    addItem(details, "Admitted instruction profiles", formatStringList(context?.admittedInstructionProfiles));
    addItem(details, "Denied skills", formatStringList(context?.deniedSkills));
  }
}

function addManagedInvocationToolDetails(
  details: OperatorEventDetailItem[],
  identity: Record<string, unknown>,
  options: { readonly includeRuntimeEvidence: boolean },
): void {
  const providerRoute = asRecord(identity.providerRoute);
  addItem(details, "Access", identity.access);
  addItem(details, "Provider", providerRoute?.providerId);
  addItem(details, "Model", providerRoute?.model);
  addItem(details, "Surface", providerRoute?.surface);
  addManagedInvocationContextDetails(details, identity, { includeResolution: options.includeRuntimeEvidence });
  if (options.includeRuntimeEvidence) {
    addItem(details, "Adapter", identity.adapterKind);
    addItem(details, "Execution", identity.executionMode);
    addItem(details, "Authority", identity.authorityProfileId);
    addManagedCapabilitySnapshotDetails(details, identity);
    addItem(details, "Invocation ID", identity.invocationId);
    addItem(details, "Parent turn", identity.parentTurnId);
    if (!asRecord(identity.capabilitySnapshot)?.routeId) {
      addItem(details, "Route ID", identity.routeId);
    }
    if (!asRecord(identity.capabilitySnapshot)?.routeSource) {
      addItem(details, "Route source", identity.routeSource);
    }
    addItem(details, "Child session", identity.childSessionId);
    addItem(details, "Child turn", identity.childTurnId);
  }
  addItem(details, "Task", identity.task);
  addItem(details, "Summary", identity.summary);
}

function addManagedCapabilitySnapshotDetails(
  details: OperatorEventDetailItem[],
  identity: Record<string, unknown>,
): void {
  const snapshot = asRecord(identity.capabilitySnapshot);
  const evidence = asRecord(identity.managedInvocationEvidence);
  const lifecycle = asRecord(evidence?.lifecycle);
  const rawSnapshotLease = asRecord(snapshot?.resourceLease);
  const rawLifecycleLease = asRecord(lifecycle?.resourceLease);
  const rawResourceLease = rawLifecycleLease ?? rawSnapshotLease;
  const resourceLease = readCompleteResourceLease(rawResourceLease);
  const accountLease = asRecord(lifecycle?.accountLease);
  if (!snapshot && !lifecycle && !rawResourceLease && !accountLease) {
    return;
  }
  const routeHealth = asRecord(snapshot?.routeHealth);
  const providerModelProof = asRecord(snapshot?.providerModelProof);
  const adapterDescriptor = asRecord(snapshot?.adapterDescriptor);
  const resourcePlane = asRecord(snapshot?.resourcePlane);
  const childIdentity = asRecord(snapshot?.childIdentity);
  if (snapshot) {
    addItem(details, "Capability snapshot", snapshot.snapshotId);
    addItem(details, "Captured", snapshot.capturedAt);
    addItem(details, "Route ID", snapshot.routeId);
    addItem(details, "Route source", snapshot.routeSource);
    addItem(details, "Route health", routeHealth?.status);
    addItem(details, "Route health reason", routeHealth?.reason);
    addItem(details, "Provider proof", providerModelProof?.status);
    addItem(details, "Provider proof source", providerModelProof?.source);
    addItem(details, "Route limitations", formatStringList(adapterDescriptor?.limitations));
    addItem(details, "Resource plane", resourcePlane?.available === true ? "available" : resourcePlane?.available === false ? "unavailable" : undefined);
  } else if (lifecycle) {
    addItem(details, "Route ID", lifecycle.routeId);
    addItem(details, "Route source", lifecycle.routeSource);
  }
  const leasePath = readString(resourceLease?.workingDirectoryPath);
  const leaseMode = readString(resourceLease?.workingDirectoryMode);
  addItem(details, "Resource lease", leasePath && leaseMode ? `${leaseMode} · ${leasePath}` : leaseMode ?? leasePath);
  addItem(details, "Lease ID", resourceLease?.leaseId);
  addItem(details, "Lease created", resourceLease?.createdAt);
  addItem(details, "Lease health", resourceLease?.healthStatus);
  addItem(details, "Lease cleanup", resourceLease?.cleanupStatus);
  addItem(details, "Lease resources", formatStringList(resourceLease?.resourceUris));
  addItem(details, "Lease diagnostics", formatStringList(resourceLease?.diagnosticUris));
  addItem(details, "Account", accountLease?.accountRef);
  addItem(details, "Account policy", accountLease?.accountPolicyId);
  addItem(details, "Account lease ID", accountLease?.leaseId);
  addItem(details, "Account lease state", accountLease?.lifecycleState);
  addItem(details, "Account selection", accountLease?.selectionReason);
  const accountUsage = asRecord(accountLease?.usageEvidence);
  addItem(details, "Account usage freshness", accountUsage?.freshness);
  addItem(details, "Account usage availability", accountUsage?.availability);
  addItem(details, "Account usage observed", accountUsage?.observedAt);
  addItem(details, "Account affinity", accountLease?.affinityOutcome);
  addItem(details, "Account affinity commit", accountLease?.affinityCommitOutcome);
  addItem(details, "Account lease acquired", accountLease?.acquiredAt);
  addItem(details, "Account lease released", accountLease?.releasedAt);
  addItem(details, "Account lease resources", formatStringList(accountLease?.resourceUris));
  addItem(details, "Account lease diagnostics", formatStringList(accountLease?.diagnosticUris));
  addItem(details, "Source resources", formatStringList(lifecycle?.sourceResourceUris));
  const worktreeReview = asRecord(resourceLease?.worktreeReview);
  const worktreeReviewStatus = readString(worktreeReview?.status);
  const worktreeReviewReason = readString(worktreeReview?.reason);
  addItem(
    details,
    "Worktree review",
    worktreeReviewStatus && worktreeReviewReason
      ? `${worktreeReviewStatus} · ${worktreeReviewReason}`
      : worktreeReviewStatus ?? worktreeReviewReason,
  );
  addItem(details, "Worktree review resources", formatStringList(worktreeReview?.resourceUris));
  addItem(details, "Worktree review diagnostics", formatStringList(worktreeReview?.diagnosticUris));
  const worktreeConflict = asRecord(resourceLease?.worktreeConflict);
  const worktreeConflictStatus = readString(worktreeConflict?.status);
  const worktreeConflictReason = readString(worktreeConflict?.reason);
  addItem(
    details,
    "Worktree conflict",
    worktreeConflictStatus && worktreeConflictReason
      ? `${worktreeConflictStatus} · ${worktreeConflictReason}`
      : worktreeConflictStatus ?? worktreeConflictReason,
  );
  addItem(details, "Requested invocation", worktreeConflict?.requestedInvocationId);
  addItem(details, "Conflicting invocation", worktreeConflict?.conflictingInvocationId);
  const conflictPath = readString(worktreeConflict?.workingDirectoryPath);
  const conflictMode = readString(worktreeConflict?.workingDirectoryMode);
  addItem(details, "Conflict worktree", conflictPath && conflictMode ? `${conflictMode} · ${conflictPath}` : conflictMode ?? conflictPath);
  addItem(details, "Conflict policy", worktreeConflict?.policyId);
  addItem(details, "Retry after", formatStringList(worktreeConflict?.retryAfterInvocationIds));
  addItem(details, "Conflict resources", formatStringList(worktreeConflict?.resourceUris));
  addItem(details, "Conflict diagnostics", formatStringList(worktreeConflict?.diagnosticUris));
  addItem(details, "Child identity", childIdentity?.displayName ?? childIdentity?.admittedAgentProfile ?? childIdentity?.requestedAgentProfile ?? childIdentity?.agentId);
}

function readCompleteResourceLease(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (
    !readString(value.leaseId)
    || !readString(value.createdAt)
    || !readString(value.healthStatus)
    || !readString(value.cleanupStatus)
    || !readString(value.workingDirectoryPath)
    || !readString(value.workingDirectoryMode)
    || !readRequiredStringList(value.resourceUris)
    || !readRequiredStringList(value.diagnosticUris)
  ) {
    return null;
  }
  return value;
}

function providerIdentity(payload: Record<string, unknown>): { provider: string | null; model: string | null } {
  const provider = asRecord(payload.provider);
  return {
    provider: readString(provider?.provider) ?? readString(payload.routedProvider),
    model: readString(provider?.model) ?? readString(payload.routedModel),
  };
}

function providerRoutedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const provider = providerIdentity(payload);
  const summary = [provider.provider, provider.model].filter((value): value is string => Boolean(value)).join(" · ")
    || readString(payload.reason)
    || "Provider selected";
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", provider.provider);
  addItem(details, "Model", provider.model);
  addItem(details, "Why", payload.reason);
  return {
    title: "Provider routed",
    summary,
    compactText: summary,
    tone: "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function multimodalRoutedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const provider = providerIdentity(payload);
  const strategy = readString(payload.strategy) ?? "unknown";
  const capability = readString(payload.requestedCapability) ?? "multimodal";
  const modalities = formatStringList(payload.requiredModalities);
  const artifacts = formatStringList(payload.artifactUris);
  const diagnostics = Array.isArray(payload.diagnostics)
    ? payload.diagnostics.flatMap((diagnostic) => readString(asRecord(diagnostic)?.code) ? [readString(asRecord(diagnostic)?.code)!] : [])
    : [];
  const delegation = asRecord(payload.delegation);
  const summary = [strategy, capability, provider.provider, provider.model]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Strategy", strategy);
  addItem(details, "Capability", capability);
  addItem(details, "Modalities", modalities);
  addItem(details, "Provider", provider.provider);
  addItem(details, "Model", provider.model);
  addItem(details, "Reason", payload.reasonCode ?? payload.reason);
  addItem(details, "Artifacts", artifacts);
  addItem(details, "Delegation route", delegation?.routeId);
  addItem(details, "Authority profile", delegation?.authorityProfileId);
  addItem(details, "Diagnostics", diagnostics.join(", "));
  return {
    title: "Multimodal routed",
    summary,
    compactText: summary,
    tone: strategy === "native" || strategy === "delegated"
      ? "success"
      : strategy === "transform"
        ? "warning"
        : "error",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: strategy === "unsupported" || strategy === "failed" ? "exception" : "none",
  };
}

function toolStartedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const toolName = readString(payload.toolName) ?? "tool";
  const input = asRecord(payload.input) ?? payload;
  const managedInvocation = managedInvocationToolIdentity(payload);
  const managedInvocationSummary = managedInvocation ? invocationRouteSummary(managedInvocation) : null;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Tool", toolName);
  addItem(details, "Tool call ID", payload.toolCallId);
  if (managedInvocation) {
    addManagedInvocationToolDetails(details, managedInvocation, { includeRuntimeEvidence: false });
  }
  addPrimitiveItems(details, input, 10, ["toolName", "toolCallId", "input", "access", "profile", "providerRoute", "routeId", "routeSource", "parentTurnId", "task", "summary", "resourceUris", "agentProfile", "skills", "contextMode", "context", "capabilitySnapshot"]);
  return {
    title: presentToolActionTitle(toolName, "running"),
    summary: managedInvocationSummary ? `${managedInvocationSummary} · Execution in progress` : "Execution in progress",
    compactText: managedInvocationSummary ?? toolName,
    tone: "running",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: "activity",
  };
}

function toolOutputDeltaPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const toolName = readString(payload.toolName) ?? "tool";
  return {
    title: `${toolName} output`,
    compactText: toolName,
    tone: "running",
    details: [],
    surfaces: ["activity_panel"],
    conversationDisposition: "none",
  };
}

function workItemTaskEventState(status: ToolResultTaskStatus | undefined): {
  readonly title: string;
  readonly tone: OperatorEventTone;
  readonly disposition: OperatorEventConversationDisposition;
} | null {
  switch (status) {
    case "paused":
      return { title: "Execution paused", tone: "warning", disposition: "exception" };
    case "blocked":
      return { title: "Execution blocked", tone: "warning", disposition: "exception" };
    case "failed":
      return { title: "Execution failed", tone: "error", disposition: "exception" };
    case "in_progress":
    case "pending":
      return { title: "Execution started", tone: "running", disposition: "result" };
    case "cancelled":
      return { title: "Execution cancelled", tone: "warning", disposition: "exception" };
    case "completed":
      return { title: "Execution completed", tone: "success", disposition: "result" };
    default:
      return null;
  }
}

function toolCompletedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const toolName = readString(payload.toolName) ?? "tool";
  const status = asRecord(payload.status);
  const rawStatusValue = readString(status?.state) ?? readString(payload.status);
  const toolPresentation = projectToolResultPresentation(toolName, payload);
  const isError = toolResultIsError(payload) || toolPresentation?.diagnostic !== undefined;
  const taskStatus = toolPresentation?.task?.status;
  const statusValue = taskStatus ?? (isError ? "failed" : rawStatusValue);
  const result = toolPresentation?.summary ?? toolResultText(payload);
  const toolUsageSummary = formatToolUsageSummary(payload);
  const managedInvocation = managedInvocationToolIdentity(payload);
  const managedInvocationSummary = managedInvocation ? invocationRouteSummary(managedInvocation) : null;
  const resultWithUsage = [result, toolUsageSummary].filter((value): value is string => Boolean(value)).join(" · ") || null;
  const summary = managedInvocationSummary && resultWithUsage ? `${managedInvocationSummary} · ${resultWithUsage}` : resultWithUsage;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Tool", toolName);
  addItem(details, "Tool call ID", payload.toolCallId);
  addItem(details, "Status", statusValue);
  addItem(details, "Result", result);
  addItem(details, "Tool usage", toolUsageSummary);
  if (managedInvocation) {
    addManagedInvocationToolDetails(details, managedInvocation, { includeRuntimeEvidence: true });
  }
  addPrimitiveItems(details, asRecord(payload.input), 16, ["toolName", "toolCallId", "input", "status", "result", "access", "profile", "providerRoute", "routeId", "routeSource", "parentTurnId", "task", "summary", "resourceUris", "agentProfile", "skills", "contextMode", "context", "capabilitySnapshot"]);
  const taskState = workItemTaskEventState(taskStatus);
  return {
    title: taskState?.title
      ?? presentToolActionTitle(toolName, isError ? "error" : "success"),
    summary: summary ?? undefined,
    compactText: summary ?? managedInvocationSummary ?? toolName,
    tone: taskState?.tone ?? (!isError && (statusValue === "succeeded" || statusValue === "success") ? "success" : "error"),
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: taskState?.disposition ?? (isError ? "exception" : "result"),
    ...(toolPresentation ? { toolPresentation } : {}),
  };
}

function fileChangedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const change = asRecord(payload.change) ?? payload;
  const path = readString(change.path);
  const changeType = readString(change.changeType);
  const summary = [changeType, path].filter((value): value is string => Boolean(value)).join(": ") || "File changed";
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Path", path);
  addItem(details, "Change", changeType);
  addItem(details, "Lines added", readNumber(change.linesAdded));
  addItem(details, "Lines removed", readNumber(change.linesRemoved));
  return {
    title: "File changed",
    summary,
    compactText: summary,
    tone: "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function costUpdatedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const provider = providerIdentity(payload);
  const usage = asRecord(payload.usage);
  const cost = asRecord(payload.cost);
  const deltaUsd = readNumber(cost?.deltaUsd) ?? 0;
  const inputTokens = readNumber(usage?.inputTokens) ?? 0;
  const outputTokens = readNumber(usage?.outputTokens) ?? 0;
  const summary = `${formatUsd(deltaUsd) ?? "$0.0000"} · ${inputTokens}↑ ${outputTokens}↓`;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", provider.provider);
  addItem(details, "Model", provider.model);
  addItem(details, "Cost", formatUsd(deltaUsd));
  addItem(details, "Input tokens", inputTokens);
  addItem(details, "Output tokens", outputTokens);
  return {
    title: "Cost updated",
    summary,
    compactText: summary,
    tone: "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function lifecycleAttributionPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const ledger = asRecord(payload.ledger);
  const parsed = VerifiedEfficiencyEvidenceProjectionSchema.safeParse(payload.efficiencyEvidence);
  if (!parsed.success) {
    return {
      title: "Efficiency evidence unavailable",
      summary: "Canonical efficiency evidence is missing or invalid",
      compactText: "Efficiency evidence unavailable",
      tone: "warning",
      details: [],
      surfaces: ACTIVITY_SURFACES,
      conversationDisposition: "none",
    };
  }
  const projection = parsed.data;
  const summary = formatVerifiedEfficiencyEvidence(projection);
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider total tokens", projection.totals.providerTotalTokens);
  addItem(details, "Measured tokens", projection.totals.measured.tokens);
  addItem(details, "Estimated tokens", projection.totals.estimated.tokens);
  addItem(details, "Cached tokens", projection.totals.cached.tokens);
  addItem(details, "Avoided tokens", projection.totals.avoided.tokens);
  addItem(details, "Unknown tokens", projection.totals.unknown.tokens);
  addItem(details, "Policy", `${projection.policy.owner}/${projection.policy.policyId}`);
  addItem(details, "Policy configuration", projection.policy.configurationHash);
  addItem(details, "Outcome", projection.outcome);
  addItem(details, "Verification", projection.verification.status);
  addItem(details, "Savings evidence", projection.savings.length);
  addItem(details, "Evidence resources", projection.evidenceUris.length);
  addItem(details, "Source event", ledger?.sourceEventId);
  return {
    title: "Verified efficiency evidence",
    summary,
    compactText: summary,
    tone: "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function effectivePromptPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const parsed = EffectivePromptObservationSchema.safeParse(payload.effectivePrompt);
  if (!parsed.success) {
    return {
      title: "Effective prompt evidence unavailable",
      summary: "Canonical final-request evidence is missing or invalid",
      compactText: "Effective prompt evidence unavailable",
      tone: "warning",
      details: [],
      surfaces: ACTIVITY_SURFACES,
      conversationDisposition: "none",
    };
  }
  const observation = parsed.data;
  const communication = asRecord(observation.communicationResolution);
  const detail = asRecord(communication?.responseDetail);
  const profile = asRecord(communication?.interactionProfile);
  const locale = asRecord(communication?.locale);
  const requiredContent = asRecord(communication?.requiredContent);
  const artifactContract = asRecord(communication?.artifactContract);
  const responseSkills = asRecord(communication?.responseSkills);
  const semanticLoss = Array.isArray(communication?.semanticLoss)
    ? communication.semanticLoss.filter((value): value is string => typeof value === "string")
    : [];
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", observation.providerId);
  addItem(details, "Model", observation.modelId);
  addItem(details, "Request", observation.requestIndex + 1);
  addItem(details, "Estimated tokens", observation.estimatedTokens);
  addItem(details, "Components", observation.componentCount);
  addItem(details, "Detail requested", detail?.requested);
  addItem(details, "Detail effective", detail?.effective);
  addItem(details, "Detail mechanism", detail?.mechanism);
  addItem(details, "Profile requested", profile?.requestedProfileId);
  addItem(details, "Profile effective", profile?.effectiveProfileId);
  addItem(details, "Profile mechanism", profile?.mechanism);
  addItem(details, "Locale effective", locale?.effective);
  addItem(details, "Locale mechanism", locale?.mechanism);
  addItem(details, "Required content", Array.isArray(requiredContent?.effective) ? requiredContent.effective.join(", ") : undefined);
  addItem(details, "Required-content mechanism", requiredContent?.mechanism);
  addItem(details, "Artifact contract", artifactContract?.effective ? JSON.stringify(artifactContract.effective) : undefined);
  addItem(details, "Artifact mechanism", artifactContract?.mechanism);
  addItem(details, "Response skills", Array.isArray(responseSkills?.effective) ? JSON.stringify(responseSkills.effective) : undefined);
  addItem(details, "Response-skill mechanism", responseSkills?.mechanism);
  addItem(details, "Semantic loss", semanticLoss.join(", "));
  const summary = formatEffectivePromptObservation(observation);
  return {
    title: "Effective prompt observed",
    summary,
    compactText: summary,
    tone: semanticLoss.length > 0 ? "warning" : "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function approvalRequestedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const summary = readString(payload.action) ?? readString(payload.justification) ?? "Approval required";
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Action", payload.action);
  addItem(details, "Why", payload.justification);
  addItem(details, "Approval ID", payload.approvalId);
  return {
    title: "Approval requested",
    summary,
    compactText: summary,
    tone: "warning",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: "action",
  };
}

function approvalResolvedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const resolution = asRecord(payload.resolution) ?? payload;
  const decision = readString(resolution.decision) ?? "resolved";
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Approval ID", payload.approvalId ?? resolution.approvalId);
  addItem(details, "Decision", decision);
  addItem(details, "Reason", resolution.reason);
  addItem(details, "Resolved by", resolution.resolvedBy);
  return {
    title: "Approval resolved",
    summary: decision,
    compactText: decision,
    tone: decision === "approved" ? "success" : "error",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: "activity",
  };
}

function configChangePresentation(kind: OperatorSessionEventKind, payload: Record<string, unknown>): OperatorEventPresentation {
  const proposalId = readString(payload.proposalId);
  const approvalId = readString(payload.approvalId);
  const operation = readString(payload.operation);
  const status = readString(payload.status);
  const error = readString(payload.errorMessage);
  const appliedWrites = readStringList(payload.appliedWrites);
  const projectionEffects = readStringList(payload.projectionEffects);
  const outcome = readString(payload.outcome);
  const reconciliationErrors = readStringList(payload.reconciliationErrors);
  const reconciliationFailed = outcome === "committed-reconciliation-failed";
  const titles: Record<string, string> = {
    config_change_proposed: "Config change proposed",
    config_change_approved: "Config change approved",
    config_change_applied: reconciliationFailed
      ? "Config change applied, reconciliation failed"
      : "Config change applied",
    config_change_failed: "Config change failed",
  };
  const identitySummary = [
    operation,
    status,
    reconciliationFailed ? "reconciliation failed" : undefined,
    proposalId,
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const summary = error ?? (identitySummary || proposalId || "Config mutation");
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Proposal", proposalId);
  addItem(details, "Approval", approvalId);
  addItem(details, "Operation", operation);
  addItem(details, "Status", status);
  addItem(details, "Authority", payload.authorityImpact);
  addItem(details, "Approved by", payload.approvedBy);
  addItem(details, "Surface", payload.surface);
  addItem(details, "Writes", appliedWrites.length > 0 ? appliedWrites.join(", ") : undefined);
  addItem(details, "Projections", projectionEffects.length > 0 ? projectionEffects.join(", ") : undefined);
  addItem(details, "Outcome", outcome);
  addItem(
    details,
    "Reconciliation errors",
    reconciliationErrors.length > 0 ? reconciliationErrors.join(", ") : undefined,
  );
  addItem(details, "Error", error);
  return {
    title: titles[kind] ?? "Config mutation",
    summary,
    compactText: summary,
    tone: kind === "config_change_failed"
      ? "error"
      : kind === "config_change_applied" || kind === "config_change_approved"
        ? "success"
        : "warning",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: kind === "config_change_proposed"
      ? "action"
      : kind === "config_change_failed"
        ? "exception"
        : "none",
  };
}

function planSubmittedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const summary = compactText(
    readString(payload.summary)
    ?? readString(payload.objective)
    ?? "Plan submitted",
  );
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Plan", payload.planId);
  addItem(details, "Mode", payload.mode);
  addItem(details, "Workflow", payload.workflowProfile);
  addItem(details, "Risk", payload.riskClassification);
  addItem(details, "Source spec", payload.sourceSpecificationId);
  addItem(details, "Work items", payload.proposedWorkItemCount);
  return {
    title: "Plan submitted",
    summary,
    compactText: summary,
    tone: "info",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function specificationSubmittedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const specificationId = readString(payload.specificationId) ?? "specification";
  const status = readString(payload.status) ?? "draft";
  const summary = readString(payload.summary) ?? "Structured specification submitted.";
  const issueCodes = Array.isArray(payload.issueCodes)
    ? payload.issueCodes.flatMap((entry) => readString(entry) ? [readString(entry)!] : [])
    : [];
  const blockingIssueCodes = Array.isArray(payload.blockingIssueCodes)
    ? payload.blockingIssueCodes.flatMap((entry) => readString(entry) ? [readString(entry)!] : [])
    : [];
  return {
    title: "Specification Submitted",
    summary: `${specificationId} · ${status}`,
    compactText: summary,
    tone: blockingIssueCodes.length > 0 ? "warning" : "info",
    details: [
      { label: "Specification", value: specificationId },
      { label: "Status", value: status },
      ...(issueCodes.length > 0 ? [{ label: "Issues", value: issueCodes.join(", ") }] : []),
      ...(blockingIssueCodes.length > 0 ? [{ label: "Blocking", value: blockingIssueCodes.join(", ") }] : []),
    ],
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function planAnalysisReportedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const reportId = readString(payload.reportId) ?? "analysis-report";
  const planId = readString(payload.planId) ?? "plan";
  const status = readString(payload.status) ?? "ready";
  const highestSeverity = readString(payload.highestSeverity) ?? "none";
  const summary = readString(payload.summary) ?? "Plan/spec consistency analysis completed.";
  const findingCount = readNumber(payload.findingCount);
  const blocking = Array.isArray(payload.blockingFindingIds)
    ? payload.blockingFindingIds.flatMap((entry) => readString(entry) ? [readString(entry)!] : [])
    : [];
  return {
    title: "Plan Analysis Reported",
    summary: `${status} · ${summary}`,
    compactText: `${planId} · ${status}`,
    tone: status === "blocked"
      ? "error"
      : highestSeverity === "high" || highestSeverity === "medium"
        ? "warning"
        : "info",
    details: [
      { label: "Report", value: reportId },
      { label: "Plan", value: planId },
      ...(readString(payload.specificationId) ? [{ label: "Specification", value: readString(payload.specificationId)! }] : []),
      { label: "Status", value: status },
      { label: "Highest severity", value: highestSeverity },
      ...(findingCount !== undefined ? [{ label: "Findings", value: String(findingCount) }] : []),
      ...(blocking.length > 0 ? [{ label: "Blocking findings", value: blocking.join(", ") }] : []),
    ],
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function clarificationRecordedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const specificationId = readString(payload.specificationId) ?? "specification";
  const clarificationId = readString(payload.clarificationId) ?? "clarification";
  const affectedSection = readString(payload.affectedSection);
  return {
    title: "Clarification Recorded",
    summary: `${clarificationId} · ${specificationId}`,
    compactText: `Clarification recorded for ${specificationId}`,
    tone: "info",
    details: [
      { label: "Specification", value: specificationId },
      { label: "Clarification", value: clarificationId },
      ...(affectedSection ? [{ label: "Section", value: affectedSection }] : []),
    ],
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function planApprovedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const fromMode = readString(payload.fromMode) ?? "plan";
  const toMode = readString(payload.toMode) ?? "execute";
  const summary = `${fromMode} -> ${toMode}`;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Plan", payload.planId);
  addItem(details, "Approval", payload.approvalId);
  addItem(details, "Plan hash", payload.planHash);
  addItem(details, "From", fromMode);
  addItem(details, "To", toMode);
  addItem(details, "Approved at", payload.approvedAt);
  return {
    title: "Plan approved",
    summary,
    compactText: summary,
    tone: "success",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function invocationLabel(payload: Record<string, unknown>): string {
  return readString(payload.agentName) ?? readString(payload.agentType) ?? readString(payload.agentId) ?? "agent";
}

function providerRouteLabel(payload: Record<string, unknown>): string | null {
  const providerRoute = asRecord(payload.providerRoute);
  const providerId = readString(providerRoute?.providerId);
  if (!providerId) {
    return null;
  }
  const model = readString(providerRoute?.model);
  const surface = readString(providerRoute?.surface);
  return [
    providerId,
    model ? `/${model}` : null,
    surface ? ` (${surface})` : null,
  ].filter((value): value is string => value !== null).join("");
}

function invocationRouteSummary(payload: Record<string, unknown>): string {
  const access = readString(payload.access);
  const route = providerRouteLabel(payload);
  if (access && route) {
    return `${access} via ${route}`;
  }
  return access ?? route ?? invocationLabel(payload);
}

function agentPresentation(kind: OperatorSessionEventKind, payload: Record<string, unknown>): OperatorEventPresentation {
  const label = invocationLabel(payload);
  const durationMs = readNumber(payload.durationMs);
  const titles: Record<string, string> = {
    agent_invocation_requested: "Agent invocation requested",
    agent_invocation_prompt_admitted: "Agent prompt admitted",
    agent_invocation_prompt_recovered: "Agent prompt recovered",
    agent_invocation_started: "Agent invocation started",
    agent_invocation_completed: "Agent invocation completed",
    agent_invocation_failed: "Agent invocation failed",
    agent_invocation_cancelled: "Agent invocation cancelled",
  };
  const routeSummary = invocationRouteSummary(payload);
  const terminalSummary = readString(payload.resultSummary)
    ?? readString(payload.errorMessage)
    ?? readString(payload.errorCode)
    ?? readString(payload.reason)
    ?? readString(payload.cancelledBy);
  const summary = terminalSummary
    ? `${routeSummary} · ${terminalSummary}`
    : durationMs !== null
      ? `${routeSummary} · ${durationMs}ms`
      : routeSummary;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Agent", label);
  addItem(details, "Prompt admission", payload.promptAdmissionId);
  addItem(details, "Delivery", payload.deliveryMode);
  addItem(details, "Delivery state", payload.deliveryState);
  addItem(details, "Previous delivery state", payload.previousDeliveryState);
  addItem(details, "Prompt", payload.inputSummary);
  addItem(details, "Wake requested", payload.wakeRequested);
  addItem(details, "Access", payload.access);
  addItem(details, "Provider", asRecord(payload.providerRoute)?.providerId);
  addItem(details, "Model", asRecord(payload.providerRoute)?.model);
  addItem(details, "Surface", asRecord(payload.providerRoute)?.surface);
  addManagedInvocationContextDetails(details, payload, { includeResolution: true });
  addItem(details, "Adapter", payload.adapterKind);
  addItem(details, "Execution", payload.executionMode);
  addItem(details, "Authority", payload.authorityProfileId);
  addManagedCapabilitySnapshotDetails(details, payload);
  addItem(details, "Invocation ID", payload.invocationId);
  addItem(details, "Parent turn", payload.parentTurnId);
  if (!asRecord(payload.capabilitySnapshot)?.routeId) {
    addItem(details, "Route ID", payload.routeId);
  }
  if (!asRecord(payload.capabilitySnapshot)?.routeSource) {
    addItem(details, "Route source", payload.routeSource);
  }
  addItem(details, "Requested by", payload.requestedBy);
  addItem(details, "Source", payload.requestSource ?? payload.source);
  addItem(details, "Attempt", readNumber(payload.attempt));
  addItem(details, "Duration", durationMs !== null ? `${durationMs} ms` : null);
  addItem(details, "Result", payload.resultSummary ?? payload.result);
  addItem(details, "Error", payload.errorMessage ?? payload.errorCode);
  addItem(details, "Reason", payload.reason);
  addItem(details, "Recovery reason", payload.recoveryReason);
  addItem(details, "Recovered at", payload.recoveredAt);
  addPrimitiveItems(
    details,
    payload,
    8,
    ["agentName", "agentType", "agentId", "promptAdmissionId", "deliveryMode", "deliveryState", "previousDeliveryState", "admissionState", "inputSummary", "promptHash", "wakeRequested", "access", "providerRoute", "invocationContext", "adapterKind", "executionMode", "authorityProfileId", "capabilitySnapshot", "managedInvocationEvidence", "invocationId", "parentTurnId", "routeId", "routeSource", "requestedBy", "requestSource", "source", "attempt", "durationMs", "resultSummary", "result", "errorMessage", "errorCode", "reason", "recoveryReason", "recoveredAt", "cancelledBy"],
  );
  return {
    title: titles[kind] ?? "Agent invocation",
    summary,
    compactText: summary,
    tone: kind === "agent_invocation_started"
      ? "running"
      : kind === "agent_invocation_failed"
        ? "error"
        : kind === "agent_invocation_cancelled"
          ? "warning"
          : kind === "agent_invocation_completed"
            ? "success"
            : "info",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: kind === "agent_invocation_completed"
      ? "result"
      : kind === "agent_invocation_failed" || kind === "agent_invocation_cancelled"
        ? "exception"
        : "none",
  };
}

const ECONOMIC_LIFECYCLE_TITLES: Record<string, string> = {
  denied: "Economic route denied",
  held: "Economic route committed",
  "dispatch-fenced": "Economic dispatch fenced",
  "settlement-pending": "Economic settlement pending",
  released: "Economic reservation released",
  "release-failed": "Economic release failed",
  leaked: "Economic reservation leaked",
};

const ECONOMIC_LIFECYCLE_TONES: Record<string, OperatorEventTone> = {
  denied: "error",
  held: "info",
  "dispatch-fenced": "running",
  "settlement-pending": "running",
  released: "success",
  "release-failed": "error",
  leaked: "warning",
};

function economicRouteLabel(route: Record<string, unknown> | null): string | null {
  const providerId = readString(route?.providerId);
  if (!providerId) {
    return null;
  }
  const modelId = readString(route?.modelId);
  return modelId ? `${providerId}/${modelId}` : providerId;
}

function economicLifecyclePresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const transition = readString(payload.transition) ?? "unknown";
  const policyId = readString(payload.policyId);
  const routeLabel = economicRouteLabel(asRecord(payload.selectedRoute));
  const settlementKind = readString(payload.settlementKind);
  const reason = readString(payload.reason);
  const summaryParts = [
    policyId ?? "economic policy",
    routeLabel,
    settlementKind ? `settlement: ${settlementKind}` : null,
    reason,
  ].filter((value): value is string => value !== null && value !== undefined);
  const summary = summaryParts.join(" · ");
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Job", payload.jobId);
  addItem(details, "Attempt", payload.economicAttemptId);
  addItem(details, "Transition", transition);
  addItem(details, "Policy", policyId);
  addItem(details, "Policy revision", payload.policyRevision);
  addItem(details, "Commitment", payload.commitmentId);
  addItem(details, "Reservation", payload.reservationId);
  addItem(details, "Dispatch fence", payload.dispatchFenceId);
  addItem(details, "Route", routeLabel);
  addItem(details, "Account", asRecord(payload.selectedAccount)?.kind);
  addItem(details, "Settlement", settlementKind);
  addItem(details, "Settlement authority", payload.settlementAuthority);
  addItem(details, "Reason", reason);
  // Deliberately no `addPrimitiveItems` fallback. Every field this payload declares is rendered
  // explicitly above, so a denylisted dump could only ever surface fields nobody decided to show -
  // which is how an unanticipated producer field, or a secret-shaped one, reaches the operator
  // without a decision. Absence must be provable here, and a denylist can only exclude what was
  // anticipated. New economic fields get an explicit `addItem` line or they are not rendered.
  return {
    title: ECONOMIC_LIFECYCLE_TITLES[transition] ?? "Economic lifecycle event",
    summary,
    compactText: summary,
    tone: ECONOMIC_LIFECYCLE_TONES[transition] ?? "info",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function continuityPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const runtimeContinuity = asRecord(payload.runtimeContinuity);
  const decision = readString(payload.decision) ?? readString(runtimeContinuity?.strategy);
  const reason = readString(payload.reason) ?? readString(runtimeContinuity?.selectionReason);
  const summary = `${decision ?? "Continuity decided"}${reason ? ` · ${reason}` : ""}`;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Decision", decision);
  addItem(details, "Reason", reason);
  addItem(details, "Strategy", runtimeContinuity?.strategy);
  addItem(details, "Selection", runtimeContinuity?.selectionReason);
  addItem(details, "Feedback", runtimeContinuity?.feedbackLabel);
  addItem(details, "Provider", payload.provider);
  return {
    title: "Continuity decided",
    summary,
    compactText: summary,
    tone: "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function providerRequestPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const request = asRecord(payload.request);
  if (!request) {
    return {
      title: "Provider request evidence unavailable",
      summary: "Canonical provider-request evidence is missing or invalid",
      compactText: "Provider request evidence unavailable",
      tone: "warning",
      details: [],
      surfaces: ACTIVITY_SURFACES,
      conversationDisposition: "none",
    };
  }
  const dispatch = asRecord(request.dispatch);
  const attempt = asRecord(dispatch?.attempt);
  const retry = asRecord(dispatch?.retry);
  const usage = asRecord(request.usage);
  const input = asRecord(usage?.input);
  const output = asRecord(usage?.output);
  const cacheRead = asRecord(usage?.cacheRead);
  const cacheWrite = asRecord(usage?.cacheWrite);
  const capacity = asRecord(request.capacity);
  const deliberation = asRecord(request.deliberation);
  const authority = asRecord(request.authority);
  const provider = readString(request.providerId) ?? "Unknown provider";
  const model = readString(request.modelId) ?? "Unknown model";
  const outcome = readString(dispatch?.outcome) ?? "unknown";
  const attemptNumber = attempt?.state === "observed" ? readNumber(attempt.value) : null;
  const inputTokens = readNumber(input?.tokens);
  const outputTokens = readNumber(output?.tokens);
  const route = readString(request.routeId);
  const summary = [
    `${provider}/${model}`,
    attemptNumber === null ? "attempt unknown" : `attempt ${attemptNumber}`,
    outcome,
    inputTokens === null || outputTokens === null ? "usage unknown" : `${inputTokens}â†‘ ${outputTokens}â†“`,
  ].join(" Â· ");
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", provider);
  addItem(details, "Model", model);
  addItem(details, "Route", route);
  addItem(
    details,
    "Deliberation",
    deliberation?.state === "observed"
      ? [readString(deliberation.selectedLevel), readString(deliberation.status)].filter(Boolean).join(" / ")
      : "unknown",
  );
  addItem(
    details,
    "Authority",
    authority?.state === "observed"
      ? [readString(authority.requestedAuthority), readString(authority.admittedAuthority)].filter(Boolean).join(" / ")
      : "unknown",
  );
  addItem(details, "Request", readNumber(request.requestIndex) === null ? null : readNumber(request.requestIndex)! + 1);
  addItem(details, "Attempt", attemptNumber);
  addItem(details, "Retry", retry?.state === "observed" ? retry.value : "unknown");
  addItem(details, "Outcome", outcome);
  addItem(details, "Response status", readNumber(dispatch?.responseStatus));
  addItem(details, "Input tokens", inputTokens ?? "unknown");
  addItem(details, "Output tokens", outputTokens ?? "unknown");
  addItem(details, "Cache read tokens", readNumber(cacheRead?.tokens) ?? "unknown");
  addItem(details, "Cache write tokens", readNumber(cacheWrite?.tokens) ?? "unknown");
  addItem(details, "Capacity", readString(capacity?.state));
  return {
    title: outcome === "failed" ? "Provider request failed" : "Provider request observed",
    summary,
    compactText: summary,
    tone: outcome === "failed" ? "error" : capacity?.state === "overflow" ? "warning" : "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

const TERMINAL_OUTCOME_LABELS = {
  completed: "Completed",
  paused: "Paused",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

const TERMINAL_DISPOSITIONS = {
  completion_eligible: { outcome: "completed", label: "Completion eligible" },
  provider_request_limit: { outcome: "paused", label: "Provider request limit reached" },
  tool_round_limit: { outcome: "paused", label: "Tool round limit reached" },
  tool_call_limit: { outcome: "paused", label: "Tool call limit reached" },
  cumulative_input_limit: { outcome: "paused", label: "Cumulative input limit reached" },
  elapsed_time_limit: { outcome: "paused", label: "Elapsed time limit reached" },
  active_time_limit: { outcome: "paused", label: "Active time limit reached" },
  recovery_limit: { outcome: "paused", label: "Recovery limit reached" },
  no_progress: { outcome: "paused", label: "No progress detected" },
  observation_unavailable: { outcome: "paused", label: "Convergence observation unavailable" },
  required_producer_not_run: { outcome: "paused", label: "Required producer was not run" },
  required_producer_unavailable: { outcome: "failed", label: "Required producer unavailable" },
  required_producer_execution_failed: { outcome: "failed", label: "Required producer failed" },
  required_producer_invalid_evidence: { outcome: "failed", label: "Required producer returned invalid evidence" },
  managed_invocation_state_transition_required: { outcome: "failed", label: "Managed invocation transition required" },
  governed_work_materialization_required: { outcome: "failed", label: "Governed work materialization required" },
  governed_work_incomplete: { outcome: "failed", label: "Governed work is incomplete" },
  outer_authority_denied: { outcome: "failed", label: "Outer authority denied the turn" },
  runtime_failure: { outcome: "failed", label: "Runtime failure" },
  external_harness_completed: { outcome: "completed", label: "Native harness completed" },
  external_harness_failed: { outcome: "failed", label: "Native harness failed" },
  session_not_active: { outcome: "paused", label: "Session is not active" },
  operator_cancelled: { outcome: "cancelled", label: "Cancelled by operator" },
  runtime_cancelled: { outcome: "cancelled", label: "Cancelled by runtime" },
} as const;

type TerminalOutcome = keyof typeof TERMINAL_OUTCOME_LABELS;
type TerminalDispositionReason = keyof typeof TERMINAL_DISPOSITIONS;

function readTerminalOutcome(value: unknown): TerminalOutcome | null {
  return value === "completed" || value === "paused" || value === "failed" || value === "cancelled"
    ? value
    : null;
}

function readTerminalDispositionReason(value: unknown): TerminalDispositionReason | null {
  return typeof value === "string" && Object.hasOwn(TERMINAL_DISPOSITIONS, value)
    ? value as TerminalDispositionReason
    : null;
}

function invalidTurnCompletedPresentation(): OperatorEventPresentation {
  const summary = "Typed terminal disposition unavailable";
  return {
    title: "Turn disposition unavailable",
    summary,
    compactText: summary,
    tone: "error",
    details: [{ label: "Terminal disposition", value: "Unavailable" }],
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "exception",
  };
}

function terminalDispositionSummary(
  outcome: TerminalOutcome,
  reason: TerminalDispositionReason,
  routeSummary: string | undefined,
): string {
  const summary = `${TERMINAL_OUTCOME_LABELS[outcome]} · ${TERMINAL_DISPOSITIONS[reason].label} (${reason})`;
  return routeSummary ? `${summary} · ${routeSummary}` : summary;
}

function appendConvergencePresentation(
  details: OperatorEventDetailItem[],
  convergence: Record<string, unknown> | null,
): void {
  const policy = asRecord(convergence?.policy);
  addItem(details, "Convergence policy", policy?.policyId);
  addItem(details, "Convergence policy hash", policy?.configurationHash);

  const pause = asRecord(convergence?.pause);
  if (pause?.status !== "pause") return;

  const reason = readTerminalDispositionReason(pause.reason);
  addItem(
    details,
    "Convergence pause",
    reason ? `${TERMINAL_DISPOSITIONS[reason].label} (${reason})` : undefined,
  );
  addItem(details, "Convergence metric", pause.metric);
  if (pause.reason === "observation_unavailable") {
    addItem(details, "Convergence unknown reason", pause.unknownReason);
    return;
  }
  addItem(details, "Convergence observed", readNumber(pause.observed));
  addItem(details, "Convergence limit", readNumber(pause.limit));
}

function completionObligationLabel(obligation: Record<string, unknown>): string | null {
  return readString(obligation.canonicalToolId)
    ?? readString(obligation.canonicalProducerId)
    ?? readString(obligation.sourceAlias)
    ?? readString(obligation.obligationId);
}

function requiredProducerStatus(value: unknown): string | null {
  return value === "accepted"
    || value === "unavailable"
    || value === "not_run"
    || value === "execution_failed"
    || value === "invalid_evidence"
    ? value
    : null;
}

function completionEvidenceItems(value: unknown, unmet: boolean): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    if (!item) return [];
    const label = completionObligationLabel(item);
    const status = requiredProducerStatus(item.status);
    if (!label || !status) return [];
    return [`${label}: ${status}${unmet ? "" : " (evidence)"}`];
  });
}

function appendCompletionPresentation(
  details: OperatorEventDetailItem[],
  completion: Record<string, unknown> | null,
): void {
  const eligibility = asRecord(completion?.eligibility);
  const status = eligibility?.status === "eligible" || eligibility?.status === "ineligible"
    ? eligibility.status
    : null;
  addItem(details, "Completion eligibility", status);

  const unmetItems = completionEvidenceItems(eligibility?.unmet, true);
  addItem(details, "Unmet completion obligations", unmetItems.length > 0 ? unmetItems.join(", ") : undefined);

  const producerEvidence = completionEvidenceItems(completion?.producerEvidence, false);
  addItem(details, "Producer evidence", producerEvidence.length > 0 ? producerEvidence.join(", ") : undefined);
}

function turnCompletedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const runtimeContinuity = asRecord(payload.runtimeContinuity);
  const authorityStatus = asRecord(payload.authorityStatus);
  const provider = providerIdentity(payload);
  const routeSummary = [provider.provider, provider.model].filter((value): value is string => Boolean(value)).join(" · ");
  const outcome = readTerminalOutcome(payload.outcome);
  const dispositionReason = readTerminalDispositionReason(payload.dispositionReason);
  if (outcome === null || dispositionReason === null || TERMINAL_DISPOSITIONS[dispositionReason].outcome !== outcome) {
    return invalidTurnCompletedPresentation();
  }

  const summary = terminalDispositionSummary(
    outcome,
    dispositionReason,
    routeSummary || undefined,
  );
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", provider.provider);
  addItem(details, "Model", provider.model);
  addItem(details, "Outcome", outcome);
  addItem(details, "Disposition reason", dispositionReason);
  addItem(details, "Continuity", runtimeContinuity?.strategy);
  addItem(details, "Why", runtimeContinuity?.selectionReason);
  addItem(details, "Authority", authorityStatus?.effective);
  const externalHarness = asRecord(payload.externalHarness);
  addItem(details, "External harness", externalHarness?.harness);
  addItem(details, "Input tokens", readNumber(payload.inputTokens));
  addItem(details, "Output tokens", readNumber(payload.outputTokens));
  appendCompletionPresentation(details, asRecord(payload.completion));
  appendConvergencePresentation(details, asRecord(payload.convergence));

  const title = `Turn ${TERMINAL_OUTCOME_LABELS[outcome].toLowerCase()}`;
  return {
    title,
    summary,
    compactText: summary,
    tone: outcome === "completed"
      ? "success"
      : outcome === "paused"
        ? "warning"
        : outcome === "failed"
          ? "error"
          : "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: outcome === "completed" ? "result" : "exception",
  };
}

function genericPresentation(kind: OperatorSessionEventKind, payload: Record<string, unknown>): OperatorEventPresentation {
  const details: OperatorEventDetailItem[] = [];
  addPrimitiveItems(details, payload, 6);
  const title = labelFromKey(kind);
  return {
    title,
    summary: eventPayloadText(payload) ?? undefined,
    compactText: eventPayloadText(payload) ?? title,
    tone: kind === "error_recorded" ? "error" : "info",
    details,
    surfaces: kind === "error_recorded" ? INLINE_ACTIVITY_SURFACES : ACTIVITY_SURFACES,
    conversationDisposition: kind === "error_recorded" ? "exception" : "none",
  };
}

function workItemPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const item = asRecord(payload.workItem);
  const summary = readString(item?.summary) ?? "Governed work item updated";
  const status = readString(item?.status) ?? "unknown";
  const operation = readString(payload.operation) ?? "update";
  const missingEvidence = workItemMissingEvidence(payload, item);
  const missingGoalEvidence = readStringList(payload.missingGoalEvidence);
  const missingVerificationGates = readStringList(payload.missingVerificationGates);
  const failedVerificationGates = readStringList(payload.failedVerificationGates);
  const missingResidualRisk = payload.missingResidualRisk === true || item?.missingResidualRisk === true;
  const hasMissingCloseout = missingEvidence.length > 0
    || missingGoalEvidence.length > 0
    || missingVerificationGates.length > 0
    || failedVerificationGates.length > 0
    || missingResidualRisk;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Work item", item?.id);
  addItem(details, "Resource", workItemResourceUri(readString(item?.id)));
  addItem(details, "Status", status);
  addItem(details, "Workflow", item?.workflowProfile);
  addItem(details, "Risk", item?.risk);
  addItem(details, "Surface", item?.surface);
  addItem(details, "Agent profile", item?.assignedAgentProfile);
  addItem(details, "Authority", item?.authority);
  addItem(details, "Access", item?.access);
  addItem(details, "Reference roots", readStringList(item?.referenceRoots).join(", "));
  addItem(details, "Expected evidence", Array.isArray(item?.expectedEvidence) ? item.expectedEvidence.join(", ") : undefined);
  addItem(details, "Provided evidence", Array.isArray(item?.providedEvidence) ? item.providedEvidence.join(", ") : undefined);
  addItem(details, "Missing evidence", missingEvidence.join(", "));
  addItem(details, "Missing goal evidence", missingGoalEvidence.join(", "));
  addItem(details, "Missing verification gates", missingVerificationGates.join(", "));
  addItem(details, "Failed verification gates", failedVerificationGates.join(", "));
  addItem(details, "Missing residual risk", missingResidualRisk);

  return {
    title: status === "completed" ? "Work item completed" : "Work item updated",
    summary: `${status} · ${summary}`,
    compactText: `${operation}: ${status} · ${summary}`,
    tone: hasMissingCloseout
      ? "warning"
      : status === "completed"
      ? "success"
      : status === "blocked"
        ? "warning"
        : "info",
    details,
    surfaces: ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

function workItemExecutionPresentation(
  kind: OperatorSessionEventKind,
  payload: Record<string, unknown>,
): OperatorEventPresentation {
  const item = asRecord(payload.workItem);
  const attempt = asRecord(payload.attempt);
  const summary = readString(item?.summary) ?? "Governed work item execution";
  const status = readString(attempt?.status) ?? readString(item?.status) ?? "unknown";
  const executionMode = readString(attempt?.executionMode) ?? "unknown";
  const missingEvidence = workItemMissingEvidence(payload, item);
  const missingGoalEvidence = readStringList(payload.missingGoalEvidence);
  const missingVerificationGates = readStringList(payload.missingVerificationGates);
  const failedVerificationGates = readStringList(payload.failedVerificationGates);
  const missingResidualRisk = payload.missingResidualRisk === true || item?.missingResidualRisk === true;
  const hasMissingCloseout = missingEvidence.length > 0
    || missingGoalEvidence.length > 0
    || missingVerificationGates.length > 0
    || failedVerificationGates.length > 0
    || missingResidualRisk;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Work item", item?.id);
  addItem(details, "Resource", workItemResourceUri(readString(item?.id)));
  addItem(details, "Attempt", attempt?.id);
  addItem(details, "Status", status);
  addItem(details, "Execution mode", executionMode);
  addItem(details, "Managed invocation", attempt?.managedInvocationId);
  addItem(details, "Authority", item?.authority);
  addItem(details, "Access", item?.access);
  addItem(details, "Reference roots", readStringList(item?.referenceRoots).join(", "));
  addItem(details, "Started", attempt?.startedAt);
  addItem(details, "Completed", attempt?.completedAt);
  addItem(details, "Missing evidence", missingEvidence.join(", "));
  addItem(details, "Missing goal evidence", missingGoalEvidence.join(", "));
  addItem(details, "Missing verification gates", missingVerificationGates.join(", "));
  addItem(details, "Failed verification gates", failedVerificationGates.join(", "));
  addItem(details, "Missing residual risk", missingResidualRisk);

  return {
    title: kind === "work_item_execution_started"
      ? "Work item execution started"
      : status === "completed"
        ? "Work item execution completed"
        : "Work item execution finished",
    summary: `${status} · ${executionMode} · ${summary}`,
    compactText: `${status} · ${executionMode} · ${summary}`,
    tone: hasMissingCloseout
      ? "warning"
      : status === "started"
      ? "running"
      : status === "completed"
        ? "success"
        : status === "failed"
          ? "error"
          : status === "blocked" || status === "cancelled"
            ? "warning"
            : "info",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: hasMissingCloseout || status === "failed" || status === "blocked" || status === "cancelled"
      ? "exception"
      : "none",
  };
}

function workItemResourceUri(id: string | null): string | undefined {
  return id ? `kiln://session/work-items/${encodeURIComponent(id)}` : undefined;
}

function workItemMissingEvidence(
  payload: Record<string, unknown>,
  item: Record<string, unknown> | null,
): readonly string[] {
  const provided = readStringList(item?.providedEvidence);
  const derived = readStringList(item?.expectedEvidence).filter((evidence) => !provided.includes(evidence));
  return [...new Set([
    ...readStringList(payload.missingEvidence),
    ...readStringList(item?.missingEvidence),
    ...derived,
    ...(payload.missingResidualRisk === true || item?.missingResidualRisk === true ? ["residual-risk"] : []),
  ])];
}

function goalPresentation(kind: OperatorSessionEventKind, payload: Record<string, unknown>): OperatorEventPresentation {
  const goal = asRecord(payload.goal);
  const authority = asRecord(goal?.authorityEnvelope);
  const routePolicy = asRecord(goal?.routePolicy);
  const source = asRecord(goal?.source);
  const status = readString(goal?.status) ?? "unknown";
  const objective = readString(goal?.objective) ?? "Governed goal";
  const summary = `${status} · ${compactText(objective)}`;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Goal", goal?.id);
  addItem(details, "Status", status);
  addItem(
    details,
    "Source",
    source?.kind === "approved_plan"
      ? `Approved plan ${readString(source.planId) ?? "unknown"}`
      : source?.kind === "operator_direct"
        ? `Operator turn ${readString(source.turnId) ?? "unknown"}`
        : undefined,
  );
  addItem(details, "Work items", Array.isArray(goal?.workItemIds) ? goal.workItemIds.join(", ") : undefined);
  addItem(details, "Workflow", routePolicy?.workflowProfile);
  addItem(details, "Authority", authority?.maximumAuthority);
  addItem(details, "Escalation", authority?.escalationPolicy);
  addItem(details, "Reason", payload.reason ?? goal?.terminalReason);
  addItem(details, "Closeout", payload.closeoutSummary ?? goal?.closeoutSummary);

  return {
    title: status === "completed"
      ? "Goal completed"
      : status === "failed"
        ? "Goal failed"
        : status === "cancelled"
          ? "Goal cancelled"
          : kind === "goal.created"
            ? "Goal created"
            : "Goal updated",
    summary,
    compactText: summary,
    tone: status === "completed"
      ? "success"
      : status === "failed"
        ? "error"
        : status === "cancelled"
          ? "warning"
          : "info",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: status === "completed"
      ? "result"
      : status === "failed" || status === "cancelled"
        ? "exception"
        : "none",
  };
}

function workItemsMaterializedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const materialization = asRecord(payload.materialization);
  const workItemIds = readStringList(materialization?.workItemIds);
  const created = readStringList(materialization?.createdWorkItemIds);
  const reused = readStringList(materialization?.reusedWorkItemIds);
  const summary = `${workItemIds.length} work items · plan ${readString(materialization?.planId) ?? "unknown"}`;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Materialization", materialization?.id);
  addItem(details, "Plan", materialization?.planId);
  addItem(details, "Plan hash", materialization?.planHash);
  addItem(details, "Approval", materialization?.approvalId);
  addItem(details, "Goal", materialization?.goalRunId);
  addItem(details, "Work items", workItemIds.join(", "));
  addItem(details, "Created", created.join(", "));
  addItem(details, "Reused", reused.join(", "));
  return {
    title: "Work items materialized",
    summary,
    compactText: summary,
    tone: "success",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
    conversationDisposition: "none",
  };
}

export function operatorEventTargetsSurface(
  presentation: Pick<OperatorEventPresentation, "surfaces">,
  surface: OperatorEventSurface,
): boolean {
  return presentation.surfaces.includes(surface);
}

export function operatorEventTargetsConversation(
  presentation: Pick<OperatorEventPresentation, "conversationDisposition">,
): boolean {
  return presentation.conversationDisposition !== "none";
}

export function presentOperatorEventPayload(
  kind: OperatorSessionEventKind,
  payload: Record<string, unknown>,
): OperatorEventPresentation {
  switch (kind) {
    case "specification_submitted":
      return specificationSubmittedPresentation(payload);
    case "clarification_recorded":
      return clarificationRecordedPresentation(payload);
    case "plan_submitted":
      return planSubmittedPresentation(payload);
    case "plan_analysis_reported":
      return planAnalysisReportedPresentation(payload);
    case "plan_approved":
      return planApprovedPresentation(payload);
    case "provider_routed":
      return providerRoutedPresentation(payload);
    case "multimodal_routed":
      return multimodalRoutedPresentation(payload);
    case "tool_call_started":
      return toolStartedPresentation(payload);
    case "tool_call_output_delta":
      return toolOutputDeltaPresentation(payload);
    case "tool_call_completed":
      return toolCompletedPresentation(payload);
    case "file_changed":
      return fileChangedPresentation(payload);
    case "cost_updated":
      return costUpdatedPresentation(payload);
    case "lifecycle_attribution_recorded":
      return lifecycleAttributionPresentation(payload);
    case "provider_request_observed":
      return providerRequestPresentation(payload);
    case "effective_prompt_observed":
      return effectivePromptPresentation(payload);
    case "goal.created":
    case "goal.updated":
    case "goal.completed":
    case "goal.failed":
    case "goal.cancelled":
      return goalPresentation(kind, payload);
    case "work_items.materialized":
      return workItemsMaterializedPresentation(payload);
    case "work_item_updated":
      return workItemPresentation(payload);
    case "work_item_execution_started":
    case "work_item_execution_finished":
      return workItemExecutionPresentation(kind, payload);
    case "approval_requested":
      return approvalRequestedPresentation(payload);
    case "approval_resolved":
      return approvalResolvedPresentation(payload);
    case "config_change_proposed":
    case "config_change_approved":
    case "config_change_applied":
    case "config_change_failed":
      return configChangePresentation(kind, payload);
    case "agent_invocation_requested":
    case "agent_invocation_prompt_admitted":
    case "agent_invocation_prompt_recovered":
    case "agent_invocation_started":
    case "agent_invocation_completed":
    case "agent_invocation_failed":
    case "agent_invocation_cancelled":
      return agentPresentation(kind, payload);
    case "managed_economic_lifecycle":
      return economicLifecyclePresentation(payload);
    case "continuity_decided":
      return continuityPresentation(payload);
    case "turn_completed":
      return turnCompletedPresentation(payload);
    default:
      return genericPresentation(kind, payload);
  }
}

export function presentOperatorSessionEvent(
  event: Pick<OperatorSessionEvent, "kind" | "payload">,
): OperatorEventPresentation {
  return presentOperatorEventPayload(event.kind, event.payload);
}
