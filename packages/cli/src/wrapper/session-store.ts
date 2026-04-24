import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appendFile, readFile, writeFile, readdir } from 'node:fs/promises';
import type { ResumeFeedback, ResumeOutcome, ResumeStrategy } from './index.js';
import type { CanonicalSessionEventKind, SessionEventEnvelope, SessionEventSource } from '@kilnai/core';

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

type PersistedTranscriptEnvelopeBase = Omit<
  SessionEventEnvelope<CanonicalSessionEventKind>,
  'timestamp'
>;

export interface PersistedTranscriptEvent extends PersistedTranscriptEnvelopeBase {
  timestamp: string;
  payload: Record<string, unknown>;
}

const CANONICAL_SESSION_EVENT_KINDS = new Set<CanonicalSessionEventKind>([
  'turn_started',
  'user_message',
  'assistant_message',
  'assistant_delta',
  'provider_routed',
  'tool_call_started',
  'tool_call_completed',
  'approval_requested',
  'approval_resolved',
  'file_changed',
  'cost_updated',
  'continuity_decided',
  'error_recorded',
  'turn_completed',
]);
const SESSION_EVENT_ACTORS = new Set(['user', 'assistant', 'system', 'tool', 'runtime']);
const SESSION_EVENT_SURFACES = new Set(['cli', 'tui', 'gui', 'ide', 'gateway', 'runtime']);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionEventSource(value: unknown): value is SessionEventSource {
  if (!isObjectRecord(value)) {
    return false;
  }
  if (!SESSION_EVENT_ACTORS.has(String(value.actor))) {
    return false;
  }
  if (!SESSION_EVENT_SURFACES.has(String(value.surface))) {
    return false;
  }
  return value.component === undefined || typeof value.component === 'string';
}

function isPersistedTranscriptEvent(value: unknown): value is PersistedTranscriptEvent {
  if (!isObjectRecord(value)) {
    return false;
  }
  if (typeof value.eventId !== 'string' || value.eventId.trim().length === 0) {
    return false;
  }
  if (typeof value.kilnSessionId !== 'string' || value.kilnSessionId.trim().length === 0) {
    return false;
  }
  if (!Number.isInteger(value.sequence) || (value.sequence as number) < 1) {
    return false;
  }
  if (typeof value.timestamp !== 'string' || value.timestamp.trim().length === 0) {
    return false;
  }
  if (
    typeof value.kind !== 'string'
    || !CANONICAL_SESSION_EVENT_KINDS.has(value.kind as CanonicalSessionEventKind)
  ) {
    return false;
  }
  if (!isObjectRecord(value.payload)) {
    return false;
  }
  if (value.turnId !== undefined && typeof value.turnId !== 'string') {
    return false;
  }
  if (value.parentEventId !== undefined && typeof value.parentEventId !== 'string') {
    return false;
  }
  if (value.source !== undefined && !isSessionEventSource(value.source)) {
    return false;
  }
  return true;
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

  async append(sessionId: string, event: PersistedTranscriptEvent): Promise<void> {
    try {
      const dir = this.sessionDir(sessionId);
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'transcript.jsonl'), JSON.stringify(event) + '\n', 'utf-8');
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

  async readTranscript(sessionId: string): Promise<PersistedTranscriptEvent[]> {
    try {
      const content = await readFile(join(this.sessionDir(sessionId), 'transcript.jsonl'), 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            if (isPersistedTranscriptEvent(parsed)) {
              return [parsed];
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
