import type { OperatorSessionEvent, OperatorSessionEventKind } from "./frames.js";
import {
  formatPresentationIntentAsText,
  parsePresentationIntent,
  presentationIntentBrief,
  type PresentationIntent,
  type PresentationIntentResourceLink,
} from "./presentation-intent.js";

export type OperatorEventTone = "info" | "running" | "success" | "warning" | "error";
export type OperatorEventSurface = "conversation_inline" | "activity_panel" | "inspector";

export interface OperatorEventDetailItem {
  readonly label: string;
  readonly value: string;
}

export type ToolResultOutputKind =
  | "text"
  | "markdown"
  | "code"
  | "table"
  | "tree"
  | "diff"
  | "image"
  | "resource_links"
  | "command"
  | "form"
  | "empty";

export interface ToolResultResourceLinkPresentation {
  readonly uri: string;
  readonly title?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation?: string;
}

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

export interface ToolResultPresentation {
  readonly outputKind: ToolResultOutputKind;
  readonly title: string;
  readonly summary?: string;
  readonly fields: readonly OperatorEventDetailItem[];
  readonly presentationIntent?: PresentationIntent;
  readonly preview?: ToolResultPreview;
  readonly resourceLinks?: readonly ToolResultResourceLinkPresentation[];
  readonly raw: ToolResultRawAvailability;
}

