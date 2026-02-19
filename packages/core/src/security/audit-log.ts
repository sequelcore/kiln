// Append-only JSONL audit log with SHA-256 hash chaining for tamper detection

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { KilnError } from "../engine/errors.js";
import type { AuditEntry, AuditFilter, AuditChainResult, AuditLog } from "./types.js";

const GENESIS_HASH = "genesis";

/** Deterministic JSON serialization with sorted keys */
function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/** Compute SHA-256 hash of entry content + previous hash */
function computeHash(entry: Omit<AuditEntry, "hash">, previousHash: string): string {
  const payload: Record<string, unknown> = {
    id: entry.id,
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
    action: entry.action,
    actor: entry.actor,
    resource: entry.resource,
    outcome: entry.outcome,
    previousHash,
  };
  if (entry.metadata !== undefined) payload["metadata"] = entry.metadata;
  if (entry.tenantId !== undefined) payload["tenantId"] = entry.tenantId;
  if (entry.sessionId !== undefined) payload["sessionId"] = entry.sessionId;

  const content = canonicalJson(payload);
  return createHash("sha256").update(content).digest("hex");
}

/** Serialize an AuditEntry to a JSON line for file storage */
function serializeEntry(entry: AuditEntry): string {
  const obj: Record<string, unknown> = {
    id: entry.id,
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
    action: entry.action,
    actor: entry.actor,
    resource: entry.resource,
    outcome: entry.outcome,
  };
  if (entry.metadata !== undefined) obj["metadata"] = entry.metadata;
  if (entry.tenantId !== undefined) obj["tenantId"] = entry.tenantId;
  if (entry.sessionId !== undefined) obj["sessionId"] = entry.sessionId;
  if (entry.hash !== undefined) obj["hash"] = entry.hash;
  if (entry.previousHash !== undefined) obj["previousHash"] = entry.previousHash;
  return JSON.stringify(obj);
}

/** Deserialize a JSON line back to an AuditEntry */
function deserializeEntry(line: string): AuditEntry {
  const obj = JSON.parse(line) as Record<string, unknown>;
  return {
    id: obj["id"] as string,
    timestamp: new Date(obj["timestamp"] as string),
    action: obj["action"] as AuditEntry["action"],
    actor: obj["actor"] as string,
    resource: obj["resource"] as string,
    outcome: obj["outcome"] as AuditEntry["outcome"],
    metadata: obj["metadata"] as Record<string, unknown> | undefined,
    tenantId: obj["tenantId"] as string | undefined,
    sessionId: obj["sessionId"] as string | undefined,
    hash: obj["hash"] as string | undefined,
    previousHash: obj["previousHash"] as string | undefined,
  };
}

export class JsonlAuditLog implements AuditLog {
  private readonly logPath: string;
  private readonly hashChaining: boolean;
  private lastHash: string;
  private entryCount: number;

  constructor(logPath: string, options?: { hashChaining?: boolean }) {
    this.logPath = logPath;
    this.hashChaining = options?.hashChaining ?? true;

    // Ensure directory exists
    const dir = dirname(logPath);
    mkdirSync(dir, { recursive: true });

    // Initialize from existing file or create empty
    if (existsSync(logPath)) {
      const { count, lastHash } = this.loadState();
      this.entryCount = count;
      this.lastHash = lastHash;
    } else {
      writeFileSync(logPath, "", "utf-8");
      this.entryCount = 0;
      this.lastHash = GENESIS_HASH;
    }
  }

  append(entry: Omit<AuditEntry, "id" | "hash" | "previousHash">): AuditEntry {
    const id = crypto.randomUUID();
    const previousHash = this.lastHash;

    const fullEntry: AuditEntry = {
      ...entry,
      id,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp),
      previousHash: this.hashChaining ? previousHash : undefined,
      hash: undefined,
    };

    const hash = this.hashChaining
      ? computeHash(fullEntry, previousHash)
      : undefined;

    const finalEntry: AuditEntry = {
      ...fullEntry,
      hash,
    };

    try {
      const line = serializeEntry(finalEntry) + "\n";
      appendFileSync(this.logPath, line, "utf-8");
    } catch (err) {
      throw new KilnError("AUDIT_WRITE_FAILED", "Failed to write audit log entry", {
        context: { id, action: entry.action },
        cause: err,
      });
    }

    if (this.hashChaining && hash) {
      this.lastHash = hash;
    }
    this.entryCount++;

    return finalEntry;
  }

  query(filter: AuditFilter): readonly AuditEntry[] {
    const entries = this.readAllEntries();
    let filtered = entries;

    if (filter.action) {
      filtered = filtered.filter((e) => e.action === filter.action);
    }
    if (filter.actor) {
      filtered = filtered.filter((e) => e.actor === filter.actor);
    }
    if (filter.tenantId) {
      filtered = filtered.filter((e) => e.tenantId === filter.tenantId);
    }
    if (filter.outcome) {
      filtered = filtered.filter((e) => e.outcome === filter.outcome);
    }
    if (filter.since) {
      const since = filter.since.getTime();
      filtered = filtered.filter((e) => e.timestamp.getTime() >= since);
    }
    if (filter.until) {
      const until = filter.until.getTime();
      filtered = filtered.filter((e) => e.timestamp.getTime() <= until);
    }
    if (filter.limit !== undefined && filter.limit > 0) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  verifyChain(fromIndex?: number, toIndex?: number): AuditChainResult {
    if (!this.hashChaining) {
      return { valid: true, entriesChecked: 0 };
    }

    const entries = this.readAllEntries();
    const start = fromIndex ?? 0;
    const end = toIndex !== undefined ? Math.min(toIndex + 1, entries.length) : entries.length;

    if (entries.length === 0) {
      return { valid: true, entriesChecked: 0 };
    }

    for (let i = start; i < end; i++) {
      const entry = entries[i]!;
      const expectedPreviousHash = i === 0 ? GENESIS_HASH : entries[i - 1]!.hash!;

      if (entry.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          entriesChecked: i - start + 1,
          brokenAt: i,
          error: `Chain broken at index ${i}: previousHash mismatch`,
        };
      }

      const recomputedHash = computeHash(entry, expectedPreviousHash);
      if (entry.hash !== recomputedHash) {
        return {
          valid: false,
          entriesChecked: i - start + 1,
          brokenAt: i,
          error: `Chain broken at index ${i}: hash mismatch (tampered entry)`,
        };
      }
    }

    return { valid: true, entriesChecked: end - start };
  }

  count(): number {
    return this.entryCount;
  }

  private readAllEntries(): AuditEntry[] {
    if (!existsSync(this.logPath)) return [];

    const content = readFileSync(this.logPath, "utf-8").trim();
    if (content.length === 0) return [];

    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map(deserializeEntry);
  }

  private loadState(): { count: number; lastHash: string } {
    const entries = this.readAllEntries();
    if (entries.length === 0) {
      return { count: 0, lastHash: GENESIS_HASH };
    }
    const lastEntry = entries[entries.length - 1]!;
    return {
      count: entries.length,
      lastHash: lastEntry.hash ?? GENESIS_HASH,
    };
  }
}
