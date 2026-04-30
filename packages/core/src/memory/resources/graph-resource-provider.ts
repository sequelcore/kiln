import { KilnError } from "../../engine/errors.js";
import type {
  ToolResourceDescriptor,
  ToolResourceProvider,
  ToolResourceReadResult,
  ToolResourceTemplateDescriptor,
} from "../../tools/domain/tool-resource-registry.js";
import {
  defineMemoryScope,
  isMemoryLayerKind,
  type MemoryLayerKind,
  type MemoryRecord,
  type MemoryScope,
} from "../domain/index.js";
import { MemoryGraphProjector } from "../graph/index.js";
import type { MemoryRepository } from "../repository.js";

const JSON_MIME_TYPE = "application/json";
const DEFAULT_GRAPH_NODE_LIMIT = 50;
const MAX_GRAPH_NODE_LIMIT = 500;
const DEFAULT_REVISION_LIMIT = 50;
const DEFAULT_RELATION_LIMIT = 50;
const DEFAULT_ADMISSION_LIMIT = 50;
const MAX_ADMISSION_LIMIT = 500;
const DEFAULT_PAYLOAD_BYTES = 256 * 1024;

export interface MemoryGraphResourceProviderOptions {
  readonly repository: MemoryRepository;
  readonly maxPayloadBytes?: number;
}

interface ParsedMemoryUri {
  readonly uri: string;
  readonly path: readonly string[];
  readonly query: URLSearchParams;
}

export class MemoryGraphResourceProvider implements ToolResourceProvider {
  private readonly repository: MemoryRepository;
  private readonly projector: MemoryGraphProjector;
  private readonly maxPayloadBytes: number;

  constructor(options: MemoryGraphResourceProviderOptions) {
    this.repository = options.repository;
    this.projector = new MemoryGraphProjector({ repository: options.repository });
    this.maxPayloadBytes = normalizePayloadLimit(options.maxPayloadBytes);
  }

  listResources(): readonly ToolResourceDescriptor[] {
    return [{
      uri: "kiln://memory/graph",
      name: "memory_graph",
      title: "Memory Graph",
      description: "Read-only bounded Memory Lattice graph snapshot.",
      mimeType: JSON_MIME_TYPE,
      annotations: { readOnlyHint: true },
    }];
  }

  listTemplates(): readonly ToolResourceTemplateDescriptor[] {
    return [
      {
        uriTemplate: "kiln://memory/graph{?scope,scopeKind,scopeId,layer,query,depth,limit}",
        name: "memory_graph",
        title: "Memory Graph",
        description: "Read a bounded Memory Lattice graph snapshot.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://memory/nodes/{id}{?scope,scopeKind,scopeId}",
        name: "memory_node",
        title: "Memory Node",
        description: "Read one memory record with revisions, relations, and admissions.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://memory/nodes/{id}/neighbors{?scope,scopeKind,scopeId,depth,limit}",
        name: "memory_node_neighbors",
        title: "Memory Node Neighbors",
        description: "Read a bounded graph centered on one memory record.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://memory/nodes/{id}/provenance{?scope,scopeKind,scopeId}",
        name: "memory_node_provenance",
        title: "Memory Node Provenance",
        description: "Read provenance, revision lineage, and context-admission evidence for one memory record.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://memory/relations/{id}{?scope,scopeKind,scopeId}",
        name: "memory_relation",
        title: "Memory Relation",
        description: "Read one memory relation by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://memory/admissions{?sessionId,recordId,limit}",
        name: "memory_admissions",
        title: "Memory Context Admissions",
        description: "Read bounded ContextGovernor admission evidence for memory records.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
    ];
  }

  async read(uri: string): Promise<ToolResourceReadResult | undefined> {
    const parsed = parseMemoryUri(uri);
    if (!parsed) {
      return undefined;
    }

    if (parsed.path.length === 1 && parsed.path[0] === "graph") {
      return this.readGraph(parsed);
    }
    if (parsed.path.length === 2 && parsed.path[0] === "nodes") {
      return this.readNode(parsed, parsed.path[1] ?? "");
    }
    if (parsed.path.length === 3 && parsed.path[0] === "nodes" && parsed.path[2] === "neighbors") {
      return this.readNeighbors(parsed, parsed.path[1] ?? "");
    }
    if (parsed.path.length === 3 && parsed.path[0] === "nodes" && parsed.path[2] === "provenance") {
      return this.readProvenance(parsed, parsed.path[1] ?? "");
    }
    if (parsed.path.length === 2 && parsed.path[0] === "relations") {
      return this.readRelation(parsed, parsed.path[1] ?? "");
    }
    if (parsed.path.length === 1 && parsed.path[0] === "admissions") {
      return this.readAdmissions(parsed);
    }

    throw memoryResourceError(`Memory resource not found: ${uri}`, { uri });
  }

  private readGraph(parsed: ParsedMemoryUri): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId", "layer", "query", "depth", "limit"]);
    const scope = parseScope(parsed.query);
    const limit = parsePositiveInteger(parsed.query.get("limit"), DEFAULT_GRAPH_NODE_LIMIT, MAX_GRAPH_NODE_LIMIT, "limit");
    const depth = parseNonNegativeInteger(parsed.query.get("depth"), 0, "depth");
    const layer = parseLayer(parsed.query.get("layer"));
    const query = normalizeOptionalText(parsed.query.get("query"));
    const snapshot = this.projector.project({
      ...(scope ? { scope } : {}),
      ...(layer ? { layer } : {}),
      ...(query ? { query } : {}),
      depth,
      limits: { maxNodes: limit, maxEdges: limit * 2 },
    });
    return this.json(parsed.uri, {
      snapshot,
      filters: {
        ...(scope ? { scope } : {}),
        ...(layer ? { layer } : {}),
        ...(query ? { query } : {}),
        depth,
      },
    });
  }

