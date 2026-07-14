import type { MemoryProvenance } from "./record.js";

export const MEMORY_REVISION_KINDS = [
  "created",
  "corrected",
  "extended",
  "contradicted",
  "superseded",
  "noop",
] as const;

export type MemoryRevisionKind = typeof MEMORY_REVISION_KINDS[number];

export interface MemoryRevision {
  readonly id: string;
  readonly recordId: string;
  readonly parentRevisionId?: string;
  readonly sequence: number;
  readonly kind: MemoryRevisionKind;
  readonly content: string;
  readonly provenance: MemoryProvenance;
  readonly reason?: string;
  readonly createdAt: string;
}

export function validateMemoryRevisionLineage<T extends readonly MemoryRevision[]>(revisions: T): T {
  if (revisions.length === 0) {
    return revisions;
  }

  const recordId = revisions[0]!.recordId;
  let previous: MemoryRevision | undefined;

  for (const revision of revisions) {
    if (revision.recordId !== recordId) {
      throw new Error("Memory revision lineage cannot mix records");
    }

    if (!Number.isInteger(revision.sequence) || revision.sequence < 1) {
      throw new Error("Memory revision sequence must be a positive integer");
    }

    if (!previous) {
      if (revision.sequence !== 1) {
        throw new Error("Memory revision lineage must start at sequence 1");
      }
      if (revision.parentRevisionId !== undefined) {
        throw new Error("First memory revision cannot have a parent");
      }
    } else {
      if (revision.sequence !== previous.sequence + 1) {
        throw new Error("Memory revision sequence must be contiguous");
      }
      if (revision.parentRevisionId !== previous.id) {
        throw new Error("Memory revision parent must reference the previous revision");
      }
    }

    previous = revision;
  }

  return revisions;
}
