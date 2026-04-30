import type { MemoryScope } from "./scope.js";

export const MEMORY_LAYER_KINDS = [
  "working",
  "episodic",
  "semantic",
  "procedural",
  "coordination",
  "audit",
] as const;

export type MemoryLayerKind = typeof MEMORY_LAYER_KINDS[number];

export const MEMORY_PROVENANCE_SOURCE_TYPES = [
  "session",
  "turn",
  "tool_call",
  "resource",
  "file",
  "gateway_app",
  "agent",
  "operator",
] as const;

export type MemoryProvenanceSourceType = typeof MEMORY_PROVENANCE_SOURCE_TYPES[number];

export interface MemoryProvenance {
  readonly sourceType: MemoryProvenanceSourceType;
  readonly sourceId: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly toolCallId?: string;
  readonly actor?: string;
  readonly capturedAt: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly layer: MemoryLayerKind;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly topicKey?: string;
  readonly tags: readonly string[];
  readonly provenance: MemoryProvenance;
  readonly confidence?: number;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export type MemoryContextAdmissionDecision = "admitted" | "deferred";

export interface MemoryContextAdmission {
  readonly id: string;
  readonly recordId: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly decision: MemoryContextAdmissionDecision;
  readonly reason: string;
  readonly estimatedTokens: number;
  readonly baseScore: number;
  readonly effectiveScore: number;
  readonly createdAt: string;
}

export function isMemoryLayerKind(value: string): value is MemoryLayerKind {
  return (MEMORY_LAYER_KINDS as readonly string[]).includes(value);
}
