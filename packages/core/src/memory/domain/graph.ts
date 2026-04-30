import type { MemoryLayerKind } from "./record.js";
import type { MemoryRelationType } from "./relation.js";
import type { MemoryScope } from "./scope.js";

export interface MemoryGraphNode {
  readonly id: string;
  readonly recordId: string;
  readonly layer: MemoryLayerKind;
  readonly scope: MemoryScope;
  readonly label: string;
  readonly score?: number;
}

export interface MemoryGraphEdge {
  readonly id: string;
  readonly sourceRecordId: string;
  readonly targetRecordId: string;
  readonly relationType: MemoryRelationType;
}

export interface MemoryGraphLimits {
  readonly maxNodes: number;
  readonly maxEdges: number;
}

export interface MemoryGraphSnapshot {
  readonly nodes: readonly MemoryGraphNode[];
  readonly edges: readonly MemoryGraphEdge[];
  readonly limits: MemoryGraphLimits;
  readonly truncated: boolean;
}

export function createMemoryGraphSnapshot(input: {
  readonly nodes: readonly MemoryGraphNode[];
  readonly edges: readonly MemoryGraphEdge[];
  readonly limits: MemoryGraphLimits;
}): MemoryGraphSnapshot {
  assertPositiveLimit(input.limits.maxNodes, "maxNodes");
  assertPositiveLimit(input.limits.maxEdges, "maxEdges");

  const nodes = [...input.nodes]
    .sort(compareNodes)
    .slice(0, input.limits.maxNodes);
  const retainedRecordIds = new Set(nodes.map((node) => node.recordId));
  const eligibleEdges = input.edges
    .filter((edge) => retainedRecordIds.has(edge.sourceRecordId) && retainedRecordIds.has(edge.targetRecordId))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = eligibleEdges.slice(0, input.limits.maxEdges);

  return {
    nodes,
    edges,
    limits: input.limits,
    truncated: nodes.length < input.nodes.length || edges.length < eligibleEdges.length || eligibleEdges.length < input.edges.length,
  };
}

function compareNodes(left: MemoryGraphNode, right: MemoryGraphNode): number {
  const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  return left.id.localeCompare(right.id);
}

function assertPositiveLimit(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Memory graph ${name} must be a positive integer`);
  }
}