  private readNode(parsed: ParsedMemoryUri, recordId: string): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId"]);
    const scope = parseScope(parsed.query);
    const record = this.requireRecord(decodePathSegment(recordId, "Memory record id is required"), scope);
    const relations = this.listBoundedScopedRelations(record.id, scope, DEFAULT_RELATION_LIMIT);
    const revisions = this.listBoundedRevisions(record.id, DEFAULT_REVISION_LIMIT);
    const admissions = this.listBoundedAdmissions({ recordId: record.id }, DEFAULT_ADMISSION_LIMIT);
    return this.json(parsed.uri, {
      record,
      revisions: revisions.items,
      relations: relations.items,
      admissions: admissions.items,
      truncated: revisions.truncated || relations.truncated || admissions.truncated,
    });
  }

  private readNeighbors(parsed: ParsedMemoryUri, recordId: string): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId", "depth", "limit"]);
    const scope = parseScope(parsed.query);
    const record = this.requireRecord(decodePathSegment(recordId, "Memory record id is required"), scope);
    const limit = parsePositiveInteger(parsed.query.get("limit"), DEFAULT_GRAPH_NODE_LIMIT, MAX_GRAPH_NODE_LIMIT, "limit");
    const depth = parseNonNegativeInteger(parsed.query.get("depth"), 1, "depth");
    const snapshot = this.projector.project({
      rootRecordIds: [record.id],
      ...(scope ? { scope } : {}),
      depth,
      limits: { maxNodes: limit, maxEdges: limit * 2 },
    });
    return this.json(parsed.uri, {
      rootRecordId: record.id,
      snapshot,
    });
  }

  private readProvenance(parsed: ParsedMemoryUri, recordId: string): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId"]);
    const scope = parseScope(parsed.query);
    const record = this.requireRecord(decodePathSegment(recordId, "Memory record id is required"), scope);
    const revisions = this.listBoundedRevisions(record.id, DEFAULT_REVISION_LIMIT);
    const admissions = this.listBoundedAdmissions({ recordId: record.id }, DEFAULT_ADMISSION_LIMIT);
    return this.json(parsed.uri, {
      recordId: record.id,
      provenance: record.provenance,
      revisions: revisions.items,
      admissions: admissions.items,
      truncated: revisions.truncated || admissions.truncated,
    });
  }

  private readRelation(parsed: ParsedMemoryUri, relationId: string): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId"]);
    const scope = parseScope(parsed.query);
    const id = decodePathSegment(relationId, "Memory relation id is required");
    const relation = this.repository.getRelation(id);
    if (!relation) {
      throw memoryResourceError(`Memory resource not found: ${parsed.uri}`, { uri: parsed.uri, relationId: id });
    }
    this.requireRecord(relation.sourceRecordId, scope);
    if (relation.target.kind === "memory_record") {
      this.requireRecord(relation.target.id, scope);
    }
    return this.json(parsed.uri, { relation });
  }

  private readAdmissions(parsed: ParsedMemoryUri): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["sessionId", "recordId", "limit"]);
    const sessionId = normalizeOptionalText(parsed.query.get("sessionId"));
    const recordId = normalizeOptionalText(parsed.query.get("recordId"));
    const limit = parsePositiveInteger(parsed.query.get("limit"), DEFAULT_ADMISSION_LIMIT, MAX_ADMISSION_LIMIT, "limit");
    if (recordId) {
      this.requireRecord(recordId, undefined);
    }
    const admissions = this.listBoundedAdmissions({
      ...(sessionId ? { sessionId } : {}),
      ...(recordId ? { recordId } : {}),
    }, limit);
    return this.json(parsed.uri, {
      admissions: admissions.items,
      truncated: admissions.truncated,
    });
  }

  private listBoundedAdmissions(
    query: { readonly sessionId?: string; readonly recordId?: string },
    limit: number,
  ): { readonly items: ReturnType<MemoryRepository["listContextAdmissions"]>; readonly truncated: boolean } {
    const rows = this.repository.listContextAdmissions({
      ...query,
      limit: limit + 1,
    });
    return {
      items: rows.slice(0, limit),
      truncated: rows.length > limit,
    };
  }

  private listBoundedScopedRelations(
    recordId: string,
    scope: MemoryScope | undefined,
    limit: number,
  ): { readonly items: ReturnType<MemoryRepository["listRelations"]>; readonly truncated: boolean } {
    const rows = this.repository.listRelations(recordId, { limit: 1_001 });
    const accepted = rows.filter((relation) => (
      relation.target.kind !== "memory_record" || this.recordExistsInScope(relation.target.id, scope)
    ));
    return {
      items: accepted.slice(0, limit),
      truncated: rows.length >= 1_001 || accepted.length > limit,
    };
  }

  private recordExistsInScope(recordId: string, scope: MemoryScope | undefined): boolean {
    const record = this.repository.getRecord(recordId);
    return !!record && (!scope || scopeEquals(record.scope, scope));
  }

  private listBoundedRevisions(
    recordId: string,
    limit: number,
  ): { readonly items: ReturnType<MemoryRepository["listRevisions"]>; readonly truncated: boolean } {
    const rows = this.repository.listRevisions(recordId, { limit: limit + 1 });
    return {
      items: rows.slice(0, limit),
      truncated: rows.length > limit,
    };
  }

  private requireRecord(recordId: string, scope: MemoryScope | undefined): MemoryRecord {
    const id = recordId.trim();
    if (id.length === 0) {
      throw memoryResourceError("Memory record id is required", { recordId });
    }
    const record = this.repository.getRecord(id);
    if (!record || (scope && !scopeEquals(record.scope, scope))) {
      throw memoryResourceError(`Memory resource not found: ${id}`, { recordId: id, scope });
    }
    return record;
  }

  private json(uri: string, value: unknown): ToolResourceReadResult {
    const text = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(text, "utf8") > this.maxPayloadBytes) {
      throw memoryResourceError("Memory resource payload exceeds configured byte limit", {
        uri,
        maxPayloadBytes: this.maxPayloadBytes,
      });
    }
    return {
      contents: [{
        uri,
        mimeType: JSON_MIME_TYPE,
        text,
      }],
    };
  }
}

