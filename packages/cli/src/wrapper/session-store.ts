import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { appendFile, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import type { ResumeFeedback, ResumeOutcome, ResumeStrategy } from './index.js';
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
  type ProjectStateRootOptions,
} from '../application/project-state-root.js';
import {
  assertPrivateStateFileTarget,
  ensurePrivateStateDirectory,
} from '../application/private-project-state-filesystem.js';
import type {
  CanonicalSessionEventKind,
  ExecutionSessionBindingEvidence,
  SessionEventEnvelope,
  SessionEventSource,
  SessionTurnOutcome,
} from '@kilnai/core';
import { executionSessionBindingKey } from '@kilnai/core';
import {
  assertPersistableAuthorityAdmissionBundle,
  defineEffectiveAuthorityAdmissionBundle,
  defineRuntimeSessionAuthorityFacet,
  type EffectiveAuthorityAdmissionBundle,
} from '@kilnai/runtime';

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
  readonly updateContinuationTarget?: boolean;
}

/** Explicit private location for session and transcript state. */
export interface SessionStoreLocation {
  readonly sessionsPath: string;
  /** Canonical private root when this location comes from a project binding. */
  readonly privateStateRoot?: string;
}

export type SessionStoreSource = string | SessionStoreLocation | ProjectStateBinding;

interface ContinuationTargetsFile {
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

function resolveSessionStoreLocation(
  source: SessionStoreSource,
  options: ProjectStateRootOptions,
): SessionStoreLocation {
  if (typeof source === 'string') {
    const binding = resolveProjectStateBinding(source, options);
    return { sessionsPath: binding.sessionsPath, privateStateRoot: binding.projectStateRoot };
  }
  if ('projectStateRoot' in source && typeof source.projectStateRoot === 'string') {
    return { sessionsPath: source.sessionsPath, privateStateRoot: source.projectStateRoot };
  }
  return source;
}

function resolveSessionDirectory(baseDir: string, sessionId: string): string {
  const root = resolve(baseDir);
  const segment = encodeSessionPathSegment(sessionId);
  const candidate = resolve(root, segment);
  if (candidate === root || !candidate.startsWith(`${root}${sep}`)) {
    throw new Error('Session identifier escapes the private session state root.');
  }
  return candidate;
}

export class SessionStore {
  private readonly baseDir: string;
  private readonly filePath: string;
  private readonly continuationTargetsPath: string;

  constructor(source: SessionStoreSource, options: ProjectStateRootOptions = {}) {
    const location = resolveSessionStoreLocation(source, options);
    this.baseDir = location.sessionsPath;
    this.filePath = join(location.sessionsPath, 'sessions.jsonl');
    this.continuationTargetsPath = join(location.sessionsPath, 'continuation-targets.json');
  }

  async append(record: SessionRecord, options: SessionRecordAppendOptions = {}): Promise<void> {
    try {
      const dir = join(this.filePath, '..');
      await ensurePrivateStateDirectory(this.baseDir, dir, true);
      const currentRecords = await this.readRecords();
      const previous = currentRecords.findLast((entry) => entry.sessionId === record.sessionId);
      const records = currentRecords.filter((entry) => entry.sessionId !== record.sessionId);
      records.push(mergeRepeatedSessionRecord(previous, record));
      await this.writeRecords(records);
      if (options.updateContinuationTarget !== false) {
        await this.setContinuationTarget(record);
      }
    } catch (err) {
      console.error('[SessionStore] Failed to append session record:', err);
    }
  }

  private async writeRecords(records: readonly SessionRecord[]): Promise<void> {
    const dir = join(this.filePath, '..');
    await ensurePrivateStateDirectory(this.baseDir, dir, true);
    await assertPrivateStateFileTarget(this.baseDir, this.filePath);
    const content = records.map(serializeSessionRecord).join('\n');
    await writeFile(this.filePath, content ? `${content}\n` : '', 'utf-8');
  }

