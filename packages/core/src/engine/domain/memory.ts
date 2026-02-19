// Engine primitive: Memory -- unified scoped storage
// Scopes enable multi-team, multi-agent memory isolation

/** Scope-based access control for memory */
export type MemoryScope =
  | "user"
  | `agent:${string}`
  | `team:${string}`
  | `project:${string}`
  | "org";

/** A single entry in the memory system */
export interface MemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly metadata?: Record<string, unknown>;
}

/** Unified storage interface with scope-based access */
export interface Memory {
  store(scope: MemoryScope, entry: MemoryEntry): Promise<string>;
  recall(scope: MemoryScope, query: string, budget?: number): Promise<MemoryEntry[]>;
  forget(scope: MemoryScope, id: string): Promise<void>;
}
