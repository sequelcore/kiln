import { createHash } from "node:crypto";

interface CacheEntry {
  readonly result: unknown;
  readonly expiresAt: number;
}

/** In-memory tool result cache with per-entry TTL. */
export class ToolCache {
  private readonly entries = new Map<string, CacheEntry>();

  /** Retrieve a cached result, or undefined if missing/expired. */
  get(tool: string, args: Record<string, unknown>): unknown | undefined {
    const key = cacheKey(tool, args);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.result;
  }

  /** Store a result with the given TTL in seconds. */
  set(
    tool: string,
    args: Record<string, unknown>,
    result: unknown,
    ttlSeconds: number,
  ): void {
    if (ttlSeconds <= 0) return;
    const expiresAt = ttlSeconds === Infinity
      ? Infinity
      : Date.now() + ttlSeconds * 1000;
    this.entries.set(cacheKey(tool, args), { result, expiresAt });
  }

  /** Invalidate entries. No args = all entries for the tool. No tool = clear all. */
  invalidate(tool?: string, args?: Record<string, unknown>): void {
    if (!tool) {
      this.entries.clear();
      return;
    }
    if (args) {
      this.entries.delete(cacheKey(tool, args));
      return;
    }
    const prefix = `${tool}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /** Number of cached entries (including potentially expired). */
  get size(): number {
    return this.entries.size;
  }
}

function cacheKey(tool: string, args: Record<string, unknown>): string {
  const sorted = JSON.stringify(args, Object.keys(args).sort());
  const hash = createHash("sha256").update(sorted).digest("hex");
  return `${tool}:${hash}`;
}
