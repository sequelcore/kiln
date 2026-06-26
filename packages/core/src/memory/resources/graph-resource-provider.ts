import { KilnError } from "../../engine/errors.js";
import type {
  ToolResourceDescriptor,
  ToolResourceProvider,
  ToolResourceReadResult,
  ToolResourceReadSummary,
  ToolResourceTemplateDescriptor,
} from "../../tools/domain/tool-resource-registry.js";
import {
  defineMemoryScope,
  evaluateMemoryReadAuthority,
  isMemoryLayerKind,
  type MemoryAuthorityPolicy,
  type MemoryAuthorityReadRequest,
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
const LIFECYCLE_TAG_PREFIX = "lifecycle:";

export interface MemoryGraphResourceProviderOptions {
  readonly repository: MemoryRepository;
  readonly maxPayloadBytes?: number;
  readonly authority?: MemoryAuthorityPolicy;
}

interface ParsedMemoryUri {
  readonly uri: string;
  readonly path: readonly string[];
  readonly query: URLSearchParams;
}

type LifecycleAdmissionDecision = "admitted" | "deferred";

interface MemoryLifecycleSummary {
  readonly tags: readonly string[];
  readonly relationTypes: readonly string[];
  readonly revisionCount: number;
  readonly admissionCount: number;
  readonly latestAdmissionDecision?: LifecycleAdmissionDecision;
}

export class MemoryGraphResourceProvider implements ToolResourceProvider {
  private readonly repository: MemoryRepository;
  private readonly projector: MemoryGraphProjector;
  private readonly maxPayloadBytes: number;
  private readonly authority: MemoryAuthorityPolicy | undefined;

  constructor(options: MemoryGraphResourceProviderOptions) {
    this.repository = options.repository;
    this.projector = new MemoryGraphProjector({ repository: options.repository });
    this.maxPayloadBytes = normalizePayloadLimit(options.maxPayloadBytes);
    this.authority = options.authority;
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
        uriTemplate: "kiln://memory/nodes/{id}/lifecycle{?scope,scopeKind,scopeId}",
        name: "memory_node_lifecycle",
        title: "Memory Node Lifecycle",
        description: "Read lifecycle summary and bounded evidence for one memory record.",
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
        uriTemplate: "kiln://memory/admissions{?sessionId,recordId,scope,scopeKind,scopeId,layer,limit}",
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
    if (parsed.path.length === 3 && parsed.path[0] === "nodes" && parsed.path[2] === "lifecycle") {
      return this.readLifecycle(parsed, parsed.path[1] ?? "");
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
    this.assertReadAuthority(parsed.uri, {
      operation: "read",
      requestedScope: scope,
      requestedLayer: layer,
      requireScope: true,
    });
    const snapshot = this.projector.project({
      ...(scope ? { scope } : {}),
      ...(layer ? { layer } : {}),
      ...(query ? { query } : {}),
      depth,
      limits: { maxNodes: limit, maxEdges: limit * 2 },
    });
    const boundedSnapshot = this.boundGraphSnapshotByAuthority(snapshot, scope, layer);
    const nodesWithLifecycle = boundedSnapshot.nodes.map((node) => {
      const record = this.repository.getRecord(node.recordId);
      if (!record) {
        return node;
      }
      return {
        ...node,
        lifecycleEvidence: this.buildLifecycleSummaryForRecord(record, scope),
      };
    });
    return this.json(parsed.uri, {
      snapshot: {
        ...boundedSnapshot,
        nodes: nodesWithLifecycle,
      },
      filters: {
        ...(scope ? { scope } : {}),
        ...(layer ? { layer } : {}),
        ...(query ? { query } : {}),
        depth,
      },
    }, summarizeMemoryGraph(boundedSnapshot, depth, limit));
  }

  private readNode(parsed: ParsedMemoryUri, recordId: string): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId"]);
    const scope = parseScope(parsed.query);
    const record = this.requireRecord(decodePathSegment(recordId, "Memory record id is required"), scope);
    this.assertReadRecordAuthorized(parsed.uri, record, scope);
    const relations = this.listBoundedScopedRelations(record.id, scope, DEFAULT_RELATION_LIMIT);
    const revisions = this.listBoundedRevisions(record.id, DEFAULT_REVISION_LIMIT);
    const admissions = this.listBoundedAdmissions({ recordId: record.id }, DEFAULT_ADMISSION_LIMIT);
    const lifecycleRevisions = this.listBoundedRecentRevisions(record.id, DEFAULT_REVISION_LIMIT);
    const lifecycleAdmissions = this.listBoundedRecentAdmissions({ recordId: record.id }, DEFAULT_ADMISSION_LIMIT);
    const lifecycle = this.buildLifecycleSummary(
      record,
      lifecycleRevisions.items,
      relations.items,
      lifecycleAdmissions.items,
    );
    return this.json(parsed.uri, {
      record,
      revisions: revisions.items,
      relations: relations.items,
      admissions: admissions.items,
      lifecycleEvidence: lifecycle,
      truncated: revisions.truncated || relations.truncated || admissions.truncated,
    });
  }

  private readLifecycle(parsed: ParsedMemoryUri, recordId: string): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId"]);
    const scope = parseScope(parsed.query);
    const record = this.requireRecord(decodePathSegment(recordId, "Memory record id is required"), scope);
    this.assertReadRecordAuthorized(parsed.uri, record, scope);
    const relations = this.listBoundedScopedRelations(record.id, scope, DEFAULT_RELATION_LIMIT);
    const revisions = this.listBoundedRecentRevisions(record.id, DEFAULT_REVISION_LIMIT);
    const admissions = this.listBoundedRecentAdmissions({ recordId: record.id }, DEFAULT_ADMISSION_LIMIT);
    const lifecycle = this.buildLifecycleSummary(record, revisions.items, relations.items, admissions.items);
    return this.json(parsed.uri, {
      recordId: record.id,
      lifecycle,
      evidence: {
        revisions: revisions.items,
        relations: relations.items,
        admissions: admissions.items,
      },
      truncated: revisions.truncated || relations.truncated || admissions.truncated,
    });
  }

  private readNeighbors(parsed: ParsedMemoryUri, recordId: string): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId", "depth", "limit"]);
    const scope = parseScope(parsed.query);
    const record = this.requireRecord(decodePathSegment(recordId, "Memory record id is required"), scope);
    this.assertReadRecordAuthorized(parsed.uri, record, scope);
    const limit = parsePositiveInteger(parsed.query.get("limit"), DEFAULT_GRAPH_NODE_LIMIT, MAX_GRAPH_NODE_LIMIT, "limit");
    const depth = parseNonNegativeInteger(parsed.query.get("depth"), 1, "depth");
    const projected = this.projector.project({
      rootRecordIds: [record.id],
      ...(scope ? { scope } : {}),
      depth,
      limits: { maxNodes: limit, maxEdges: limit * 2 },
    });
    const snapshot = this.boundGraphSnapshotByAuthority(projected, scope, undefined);
    return this.json(parsed.uri, {
      rootRecordId: record.id,
      snapshot,
    });
  }

  private readProvenance(parsed: ParsedMemoryUri, recordId: string): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["scope", "scopeKind", "scopeId"]);
    const scope = parseScope(parsed.query);
    const record = this.requireRecord(decodePathSegment(recordId, "Memory record id is required"), scope);
    this.assertReadRecordAuthorized(parsed.uri, record, scope);
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
    const sourceRecord = this.requireRecord(relation.sourceRecordId, scope);
    this.assertReadRecordAuthorized(parsed.uri, sourceRecord, scope);
    if (relation.target.kind === "memory_record") {
      const targetRecord = this.requireRecord(relation.target.id, scope);
      this.assertReadRecordAuthorized(parsed.uri, targetRecord, scope);
    }
    return this.json(parsed.uri, { relation });
  }

  private readAdmissions(parsed: ParsedMemoryUri): ToolResourceReadResult {
    assertAllowedQuery(parsed, ["sessionId", "recordId", "scope", "scopeKind", "scopeId", "layer", "limit"]);
    const sessionId = normalizeOptionalText(parsed.query.get("sessionId"));
    const recordId = normalizeOptionalText(parsed.query.get("recordId"));
    const scope = parseScope(parsed.query);
    const layer = parseLayer(parsed.query.get("layer"));
    const limit = parsePositiveInteger(parsed.query.get("limit"), DEFAULT_ADMISSION_LIMIT, MAX_ADMISSION_LIMIT, "limit");
    if (recordId) {
      const record = this.requireRecord(recordId, undefined);
      this.assertReadRecordAuthorized(parsed.uri, record, undefined);
    } else if (this.authority) {
      this.assertReadAuthority(parsed.uri, {
        operation: "read",
        requestedScope: scope,
        requestedLayer: layer,
        requireScope: true,
      });
    }
    const query = {
      ...(sessionId ? { sessionId } : {}),
      ...(recordId ? { recordId } : {}),
    };
    const admissions = this.authority && !recordId
      ? this.listBoundedAuthorizedAdmissions(query, limit, scope, layer)
      : this.listBoundedAdmissions(query, limit);
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

  private listBoundedRecentAdmissions(
    query: { readonly sessionId?: string; readonly recordId?: string },
    limit: number,
  ): { readonly items: ReturnType<MemoryRepository["listContextAdmissions"]>; readonly truncated: boolean } {
    const rows = this.repository.listContextAdmissions({
      ...query,
      limit: limit + 1,
      order: "newest_first",
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
    return !!record && (!scope || scopeEquals(record.scope, scope)) && this.isRecordReadAuthorized(record, scope);
  }

  private listBoundedAuthorizedAdmissions(
    query: { readonly sessionId?: string; readonly recordId?: string },
    limit: number,
    requestedScope: MemoryScope | undefined,
    requestedLayer: MemoryLayerKind | undefined,
  ): { readonly items: ReturnType<MemoryRepository["listContextAdmissions"]>; readonly truncated: boolean } {
    const rows = this.repository.listContextAdmissions(query);
    const authorized = rows.filter((admission) => {
      const record = this.repository.getRecord(admission.recordId);
      return !!record && evaluateMemoryReadAuthority(this.authority!, {
        operation: "read",
        requestedScope,
        requestedLayer,
        actualScope: record.scope,
        actualLayer: record.layer,
      }).allowed;
    });
    return {
      items: authorized.slice(0, limit),
      truncated: authorized.length > limit,
    };
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

  private listBoundedRecentRevisions(
    recordId: string,
    limit: number,
  ): { readonly items: ReturnType<MemoryRepository["listRevisions"]>; readonly truncated: boolean } {
    const rows = this.repository.listRevisions(recordId);
    const sorted = [...rows].sort(compareByCreatedAtThenIdDesc);
    return {
      items: sorted.slice(0, limit),
      truncated: rows.length > limit,
    };
  }

  private buildLifecycleSummaryForRecord(record: MemoryRecord, scope: MemoryScope | undefined): MemoryLifecycleSummary {
    const relations = this.listBoundedScopedRelations(record.id, scope, DEFAULT_RELATION_LIMIT);
    const revisions = this.listBoundedRecentRevisions(record.id, DEFAULT_REVISION_LIMIT);
    const admissions = this.listBoundedRecentAdmissions({ recordId: record.id }, DEFAULT_ADMISSION_LIMIT);
    return this.buildLifecycleSummary(record, revisions.items, relations.items, admissions.items);
  }

  private buildLifecycleSummary(
    record: MemoryRecord,
    revisions: ReturnType<MemoryRepository["listRevisions"]>,
    relations: ReturnType<MemoryRepository["listRelations"]>,
    admissions: ReturnType<MemoryRepository["listContextAdmissions"]>,
  ): MemoryLifecycleSummary {
    const tags = [...record.tags]
      .filter((tag) => tag.startsWith(LIFECYCLE_TAG_PREFIX))
      .sort((left, right) => left.localeCompare(right));
    const relationTypes = [...new Set(relations.map((relation) => relation.type))]
      .sort((left, right) => left.localeCompare(right));
    const latestAdmissionDecision = selectLatestAdmissionDecision(admissions);
    return {
      tags,
      relationTypes,
      revisionCount: revisions.length,
      admissionCount: admissions.length,
      ...(latestAdmissionDecision ? { latestAdmissionDecision } : {}),
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

  private assertReadAuthority(uri: string, request: MemoryAuthorityReadRequest): void {
    if (!this.authority) {
      return;
    }
    const decision = evaluateMemoryReadAuthority(this.authority, request);
    if (!decision.allowed) {
      throw memoryResourceError(decision.reason, { uri, caller: this.authority.caller });
    }
  }

  private assertReadRecordAuthorized(uri: string, record: MemoryRecord, requestedScope: MemoryScope | undefined): void {
    this.assertReadAuthority(uri, {
      operation: "read",
      requestedScope,
      actualScope: record.scope,
      actualLayer: record.layer,
    });
  }

  private isRecordReadAuthorized(record: MemoryRecord, requestedScope: MemoryScope | undefined): boolean {
    if (!this.authority) {
      return true;
    }
    return evaluateMemoryReadAuthority(this.authority, {
      operation: "read",
      requestedScope,
      actualScope: record.scope,
      actualLayer: record.layer,
    }).allowed;
  }

  private boundGraphSnapshotByAuthority(
    snapshot: ReturnType<MemoryGraphProjector["project"]>,
    requestedScope: MemoryScope | undefined,
    requestedLayer: MemoryLayerKind | undefined,
  ): ReturnType<MemoryGraphProjector["project"]> {
    if (!this.authority) {
      return snapshot;
    }
    const nodes = snapshot.nodes.filter((node) => evaluateMemoryReadAuthority(this.authority!, {
      operation: "read",
      requestedScope,
      requestedLayer,
      actualScope: node.scope,
      actualLayer: node.layer,
    }).allowed);
    const nodeIds = new Set(nodes.map((node) => node.recordId));
    const edges = snapshot.edges.filter((edge) => nodeIds.has(edge.sourceRecordId) && nodeIds.has(edge.targetRecordId));
    return {
      ...snapshot,
      nodes,
      edges,
      truncated: snapshot.truncated || nodes.length !== snapshot.nodes.length || edges.length !== snapshot.edges.length,
    };
  }

  private json(uri: string, value: unknown, summary?: ToolResourceReadSummary): ToolResourceReadResult {
    const text = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(text, "utf8") > this.maxPayloadBytes) {
      throw memoryResourceError("Memory resource payload exceeds configured byte limit", {
        uri,
        maxPayloadBytes: this.maxPayloadBytes,
      });
    }
    return {
      ...(summary ? { summary } : {}),
      contents: [{
        uri,
        mimeType: JSON_MIME_TYPE,
        text,
      }],
    };
  }
}

function summarizeMemoryGraph(
  snapshot: ReturnType<MemoryGraphProjector["project"]>,
  depth: number,
  limit: number,
): ToolResourceReadSummary {
  return {
    kind: "memory-graph",
    totalCount: snapshot.nodes.length,
    counts: {
      node: snapshot.nodes.length,
      edge: snapshot.edges.length,
      truncated: snapshot.truncated ? 1 : 0,
    },
    facets: {
      layers: uniqueSorted(snapshot.nodes.map((node) => node.layer)),
      scopeKinds: uniqueSorted(snapshot.nodes.map((node) => node.scope.kind)),
    },
    meta: {
      depth,
      limit,
    },
  };
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

function selectLatestAdmissionDecision(
  admissions: ReturnType<MemoryRepository["listContextAdmissions"]>,
): LifecycleAdmissionDecision | undefined {
  let latest = admissions[0];
  if (!latest) {
    return undefined;
  }
  for (let index = 1; index < admissions.length; index += 1) {
    const candidate = admissions[index]!;
    if (candidate.createdAt > latest.createdAt || (candidate.createdAt === latest.createdAt && candidate.id > latest.id)) {
      latest = candidate;
    }
  }
  return latest.decision;
}

function compareByCreatedAtThenIdDesc(left: { readonly createdAt: string; readonly id: string }, right: { readonly createdAt: string; readonly id: string }): number {
  if (left.createdAt === right.createdAt) {
    return right.id.localeCompare(left.id);
  }
  return right.createdAt.localeCompare(left.createdAt);
}

function scopeEquals(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function memoryResourceError(message: string, context: Record<string, unknown>): KilnError {
  return new KilnError("INTERNAL_ERROR", message, {
    context,
    retryable: false,
  });
}
