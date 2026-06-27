import { KilnError } from "../../engine/errors.js";
import type { ToolCatalogIndex } from "./tool-catalog.js";
import type { MonitorRegistry } from "../infrastructure/monitor-tools.js";
import type { AnalysisStateStore } from "../infrastructure/analysis-state-store.js";
import type { AuthorityStateStore } from "../infrastructure/authority-state-store.js";
import type { PlanStateStore } from "../infrastructure/plan-state-store.js";
import type { SpecificationStateStore } from "../infrastructure/specification-state-store.js";
import type { TaskStateStore } from "../infrastructure/task-state-tools.js";
import type { GoalRun, GoalRunStore, WorkItem, WorkItemStore } from "../../work-governance/index.js";
import { createHash } from "node:crypto";

const JSON_MIME_TYPE = "application/json";
const DEFAULT_RESOURCE_PAGE_LIMIT = 50;
const MAX_RESOURCE_PAGE_LIMIT = 100;
const DEFAULT_RESOURCE_READ_LINE_LIMIT = 100;
const MAX_RESOURCE_READ_LINE_LIMIT = 1_000;
const DEFAULT_RESOURCE_READ_BYTE_LIMIT = 64 * 1024;
const MAX_RESOURCE_READ_BYTE_LIMIT = 256 * 1024;

export interface ToolResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly annotations?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

export interface ToolResourceTemplateDescriptor {
  readonly uriTemplate: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly annotations?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

export type ToolResourceContent =
  | {
    readonly uri: string;
    readonly mimeType?: string;
    readonly text: string;
    readonly _meta?: Record<string, unknown>;
  }
  | {
    readonly uri: string;
    readonly mimeType?: string;
    readonly blob: string;
    readonly _meta?: Record<string, unknown>;
  };

export interface ToolResourceReadSummary {
  readonly kind: string;
  readonly totalCount?: number;
  readonly counts?: Record<string, number>;
  readonly facets?: Record<string, string[]>;
  readonly meta?: Record<string, unknown>;
}

export interface ToolResourceReadResult {
  readonly summary?: ToolResourceReadSummary;
  readonly contents: readonly ToolResourceContent[];
  readonly nextCursor?: string;
}

export interface ToolResourceReadTarget {
  readonly gatewayTargetId?: string;
  readonly instanceId?: string;
  readonly appId?: string;
  readonly tenantId?: string;
  readonly sessionId?: string;
  readonly eventId?: string;
  readonly resourceUri?: string;
  readonly workItemId?: string;
  readonly managedInvocationId?: string;
  readonly toolCallId?: string;
}

export interface ToolResourceReadOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly target?: ToolResourceReadTarget;
}

export type ToolResourceReadRangeUnit = "line" | "byte";

export interface ToolResourceReadRange {
  readonly unit: ToolResourceReadRangeUnit;
  readonly offset: number;
  readonly limit: number;
  readonly returned: number;
  readonly total: number;
  readonly truncated: boolean;
  readonly nextCursor?: string;
}

export interface ToolResourceListOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ToolResourcePage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface ToolResourceProvider {
  listResources(): readonly ToolResourceDescriptor[];
  listTemplates(): readonly ToolResourceTemplateDescriptor[];
  read(uri: string, options?: ToolResourceReadOptions): Promise<ToolResourceReadResult | undefined>;
}

export interface ToolResourceRegistryOptions {
  readonly catalog: ToolCatalogIndex;
  readonly taskStateStore: TaskStateStore;
  readonly analysisStateStore?: AnalysisStateStore;
  readonly authorityStateStore?: AuthorityStateStore;
  readonly planStateStore?: PlanStateStore;
  readonly specificationStateStore?: SpecificationStateStore;
  readonly workItemStore?: WorkItemStore;
  readonly goalRunStore?: GoalRunStore;
  readonly monitorRegistry: MonitorRegistry;
  readonly providers?: readonly ToolResourceProvider[];
}

export class ToolResourceRegistry {
  private readonly catalog: ToolCatalogIndex;
  private readonly taskStateStore: TaskStateStore;
  private readonly analysisStateStore?: AnalysisStateStore;
  private readonly authorityStateStore?: AuthorityStateStore;
  private readonly planStateStore?: PlanStateStore;
  private readonly specificationStateStore?: SpecificationStateStore;
  private readonly workItemStore?: WorkItemStore;
  private readonly goalRunStore?: GoalRunStore;
  private readonly monitorRegistry: MonitorRegistry;
  private readonly providers: readonly ToolResourceProvider[];

