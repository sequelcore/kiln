import { describe, it, expect, beforeEach } from "vitest";
import { EventBus } from "../../src/events/event-bus.js";
import type {
  MemoryEntry,
  MemorySearchResult,
  MemoryStore,
} from "../../src/memory/index.js";
import { MemoryManager } from "../../src/memory/memory-manager.js";
import type { MemorySavedEvent, MemoryRecalledEvent } from "../../src/events/index.js";

/** In-memory mock of MemoryStore (no bun:sqlite dependency). */
class MockMemoryStore implements MemoryStore {
  readonly entries: MemoryEntry[] = [];
  decayApplied = false;
  closed = false;

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">,
  ): Promise<string> {
    const id = `mock-${crypto.randomUUID()}`;
    const now = new Date();
    this.entries.push({
      ...entry,
      id,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    });
    return id;
  }

  async search(
    query: string,
    limit?: number,
  ): Promise<readonly MemorySearchResult[]> {
    const maxResults = limit ?? 10;
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

    const scored: MemorySearchResult[] = [];
    for (const entry of this.entries) {
      const lower = entry.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) score++;
      }
      if (score > 0) {
        scored.push({ entry, score, snippet: entry.content.slice(0, 100) });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
  }

  async recall(query: string, tokenBudget: number): Promise<string> {
    const results = await this.search(query, 50);
    const parts: string[] = [];
    let tokensUsed = 0;

    for (const result of results) {
      const tokenEstimate = Math.ceil(result.entry.content.length / 4);
      if (tokensUsed + tokenEstimate > tokenBudget) break;
      parts.push(result.entry.content);
      tokensUsed += tokenEstimate;
    }

    return parts.join("\n\n");
  }

  async forget(id: string): Promise<void> {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx !== -1) this.entries.splice(idx, 1);
  }

  applyDecay(_factor?: number): void {
    this.decayApplied = true;
  }

  close(): void {
    this.closed = true;
  }
}

