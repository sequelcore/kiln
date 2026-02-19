// Memory compaction: group old entries by tags, summarize, archive originals
// Deterministic text truncation -- LLM-based summarization is Phase 4+

/** Compaction configuration */
export interface CompactionConfig {
  readonly threshold: number;
  readonly targetSize: number;
  readonly minAge: number;
  readonly batchSize: number;
}

/** Compaction result */
export interface CompactionResult {
  readonly entriesRemoved: number;
  readonly summariesCreated: number;
  readonly archivedIds: readonly string[];
}

/** Default compaction configuration */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  threshold: 1000,
  targetSize: 500,
  minAge: 7,
  batchSize: 10,
};

/**
 * Interface for the store operations the compactor needs.
 * Decouples from bun:sqlite so tests can use in-memory implementations.
 */
export interface CompactableStore {
  /** Total entry count */
  entryCount(): number;
  /** Query entries older than minAgeDays, ordered by decay_score ASC, limited */
  queryOldEntries(minAgeDays: number, limit: number): readonly CompactableEntry[];
  /** Save a summary entry (returns the new ID) */
  saveSummary(content: string, tags: readonly string[]): string;
  /** Archive and delete entries by ID */
  archiveEntries(ids: readonly string[]): void;
}

/** Minimal entry shape for compaction */
export interface CompactableEntry {
  readonly id: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly decayScore: number;
}

/**
 * MemoryCompactor: groups old, low-score entries and creates summaries.
 *
 * Strategy:
 * 1. Query entries older than `minAge` days, ordered by decay_score ASC
 * 2. Group by tags (entries with the same tag set are related)
 * 3. For each group:
 *    - 1-3 entries: keep highest-scored, delete rest
 *    - 4+ entries: concatenate content, truncate to 500 chars as summary
 * 4. Delete original entries, archive IDs
 *
 * Deterministic: no LLM calls, pure text truncation.
 */
export class MemoryCompactor {
  private readonly config: CompactionConfig;

  constructor(config?: Partial<CompactionConfig>) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  /** Check if compaction is needed (entry count > threshold) */
  shouldCompact(store: CompactableStore): boolean {
    return store.entryCount() > this.config.threshold;
  }

  /** Run compaction on the given store */
  compact(store: CompactableStore): CompactionResult {
    const entriesToRemove = store.entryCount() - this.config.targetSize;
    if (entriesToRemove <= 0) {
      return { entriesRemoved: 0, summariesCreated: 0, archivedIds: [] };
    }

    const candidates = store.queryOldEntries(this.config.minAge, entriesToRemove);
    if (candidates.length === 0) {
      return { entriesRemoved: 0, summariesCreated: 0, archivedIds: [] };
    }

    // Group by tag signature (sorted, joined)
    const groups = groupByTags(candidates);

    let totalRemoved = 0;
    let totalSummaries = 0;
    const allArchivedIds: string[] = [];

    for (const group of groups.values()) {
      if (totalRemoved >= entriesToRemove) break;

      const { removedIds, summaryCreated } = this.compactGroup(group, store);
      allArchivedIds.push(...removedIds);
      totalRemoved += removedIds.length;
      if (summaryCreated) totalSummaries++;
    }

    return {
      entriesRemoved: totalRemoved,
      summariesCreated: totalSummaries,
      archivedIds: allArchivedIds,
    };
  }

  private compactGroup(
    group: CompactableEntry[],
    store: CompactableStore,
  ): { removedIds: string[]; summaryCreated: boolean } {
    if (group.length <= 1) {
      return { removedIds: [], summaryCreated: false };
    }

    // Sort by decayScore descending -- keep highest scored
    const sorted = [...group].sort((a, b) => b.decayScore - a.decayScore);

    if (group.length <= 3) {
      // Keep the best one, remove the rest
      const toRemove = sorted.slice(1);
      const removeIds = toRemove.map((e) => e.id);
      store.archiveEntries(removeIds);
      return { removedIds: removeIds, summaryCreated: false };
    }

    // 4+ entries: create summary from concatenated content
    const combined = sorted.map((e) => e.content).join("\n---\n");
    const summary = combined.length > 500 ? combined.slice(0, 497) + "..." : combined;
    const tags = sorted[0]!.tags;

    store.saveSummary(summary, tags);
    const removeIds = sorted.map((e) => e.id);
    store.archiveEntries(removeIds);

    return { removedIds: removeIds, summaryCreated: true };
  }
}

/** Group entries by their tag signature (sorted tags joined with comma) */
function groupByTags(entries: readonly CompactableEntry[]): Map<string, CompactableEntry[]> {
  const groups = new Map<string, CompactableEntry[]>();

  for (const entry of entries) {
    const key = [...entry.tags].sort().join(",") || "__untagged__";
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  return groups;
}
