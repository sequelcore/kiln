import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appendFile, readFile, writeFile, readdir } from 'node:fs/promises';
import type { ResumeFeedback, ResumeOutcome, ResumeStrategy } from './index.js';

export interface ProviderThreadMeta {
  provider: string;
  nativeSessionId: string;
}

export interface SessionRecord {
  sessionId: string;
  provider: string;
  task: string;
  canonicalTitle?: string;
  title?: string;
  summary?: string;
  tags?: readonly string[];
  providersUsed?: readonly string[];
  completedAt: string;
  cost: number;
  projectPath: string;
  providerThread?: ProviderThreadMeta;
  resumeStrategy?: ResumeStrategy;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .flatMap((entry) => typeof entry === 'string' ? [entry.trim()] : [])
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }
  return [...new Set(normalized)];
}

function serializeSessionRecord(record: SessionRecord): string {
  return JSON.stringify(record);
}

function parseSessionRecord(line: string): SessionRecord | null {
  try {
    const parsed = JSON.parse(line) as Partial<SessionRecord>;
    if (
      typeof parsed.sessionId !== 'string'
      || typeof parsed.provider !== 'string'
      || typeof parsed.task !== 'string'
      || typeof parsed.completedAt !== 'string'
      || typeof parsed.cost !== 'number'
      || typeof parsed.projectPath !== 'string'
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      provider: parsed.provider,
      task: parsed.task,
      canonicalTitle: parseOptionalString(parsed.canonicalTitle) ?? parseOptionalString(parsed.title),
      title: parseOptionalString(parsed.title),
      summary: parseOptionalString(parsed.summary),
      tags: parseOptionalStringArray(parsed.tags),
      providersUsed: parseOptionalStringArray(parsed.providersUsed),
      completedAt: parsed.completedAt,
      cost: parsed.cost,
      projectPath: parsed.projectPath,
      providerThread: parsed.providerThread,
      resumeStrategy: parsed.resumeStrategy,
    };
  } catch {
    return null;
  }
}

export class SessionStore {
  private readonly filePath: string;

  constructor(projectPath: string) {
    this.filePath = join(projectPath, '.kiln', 'sessions.jsonl');
  }