  constructor(options: ToolResourceRegistryOptions) {
    this.catalog = options.catalog;
    this.taskStateStore = options.taskStateStore;
    this.analysisStateStore = options.analysisStateStore;
    this.authorityStateStore = options.authorityStateStore;
    this.planStateStore = options.planStateStore;
    this.specificationStateStore = options.specificationStateStore;
    this.workItemStore = options.workItemStore;
    this.goalRunStore = options.goalRunStore;
    this.monitorRegistry = options.monitorRegistry;
    this.providers = options.providers ?? [];
  }

  list(): readonly ToolResourceDescriptor[] {
    return [
      {
        uri: "kiln://tools/catalog",
        name: "tool_catalog",
        title: "Tool Catalog",
        description: "Read-only snapshot of shared Kiln builtin tool catalog entries.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uri: "kiln://session/tasks",
        name: "session_tasks",
        title: "Session Tasks",
        description: "Read-only snapshot of session-local model-visible task state.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uri: "kiln://session/monitors",
        name: "session_monitors",
        title: "Session Monitors",
        description: "Read-only snapshot of session-local monitor lifecycle state.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      ...(this.planStateStore ? [{
        uri: "kiln://session/plans",
        name: "session_plans",
        title: "Session Plans",
        description: "Read-only snapshot of structured plan artifacts.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.analysisStateStore ? [{
        uri: "kiln://session/analysis-reports",
        name: "session_analysis_reports",
        title: "Session Analysis Reports",
        description: "Read-only snapshot of plan/spec consistency analysis reports.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }, {
        uri: "kiln://session/analysis-findings",
        name: "session_analysis_findings",
        title: "Session Analysis Findings",
        description: "Read-only snapshot of analysis findings and lifecycle status.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.authorityStateStore ? [{
        uri: "kiln://session/authority",
        name: "session_authority",
        title: "Session Authority",
        description: "Read-only snapshot of effective turn authority decisions for this session.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.specificationStateStore ? [{
        uri: "kiln://session/specifications",
        name: "session_specifications",
        title: "Session Specifications",
        description: "Read-only snapshot of structured specifications and validation issues.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }, {
        uri: "kiln://session/clarifications",
        name: "session_clarifications",
        title: "Session Clarifications",
        description: "Read-only snapshot of specification clarification records.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.workItemStore ? [{
        uri: "kiln://session/work-items",
        name: "session_work_items",
        title: "Session Work Items",
        description: "Read-only snapshot of governed work items, execution attempts, pause requirements, and evidence state for this session.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.goalRunStore ? [{
        uri: "kiln://session/goals",
        name: "session_goals",
        title: "Session Goals",
        description: "Read-only snapshot of durable goal-run lifecycle state for this session.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...this.providers.flatMap((provider) => provider.listResources()),
    ];
  }

  listTemplates(): readonly ToolResourceTemplateDescriptor[] {
    return [
      {
        uriTemplate: "kiln://tools/catalog/{name}",
        name: "tool_catalog_entry",
        title: "Tool Catalog Entry",
        description: "Read one shared Kiln tool catalog entry by exact tool name.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://session/tasks/{id}",
        name: "session_task",
        title: "Session Task",
        description: "Read one session-local task by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://session/monitors/{id}",
        name: "session_monitor",
        title: "Session Monitor",
        description: "Read one session-local monitor snapshot and its bounded events by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      ...(this.planStateStore ? [{
        uriTemplate: "kiln://session/plans/{id}",
        name: "session_plan",
        title: "Session Plan",
        description: "Read one structured plan artifact by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.analysisStateStore ? [{
        uriTemplate: "kiln://session/analysis-reports/{id}",
        name: "session_analysis_report",
        title: "Session Analysis Report",
        description: "Read one plan/spec consistency analysis report by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }, {
        uriTemplate: "kiln://session/analysis-findings/{id}",
        name: "session_analysis_finding",
        title: "Session Analysis Finding",
        description: "Read one analysis finding by stable id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.authorityStateStore ? [{
        uriTemplate: "kiln://session/authority/{id}",
        name: "session_authority_snapshot",
        title: "Session Authority Snapshot",
        description: "Read one effective turn authority snapshot by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.specificationStateStore ? [{
        uriTemplate: "kiln://session/specifications/{id}",
        name: "session_specification",
        title: "Session Specification",
        description: "Read one structured specification by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }, {
        uriTemplate: "kiln://session/clarifications/{specificationId}",
        name: "session_specification_clarifications",
        title: "Session Specification Clarifications",
        description: "Read clarification records for one specification id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.workItemStore ? [{
        uriTemplate: "kiln://session/work-items/{id}",
        name: "session_work_item",
        title: "Session Work Item",
        description: "Read one governed work item by id, including execution attempts, pause requirements, and evidence state.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(this.goalRunStore ? [{
        uriTemplate: "kiln://session/goals/{id}",
        name: "session_goal",
        title: "Session Goal",
        description: "Read one durable goal run by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...this.providers.flatMap((provider) => provider.listTemplates()),
    ];
  }

  listPage(options: ToolResourceListOptions = {}): ToolResourcePage<ToolResourceDescriptor> {
    return paginateResourceItems("resources", this.list(), options);
  }

  listTemplatePage(options: ToolResourceListOptions = {}): ToolResourcePage<ToolResourceTemplateDescriptor> {
    return paginateResourceItems("resourceTemplates", this.listTemplates(), options);
  }

  async read(uri: string, options: ToolResourceReadOptions = {}): Promise<ToolResourceReadResult> {
    const parsed = parseKilnResourceUri(uri);
    if (!parsed) {
      throw resourceNotFound(uri);
    }
    if (parsed.host === "tools" || parsed.host === "session") {
      rejectResourceReadCursor(uri, options);
    }

    if (parsed.host === "tools" && parsed.path.length === 1 && parsed.path[0] === "catalog") {
      const entries = this.catalog.list();
      return jsonResource(uri, {
        totalIndexed: entries.length,
        entries,
      }, summarizeToolCatalog(entries.length));
    }

    if (parsed.host === "tools" && parsed.path.length === 2 && parsed.path[0] === "catalog") {
      const name = parsed.path[1] ?? "";
      const entry = this.catalog.search({ exact: name, includeSchemas: true }).entries[0];
      if (!entry) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, entry);
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "tasks") {
      return jsonResource(uri, this.taskStateStore.snapshot());
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "tasks") {
      const id = parsed.path[1] ?? "";
      const task = this.taskStateStore.list().find((candidate) => candidate.id === id);
      if (!task) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, task);
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "monitors") {
      return jsonResource(uri, {
        monitors: this.monitorRegistry.list(),
      });
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "plans" && this.planStateStore) {
      return jsonResource(uri, this.planStateStore.snapshot());
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "plans" && this.planStateStore) {
      const id = parsed.path[1] ?? "";
      const plan = this.planStateStore.getPlan(id);
      if (!plan) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, plan);
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "analysis-reports" && this.analysisStateStore) {
      return jsonResource(uri, {
        reports: this.analysisStateStore.listReports(),
      });
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "analysis-reports" && this.analysisStateStore) {
      const id = parsed.path[1] ?? "";
      const report = this.analysisStateStore.getReport(id);
      if (!report) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, report);
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "analysis-findings" && this.analysisStateStore) {
      return jsonResource(uri, {
        findings: this.analysisStateStore.listFindings(),
      });
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "authority" && this.authorityStateStore) {
      return jsonResource(uri, this.authorityStateStore.snapshot());
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "authority" && this.authorityStateStore) {
      const id = parsed.path[1] ?? "";
      const authority = this.authorityStateStore.get(id);
      if (!authority) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, authority);
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "analysis-findings" && this.analysisStateStore) {
      const id = parsed.path[1] ?? "";
      const finding = this.analysisStateStore.getFinding(id);
      if (!finding) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, finding);
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "specifications" && this.specificationStateStore) {
      return jsonResource(uri, this.specificationStateStore.snapshot());
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "specifications" && this.specificationStateStore) {
      const id = parsed.path[1] ?? "";
      const specification = this.specificationStateStore.getSpecification(id);
      if (!specification) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, specification);
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "clarifications" && this.specificationStateStore) {
      return jsonResource(uri, {
        clarifications: this.specificationStateStore.listClarifications(),
      });
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "clarifications" && this.specificationStateStore) {
      const specificationId = parsed.path[1] ?? "";
      return jsonResource(uri, {
        specificationId,
        clarifications: this.specificationStateStore.listClarifications(specificationId),
      });
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "work-items" && this.workItemStore) {
      const snapshot = this.workItemStore.snapshot();
      const items = snapshot.items.map(projectWorkItemResource);
      return jsonResource(uri, {
        ...snapshot,
        items,
      }, summarizeWorkItems(items));
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "goals" && this.goalRunStore) {
      const snapshot = this.goalRunStore.snapshot();
      return jsonResource(uri, snapshot, summarizeGoals(snapshot.goals));
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "work-items" && this.workItemStore) {
      const id = parsed.path[1] ?? "";
      const item = this.workItemStore.list().find((candidate) => candidate.id === id);
      if (!item) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, projectWorkItemResource(item));
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "goals" && this.goalRunStore) {
      const id = parsed.path[1] ?? "";
      const goal = this.goalRunStore.get(id);
      if (!goal) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, goal);
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "monitors") {
      const id = parsed.path[1] ?? "";
      const result = this.monitorRegistry.read(id, { limit: 1_000 });
      if (!result.snapshot) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, {
        snapshot: result.snapshot,
        events: result.events,
      });
    }

    for (const provider of this.providers) {
      const result = await provider.read(uri, options);
      if (result) {
        return result;
      }
    }

    throw resourceNotFound(uri);
  }
}

