import type { AgentRole } from "../agents/index.js";
import type { EventBus } from "../events/event-bus.js";
import type { MemorySavedEvent, MemoryRecalledEvent } from "../events/index.js";
import type {
  MemoryEntry,
  MemoryLayer,
  MemorySearchResult,
  MemoryStore,
} from "./index.js";

export interface MemoryManagerOptions {
  readonly userStore: MemoryStore;
  readonly agentStores: Map<AgentRole, MemoryStore>;
  readonly projectStore: MemoryStore;
  readonly eventBus: EventBus;
}

/**
 * Coordinates all three memory layers with unified search and token budgets.
 * Routes saves to the correct store, merges cross-layer search results,
 * and implements progressive disclosure via recall().
 */
export class MemoryManager implements MemoryStore {
  private readonly userStore: MemoryStore;
  private readonly agentStores: Map<AgentRole, MemoryStore>;
  private readonly projectStore: MemoryStore;
  private readonly eventBus: EventBus;
  private readonly sessionId: string;

  constructor(options: MemoryManagerOptions, sessionId?: string) {
    this.userStore = options.userStore;
    this.agentStores = options.agentStores;
    this.projectStore = options.projectStore;
    this.eventBus = options.eventBus;
    this.sessionId = sessionId ?? "";
  }

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">,
  ): Promise<string> {
    const store = this.resolveStore(entry.layer, entry.agentRole);
    const id = await store.save(entry);

    const savedEvent: MemorySavedEvent = {
      type: "memory_saved",
      timestamp: new Date(),
      sessionId: this.sessionId,
      memoryId: id,
      layer: entry.layer,
      tags: entry.tags,
    };
    this.eventBus.emit(savedEvent);

    return id;
  }

  async search(
    query: string,
    layer?: MemoryLayer,
    limit?: number,
  ): Promise<readonly MemorySearchResult[]> {
    const maxResults = limit ?? 10;
    let results: MemorySearchResult[];

    if (layer !== undefined) {
      results = [...await this.searchLayer(layer, query, maxResults)];
    } else {
      const [userResults, projectResults, ...agentResults] = await Promise.all([
        this.userStore.search(query, "user", maxResults),
        this.projectStore.search(query, "project", maxResults),
        ...Array.from(this.agentStores.values()).map((s) =>
          s.search(query, "agent", maxResults),
        ),
      ]);

      results = [
        ...(userResults ?? []),
        ...(projectResults ?? []),
        ...agentResults.flat(),
      ];

      results.sort((a, b) => b.score - a.score);
      results = results.slice(0, maxResults);
    }

    const recalledEvent: MemoryRecalledEvent = {
      type: "memory_recalled",
      timestamp: new Date(),
      sessionId: this.sessionId,
      query,
      resultsCount: results.length,
    };
    this.eventBus.emit(recalledEvent);

    return results;
  }

  async recall(query: string, tokenBudget: number): Promise<string> {
    const userBudget = Math.floor(tokenBudget * 0.4);
    const agentBudget = Math.floor(tokenBudget * 0.3);
    const projectBudget = Math.floor(tokenBudget * 0.3);

    const [userText, projectText, ...agentTexts] = await Promise.all([
      this.userStore.recall(query, userBudget),
      this.projectStore.recall(query, projectBudget),
      ...Array.from(this.agentStores.entries()).map(([role, store]) =>
        store.recall(query, agentBudget).then((text) => ({ role, text })),
      ),
    ]);

    const parts: string[] = [];

    if (typeof userText === "string" && userText.length > 0) {
      parts.push(`--- User Memory ---\n${userText}`);
    }

    for (const item of agentTexts) {
      const agentItem = item as { role: AgentRole; text: string };
      if (agentItem.text.length > 0) {
        parts.push(`--- Agent Memory (${agentItem.role}) ---\n${agentItem.text}`);
      }
    }

    if (typeof projectText === "string" && projectText.length > 0) {
      parts.push(`--- Project Memory ---\n${projectText}`);
    }

    return parts.join("\n\n");
  }

  async forget(id: string): Promise<void> {
    const stores: MemoryStore[] = [
      this.userStore,
      this.projectStore,
      ...this.agentStores.values(),
    ];

    await Promise.all(stores.map((s) => s.forget(id)));
  }

  applyDecay(factor?: number): void {
    for (const store of this.agentStores.values()) {
      const sqliteStore = store as { applyDecay?: (factor?: number) => void };
      if (typeof sqliteStore.applyDecay === "function") {
        sqliteStore.applyDecay(factor);
      }
    }
  }

  close(): void {
    const allStores = [
      this.userStore,
      this.projectStore,
      ...this.agentStores.values(),
    ];
    for (const store of allStores) {
      const closeable = store as { close?: () => void };
      if (typeof closeable.close === "function") {
        closeable.close();
      }
    }
  }

  private resolveStore(
    layer: MemoryLayer,
    agentRole?: AgentRole,
  ): MemoryStore {
    switch (layer) {
      case "user":
        return this.userStore;
      case "agent": {
        const role = agentRole ?? "worker";
        const store = this.agentStores.get(role);
        if (!store) {
          throw new Error(`No agent store for role: ${role}`);
        }
        return store;
      }
      case "project":
        return this.projectStore;
    }
  }

  private async searchLayer(
    layer: MemoryLayer,
    query: string,
    limit: number,
  ): Promise<readonly MemorySearchResult[]> {
    switch (layer) {
      case "user":
        return this.userStore.search(query, "user", limit);
      case "agent": {
        const allResults: MemorySearchResult[] = [];
        for (const store of this.agentStores.values()) {
          const results = await store.search(query, "agent", limit);
          allResults.push(...results);
        }
        allResults.sort((a, b) => b.score - a.score);
        return allResults.slice(0, limit);
      }
      case "project":
        return this.projectStore.search(query, "project", limit);
    }
  }
}
