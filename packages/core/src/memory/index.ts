import type { AgentRole } from "../agents/index.js";

/** Memory layer identifier */
export type MemoryLayer = "user" | "agent" | "project";

/** A single memory entry */
export interface MemoryEntry {
  readonly id: string;
  readonly layer: MemoryLayer;
  readonly content: string;
  readonly tags: readonly string[];
  readonly topicKey?: string;
  readonly revisionCount?: number;
  readonly lastSeenAt?: Date;
  readonly createdAt: Date;
  readonly lastAccessedAt: Date;
  readonly accessCount: number;
  readonly agentRole?: AgentRole;
  readonly projectId?: string;
}

/** Memory search result with relevance score */
export interface MemorySearchResult {
  readonly entry: MemoryEntry;
  readonly score?: number;
  readonly snippet?: string;
}

/** Memory store interface */
export interface MemoryStore {
  save(entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount" | "revisionCount" | "lastSeenAt">): Promise<string>;
  search(query: string, limit?: number): Promise<readonly MemorySearchResult[]>;
  recall(query: string, tokenBudget: number): Promise<string>;
  forget(id: string): Promise<void>;
  applyDecay?(factor?: number): void;
  close?(): void;
}

export { SqliteMemoryStore } from "./sqlite-store.js";
export type { SqliteMemoryStoreOptions } from "./sqlite-store.js";
export { ProjectMemoryStore, stripPrivateTags } from "./project-store.js";
export { MemoryManager } from "./memory-manager.js";
export type { MemoryManagerOptions } from "./memory-manager.js";
export { getDeveloperIdentity, generateDeveloperId } from "./developer-identity.js";
export type { DeveloperIdentity } from "./developer-identity.js";
export { ChunkImporter } from "./chunk-importer.js";
export type { ImportResult } from "./chunk-importer.js";
export { GitSyncManager } from "./git-sync-manager.js";
export type { SyncStatus, DeveloperInfo } from "./git-sync-manager.js";

// Decay curves (Phase 2D)
export { exponentialDecay, linearDecay, stepDecay, applyDecayCurve, shouldPrune, DEFAULT_DECAY_CONFIG } from "./decay-curves.js";
export type { DecayCurve, DecayConfig } from "./decay-curves.js";

// Memory compaction (Phase 2D)
export { MemoryCompactor, DEFAULT_COMPACTION_CONFIG } from "./compactor.js";
export type { CompactionConfig, CompactionResult, CompactableStore, CompactableEntry } from "./compactor.js";
export { selectContextWithinBudget } from "./context-budget.js";
export type { ContextBudgetCandidate, ContextBudgetSelection } from "./context-budget.js";
export { InMemoryContextArtifactCache } from "./context-cache.js";
export type { ContextArtifact, ContextArtifactCache } from "./context-cache.js";
export { collectResumeSignalsFromPresence } from "./resume-signals.js";
export type { ResumeSignalSet } from "./resume-signals.js";
export { decideResumePolicy } from "./resume-policy.js";
export type { ResumeFeedbackSignal, ResumePolicyDecision, ResumeStrategyKind } from "./resume-policy.js";