function parseMemoryUri(uri: string): ParsedMemoryUri | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname !== "memory") {
    return undefined;
  }
  let path: string[];
  try {
    path = parsed.pathname.split("/").filter(Boolean);
  } catch {
    throw memoryResourceError("Memory resource path segment is not valid URI encoding", { uri });
  }
  return {
    uri,
    path,
    query: parsed.searchParams,
  };
}

function decodePathSegment(segment: string, emptyMessage: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw memoryResourceError("Memory resource path segment is not valid URI encoding", { segment });
  }
  if (decoded.trim().length === 0) {
    throw memoryResourceError(emptyMessage, { segment });
  }
  return decoded;
}

function assertAllowedQuery(parsed: ParsedMemoryUri, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of parsed.query.keys()) {
    if (!allowedSet.has(key)) {
      throw memoryResourceError(`Unsupported memory resource query parameter: ${key}`, { uri: parsed.uri, key });
    }
  }
}

function parseScope(query: URLSearchParams): MemoryScope | undefined {
  const scope = normalizeOptionalText(query.get("scope"));
  const scopeKind = normalizeOptionalText(query.get("scopeKind"));
  const scopeId = normalizeOptionalText(query.get("scopeId"));
  if (scope && (scopeKind || scopeId)) {
    throw memoryResourceError("Memory resource scope must use either scope or scopeKind/scopeId", { scope, scopeKind, scopeId });
  }
  if (scope) {
    const separator = scope.indexOf(":");
    if (separator <= 0 || separator === scope.length - 1) {
      throw memoryResourceError("Memory resource scope must use kind:id format", { scope });
    }
    return defineMemoryScope({
      kind: scope.slice(0, separator),
      id: scope.slice(separator + 1),
    });
  }
  if (!scopeKind && !scopeId) return undefined;
  if (!scopeKind || !scopeId) {
    throw memoryResourceError("Memory resource scopeKind and scopeId must be provided together", { scopeKind, scopeId });
  }
  return defineMemoryScope({ kind: scopeKind, id: scopeId });
}

function parseLayer(layer: string | null): MemoryLayerKind | undefined {
  const normalized = normalizeOptionalText(layer);
  if (!normalized) return undefined;
  if (!isMemoryLayerKind(normalized)) {
    throw memoryResourceError(`Unsupported memory layer: ${normalized}`, { layer: normalized });
  }
  return normalized;
}

function parsePositiveInteger(value: string | null, fallback: number, max: number, name: string): number {
  if (value === null || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw memoryResourceError(`Memory resource ${name} must be a positive integer`, { [name]: value });
  }
  return Math.min(parsed, max);
}

function parseNonNegativeInteger(value: string | null, fallback: number, name: string): number {
  if (value === null || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw memoryResourceError(`Memory resource ${name} must be a non-negative integer`, { [name]: value });
  }
  return parsed;
}

function normalizeOptionalText(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePayloadLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAYLOAD_BYTES;
  if (!Number.isInteger(value) || value < 1) {
    throw memoryResourceError("Memory resource maxPayloadBytes must be a positive integer", { maxPayloadBytes: value });
  }
  return value;
}

function scopeEquals(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function memoryResourceError(message: string, context: Record<string, unknown>): KilnError {
  return new KilnError("INTERNAL_ERROR", message, {
    context,
    retryable: false,
  });
}
