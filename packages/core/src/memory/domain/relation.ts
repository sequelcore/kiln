export const MEMORY_RELATION_TYPES = [
  "related_to",
  "supports",
  "contradicts",
  "supersedes",
  "revises",
  "derived_from",
  "same_topic",
  "admitted_to_context",
  "linked_resource",
  "belongs_to_scope",
] as const;

export type MemoryRelationType = typeof MEMORY_RELATION_TYPES[number];

export type MemoryRelationTarget =
  | {
    readonly kind: "memory_record";
    readonly id: string;
  }
  | {
    readonly kind: "resource";
    readonly uri: string;
  };

export interface MemoryRelation {
  readonly id: string;
  readonly sourceRecordId: string;
  readonly target: MemoryRelationTarget;
  readonly type: MemoryRelationType;
  readonly reason?: string;
  readonly evidence?: readonly string[];
  readonly confidence?: number;
  readonly createdAt: string;
}

export interface MemoryRelationDraft {
  readonly id: string;
  readonly sourceRecordId: string;
  readonly target: MemoryRelationTarget;
  readonly type: MemoryRelationType;
  readonly reason?: string;
  readonly evidence?: readonly string[];
  readonly confidence?: number;
  readonly createdAt: string;
}

export function createMemoryRelation(input: MemoryRelationDraft): MemoryRelation {
  const id = requireText(input.id, "Memory relation id is required");
  const sourceRecordId = requireText(input.sourceRecordId, "Memory relation source record id is required");

  if (!isMemoryRelationType(input.type as string)) {
    throw new Error(`Unsupported memory relation type: ${input.type as string}`);
  }

  if (input.target.kind === "memory_record") {
    const targetId = requireText(input.target.id, "Memory relation target id is required");
    if (sourceRecordId === targetId) {
      throw new Error("Memory relation cannot target itself");
    }
  } else {
    requireText(input.target.uri, "Memory relation target URI is required");
  }

  if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
    throw new Error("Memory relation confidence must be between 0 and 1");
  }

  return {
    ...input,
    id,
    sourceRecordId,
  };
}

export function isMemoryRelationType(value: string): value is MemoryRelationType {
  return (MEMORY_RELATION_TYPES as readonly string[]).includes(value);
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