  async append(record: SessionRecord): Promise<void> {
    try {
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });
      const line = serializeSessionRecord(record) + '\n';
      await appendFile(this.filePath, line, 'utf-8');
    } catch (err) {
      console.error('[SessionStore] Failed to append session record:', err);
    }
  }

  private async readRecords(): Promise<SessionRecord[]> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .flatMap((line) => {
          const parsed = parseSessionRecord(line);
          return parsed ? [parsed] : [];
        });
    } catch {
      return [];
    }
  }

  async last(provider?: string): Promise<SessionRecord | null> {
    try {
      const records = await this.readRecords();
      const filtered = provider !== undefined
        ? records.filter((record) => record.provider === provider)
        : records;
      if (filtered.length === 0) {
        return null;
      }
      return filtered[filtered.length - 1]!;
    } catch {
      return null;
    }
  }

  async clearLast(provider?: string): Promise<void> {
    try {
      const records = await this.readRecords();
      // Find index of the last record matching provider (or any if undefined)
      let lastMatchIndex = -1;
      for (let i = 0; i < records.length; i++) {
        const record = records[i]!;
        if (provider === undefined || record.provider === provider) {
          lastMatchIndex = i;
        }
      }
      if (lastMatchIndex === -1) return;
      const remaining = records.filter((_, i) => i !== lastMatchIndex);
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(
        this.filePath,
        remaining.map((record) => `${serializeSessionRecord(record)}\n`).join(''),
        'utf-8',
      );
    } catch (err) {
      console.error('[SessionStore] Failed to clearLast:', err);
    }
  }

  async find(sessionId: string): Promise<SessionRecord | null> {
    try {
      const records = await this.readRecords();
      for (let i = records.length - 1; i >= 0; i -= 1) {
        const record = records[i];
        if (record?.sessionId === sessionId) {
          return record;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async findProviderThread(sessionId: string, provider: string): Promise<ProviderThreadMeta | undefined> {
    try {
      const records = await this.readRecords();
      for (let i = records.length - 1; i >= 0; i -= 1) {
        const record = records[i];
        if (record?.sessionId !== sessionId) {
          continue;
        }
        if (record.providerThread?.provider === provider) {
          return record.providerThread;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<SessionRecord[]> {
    try {
      const records = await this.readRecords();
      return records.reverse();
    } catch {
      return [];
    }
  }
}

export interface PersistedSessionMeta {
  kilnSessionId: string;
  provider: string;
  canonicalTitle?: string;
  title?: string;
  summary?: string;
  tags?: readonly string[];
  providersUsed?: readonly string[];
  task: string;
  startedAt: string;
  completedAt?: string;
  costUsd?: number;
  toolCount?: number;
  turnDepth?: number;
  providerThread?: ProviderThreadMeta;
  resumeStrategy?: ResumeStrategy;
  resumeFeedback?: ResumeFeedback;
  resumeOutcome?: ResumeOutcome;
  sessionLedger?: {
    currentPhase: string;
    resumedFrom?: string;
    workingDirectory?: string;
    worktreePath?: string;
    lastError?: string;
    lastProvider?: string;
    toolCallCount?: number;
    turnDepth?: number;
  };
  exactArtifacts?: string[];
}

function serializePersistedMeta(meta: PersistedSessionMeta): string {
  return JSON.stringify(meta, null, 2);
}

function encodeSessionPathSegment(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

export interface PersistedTranscriptLine {
  seq: number;
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

export class TranscriptStore {
  private readonly baseDir: string;

  constructor(projectPath: string) {
    this.baseDir = join(projectPath, '.kiln', 'sessions');
  }

  sessionDir(sessionId: string): string {
    return join(this.baseDir, encodeSessionPathSegment(sessionId));
  }

  async init(sessionId: string, meta: PersistedSessionMeta): Promise<void> {
    try {
      const dir = this.sessionDir(sessionId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'meta.json'), serializePersistedMeta(meta), 'utf-8');
    } catch {
      // fail-open
    }
  }

  async append(sessionId: string, line: PersistedTranscriptLine): Promise<void> {
    try {
      const dir = this.sessionDir(sessionId);
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'transcript.jsonl'), JSON.stringify(line) + '\n', 'utf-8');
    } catch {
      // fail-open
    }
  }

  async finalize(sessionId: string, updates: Partial<PersistedSessionMeta>): Promise<void> {
    try {
      const dir = this.sessionDir(sessionId);
      const filePath = join(dir, 'meta.json');
      const existing = await this.readMeta(sessionId);
      if (!existing) {
        return;
      }
      await writeFile(
        filePath,
        serializePersistedMeta({
          ...existing,
          ...updates,
        }),
        'utf-8',
      );
    } catch {
      // fail-open
    }
  }

  async readMeta(sessionId: string): Promise<PersistedSessionMeta | null> {
    try {
      const content = await readFile(join(this.sessionDir(sessionId), 'meta.json'), 'utf-8');
      return JSON.parse(content) as PersistedSessionMeta;
    } catch {
      return null;
    }
  }

  async readTranscript(sessionId: string): Promise<PersistedTranscriptLine[]> {
    try {
      const content = await readFile(join(this.sessionDir(sessionId), 'transcript.jsonl'), 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as
              | PersistedTranscriptLine
              | { seq: number; ts: string; event: { type: string } & Record<string, unknown> };
            if (
              typeof parsed === 'object'
              && parsed !== null
              && 'type' in parsed
              && 'data' in parsed
            ) {
              return [parsed as PersistedTranscriptLine];
            }
            if (
              typeof parsed === 'object'
              && parsed !== null
              && 'event' in parsed
              && typeof parsed.event === 'object'
              && parsed.event !== null
              && 'type' in parsed.event
            ) {
              const { type, ...data } = parsed.event;
              return [{
                seq: parsed.seq,
                ts: parsed.ts,
                type,
                data,
              }];
            }
            return [];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  async listSessions(): Promise<string[]> {
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => decodeSessionPathSegment(entry.name));
    } catch {
      return [];
    }
  }
}

function decodeSessionPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