export function createTextResourceReadResult(
  uri: string,
  text: string,
  mimeType: string | undefined,
  options: ToolResourceReadOptions | undefined,
  meta: Record<string, unknown> = {},
): ToolResourceReadResult {
  const lines = text.length === 0 ? [] : text.split(/\r?\n/);
  const limit = normalizeReadLimit(options?.limit, DEFAULT_RESOURCE_READ_LINE_LIMIT, MAX_RESOURCE_READ_LINE_LIMIT);
  const fingerprint = fingerprintResourceContent(uri, "line", text);
  const offset = options?.cursor
    ? decodeResourceReadCursor(options.cursor, uri, "line", fingerprint, lines.length).offset
    : 0;
  const pageLines = lines.slice(offset, offset + limit);
  const nextOffset = offset + pageLines.length;
  const nextCursor = nextOffset < lines.length
    ? encodeResourceReadCursor({ kind: "resourceRead", uri, unit: "line", offset: nextOffset, fingerprint })
    : undefined;
  const range = buildResourceReadRange("line", offset, limit, pageLines.length, lines.length, nextCursor);
  return {
    contents: [{
      uri,
      ...(mimeType ? { mimeType } : {}),
      text: pageLines.join("\n"),
      _meta: { ...meta, range },
    }],
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function createBlobResourceReadResult(
  uri: string,
  blob: string,
  mimeType: string | undefined,
  options: ToolResourceReadOptions | undefined,
  meta: Record<string, unknown> = {},
): ToolResourceReadResult {
  const bytes = Buffer.from(blob, "base64");
  const limit = normalizeReadLimit(options?.limit, DEFAULT_RESOURCE_READ_BYTE_LIMIT, MAX_RESOURCE_READ_BYTE_LIMIT);
  const fingerprint = fingerprintResourceContent(uri, "byte", bytes);
  const offset = options?.cursor
    ? decodeResourceReadCursor(options.cursor, uri, "byte", fingerprint, bytes.length).offset
    : 0;
  const pageBytes = bytes.subarray(offset, offset + limit);
  const nextOffset = offset + pageBytes.length;
  const nextCursor = nextOffset < bytes.length
    ? encodeResourceReadCursor({ kind: "resourceRead", uri, unit: "byte", offset: nextOffset, fingerprint })
    : undefined;
  const range = buildResourceReadRange("byte", offset, limit, pageBytes.length, bytes.length, nextCursor);
  return {
    contents: [{
      uri,
      ...(mimeType ? { mimeType } : {}),
      blob: pageBytes.toString("base64"),
      _meta: { ...meta, range },
    }],
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function rejectResourceReadCursor(uri: string, options: ToolResourceReadOptions | undefined): void {
  if (!options?.cursor) {
    return;
  }
  throw resourceReadCursorError("Stale resource read cursor", { uri, cursor: options.cursor });
}

type ResourceCursorKind = "resources" | "resourceTemplates";

interface DecodedResourceCursor {
  readonly kind: ResourceCursorKind;
  readonly offset: number;
  readonly fingerprint: string;
}

interface DecodedResourceReadCursor {
  readonly kind: "resourceRead";
  readonly uri: string;
  readonly unit: ToolResourceReadRangeUnit;
  readonly offset: number;
  readonly fingerprint: string;
}

function paginateResourceItems<T extends ToolResourceDescriptor | ToolResourceTemplateDescriptor>(
  kind: ResourceCursorKind,
  items: readonly T[],
  options: ToolResourceListOptions,
): ToolResourcePage<T> {
  const limit = normalizeLimit(options.limit);
  const fingerprint = fingerprintResourceItems(items);
  const offset = options.cursor ? decodeResourceCursor(options.cursor, kind, fingerprint, items.length).offset : 0;
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    ...(nextOffset < items.length ? { nextCursor: encodeResourceCursor({ kind, offset: nextOffset, fingerprint }) } : {}),
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_RESOURCE_PAGE_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (!Number.isFinite(limit) || normalized <= 0) {
    throw new KilnError("INTERNAL_ERROR", "Invalid resource page limit", {
      context: { limit },
      retryable: false,
    });
  }
  return Math.min(normalized, MAX_RESOURCE_PAGE_LIMIT);
}

function normalizeReadLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (limit === undefined) {
    return defaultLimit;
  }
  const normalized = Math.trunc(limit);
  if (!Number.isFinite(limit) || normalized <= 0) {
    throw new KilnError("INTERNAL_ERROR", "Invalid resource read limit", {
      context: { limit },
      retryable: false,
    });
  }
  return Math.min(normalized, maxLimit);
}

function encodeResourceCursor(cursor: DecodedResourceCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function encodeResourceReadCursor(cursor: DecodedResourceReadCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeResourceCursor(
  cursor: string,
  expectedKind: ResourceCursorKind,
  expectedFingerprint: string,
  itemCount: number,
): DecodedResourceCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw resourceCursorError("Invalid resource cursor", { cursor });
  }

  if (!isDecodedResourceCursor(decoded)) {
    throw resourceCursorError("Invalid resource cursor", { cursor });
  }
  if (decoded.kind !== expectedKind || decoded.fingerprint !== expectedFingerprint) {
    throw resourceCursorError("Stale resource cursor", { cursor, expectedKind });
  }
  if (decoded.offset >= itemCount) {
    throw resourceCursorError("Out-of-range resource cursor", { cursor, itemCount });
  }
  return decoded;
}

function decodeResourceReadCursor(
  cursor: string,
  expectedUri: string,
  expectedUnit: ToolResourceReadRangeUnit,
  expectedFingerprint: string,
  total: number,
): DecodedResourceReadCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw resourceReadCursorError("Invalid resource read cursor", { cursor });
  }

  if (!isDecodedResourceReadCursor(decoded)) {
    throw resourceReadCursorError("Invalid resource read cursor", { cursor });
  }
  if (
    decoded.uri !== expectedUri
    || decoded.unit !== expectedUnit
    || decoded.fingerprint !== expectedFingerprint
  ) {
    throw resourceReadCursorError("Stale resource read cursor", { cursor, expectedUri, expectedUnit });
  }
  if (decoded.offset >= total) {
    throw resourceReadCursorError("Out-of-range resource read cursor", { cursor, total });
  }
  return decoded;
}

function isDecodedResourceCursor(value: unknown): value is DecodedResourceCursor {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate["kind"] === "resources" || candidate["kind"] === "resourceTemplates") &&
    Number.isInteger(candidate["offset"]) &&
    typeof candidate["fingerprint"] === "string" &&
    (candidate["offset"] as number) >= 0
  );
}

