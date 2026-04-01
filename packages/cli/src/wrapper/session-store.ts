import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appendFile, readFile, writeFile, readdir } from 'node:fs/promises';

export interface SessionRecord {
  sessionId: string;
  provider: string;
  task: string;
  completedAt: string;
  cost: number;
  projectPath: string;
  remoteSessionId?: string;
  threadId?: string;
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
      const line = JSON.stringify(record) + '\n';
      await appendFile(this.filePath, line, 'utf-8');
    } catch (err) {
      console.error('[SessionStore] Failed to append session record:', err);
    }
  }

  async last(provider?: string): Promise<SessionRecord | null> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');
      const filtered = provider !== undefined
        ? lines.filter((line) => {
            try {
              const record = JSON.parse(line) as SessionRecord;
              return record.provider === provider;
            } catch {
              return false;
            }
          })
        : lines;
      if (filtered.length === 0) {
        return null;
      }
      const lastLine = filtered[filtered.length - 1]!;
      return JSON.parse(lastLine) as SessionRecord;
    } catch {
      return null;
    }
  }

  async find(sessionId: string): Promise<SessionRecord | null> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as SessionRecord;
          if (record.sessionId === sessionId) {
            return record;
          }
        } catch {
          continue;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}

export interface PersistedSessionMeta {
  kilnSessionId: string;
  provider: string;
  task: string;
  startedAt: string;
  completedAt?: string;
  costUsd?: number;
  toolCount?: number;
  turnDepth?: number;
  providerSessionId?: string;
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
    return join(this.baseDir, sessionId);
  }

  async init(sessionId: string, meta: PersistedSessionMeta): Promise<void> {
    try {
      const dir = this.sessionDir(sessionId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
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
      await writeFile(filePath, JSON.stringify({ ...existing, ...updates }, null, 2), 'utf-8');
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
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}
