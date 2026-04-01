import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appendFile, readFile } from 'node:fs/promises';

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
