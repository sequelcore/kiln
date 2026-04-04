import { gzipSync, gunzipSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { MemoryEntry, MemorySearchResult, MemoryStore } from "./index.js";

interface ManifestChunk {
  readonly hash: string;
  readonly entries: number;
  readonly createdAt: string;
  readonly developer?: string;
}

interface Manifest {
  version: 1;
  chunks: ManifestChunk[];
  deleted: string[];
}

const FLUSH_THRESHOLD = 10;

/** Rough heuristic: ~4 characters per token for English text */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Remove `<private>...</private>` blocks from content */
export function stripPrivateTags(content: string): string {
  return content.replace(/<private>[\s\S]*?<\/private>/g, "").trim();
}

/**
 * Git-synced gzipped JSONL memory store.
 *
 * Entries are buffered in memory and flushed to content-hashed
 * `.jsonl.gz` chunk files when the buffer reaches the threshold.
 * A `manifest.json` tracks all chunks and soft-deleted entry IDs.
 */
export class ProjectMemoryStore implements MemoryStore {
  private readonly dir: string;
  private buffer: MemoryEntry[] = [];
  private _manifestCache: Manifest | null = null;

  constructor(opts: { projectPath: string }) {
    this.dir = opts.projectPath;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">,
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const full: MemoryEntry = {
      ...entry,
      id,
      content: stripPrivateTags(entry.content),
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    };
    this.buffer.push(full);

    if (this.buffer.length >= FLUSH_THRESHOLD) {
      await this.flush();
    }

    return id;
  }

  async search(
    query: string,
    limit: number = 10,
  ): Promise<readonly MemorySearchResult[]> {
    const allEntries = this.readAllEntries();
    const manifest = this.readManifest();
    const deletedSet = new Set(manifest.deleted);

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const scored: MemorySearchResult[] = [];
    for (const entry of allEntries) {
      if (deletedSet.has(entry.id)) continue;

      const lower = entry.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let idx = 0;
        while (true) {
          const found = lower.indexOf(term, idx);
          if (found === -1) break;
          score++;
          idx = found + term.length;
        }
      }

      if (score > 0) {
        scored.push({
          entry,
          score,
          snippet: entry.content.slice(0, 200),
        });
      }
    }

    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return scored.slice(0, limit);
  }

  async recall(query: string, tokenBudget: number): Promise<string> {
    const results = await this.search(query, 50);
    const parts: string[] = [];
    let usedTokens = 0;

    for (const r of results) {
      const entryTokens = Math.ceil(r.entry.content.length / CHARS_PER_TOKEN_ESTIMATE);
      if (usedTokens + entryTokens > tokenBudget) break;
      parts.push(r.entry.content);
      usedTokens += entryTokens;
    }

    return parts.join("\n\n");
  }

  async forget(id: string): Promise<void> {
    const manifest = this.readManifest();
    if (!manifest.deleted.includes(id)) {
      manifest.deleted.push(id);
    }
    this.writeManifest(manifest);
  }

  async flush(developerId?: string): Promise<void> {
    if (this.buffer.length === 0) return;

    const lines = this.buffer.map((e) => JSON.stringify(e)).join("\n");
    const compressed = gzipSync(Buffer.from(lines, "utf-8"));
    const hash = createHash("sha256").update(compressed).digest("hex");
    const filename = `${hash}.jsonl.gz`;

    writeFileSync(join(this.dir, filename), compressed);

    const manifest = this.readManifest();
    manifest.chunks.push({
      hash,
      entries: this.buffer.length,
      createdAt: new Date().toISOString(),
      developer: developerId,
    });
    this.writeManifest(manifest);

    this.buffer = [];
  }

  get count(): number {
    const manifest = this.readManifest();
    const chunkTotal = manifest.chunks.reduce((sum, c) => sum + c.entries, 0);
    return chunkTotal + this.buffer.length - manifest.deleted.length;
  }

  // -- Private helpers --

  private readManifest(): Manifest {
    if (this._manifestCache) return this._manifestCache;
    const path = join(this.dir, "manifest.json");
    if (!existsSync(path)) {
      return { version: 1, chunks: [], deleted: [] };
    }
    this._manifestCache = JSON.parse(readFileSync(path, "utf-8")) as Manifest;
    return this._manifestCache;
  }

  private writeManifest(manifest: Manifest): void {
    writeFileSync(
      join(this.dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    this._manifestCache = null;
  }

  private readAllEntries(): MemoryEntry[] {
    const manifest = this.readManifest();
    const entries: MemoryEntry[] = [];

    for (const chunk of manifest.chunks) {
      const path = join(this.dir, `${chunk.hash}.jsonl.gz`);
      if (!existsSync(path)) continue;
      const compressed = readFileSync(path);
      const decompressed = gunzipSync(compressed).toString("utf-8");
      for (const line of decompressed.split("\n")) {
        if (line.trim().length === 0) continue;
        entries.push(JSON.parse(line) as MemoryEntry);
      }
    }

    // Include unflushed buffer entries
    entries.push(...this.buffer);

    return entries;
  }
}
