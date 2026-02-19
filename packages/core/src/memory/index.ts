import type { AgentRole } from "../agents/index.js";

/** Memory layer identifier */
export type MemoryLayer = "user" | "agent" | "project";

/** A single memory entry */
export interface MemoryEntry {
  readonly id: string;
  readonly layer: MemoryLayer;
  readonly content: string;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly lastAccessedAt: Date;
  readonly accessCount: number;
  readonly agentRole?: AgentRole;
  readonly projectId?: string;
}

/** Memory search result with relevance score */
export interface MemorySearchResult {
  readonly entry: MemoryEntry;
  readonly score: number;
  readonly snippet: string;
}

/** Memory store interface */
export interface MemoryStore {
  save(entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">): Promise<string>;
  search(query: string, layer?: MemoryLayer, limit?: number): Promise<readonly MemorySearchResult[]>;
  recall(query: string, tokenBudget: number): Promise<string>;
  forget(id: string): Promise<void>;
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
