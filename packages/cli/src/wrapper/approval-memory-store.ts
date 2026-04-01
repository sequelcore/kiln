import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KilnPermissionAction } from "./session.js";

export type ApprovalScope = "once" | "session" | "project";
export type ApprovalSurface = "tool" | "command" | "file" | "destination";

export interface ApprovalMemoryRecord {
  id: string;
  scope: ApprovalScope;
  surface: ApprovalSurface;
  selector: string;
  action: KilnPermissionAction;
  createdAt: string;
  sessionId?: string;
  agent?: string;
  reason?: string;
}

export interface ApprovalGrantInput {
  scope: ApprovalScope;
  surface: ApprovalSurface;
  selector: string;
  action: KilnPermissionAction;
  sessionId?: string;
  agent?: string;
  reason?: string;
}

export interface ApprovalMatchQuery {
  surface: ApprovalSurface;
  selector: string;
  action?: KilnPermissionAction;
  sessionId?: string;
}

function isScope(value: unknown): value is ApprovalScope {
  return value === "once" || value === "session" || value === "project";
}

function isSurface(value: unknown): value is ApprovalSurface {
  return value === "tool" || value === "command" || value === "file" || value === "destination";
}

function parseRecord(line: string): ApprovalMemoryRecord | null {
  try {
    const parsed = JSON.parse(line) as Partial<ApprovalMemoryRecord>;
    if (
      typeof parsed.id !== "string"
      || !isScope(parsed.scope)
      || !isSurface(parsed.surface)
      || typeof parsed.selector !== "string"
      || (parsed.action !== "allow" && parsed.action !== "ask" && parsed.action !== "deny")
      || typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    if (parsed.scope === "session" && typeof parsed.sessionId !== "string") {
      return null;
    }
    return parsed as ApprovalMemoryRecord;
  } catch {
    return null;
  }
}

function matchesRecord(
  record: ApprovalMemoryRecord,
  query: ApprovalMatchQuery,
): boolean {
  if (record.surface !== query.surface) return false;
  if (record.selector !== query.selector) return false;
  if (query.action !== undefined && record.action !== query.action) return false;

  if (record.scope === "session") {
    return query.sessionId !== undefined && record.sessionId === query.sessionId;
  }

  return true;
}

export class ApprovalMemoryStore {
  private readonly filePath: string;

  constructor(projectPath: string) {
    this.filePath = join(projectPath, ".kiln", "approval-memory.jsonl");
  }

  async grant(input: ApprovalGrantInput): Promise<ApprovalMemoryRecord | null> {
    if (input.scope === "session" && input.sessionId === undefined) {
      throw new Error("sessionId is required for session approval scope");
    }

    const record: ApprovalMemoryRecord = {
      id: randomUUID(),
      scope: input.scope,
      surface: input.surface,
      selector: input.selector,
      action: input.action,
      createdAt: new Date().toISOString(),
      sessionId: input.sessionId,
      agent: input.agent,
      reason: input.reason,
    };

    try {
      const dir = join(this.filePath, "..");
      await mkdir(dir, { recursive: true });
      await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf-8");
      return record;
    } catch (err) {
      console.error("[ApprovalMemoryStore] Failed to persist approval grant:", err);
      return null;
    }
  }

  async list(): Promise<ApprovalMemoryRecord[]> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      return content
        .split("\n")
        .filter((line) => line.trim() !== "")
        .flatMap((line) => {
          const parsed = parseRecord(line);
          return parsed ? [parsed] : [];
        });
    } catch {
      return [];
    }
  }

  async findMatch(query: ApprovalMatchQuery): Promise<ApprovalMemoryRecord | null> {
    const records = await this.list();
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i]!;
      if (matchesRecord(record, query)) {
        return record;
      }
    }
    return null;
  }

  async consumeOnce(query: ApprovalMatchQuery): Promise<ApprovalMemoryRecord | null> {
    const records = await this.list();
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i]!;
      if (record.scope === "once" && matchesRecord(record, query)) {
        records.splice(i, 1);
        await this.persistAll(records);
        return record;
      }
    }
    return null;
  }

  async clearSession(sessionId: string): Promise<number> {
    const records = await this.list();
    const retained = records.filter((record) => !(record.scope === "session" && record.sessionId === sessionId));
    const removed = records.length - retained.length;
    if (removed === 0) {
      return 0;
    }
    await this.persistAll(retained);
    return removed;
  }

  private async persistAll(records: readonly ApprovalMemoryRecord[]): Promise<void> {
    try {
      const dir = join(this.filePath, "..");
      await mkdir(dir, { recursive: true });
      const payload = records.map((record) => JSON.stringify(record)).join("\n");
      await writeFile(this.filePath, payload.length > 0 ? `${payload}\n` : "", "utf-8");
    } catch (err) {
      console.error("[ApprovalMemoryStore] Failed to rewrite approval memory:", err);
    }
  }
}
