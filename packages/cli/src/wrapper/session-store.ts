import { join } from 'node:path';
import { appendFile, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import type { ResumeFeedback, ResumeOutcome, ResumeStrategy } from './index.js';
import type { CanonicalSessionEventKind, SessionEventEnvelope, SessionEventSource, SessionTurnOutcome } from '@kilnai/core';

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

export interface SessionRecordAppendOptions {
  readonly updateResumeTarget?: boolean;
}

interface ResumeTargetsFile {
  readonly defaultSessionId?: string;
  readonly providerSessionIds?: Record<string, string>;
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

function latestRecordsBySessionId(records: readonly SessionRecord[]): SessionRecord[] {
  const bySessionId = new Map<string, SessionRecord>();
  for (const record of records) {
    bySessionId.delete(record.sessionId);
    bySessionId.set(record.sessionId, record);
  }
  return [...bySessionId.values()];
}

function mergeProviderIds(
  existing: readonly string[] | undefined,
  incoming: readonly (string | undefined)[],
): string[] | undefined {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...(existing ?? []), ...incoming]) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged.length > 0 ? merged : undefined;
}

function mergeRepeatedSessionRecord(
  previous: SessionRecord | undefined,
  next: SessionRecord,
): SessionRecord {
  if (!previous) {
    return next;
  }
  const cost = previous.completedAt === next.completedAt
    ? next.cost
    : previous.cost + next.cost;
  return {
    ...next,
    cost,
    providersUsed: mergeProviderIds(next.providersUsed, [
      next.provider,
      ...(previous.providersUsed ?? []),
      previous.provider,
    ]),
    tags: parseOptionalStringArray([...(previous.tags ?? []), ...(next.tags ?? [])]),
  };
}

export class SessionStore {
  private readonly filePath: string;
  private readonly resumeTargetsPath: string;

  constructor(projectPath: string) {
    this.filePath = join(projectPath, '.kiln', 'sessions.jsonl');
    this.resumeTargetsPath = join(projectPath, '.kiln', 'resume-targets.json');
  }