describe("MemoryManager", () => {
  let userStore: MockMemoryStore;
  let workerStore: MockMemoryStore;
  let architectStore: MockMemoryStore;
  let projectStore: MockMemoryStore;
  let eventBus: EventBus;
  let manager: MemoryManager;

  beforeEach(() => {
    userStore = new MockMemoryStore();
    workerStore = new MockMemoryStore();
    architectStore = new MockMemoryStore();
    projectStore = new MockMemoryStore();
    eventBus = new EventBus();

    manager = new MemoryManager({
      userStore,
      agentStores: new Map([
        ["worker", workerStore],
        ["architect", architectStore],
      ]),
      projectStore,
      eventBus,
    }, "test-session");
  });

  describe("save", () => {
    it("routes user entries to userStore", async () => {
      await manager.save({ layer: "user", content: "user preference", tags: ["pref"] });
      expect(userStore.entries).toHaveLength(1);
      expect(userStore.entries[0]!.content).toBe("user preference");
      expect(workerStore.entries).toHaveLength(0);
      expect(projectStore.entries).toHaveLength(0);
    });

    it("routes agent entries to correct agent store", async () => {
      await manager.save({
        layer: "agent",
        content: "worker pattern",
        tags: ["pattern"],
        agentRole: "worker",
      });
      expect(workerStore.entries).toHaveLength(1);
      expect(architectStore.entries).toHaveLength(0);

      await manager.save({
        layer: "agent",
        content: "architect decision",
        tags: ["arch"],
        agentRole: "architect",
      });
      expect(architectStore.entries).toHaveLength(1);
    });

    it("routes project entries to projectStore", async () => {
      await manager.save({ layer: "project", content: "project note", tags: ["note"] });
      expect(projectStore.entries).toHaveLength(1);
      expect(projectStore.entries[0]!.content).toBe("project note");
    });

    it("throws for unknown agent role", async () => {
      await expect(
        manager.save({
          layer: "agent",
          content: "unknown",
          tags: [],
          agentRole: "optimizer",
        }),
      ).rejects.toThrow("No agent store for role: optimizer");
    });

    it("emits memory_saved event", async () => {
      const events: MemorySavedEvent[] = [];
      eventBus.on("memory_saved", (e) => events.push(e));

      const id = await manager.save({
        layer: "user",
        content: "test content",
        tags: ["tag1", "tag2"],
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.memoryId).toBe(id);
      expect(events[0]!.layer).toBe("user");
      expect(events[0]!.tags).toEqual(["tag1", "tag2"]);
      expect(events[0]!.sessionId).toBe("test-session");
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await userStore.save({ layer: "user", content: "react component patterns", tags: ["react"] });
      await workerStore.save({ layer: "agent", content: "react testing strategies", tags: ["test"], agentRole: "worker" });
      await projectStore.save({ layer: "project", content: "project uses react and vue", tags: ["stack"] });
    });

    it("searches all layers when no layer specified", async () => {
      const results = await manager.search("react");
      expect(results.length).toBe(3);
    });

    it("searches only specified layer", async () => {
      const results = await manager.searchByLayer("react", "user");
      expect(results.length).toBe(1);
      expect(results[0]!.entry.content).toContain("component");
    });

    it("merges results sorted by score", async () => {
      const results = await manager.search("react");
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });

    it("respects limit", async () => {
      const results = await manager.search("react", 2);
      expect(results.length).toBe(2);
    });

    it("emits memory_recalled event", async () => {
      const events: MemoryRecalledEvent[] = [];
      eventBus.on("memory_recalled", (e) => events.push(e));

      await manager.search("react");

      expect(events).toHaveLength(1);
      expect(events[0]!.query).toBe("react");
      expect(events[0]!.resultsCount).toBe(3);
    });

    it("searches agent layer across all agent stores", async () => {
      await architectStore.save({
        layer: "agent",
        content: "react architecture decisions",
        tags: ["arch"],
        agentRole: "architect",
      });

      const results = await manager.searchByLayer("react", "agent");
      expect(results.length).toBe(2); // worker + architect
    });
  });

  describe("recall", () => {
    beforeEach(async () => {
      // Each entry is ~10 tokens (40 chars / 4)
      await userStore.save({ layer: "user", content: "User memory about react components here", tags: ["react"] });
      await workerStore.save({ layer: "agent", content: "Worker memory about react testing here", tags: ["react"], agentRole: "worker" });
      await projectStore.save({ layer: "project", content: "Project memory about react stack info", tags: ["react"] });
    });

    it("returns formatted output with layer headers", async () => {
      const result = await manager.recall("react", 2000);
      expect(result).toContain("--- User Memory ---");
      expect(result).toContain("--- Agent Memory (worker) ---");
      expect(result).toContain("--- Project Memory ---");
    });

    it("includes content from all layers", async () => {
      const result = await manager.recall("react", 2000);
      expect(result).toContain("User memory about react");
      expect(result).toContain("Worker memory about react");
      expect(result).toContain("Project memory about react");
    });

    it("respects total token budget", async () => {
      // With budget=10, 40% user=4 tokens, 30% agent=3 tokens, 30% project=3 tokens
      // Each entry is ~10 tokens, so none should fit in their budget
      const result = await manager.recall("react", 10);
      expect(result).toBe("");
    });

    it("omits empty layer sections", async () => {
      const result = await manager.recall("nonexistent query", 2000);
      expect(result).toBe("");
    });
  });

  describe("forget", () => {
    it("removes entry from correct store", async () => {
      const id = await manager.save({ layer: "user", content: "forget me", tags: [] });
      expect(userStore.entries).toHaveLength(1);

      await manager.forget(id);
      expect(userStore.entries).toHaveLength(0);
    });

    it("tries all stores (no error if not found)", async () => {
      await expect(manager.forget("nonexistent-id")).resolves.not.toThrow();
    });
  });

  describe("applyDecay", () => {
    it("calls applyDecay on all agent stores", () => {
      manager.applyDecay();
      expect(workerStore.decayApplied).toBe(true);
      expect(architectStore.decayApplied).toBe(true);
    });

    it("does not call applyDecay on user or project stores", () => {
      manager.applyDecay();
      expect(userStore.decayApplied).toBe(false);
      expect(projectStore.decayApplied).toBe(false);
    });
  });

  describe("close", () => {
    it("closes all stores", () => {
      manager.close();
      expect(userStore.closed).toBe(true);
      expect(workerStore.closed).toBe(true);
      expect(architectStore.closed).toBe(true);
      expect(projectStore.closed).toBe(true);
    });
  });
});
