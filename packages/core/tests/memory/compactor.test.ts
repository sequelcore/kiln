import { describe, it, expect } from "vitest";
import { MemoryCompactor, DEFAULT_COMPACTION_CONFIG } from "../../src/memory/compactor.js";
import type { CompactableStore, CompactableEntry } from "../../src/memory/compactor.js";

/** In-memory CompactableStore for testing */
function createMockStore(entries: CompactableEntry[] = []): CompactableStore & {
  entries: CompactableEntry[];
  summaries: { content: string; tags: readonly string[] }[];
  archived: string[];
} {
  const state = {
    entries: [...entries],
    summaries: [] as { content: string; tags: readonly string[] }[],
    archived: [] as string[],
  };

  return {
    ...state,
    entryCount(): number {
      return state.entries.length;
    },
    queryOldEntries(_minAgeDays: number, limit: number): readonly CompactableEntry[] {
      // Return entries sorted by decayScore ASC (lowest first)
      return [...state.entries]
        .sort((a, b) => a.decayScore - b.decayScore)
        .slice(0, limit);
    },
    saveSummary(content: string, tags: readonly string[]): string {
      const id = `summary-${state.summaries.length}`;
      state.summaries.push({ content, tags });
      state.entries.push({ id, content, tags, decayScore: 1.0 });
      return id;
    },
    archiveEntries(ids: readonly string[]): void {
      state.archived.push(...ids);
      state.entries = state.entries.filter((e) => !ids.includes(e.id));
    },
  };
}

function makeEntry(id: string, content: string, tags: string[], decayScore = 0.5): CompactableEntry {
  return { id, content, tags, decayScore };
}