function isDecodedResourceReadCursor(value: unknown): value is DecodedResourceReadCursor {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate["kind"] === "resourceRead"
    && typeof candidate["uri"] === "string"
    && (candidate["unit"] === "line" || candidate["unit"] === "byte")
    && Number.isInteger(candidate["offset"])
    && typeof candidate["fingerprint"] === "string"
    && (candidate["offset"] as number) >= 0
  );
}

function fingerprintResourceItems(
  items: readonly (ToolResourceDescriptor | ToolResourceTemplateDescriptor)[],
): string {
  const canonicalIds = items.map((item) => "uri" in item ? item.uri : item.uriTemplate).join("\n");
  return createHash("sha256").update(canonicalIds).digest("base64url");
}

function fingerprintResourceContent(
  uri: string,
  unit: ToolResourceReadRangeUnit,
  content: string | Buffer,
): string {
  return createHash("sha256")
    .update(uri)
    .update("\0")
    .update(unit)
    .update("\0")
    .update(content)
    .digest("base64url");
}

function buildResourceReadRange(
  unit: ToolResourceReadRangeUnit,
  offset: number,
  limit: number,
  returned: number,
  total: number,
  nextCursor: string | undefined,
): ToolResourceReadRange {
  return {
    unit,
    offset,
    limit,
    returned,
    total,
    truncated: nextCursor !== undefined,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function resourceCursorError(message: string, context: Record<string, unknown>): KilnError {
  return new KilnError("INTERNAL_ERROR", message, {
    context,
    retryable: false,
  });
}

function resourceReadCursorError(message: string, context: Record<string, unknown>): KilnError {
  return new KilnError("INTERNAL_ERROR", message, {
    context,
    retryable: false,
  });
}

function jsonResource(
  uri: string,
  value: unknown,
  summary?: ToolResourceReadSummary,
): ToolResourceReadResult {
  return {
    ...(summary ? { summary } : {}),
    contents: [{
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function summarizeToolCatalog(total: number): ToolResourceReadSummary {
  return {
    kind: "tool-catalog",
    totalCount: total,
    counts: {
      tool: total,
    },
  };
}

function summarizeWorkItems(
  items: readonly ReturnType<typeof projectWorkItemResource>[],
): ToolResourceReadSummary {
  return {
    kind: "session-work-items",
    totalCount: items.length,
    counts: {
      workItem: items.length,
      pending: countWhere(items, (item) => item.status === "pending"),
      inProgress: countWhere(items, (item) => item.status === "in_progress"),
      paused: countWhere(items, (item) => (item.pauseRequirements ?? []).some((requirement) => requirement.status === "pending")),
      completed: countWhere(items, (item) => item.status === "completed"),
      blocked: countWhere(items, (item) => item.status === "blocked"),
      cancelled: countWhere(items, (item) => item.status === "cancelled"),
      executionAttempt: sum(items, (item) => item.executionAttempts.length),
      pauseRequirement: sum(items, (item) => (item.pauseRequirements ?? []).length),
      missingEvidence: sum(items, (item) => item.missingEvidence.length),
    },
    facets: {
      workflowProfiles: uniqueSorted(items.map((item) => item.workflowProfile)),
      goalRunIds: uniqueSorted(items.map((item) => item.goalRunId).filter(isNonEmptyString)),
    },
  };
}

function summarizeGoals(goals: readonly GoalRun[]): ToolResourceReadSummary {
  return {
    kind: "session-goals",
    totalCount: goals.length,
    counts: {
      goal: goals.length,
      active: countWhere(goals, (goal) => goal.status === "active"),
      completed: countWhere(goals, (goal) => goal.status === "completed"),
      failed: countWhere(goals, (goal) => goal.status === "failed"),
      cancelled: countWhere(goals, (goal) => goal.status === "cancelled"),
      workItem: sum(goals, (goal) => goal.workItemIds.length),
      evidenceRequirement: sum(goals, (goal) => goal.evidenceRequirements.length),
    },
    facets: {
      workflowProfiles: uniqueSorted(goals.map((goal) => goal.routePolicy.workflowProfile)),
    },
  };
}

function projectWorkItemResource(item: WorkItem): WorkItem & {
  readonly resourceUri: string;
  readonly missingEvidence: readonly string[];
} {
  const missingEvidence = item.expectedEvidence.filter((evidence) => {
    if (item.providedEvidence.includes(evidence)) {
      return false;
    }
    if (evidence === "residual-risk" && item.residualRisk?.trim()) {
      return false;
    }
    return true;
  });
  return {
    ...item,
    resourceUri: `kiln://session/work-items/${encodeURIComponent(item.id)}`,
    missingEvidence,
  };
}

function countWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

function sum<T>(items: readonly T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseKilnResourceUri(uri: string): { readonly host: string; readonly path: readonly string[] } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname.length === 0) {
    return undefined;
  }
  let path: string[];
  try {
    path = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw invalidResourceUriEncoding(uri);
  }
  return {
    host: parsed.hostname,
    path,
  };
}

function invalidResourceUriEncoding(uri: string): KilnError {
  return new KilnError("INTERNAL_ERROR", "Invalid resource URI path encoding", {
    context: { uri },
    retryable: false,
  });
}

function resourceNotFound(uri: string): KilnError {
  return new KilnError("INTERNAL_ERROR", `Resource not found: ${uri}`, {
    context: { uri },
    retryable: false,
  });
}