  private async readRecords(): Promise<SessionRecord[]> {
    try {
      await ensurePrivateStateDirectory(this.baseDir, join(this.filePath, '..'), false);
      await assertPrivateStateFileTarget(this.baseDir, this.filePath);
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

  private async readContinuationTargets(): Promise<ContinuationTargetsFile> {
    try {
      await ensurePrivateStateDirectory(this.baseDir, join(this.continuationTargetsPath, '..'), false);
      await assertPrivateStateFileTarget(this.baseDir, this.continuationTargetsPath);
      const parsed = JSON.parse(await readFile(this.continuationTargetsPath, 'utf-8')) as Partial<ContinuationTargetsFile>;
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

  private async writeContinuationTargets(targets: ContinuationTargetsFile): Promise<void> {
    const dir = join(this.continuationTargetsPath, '..');
    await ensurePrivateStateDirectory(this.baseDir, dir, true);
    await assertPrivateStateFileTarget(this.baseDir, this.continuationTargetsPath);
    await writeFile(this.continuationTargetsPath, JSON.stringify(targets, null, 2), 'utf-8');
  }

  async getContinuationTarget(provider?: string): Promise<SessionRecord | null> {
    const sessionId = await this.getContinuationTargetSessionId(provider);
    return sessionId ? this.find(sessionId) : null;
  }

  async getContinuationTargetSessionId(provider?: string): Promise<string | undefined> {
    const targets = await this.readContinuationTargets();
    return provider ? targets.providerSessionIds?.[provider] : targets.defaultSessionId;
  }

  async setContinuationTarget(record: SessionRecord): Promise<void> {
    try {
      const current = await this.readContinuationTargets();
      await this.writeContinuationTargets({
        defaultSessionId: record.sessionId,
        providerSessionIds: {
          ...(current.providerSessionIds ?? {}),
          [record.provider]: record.sessionId,
        },
      });
    } catch (err) {
      console.error('[SessionStore] Failed to set continuation target:', err);
    }
  }

  async clearContinuationTarget(provider?: string): Promise<void> {
    try {
      if (provider === undefined) {
        await this.writeContinuationTargets({});
        return;
      }
      const current = await this.readContinuationTargets();
      const providerSessionIds = { ...(current.providerSessionIds ?? {}) };
      delete providerSessionIds[provider];
      const nextDefault = current.defaultSessionId && current.defaultSessionId === current.providerSessionIds?.[provider]
        ? undefined
        : current.defaultSessionId;
      await this.writeContinuationTargets({
        ...(nextDefault ? { defaultSessionId: nextDefault } : {}),
        ...(Object.keys(providerSessionIds).length > 0 ? { providerSessionIds } : {}),
      });
    } catch (err) {
      console.error('[SessionStore] Failed to clear continuation target:', err);
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
  executionBindings?: readonly ExecutionSessionBindingEvidence[];
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

/** One immutable full Runtime authority bundle, indexed by its turn. */
export interface PersistedAuthorityAdmissionRecord {
  readonly schemaRevision: 1;
  readonly sessionId: string;
  readonly turnId: string;
  readonly admissionId: `sha256:${string}`;
  readonly bundle: EffectiveAuthorityAdmissionBundle;
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

function mergeExecutionBindings(
  existing: readonly ExecutionSessionBindingEvidence[] | undefined,
  updates: readonly ExecutionSessionBindingEvidence[],
): readonly ExecutionSessionBindingEvidence[] {
  const bindings = new Map<string, ExecutionSessionBindingEvidence>();
  for (const binding of [...(existing ?? []), ...updates]) {
    bindings.set(executionSessionBindingKey(binding), binding);
  }
  return [...bindings.values()];
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

export class IncompatibleTranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleTranscriptError';
  }
}

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
  'operator_adoption_decision',
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
  'context_usage_observed',
  'effective_prompt_observed',
  'lifecycle_attribution_recorded',
  'agent_invocation_requested',
  'agent_invocation_started',
  'agent_invocation_completed',
  'agent_invocation_failed',
  'agent_invocation_cancelled',
  'managed_economic_lifecycle',
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

function requiredToolIdentityField(
  event: PersistedTranscriptEvent,
  field: 'toolCallId' | 'toolCallScopeId',
): string {
  const value = event.payload[field];
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new IncompatibleTranscriptError(
      `Transcript event "${event.eventId}" requires a trimmed, non-empty ${field}.`,
    );
  }
  return value;
}

function validateTranscriptToolIdentities(events: readonly PersistedTranscriptEvent[]): void {
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.kind !== 'tool_call_started' && event.kind !== 'tool_call_completed') {
      continue;
    }
    const toolCallId = requiredToolIdentityField(event, 'toolCallId');
    const toolCallScopeId = requiredToolIdentityField(event, 'toolCallScopeId');
    const identity = `${toolCallScopeId}\0${toolCallId}`;
    if (event.kind === 'tool_call_started') {
      if (started.has(identity)) {
        throw new IncompatibleTranscriptError(
          `Transcript contains duplicate tool call identity "${toolCallId}" in scope "${toolCallScopeId}".`,
        );
      }
      started.add(identity);
      continue;
    }
    if (!started.has(identity)) {
      throw new IncompatibleTranscriptError(
        `Transcript tool result "${event.eventId}" has no matching scoped tool start.`,
      );
    }
    if (completed.has(identity)) {
      throw new IncompatibleTranscriptError(
        `Transcript contains duplicate tool result identity "${toolCallId}" in scope "${toolCallScopeId}".`,
      );
    }
    completed.add(identity);
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

export class TranscriptStore {
  private readonly baseDir: string;
  readonly privateStateRoot?: string;
  private readonly appendQueues = new Map<string, Promise<void>>();

  constructor(source: SessionStoreSource, options: ProjectStateRootOptions = {}) {
    const location = resolveSessionStoreLocation(source, options);
    this.baseDir = location.sessionsPath;
    this.privateStateRoot = location.privateStateRoot;
  }

  sessionDir(sessionId: string): string {
    return resolveSessionDirectory(this.baseDir, sessionId);
  }

  authorityAdmissionEvidencePath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'authority-admissions.jsonl');
  }

  authorityAdmissionLockPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'authority-admissions.lock');
  }

  async appendAuthorityAdmission(record: PersistedAuthorityAdmissionRecord): Promise<void> {
    if (!isPersistedAuthorityAdmissionRecord(record)) {
      throw new IncompatibleTranscriptError('Authority admission evidence does not satisfy its persisted record contract.');
    }
    try {
      assertPersistableAuthorityAdmissionBundle(record.bundle);
    } catch (error) {
      throw new IncompatibleTranscriptError(`Authority admission evidence is not a valid immutable bundle: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.enqueueAppend(record.sessionId, async () => {
      const existing = await this.readAuthorityAdmissions(record.sessionId);
      const candidateFacet = authorityFacetFromBundle(record.bundle);
      if (existing.some((entry) => authorityFacetFromBundle(entry.bundle).facetId !== candidateFacet.facetId)) {
        throw new IncompatibleTranscriptError(`Authority admission evidence contains conflicting session facets for "${record.sessionId}".`);
      }
      const previous = existing.find((entry) => entry.turnId === record.turnId);
      if (previous) {
        if (previous.admissionId === record.admissionId && JSON.stringify(previous.bundle) === JSON.stringify(record.bundle)) return;
        throw new IncompatibleTranscriptError(`Authority admission conflict for turn "${record.turnId}".`);
      }
      const dir = this.sessionDir(record.sessionId);
      await ensurePrivateStateDirectory(this.baseDir, dir, true);
      await writeAuthorityAdmissionRecords(this.authorityAdmissionEvidencePath(record.sessionId), [...existing, record]);
    });
  }

  async readAuthorityAdmissions(sessionId: string): Promise<PersistedAuthorityAdmissionRecord[]> {
    try {
      await ensurePrivateStateDirectory(this.baseDir, this.sessionDir(sessionId), false);
      const filePath = this.authorityAdmissionEvidencePath(sessionId);
      await assertPrivateStateFileTarget(this.baseDir, filePath);
      const content = await readFile(filePath, 'utf-8');
      const records = content.split('\n').filter((line) => line.trim() !== '').map((line, index) => {
        let parsed: unknown;
        try { parsed = JSON.parse(line) as unknown; } catch { throw new IncompatibleTranscriptError(`Authority admission evidence line ${index + 1} is not valid JSON.`); }
        if (!isPersistedAuthorityAdmissionRecord(parsed)) {
          throw new IncompatibleTranscriptError(`Authority admission evidence line ${index + 1} is malformed.`);
        }
        let normalizedBundle: EffectiveAuthorityAdmissionBundle;
        try {
          normalizedBundle = assertPersistableAuthorityAdmissionBundle(defineEffectiveAuthorityAdmissionBundle(parsed.bundle));
        } catch (error) {
          throw new IncompatibleTranscriptError(`Authority admission evidence line ${index + 1} has an invalid bundle: ${error instanceof Error ? error.message : String(error)}`);
        }
        return Object.freeze({ ...parsed, bundle: normalizedBundle });
      });
      const turnIds = new Set<string>();
      for (const record of records) {
        if (turnIds.has(record.turnId)) throw new IncompatibleTranscriptError(`Authority admission evidence repeats turn "${record.turnId}".`);
        turnIds.add(record.turnId);
      }
      return records;
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  /** Reads all persisted full bundles for this project for derived status projections. */
  async readAllAuthorityAdmissions(): Promise<readonly PersistedAuthorityAdmissionRecord[]> {
    const sessionIds = await this.listSessions();
    const records: PersistedAuthorityAdmissionRecord[] = [];
    for (const sessionId of sessionIds) {
      records.push(...await this.readAuthorityAdmissions(sessionId));
    }
    return records.sort((left, right) => left.bundle.admittedAt.localeCompare(right.bundle.admittedAt)
      || left.turnId.localeCompare(right.turnId));
  }

  async init(sessionId: string, meta: PersistedSessionMeta): Promise<void> {
    try {
      const dir = this.sessionDir(sessionId);
      await ensurePrivateStateDirectory(this.baseDir, dir, true);
      const filePath = join(dir, 'meta.json');
      await assertPrivateStateFileTarget(this.baseDir, filePath);
      await writeFile(filePath, serializePersistedMeta(meta), 'utf-8');
    } catch {
      // fail-open
    }
  }

  async append(sessionId: string, event: PersistedTranscriptEvent): Promise<void> {
    const existing = await this.readTranscript(sessionId);
    validateTranscriptToolIdentities([...existing, event]);
    const dir = this.sessionDir(sessionId);
    await ensurePrivateStateDirectory(this.baseDir, dir, true);
    const filePath = join(dir, 'transcript.jsonl');
    await assertPrivateStateFileTarget(this.baseDir, filePath);
    await appendFile(filePath, JSON.stringify(event) + '\n', 'utf-8');
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
    const dir = this.sessionDir(sessionId);
    await ensurePrivateStateDirectory(this.baseDir, dir, true);
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
      if (!isPersistedTranscriptEvent(event)) {
        throw new IncompatibleTranscriptError(
          `Transcript event "${draft.eventId}" does not satisfy the persisted event contract.`,
        );
      }
      events.push(event);
      existingEventIds.add(event.eventId);
    }
    validateTranscriptToolIdentities([...existing, ...events]);
    await writeTranscriptEvents(dir, events);
    return events;
  }

  async finalize(sessionId: string, updates: Partial<PersistedSessionMeta>): Promise<void> {
    try {
      const dir = this.sessionDir(sessionId);
      const filePath = join(dir, 'meta.json');
      const existing = await this.readMeta(sessionId);
      if (!existing) {
        return;
      }
      await ensurePrivateStateDirectory(this.baseDir, dir, false);
      await assertPrivateStateFileTarget(this.baseDir, filePath);
      await writeFile(
        filePath,
        serializePersistedMeta({
          ...existing,
          ...updates,
          ...(updates.providerTokenUsage !== undefined ? {
            providerTokenUsage: mergePersistedProviderTokenUsage(existing.providerTokenUsage, updates.providerTokenUsage),
          } : {}),
          ...(updates.executionBindings !== undefined ? {
            executionBindings: mergeExecutionBindings(existing.executionBindings, updates.executionBindings),
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
      await ensurePrivateStateDirectory(this.baseDir, this.sessionDir(sessionId), false);
      const filePath = join(this.sessionDir(sessionId), 'meta.json');
      await assertPrivateStateFileTarget(this.baseDir, filePath);
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as PersistedSessionMeta;
    } catch {
      return null;
    }
  }

  async readTranscript(sessionId: string): Promise<PersistedTranscriptEvent[]> {
    try {
      await ensurePrivateStateDirectory(this.baseDir, this.sessionDir(sessionId), false);
      const filePath = join(this.sessionDir(sessionId), 'transcript.jsonl');
      await assertPrivateStateFileTarget(this.baseDir, filePath);
      const content = await readFile(filePath, 'utf-8');
      const events = content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line, index) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            if (isPersistedTranscriptEvent(parsed)) {
              return parsed;
            }
            throw new IncompatibleTranscriptError(
              `Transcript line ${index + 1} does not satisfy the persisted event contract.`,
            );
          } catch (error) {
            if (error instanceof IncompatibleTranscriptError) {
              throw error;
            }
            throw new IncompatibleTranscriptError(`Transcript line ${index + 1} is not valid JSON.`);
          }
        });
      validateTranscriptToolIdentities(events);
      return events;
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }
  }

  async listSessions(): Promise<string[]> {
    try {
      await ensurePrivateStateDirectory(this.baseDir, this.baseDir, false);
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
  const filePath = join(sessionDir, 'transcript.jsonl');
  await assertPrivateStateFileTarget(sessionDir, filePath);
  await appendFile(filePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf-8');
}

function authorityFacetFromBundle(bundle: EffectiveAuthorityAdmissionBundle) {
  return defineRuntimeSessionAuthorityFacet({
    sessionId: bundle.sessionId,
    sessionRevision: bundle.configuration.sessionRevision,
    ...bundle.session,
  });
}

function isPersistedAuthorityAdmissionRecord(value: unknown): value is PersistedAuthorityAdmissionRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<PersistedAuthorityAdmissionRecord>;
  return candidate.schemaRevision === 1
    && typeof candidate.sessionId === 'string' && candidate.sessionId.trim().length > 0
    && typeof candidate.turnId === 'string' && candidate.turnId.trim().length > 0
    && typeof candidate.admissionId === 'string' && /^sha256:[a-f0-9]{64}$/u.test(candidate.admissionId)
    && candidate.bundle !== null && typeof candidate.bundle === 'object' && !Array.isArray(candidate.bundle)
    && (candidate.bundle as { sessionId?: unknown }).sessionId === candidate.sessionId
    && (candidate.bundle as { turnId?: unknown }).turnId === candidate.turnId
    && (candidate.bundle as { admissionId?: unknown }).admissionId === candidate.admissionId;
}

async function writeAuthorityAdmissionRecords(
  filePath: string,
  records: readonly PersistedAuthorityAdmissionRecord[],
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await assertPrivateStateFileTarget(dirname(filePath), filePath);
    await writeFile(temporaryPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function decodeSessionPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