describe("MemoryCompactor", () => {
  describe("shouldCompact", () => {
    it("returns true when entry count exceeds threshold", () => {
      const compactor = new MemoryCompactor({ threshold: 5 });
      const entries = Array.from({ length: 6 }, (_, i) => makeEntry(`e${i}`, `content ${i}`, ["tag"]));
      const store = createMockStore(entries);
      expect(compactor.shouldCompact(store)).toBe(true);
    });

    it("returns false when entry count is at or below threshold", () => {
      const compactor = new MemoryCompactor({ threshold: 10 });
      const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`e${i}`, `content ${i}`, ["tag"]));
      const store = createMockStore(entries);
      expect(compactor.shouldCompact(store)).toBe(false);
    });
  });

  describe("compact", () => {
    it("removes nothing when already at target size", () => {
      const compactor = new MemoryCompactor({ threshold: 10, targetSize: 10 });
      const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`e${i}`, `content ${i}`, ["tag"]));
      const store = createMockStore(entries);
      const result = compactor.compact(store);
      expect(result.entriesRemoved).toBe(0);
      expect(result.summariesCreated).toBe(0);
    });

    it("removes nothing when no candidates are returned", () => {
      const compactor = new MemoryCompactor({ threshold: 3, targetSize: 2 });
      // Store with entries but queryOldEntries returns empty (no old entries)
      const store = createMockStore([]);
      // Manually override to report count > target but no old entries
      store.entryCount = () => 10;
      store.queryOldEntries = () => [];
      const result = compactor.compact(store);
      expect(result.entriesRemoved).toBe(0);
    });

    it("keeps highest-scored entry in groups of 2-3", () => {
      // targetSize=0 so all 3 entries are candidates (entriesToRemove = 3)
      const compactor = new MemoryCompactor({ threshold: 2, targetSize: 0 });
      const entries = [
        makeEntry("e1", "low", ["tagA"], 0.1),
        makeEntry("e2", "medium", ["tagA"], 0.5),
        makeEntry("e3", "high", ["tagA"], 0.9),
      ];
      const store = createMockStore(entries);
      const result = compactor.compact(store);

      // Group of 3: keep highest (e3), remove e1 + e2
      expect(result.entriesRemoved).toBe(2);
      expect(result.summariesCreated).toBe(0);
      expect(store.archived).toContain("e1");
      expect(store.archived).toContain("e2");
      expect(store.archived).not.toContain("e3");
    });

    it("creates summary for groups of 4+ entries", () => {
      // targetSize=0 so all 4 entries are candidates
      const compactor = new MemoryCompactor({ threshold: 3, targetSize: 0 });
      const entries = [
        makeEntry("e1", "first", ["tagB"], 0.1),
        makeEntry("e2", "second", ["tagB"], 0.2),
        makeEntry("e3", "third", ["tagB"], 0.3),
        makeEntry("e4", "fourth", ["tagB"], 0.4),
      ];
      const store = createMockStore(entries);
      const result = compactor.compact(store);

      expect(result.summariesCreated).toBe(1);
      expect(result.entriesRemoved).toBe(4);
      expect(store.summaries).toHaveLength(1);
      expect(store.summaries[0]!.tags).toEqual(["tagB"]);
    });

    it("truncates summary content to 500 characters", () => {
      // targetSize=0 so all 4 entries are candidates
      const compactor = new MemoryCompactor({ threshold: 3, targetSize: 0 });
      const longContent = "A".repeat(200);
      const entries = [
        makeEntry("e1", longContent, ["tag"], 0.1),
        makeEntry("e2", longContent, ["tag"], 0.2),
        makeEntry("e3", longContent, ["tag"], 0.3),
        makeEntry("e4", longContent, ["tag"], 0.4),
      ];
      const store = createMockStore(entries);
      compactor.compact(store);

      expect(store.summaries[0]!.content.length).toBeLessThanOrEqual(500);
      expect(store.summaries[0]!.content).toMatch(/\.\.\.$/);
    });

    it("groups entries by tags", () => {
      // targetSize=0 so all 6 entries are candidates
      const compactor = new MemoryCompactor({ threshold: 5, targetSize: 0 });
      const entries = [
        makeEntry("a1", "group-a-1", ["alpha"], 0.1),
        makeEntry("a2", "group-a-2", ["alpha"], 0.2),
        makeEntry("a3", "group-a-3", ["alpha"], 0.3),
        makeEntry("b1", "group-b-1", ["beta"], 0.1),
        makeEntry("b2", "group-b-2", ["beta"], 0.2),
        makeEntry("b3", "group-b-3", ["beta"], 0.3),
      ];
      const store = createMockStore(entries);
      const result = compactor.compact(store);

      // Both groups have 3 entries: keeps highest, removes 2 each
      expect(result.entriesRemoved).toBe(4);
      expect(result.summariesCreated).toBe(0);
    });

    it("handles entries without tags", () => {
      // targetSize=0 so all 3 entries are candidates
      const compactor = new MemoryCompactor({ threshold: 2, targetSize: 0 });
      const entries = [
        makeEntry("e1", "no tags 1", [], 0.1),
        makeEntry("e2", "no tags 2", [], 0.2),
        makeEntry("e3", "no tags 3", [], 0.3),
      ];
      const store = createMockStore(entries);
      const result = compactor.compact(store);

      // All grouped under __untagged__: group of 3, keep highest (e3), remove e1 + e2
      expect(result.entriesRemoved).toBe(2);
      expect(store.archived).toContain("e1");
      expect(store.archived).toContain("e2");
    });

    it("does not compact single-entry groups", () => {
      const compactor = new MemoryCompactor({ threshold: 3, targetSize: 1 });
      const entries = [
        makeEntry("e1", "lonely", ["unique-tag-1"], 0.1),
        makeEntry("e2", "also lonely", ["unique-tag-2"], 0.2),
        makeEntry("e3", "still lonely", ["unique-tag-3"], 0.3),
      ];
      const store = createMockStore(entries);
      const result = compactor.compact(store);

      // Each group has only 1 entry -- nothing to compact
      expect(result.entriesRemoved).toBe(0);
    });

    it("returns archived IDs", () => {
      // targetSize=0 so all 3 entries are candidates
      const compactor = new MemoryCompactor({ threshold: 2, targetSize: 0 });
      const entries = [
        makeEntry("e1", "a", ["tag"], 0.1),
        makeEntry("e2", "b", ["tag"], 0.5),
        makeEntry("e3", "c", ["tag"], 0.9),
      ];
      const store = createMockStore(entries);
      const result = compactor.compact(store);

      // Group of 3: keep highest (e3), archive e1 + e2
      expect(result.archivedIds).toContain("e1");
      expect(result.archivedIds).toContain("e2");
      expect(result.archivedIds).not.toContain("e3");
    });
  });

  describe("DEFAULT_COMPACTION_CONFIG", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_COMPACTION_CONFIG.threshold).toBe(1000);
      expect(DEFAULT_COMPACTION_CONFIG.targetSize).toBe(500);
      expect(DEFAULT_COMPACTION_CONFIG.minAge).toBe(7);
      expect(DEFAULT_COMPACTION_CONFIG.batchSize).toBe(10);
    });
  });
});