  async append(record: SessionRecord, options: SessionRecordAppendOptions = {}): Promise<void> {
    try {
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });
      const currentRecords = await this.readRecords();
      const previous = currentRecords.findLast((entry) => entry.sessionId === record.sessionId);
      const records = currentRecords.filter((entry) => entry.sessionId !== record.sessionId);
      records.push(mergeRepeatedSessionRecord(previous, record));
      await this.writeRecords(records);
      if (options.updateResumeTarget !== false) {
        await this.setResumeTarget(record);
      }
    } catch (err) {
      console.error('[SessionStore] Failed to append session record:', err);
    }
  }

  private async writeRecords(records: readonly SessionRecord[]): Promise<void> {
    const dir = join(this.filePath, '..');
    await mkdir(dir, { recursive: true });
    const content = records.map(serializeSessionRecord).join('\n');
    await writeFile(this.filePath, content ? `${content}\n` : '', 'utf-8');
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

  private async readResumeTargets(): Promise<ResumeTargetsFile> {
    try {
      const parsed = JSON.parse(await readFile(this.resumeTargetsPath, 'utf-8')) as Partial<ResumeTargetsFile>;
      const defaultSessionId = parseOptionalString(parsed.defaultSessionId);
      const providerSessionIds = parsed.providerSessionIds && typeof parsed.providerSessionIds === 'object'
        ? Object.fromEntries(
          Object.entries(parsed.providerSessionIds)
            .flatMap(([provider, sessionId]) => {
              const normalizedProvider = parseOptionalString(provider);
              const normalizedSessionId = parseOptionalString(sessionId);
              return normalizedProvider && normalizedSessionId
                ? [[normalizedProvider, normalizedSessionId]]
                : [];
            }),
        )
        : undefined;
      return {
        ...(defaultSessionId ? { defaultSessionId } : {}),
        ...(providerSessionIds && Object.keys(providerSessionIds).length > 0 ? { providerSessionIds } : {}),
      };
    } catch {
      return {};
    }
  }

  private async writeResumeTargets(targets: ResumeTargetsFile): Promise<void> {
    const dir = join(this.resumeTargetsPath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(this.resumeTargetsPath, JSON.stringify(targets, null, 2), 'utf-8');
  }

  async getResumeTarget(provider?: string): Promise<SessionRecord | null> {
    const targets = await this.readResumeTargets();
    const sessionId = provider ? targets.providerSessionIds?.[provider] : targets.defaultSessionId;
    return sessionId ? this.find(sessionId) : null;
  }

  async setResumeTarget(record: SessionRecord): Promise<void> {
    try {
      const current = await this.readResumeTargets();
      await this.writeResumeTargets({
        defaultSessionId: record.sessionId,
        providerSessionIds: {
          ...(current.providerSessionIds ?? {}),
          [record.provider]: record.sessionId,
        },
      });
    } catch (err) {
      console.error('[SessionStore] Failed to set resume target:', err);
    }
  }

  async clearResumeTarget(provider?: string): Promise<void> {
    try {
      if (provider === undefined) {
        await this.writeResumeTargets({});
        return;
      }
      const current = await this.readResumeTargets();
      const providerSessionIds = { ...(current.providerSessionIds ?? {}) };
      delete providerSessionIds[provider];
      const nextDefault = current.defaultSessionId && current.defaultSessionId === current.providerSessionIds?.[provider]
        ? undefined
        : current.defaultSessionId;
      await this.writeResumeTargets({
        ...(nextDefault ? { defaultSessionId: nextDefault } : {}),
        ...(Object.keys(providerSessionIds).length > 0 ? { providerSessionIds } : {}),
      });
    } catch (err) {
      console.error('[SessionStore] Failed to clear resume target:', err);
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
      const records = latestRecordsBySessionId(await this.readRecords());
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
  lastTurnOutcome?: SessionTurnOutcome;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  providerTokenUsage?: readonly PersistedProviderTokenUsage[];
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

export interface PersistedProviderTokenUsage {
  readonly provider: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

function serializePersistedMeta(meta: PersistedSessionMeta): string {
  return JSON.stringify(meta, null, 2);
}

function mergePersistedProviderTokenUsage(
  existing: readonly PersistedProviderTokenUsage[] | undefined,
  updates: readonly PersistedProviderTokenUsage[],
): readonly PersistedProviderTokenUsage[] {
  const usageByProviderModel = new Map<string, PersistedProviderTokenUsage>();
  for (const usage of [...(existing ?? []), ...updates]) {
    const key = `${usage.provider}\0${usage.model ?? ""}`;
    const current = usageByProviderModel.get(key);
    usageByProviderModel.set(key, {
      provider: usage.provider,
      ...(usage.model ? { model: usage.model } : {}),
      inputTokens: readTokenCount(current?.inputTokens) + readTokenCount(usage.inputTokens),
      outputTokens: readTokenCount(current?.outputTokens) + readTokenCount(usage.outputTokens),
      cacheReadTokens: readTokenCount(current?.cacheReadTokens) + readTokenCount(usage.cacheReadTokens),
      cacheWriteTokens: readTokenCount(current?.cacheWriteTokens) + readTokenCount(usage.cacheWriteTokens),
    });
  }
  return [...usageByProviderModel.values()];
}

function readTokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
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

export type PersistedTranscriptEventDraft = Omit<PersistedTranscriptEvent, 'sequence'> & {
  readonly sequence?: number;
};

const CANONICAL_SESSION_EVENT_KINDS = new Set<CanonicalSessionEventKind>([
  'turn_started',
  'user_message',
  'assistant_message',
  'assistant_delta',
  'specification_submitted',
  'clarification_recorded',
  'plan_submitted',
  'plan_analysis_reported',
  'plan_approved',
  'goal.created',
  'goal.updated',
  'goal.completed',
  'goal.failed',
  'goal.cancelled',
  'work_items.materialized',
  'provider_routed',
  'tool_call_started',
  'tool_call_completed',
  'approval_requested',
  'approval_resolved',
  'config_change_proposed',
  'config_change_approved',
  'config_change_applied',
  'config_change_failed',
  'file_changed',
  'cost_updated',
  'agent_invocation_requested',
  'agent_invocation_started',
  'agent_invocation_completed',
  'agent_invocation_failed',
  'agent_invocation_cancelled',
  'continuity_decided',
  'error_recorded',
  'turn_completed',
  'work_item_updated',
  'work_item_execution_started',
  'work_item_execution_finished',
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
  private readonly appendQueues = new Map<string, Promise<void>>();

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

  async appendNext(sessionId: string, event: PersistedTranscriptEventDraft): Promise<PersistedTranscriptEvent | null> {
    const appended = await this.appendManyNext(sessionId, [event]);
    return appended[0] ?? null;
  }

  async appendManyNext(
    sessionId: string,
    events: readonly PersistedTranscriptEventDraft[],
  ): Promise<readonly PersistedTranscriptEvent[]> {
    return this.enqueueAppend(sessionId, () => this.appendManyNextNow(sessionId, events));
  }

  private async enqueueAppend<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.appendQueues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current, () => current);
    this.appendQueues.set(sessionId, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.appendQueues.get(sessionId) === queued) {
        this.appendQueues.delete(sessionId);
      }
    }
  }

  private async appendManyNextNow(
    sessionId: string,
    drafts: readonly PersistedTranscriptEventDraft[],
  ): Promise<readonly PersistedTranscriptEvent[]> {
    try {
      const dir = this.sessionDir(sessionId);
      await mkdir(dir, { recursive: true });
      const existing = await this.readTranscript(sessionId);
      const existingEventIds = new Set(existing.map((event) => event.eventId));
      let sequence = existing.reduce((highest, event) => Math.max(highest, event.sequence), 0);
      const events: PersistedTranscriptEvent[] = [];
      for (const draft of drafts) {
        if (existingEventIds.has(draft.eventId)) {
          continue;
        }
        sequence += 1;
        const event = {
          ...draft,
          sequence,
        };
        if (isPersistedTranscriptEvent(event)) {
          events.push(event);
          existingEventIds.add(event.eventId);
        }
      }
      await writeTranscriptEvents(dir, events);
      return events;
    } catch {
      return [];
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
          ...(updates.providerTokenUsage !== undefined ? {
            providerTokenUsage: mergePersistedProviderTokenUsage(existing.providerTokenUsage, updates.providerTokenUsage),
          } : {}),
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

async function writeTranscriptEvents(
  sessionDir: string,
  events: readonly PersistedTranscriptEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  await appendFile(join(sessionDir, 'transcript.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf-8');
}

function decodeSessionPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