export interface OperatorEventPresentation {
  readonly title: string;
  readonly summary?: string;
  readonly tone: OperatorEventTone;
  readonly details: readonly OperatorEventDetailItem[];
  readonly compactText?: string;
  readonly surfaces: readonly OperatorEventSurface[];
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

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseToolResultEnvelope(value: string | null): {
  readonly output?: string;
  readonly isError?: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly presentationIntent?: unknown;
  readonly resourceLinks: readonly ToolResultResourceLinkPresentation[];
} | null {
  if (!value) return null;
  let output: string | undefined;
  let isError: boolean | undefined;
  let metadata: Record<string, unknown> | undefined;
  let presentationIntent: unknown;
  let resourceLinks: readonly ToolResultResourceLinkPresentation[] = [];
  let current: string | null = value;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const parsed = parseJsonRecord(current);
    if (!parsed) {
      output = current;
      break;
    }
    const result = asRecord(parsed.result) ?? parsed;
    const nextMetadata = asRecord(result.metadata);
    if (nextMetadata) {
      metadata = {
        ...(metadata ?? {}),
        ...nextMetadata,
      };
      if ("presentationIntent" in nextMetadata) {
        presentationIntent = nextMetadata.presentationIntent;
      }
      const links = readResourceLinks(nextMetadata.resourceLinks);
      if (links.length > 0) {
        resourceLinks = links;
      }
    }
    if ("presentationIntent" in result) {
      presentationIntent = result.presentationIntent;
    }
    const directLinks = readResourceLinks(result.resourceLinks);
    if (directLinks.length > 0) {
      resourceLinks = directLinks;
    }
    if (typeof result.isError === "boolean") {
      isError = result.isError;
    }
    const nextOutput = readString(result.output);
    if (!nextOutput) {
      break;
    }
    const nested = parseJsonRecord(nextOutput);
    if (!nested || (!("output" in nested) && !("result" in nested) && !("metadata" in nested))) {
      output = nextOutput;
      break;
    }
    current = nextOutput;
  }
  return {
    ...(output ? { output } : {}),
    ...(isError !== undefined ? { isError } : {}),
    ...(metadata ? { metadata } : {}),
    ...(presentationIntent !== undefined ? { presentationIntent } : {}),
    resourceLinks,
  };
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

function readResourceLinks(value: unknown): readonly ToolResultResourceLinkPresentation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      const uri = readString(record?.uri);
      if (!uri) return null;
      return {
        uri,
        ...(readString(record?.title) ? { title: readString(record?.title)! } : {}),
        ...(readString(record?.mimeType) ? { mimeType: readString(record?.mimeType)! } : {}),
        ...(readNumber(record?.size) !== null ? { size: readNumber(record?.size)! } : {}),
        ...(readString(record?.relation) ? { relation: readString(record?.relation)! } : {}),
      } satisfies ToolResultResourceLinkPresentation;
    })
    .filter((item): item is ToolResultResourceLinkPresentation => item !== null);
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
    title: resourceLinks[0]?.title ?? toolResultTitle(toolName, metadata, `${toolName} output`),
    summary,
    fields,
    resourceLinks,
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
    title: path ?? toolName,
    summary: text ? compactText(text) : fallbackSummary,
    fields,
    preview: compactPreview(text ?? (!outputRecord ? output : undefined)),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function projectTextPresentation(
  toolName: string,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
  resourceLinks: readonly ToolResultResourceLinkPresentation[],
): ToolResultPresentation {
  const text = output ?? "";
  const filePath = readString(metadata?.filePath);
  const outputKind: ToolResultOutputKind = filePath?.toLowerCase().endsWith(".md") || /^#\s/u.test(text.trim())
    ? "markdown"
    : text.trim().length === 0
      ? "empty"
      : "text";
  const fields = [
    field("Path", filePath),
    field("Lines", readMetadataNumber(metadata, "totalLines")),
    field("Bytes", readMetadataNumber(metadata, "totalBytes")),
  ].filter((item): item is OperatorEventDetailItem => item !== null);
  return {
    outputKind,
    title: toolResultTitle(toolName, metadata, toolName),
    summary: text.trim().length > 0 ? compactText(text) : "No output",
    fields,
    preview: compactPreview(text),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
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
  const text = formatPresentationIntentAsText(intent);
  return {
    outputKind: presentationIntentOutputKind(intent),
    title: intent.title,
    summary: presentationIntentBrief(intent),
    fields: presentationIntentFields(intent),
    presentationIntent: intent,
    preview: compactPreview(text, 4_000),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    raw: toolResultRawAvailability(resourceLinks),
  };
}

function readPresentationIntent(
  payload: Record<string, unknown>,
  envelope: ReturnType<typeof parseToolResultEnvelope>,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
): PresentationIntent | undefined {
  const outputRecord = parseOutputRecord(output);
  const candidates = [
    metadata?.presentationIntent,
    envelope?.presentationIntent,
    payload.presentationIntent,
    outputRecord?.presentationIntent,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const parsed = parsePresentationIntent(candidate);
    if (parsed.ok) return parsed.intent;
  }
  return undefined;
}

function projectConfigToolPresentation(toolName: string, output: string | undefined): ToolResultPresentation | undefined {
  if (!toolName.startsWith("kiln_config.") || !output) {
    return undefined;
  }
  const record = parseOutputRecord(output);
  if (!record) {
    return undefined;
  }
  const proposalId = readString(record.proposalId);
  const approvalId = readString(record.approvalId);
  const operation = readString(record.operation);
  const status = readString(record.status);
  const affectedPaths = readStringList(record.affectedCanonicalPaths);
  const appliedWrites = Array.isArray(record.appliedWrites)
    ? record.appliedWrites
      .map((write) => readString(asRecord(write)?.path))
      .filter((path): path is string => Boolean(path))
    : [];
  const diagnostics = Array.isArray(record.diagnostics) ? record.diagnostics.length : 0;
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

function projectToolResultPresentation(
  toolName: string,
  payload: Record<string, unknown>,
): ToolResultPresentation | undefined {
  const envelope = parseToolResultEnvelope(toolResultEnvelopeText(payload));
  const payloadMetadata = asRecord(payload.metadata);
  const output = envelope?.output ?? readString(payload.output) ?? readString(payload.outputSummary) ?? undefined;
  const metadata = envelope?.metadata || payloadMetadata
    ? {
        ...(envelope?.metadata ?? {}),
        ...(payloadMetadata ?? {}),
      }
    : undefined;
  const payloadResourceLinks = readResourceLinks(payloadMetadata?.resourceLinks);
  const resourceLinks = payloadResourceLinks.length > 0 ? payloadResourceLinks : envelope?.resourceLinks ?? [];
  const presentationIntent = readPresentationIntent(payload, envelope, output, metadata);
  if (!output && !metadata && resourceLinks.length === 0 && !presentationIntent) return undefined;
  if (presentationIntent) {
    return projectPresentationIntentToolPresentation(presentationIntent, resourceLinks);
  }
  const configPresentation = projectConfigToolPresentation(toolName, output);
  if (configPresentation) {
    return configPresentation;
  }
  const operation = readString(metadata?.operation);
  const kind = readString(metadata?.kind);
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
  if (operation === "read_many" && resourceLinks.length > 0) {
    return projectResourceLinkPresentation(toolName, output, metadata ?? {}, resourceLinks);
  }
  if (operation === "read" || toolName === "read") {
    return projectTextPresentation(toolName, output, metadata, resourceLinks);
  }
  if (resourceLinks.length > 0) {
    return projectResourceLinkPresentation(toolName, output, metadata ?? {}, resourceLinks);
  }
  return projectTextPresentation(toolName, output, metadata, resourceLinks);
}

function toolResultText(payload: Record<string, unknown>): string | null {
  const raw = toolResultEnvelopeText(payload);
  if (!raw) return null;
  const envelope = parseToolResultEnvelope(raw);
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
  const envelope = parseToolResultEnvelope(toolResultEnvelopeText(payload));
  return envelope?.isError === true;
}

function toolResultMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const envelope = parseToolResultEnvelope(toolResultEnvelopeText(payload));
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
  const profile = readString(metadata?.profile) ?? readString(input?.profile);
  if (!profile && !providerRoute) {
    return null;
  }
  return {
    ...(input ?? {}),
    ...(metadata ?? {}),
    ...(profile ? { profile } : {}),
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
  addItem(details, "Profile", identity.profile);
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
    addItem(details, "Route ID", identity.routeId);
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
  if (!snapshot) {
    return;
  }
  const routeHealth = asRecord(snapshot.routeHealth);
  const providerModelProof = asRecord(snapshot.providerModelProof);
  const resourcePlane = asRecord(snapshot.resourcePlane);
  const childIdentity = asRecord(snapshot.childIdentity);
  addItem(details, "Capability snapshot", snapshot.snapshotId);
  addItem(details, "Captured", snapshot.capturedAt);
  addItem(details, "Route health", routeHealth?.status);
  addItem(details, "Route health reason", routeHealth?.reason);
  addItem(details, "Provider proof", providerModelProof?.status);
  addItem(details, "Provider proof source", providerModelProof?.source);
  addItem(details, "Resource plane", resourcePlane?.available === true ? "available" : resourcePlane?.available === false ? "unavailable" : undefined);
  addItem(details, "Child identity", childIdentity?.displayName ?? childIdentity?.admittedAgentProfile ?? childIdentity?.requestedAgentProfile ?? childIdentity?.agentId);
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
  addPrimitiveItems(details, input, 10, ["toolName", "toolCallId", "input", "profile", "providerRoute", "routeId", "task", "summary", "resourceUris", "agentProfile", "skills", "contextMode", "context", "capabilitySnapshot"]);
  return {
    title: `Using ${toolName}`,
    summary: managedInvocationSummary ? `${managedInvocationSummary} · Execution in progress` : "Execution in progress",
    compactText: managedInvocationSummary ?? toolName,
    tone: "running",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
  };
}

function toolCompletedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const toolName = readString(payload.toolName) ?? "tool";
  const status = asRecord(payload.status);
  const rawStatusValue = readString(status?.state) ?? readString(payload.status);
  const isError = toolResultIsError(payload);
  const statusValue = isError ? "failed" : rawStatusValue;
  const toolPresentation = projectToolResultPresentation(toolName, payload);
  const result = toolPresentation?.summary ?? toolResultText(payload);
  const managedInvocation = managedInvocationToolIdentity(payload);
  const managedInvocationSummary = managedInvocation ? invocationRouteSummary(managedInvocation) : null;
  const summary = managedInvocationSummary && result ? `${managedInvocationSummary} · ${result}` : result;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Tool", toolName);
  addItem(details, "Tool call ID", payload.toolCallId);
  addItem(details, "Status", statusValue);
  addItem(details, "Result", result);
  if (managedInvocation) {
    addManagedInvocationToolDetails(details, managedInvocation, { includeRuntimeEvidence: true });
  }
  addPrimitiveItems(details, asRecord(payload.input), 16, ["toolName", "toolCallId", "input", "status", "result", "profile", "providerRoute", "routeId", "task", "summary", "resourceUris", "agentProfile", "skills", "contextMode", "context", "capabilitySnapshot"]);
  return {
    title: `${isError ? "Failed" : "Completed"} ${toolName}`,
    summary: summary ?? undefined,
    compactText: summary ?? managedInvocationSummary ?? toolName,
    tone: !isError && (statusValue === "succeeded" || statusValue === "success") ? "success" : "error",
    details,
    surfaces: INLINE_ACTIVITY_SURFACES,
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
  const titles: Record<string, string> = {
    config_change_proposed: "Config change proposed",
    config_change_approved: "Config change approved",
    config_change_applied: "Config change applied",
    config_change_failed: "Config change failed",
  };
  const identitySummary = [operation, status, proposalId].filter((value): value is string => Boolean(value)).join(" · ");
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
  const profile = readString(payload.profile);
  const route = providerRouteLabel(payload);
  if (profile && route) {
    return `${profile} via ${route}`;
  }
  return profile ?? route ?? invocationLabel(payload);
}

function agentPresentation(kind: OperatorSessionEventKind, payload: Record<string, unknown>): OperatorEventPresentation {
  const label = invocationLabel(payload);
  const durationMs = readNumber(payload.durationMs);
  const titles: Record<string, string> = {
    agent_invocation_requested: "Agent invocation requested",
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
  addItem(details, "Profile", payload.profile);
  addItem(details, "Provider", asRecord(payload.providerRoute)?.providerId);
  addItem(details, "Model", asRecord(payload.providerRoute)?.model);
  addItem(details, "Surface", asRecord(payload.providerRoute)?.surface);
  addManagedInvocationContextDetails(details, payload, { includeResolution: true });
  addItem(details, "Adapter", payload.adapterKind);
  addItem(details, "Execution", payload.executionMode);
  addItem(details, "Authority", payload.authorityProfileId);
  addManagedCapabilitySnapshotDetails(details, payload);
  addItem(details, "Invocation ID", payload.invocationId);
  addItem(details, "Requested by", payload.requestedBy);
  addItem(details, "Source", payload.requestSource ?? payload.source);
  addItem(details, "Attempt", readNumber(payload.attempt));
  addItem(details, "Duration", durationMs !== null ? `${durationMs} ms` : null);
  addItem(details, "Result", payload.resultSummary ?? payload.result);
  addItem(details, "Error", payload.errorMessage ?? payload.errorCode);
  addItem(details, "Reason", payload.reason);
  addPrimitiveItems(
    details,
    payload,
    8,
    ["agentName", "agentType", "agentId", "profile", "providerRoute", "invocationContext", "adapterKind", "executionMode", "authorityProfileId", "capabilitySnapshot", "invocationId", "requestedBy", "requestSource", "source", "attempt", "durationMs", "resultSummary", "result", "errorMessage", "errorCode", "reason", "cancelledBy"],
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
  };
}

function turnCompletedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const runtimeContinuity = asRecord(payload.runtimeContinuity);
  const authorityStatus = asRecord(payload.authorityStatus);
  const provider = providerIdentity(payload);
  const routeSummary = [provider.provider, provider.model].filter((value): value is string => Boolean(value)).join(" · ");
  const summary = readString(payload.outcome) ?? (routeSummary || undefined);
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", provider.provider);
  addItem(details, "Model", provider.model);
  addItem(details, "Outcome", payload.outcome);
  addItem(details, "Continuity", runtimeContinuity?.strategy);
  addItem(details, "Why", runtimeContinuity?.selectionReason);
  addItem(details, "Authority", authorityStatus?.effective);
  addItem(details, "Input tokens", readNumber(payload.inputTokens));
  addItem(details, "Output tokens", readNumber(payload.outputTokens));
  return {
    title: "Turn completed",
    summary,
    compactText: summary,
    tone: "success",
    details,
    surfaces: ACTIVITY_SURFACES,
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
  };
}

function workItemPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const item = asRecord(payload.workItem);
  const summary = readString(item?.summary) ?? "Governed work item updated";
  const status = readString(item?.status) ?? "unknown";
  const operation = readString(payload.operation) ?? "update";
  const missingEvidence = Array.isArray(payload.missingEvidence)
    ? payload.missingEvidence.flatMap((entry) => readString(entry) ? [readString(entry)!] : [])
    : [];
  const missingGoalEvidence = readStringList(payload.missingGoalEvidence);
  const failedVerificationGates = readStringList(payload.failedVerificationGates);
  const missingResidualRisk = payload.missingResidualRisk === true;
  const hasMissingCloseout = missingEvidence.length > 0
    || missingGoalEvidence.length > 0
    || failedVerificationGates.length > 0
    || missingResidualRisk;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Work item", item?.id);
  addItem(details, "Status", status);
  addItem(details, "Workflow", item?.workflowProfile);
  addItem(details, "Risk", item?.risk);
  addItem(details, "Surface", item?.surface);
  addItem(details, "Agent profile", item?.assignedAgentProfile);
  addItem(details, "Authority", item?.authorityProfile);
  addItem(details, "Expected evidence", Array.isArray(item?.expectedEvidence) ? item.expectedEvidence.join(", ") : undefined);
  addItem(details, "Provided evidence", Array.isArray(item?.providedEvidence) ? item.providedEvidence.join(", ") : undefined);
  addItem(details, "Missing evidence", missingEvidence.join(", "));
  addItem(details, "Missing goal evidence", missingGoalEvidence.join(", "));
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
  const missingEvidence = readStringList(payload.missingEvidence);
  const missingGoalEvidence = readStringList(payload.missingGoalEvidence);
  const failedVerificationGates = readStringList(payload.failedVerificationGates);
  const missingResidualRisk = payload.missingResidualRisk === true;
  const hasMissingCloseout = missingEvidence.length > 0
    || missingGoalEvidence.length > 0
    || failedVerificationGates.length > 0
    || missingResidualRisk;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Work item", item?.id);
  addItem(details, "Attempt", attempt?.id);
  addItem(details, "Status", status);
  addItem(details, "Execution mode", executionMode);
  addItem(details, "Managed invocation", attempt?.managedInvocationId);
  addItem(details, "Started", attempt?.startedAt);
  addItem(details, "Completed", attempt?.completedAt);
  addItem(details, "Missing evidence", missingEvidence.join(", "));
  addItem(details, "Missing goal evidence", missingGoalEvidence.join(", "));
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
  };
}

function goalPresentation(kind: OperatorSessionEventKind, payload: Record<string, unknown>): OperatorEventPresentation {
  const goal = asRecord(payload.goal);
  const authority = asRecord(goal?.authorityEnvelope);
  const routePolicy = asRecord(goal?.routePolicy);
  const status = readString(goal?.status) ?? "unknown";
  const objective = readString(goal?.objective) ?? "Governed goal";
  const summary = `${status} · ${compactText(objective)}`;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Goal", goal?.id);
  addItem(details, "Status", status);
  addItem(details, "Plan", goal?.planId);
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
  };
}

export function operatorEventTargetsSurface(
  presentation: Pick<OperatorEventPresentation, "surfaces">,
  surface: OperatorEventSurface,
): boolean {
  return presentation.surfaces.includes(surface);
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
    case "tool_call_started":
      return toolStartedPresentation(payload);
    case "tool_call_completed":
      return toolCompletedPresentation(payload);
    case "file_changed":
      return fileChangedPresentation(payload);
    case "cost_updated":
      return costUpdatedPresentation(payload);
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
    case "agent_invocation_started":
    case "agent_invocation_completed":
    case "agent_invocation_failed":
    case "agent_invocation_cancelled":
      return agentPresentation(kind, payload);
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
