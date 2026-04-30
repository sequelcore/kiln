import {
  createMemoryGraphSnapshot,
  type MemoryGraphEdge,
  type MemoryGraphLimits,
  type MemoryGraphNode,
  type MemoryGraphSnapshot,
  type MemoryLayerKind,
  type MemoryRecord,
  type MemoryRelationType,
  type MemoryScope,
} from "../domain/index.js";
import type {
  MemoryRecordQuery,
  MemoryRepository,
} from "../repository.js";

const DEFAULT_GRAPH_LIMITS: MemoryGraphLimits = {
  maxNodes: 50,
  maxEdges: 100,
};

const MAX_SEED_QUERY_LIMIT = 500;
const MAX_RELATION_SCAN_LIMIT = 1_001;

export interface MemoryGraphProjectorOptions {
  readonly repository: MemoryRepository;
}

export interface MemoryGraphProjectInput {
  readonly rootRecordIds?: readonly string[];
  readonly depth?: number;
  readonly scope?: MemoryScope;
  readonly layer?: MemoryLayerKind;
  readonly query?: string;
  readonly tags?: readonly string[];
  readonly relationTypes?: readonly MemoryRelationType[];
  readonly limits?: Partial<MemoryGraphLimits>;
}

interface QueuedRecord {
  readonly record: MemoryRecord;
  readonly depth: number;
}

export class MemoryGraphProjector {
  private readonly repository: MemoryRepository;

  constructor(options: MemoryGraphProjectorOptions) {
    this.repository = options.repository;
  }

  project(input: MemoryGraphProjectInput = {}): MemoryGraphSnapshot {
    const limits = normalizeLimits(input.limits);
    const depth = normalizeDepth(input.depth);
    const relationTypes = input.relationTypes ? new Set(input.relationTypes) : undefined;
    const tags = normalizeTags(input.tags ?? []);
    const nodes = new Map<string, MemoryGraphNode>();
    const edges = new Map<string, MemoryGraphEdge>();
    const visited = new Set<string>();
    const enqueued = new Set<string>();
    const queue = this.seedQueue(input, Math.min(limits.maxNodes + 1, MAX_SEED_QUERY_LIMIT), tags);
    let truncated = explicitRootCount(input) > limits.maxNodes || queue.length > limits.maxNodes;
    if (queue.length > limits.maxNodes) {
      queue.length = limits.maxNodes;
    }

    for (const item of queue) {
      this.addNode(nodes, item.record, item.score);
      enqueued.add(item.record.id);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.record.id)) continue;
      visited.add(current.record.id);
      if (current.depth >= depth) continue;

      const remainingEdgeSlots = limits.maxEdges - edges.size;
      if (remainingEdgeSlots <= 0) {
        truncated = true;
        break;
      }
      const relationRows = [...this.repository.listRelations(current.record.id, { limit: MAX_RELATION_SCAN_LIMIT })];
      if (relationRows.length >= MAX_RELATION_SCAN_LIMIT) {
        truncated = true;
      }
      const relations = relationRows
        .filter((relation) => !relationTypes || relationTypes.has(relation.type))
        .sort((left, right) => left.id.localeCompare(right.id));

      for (const relation of relations) {
        if (edges.size >= limits.maxEdges) {
          truncated = true;
          break;
        }
        if (relation.target.kind !== "memory_record") continue;
        const target = this.repository.getRecord(relation.target.id);
        if (!target || !recordMatches(target, input, tags)) continue;

        const targetExists = nodes.has(target.id);
        if (!targetExists && nodes.size >= limits.maxNodes) {
          truncated = true;
          continue;
        }

        this.addNode(nodes, target);
        edges.set(relation.id, {
          id: relation.id,
          sourceRecordId: relation.sourceRecordId,
          targetRecordId: target.id,
          relationType: relation.type,
        });
        if (!enqueued.has(target.id)) {
          enqueued.add(target.id);
          queue.push({ record: target, depth: current.depth + 1 });
        }
      }
    }

    const snapshot = createMemoryGraphSnapshot({
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      limits,
    });
    return {
      ...snapshot,
      truncated: snapshot.truncated || truncated,
    };
  }

  private seedQueue(
    input: MemoryGraphProjectInput,
    maxSeedCount: number,
    tags: readonly string[],
  ): Array<QueuedRecord & { readonly score?: number }> {
    if (input.rootRecordIds && input.rootRecordIds.length > 0) {
      return [...new Set(input.rootRecordIds)]
        .slice(0, maxSeedCount)
        .map((recordId) => this.repository.getRecord(recordId))
        .filter((record): record is MemoryRecord => record !== undefined && recordMatches(record, input, tags))
        .sort(compareRecords)
        .map((record) => ({ record, depth: 0, score: 1 }));
    }

    const query: MemoryRecordQuery = {
      scope: input.scope,
      layer: input.layer,
      tags,
      limit: maxSeedCount,
    };

    if (input.query && input.query.trim().length > 0) {
      const results = [...this.repository.searchRecords({ ...query, query: input.query })];
      return results.map((result, index) => ({
        record: result.record,
        depth: 0,
        score: results.length - index,
      }));
    }

    return this.repository.listRecords(query)
      .map((record) => ({ record, depth: 0 }));
  }

  private addNode(nodes: Map<string, MemoryGraphNode>, record: MemoryRecord, score?: number): void {
    if (nodes.has(record.id)) return;
    nodes.set(record.id, {
      id: `memory:${record.id}`,
      recordId: record.id,
      layer: record.layer,
      scope: record.scope,
      label: createNodeLabel(record),
      score,
    });
  }
}

function normalizeLimits(limits: Partial<MemoryGraphLimits> | undefined): MemoryGraphLimits {
  return {
    maxNodes: limits?.maxNodes ?? DEFAULT_GRAPH_LIMITS.maxNodes,
    maxEdges: limits?.maxEdges ?? DEFAULT_GRAPH_LIMITS.maxEdges,
  };
}

function explicitRootCount(input: MemoryGraphProjectInput): number {
  return input.rootRecordIds ? new Set(input.rootRecordIds).size : 0;
}

function normalizeDepth(depth: number | undefined): number {
  if (depth === undefined) return 0;
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error("Memory graph depth must be a non-negative integer");
  }
  return depth;
}

function recordMatches(record: MemoryRecord, input: MemoryGraphProjectInput, tags: readonly string[]): boolean {
  if (input.scope && (record.scope.kind !== input.scope.kind || record.scope.id !== input.scope.id)) {
    return false;
  }
  if (input.layer && record.layer !== input.layer) {
    return false;
  }
  if (!tags.every((tag) => record.tags.includes(tag))) {
    return false;
  }
  return true;
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}

function compareRecords(left: MemoryRecord, right: MemoryRecord): number {
  return left.id.localeCompare(right.id);
}

function createNodeLabel(record: MemoryRecord): string {
  if (record.topicKey && record.topicKey.trim().length > 0) {
    return record.topicKey.trim();
  }
  const firstLine = record.content.split("\n").find((line) => line.trim().length > 0)?.trim();
  return firstLine ?? record.id;
}
