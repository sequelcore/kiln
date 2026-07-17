import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  defineMemoryEfficiencyUsageReport,
  evaluateMemoryInjectionEligibility,
  MemoryMutationService,
  scoreMemoryRecall,
  SqliteMemoryRepository,
  toMemoryContextCandidates,
  type ContextCandidate,
  type EventBus,
  type MemoryEfficiencyUsageReport,
  type MemoryRecallIntegrityEvidence,
  type MemoryRepository,
  type MemoryScope,
} from "@kilnai/core";

const DEFAULT_RECALL_LIMIT = 20;
const TOKEN_CHAR_ESTIMATE = 4;
const CONVERSATION_MEMORY_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const INTEGRITY_SCHEMA_TAG = "integrity:gateway-exchange-v1";
const POISONED_TAG_PREFIX = "integrity:poisoned:";
const DERIVATIVE_TRUST_TAG = "integrity:derivative-trust:original";
const EXPIRES_AT_TAG_PREFIX = "integrity:expires-at:";

export interface TenantConversationMemoryOptions {
  readonly repository: MemoryRepository;
  readonly eventBus?: EventBus;
  readonly integrityResolver?: (recordId: string) => MemoryRecallIntegrityEvidence | undefined;
}

export interface TenantConversationRecallInput {
  readonly tenantId: string;
  readonly participantId: string;
  readonly query: string;
}

export interface TenantConversationRecallResult {
  readonly candidates: readonly ContextCandidate[];
  readonly usage: MemoryEfficiencyUsageReport;
}

export interface TenantConversationExchangeInput {
  readonly appName: string;
  readonly channel: string;
  readonly tenantId: string;
  readonly participantId: string;
  readonly userMessage: string;
  readonly assistantMessage: string;
}

export class TenantConversationMemory {
  private readonly repository: MemoryRepository;
  private readonly eventBus: EventBus | undefined;
  private readonly integrityResolver: TenantConversationMemoryOptions["integrityResolver"];

  constructor(options: TenantConversationMemoryOptions) {
    this.repository = options.repository;
    this.eventBus = options.eventBus;
    this.integrityResolver = options.integrityResolver
      ?? ((recordId) => resolvePersistedConversationIntegrity(this.repository, recordId));
  }

  recall(input: TenantConversationRecallInput): TenantConversationRecallResult | undefined {
    const participantTag = participantMemoryTag(input.participantId);
    const records = this.repository.listRecords({
      scope: { kind: "tenant", id: input.tenantId },
      layer: "episodic",
      tags: [participantTag],
      limit: DEFAULT_RECALL_LIMIT,
    });
    if (records.length === 0) {
      return undefined;
    }

    const recall = scoreMemoryRecall({
      now: new Date().toISOString(),
      scope: { kind: "tenant", id: input.tenantId },
      cues: [input.query],
      records: records.map((record) => ({
        record,
        estimatedTokens: estimateTokens(record.content),
      })),
    });
    const injection = evaluateMemoryInjectionEligibility(recall.eligible, recall.eligible.flatMap((candidate) => {
      const integrity = this.integrityResolver?.(candidate.record.id);
      return integrity ? [{ recordId: candidate.record.id, integrity }] : [];
    }));
    const candidates = toMemoryContextCandidates(recall.eligible, injection);
    if (candidates.length === 0) {
      return undefined;
    }
    return {
      candidates,
      usage: defineMemoryEfficiencyUsageReport({
        version: "memory-efficiency-usage-v1",
        entries: records.map((record) => ({
          operation: "recall",
          layer: record.layer,
          tokens: { value: estimateTokens(record.content), source: "estimated" },
          costUsd: { value: "unknown", source: "unknown" },
          latencyMs: { value: "unknown", source: "unknown" },
          evidenceUris: [`kiln://memory/nodes/${record.id}`],
        })),
      }),
    };
  }

  saveExchange(input: TenantConversationExchangeInput): string {
    const capturedAt = new Date();
    const poisoned = isPotentialPromptInjection(input.userMessage);
    const mutationService = new MemoryMutationService({
      repository: this.repository,
      eventBus: this.eventBus,
      sessionId: `${input.appName}:${input.channel}`,
      tenantId: input.tenantId,
    });
    const record = mutationService.saveRecord({
      layer: "episodic",
      scope: { kind: "tenant", id: input.tenantId },
      content: `User: ${input.userMessage}\nAssistant: ${input.assistantMessage}`,
      tags: [
        channelMemoryTag(input.channel),
        appMemoryTag(input.appName),
        participantMemoryTag(input.participantId),
        INTEGRITY_SCHEMA_TAG,
        `${POISONED_TAG_PREFIX}${poisoned}`,
        DERIVATIVE_TRUST_TAG,
        `${EXPIRES_AT_TAG_PREFIX}${new Date(capturedAt.getTime() + CONVERSATION_MEMORY_TTL_MS).toISOString()}`,
      ],
      provenance: {
        sourceType: "gateway_app",
        sourceId: `${input.appName}:${input.channel}`,
        actor: input.participantId,
        capturedAt: capturedAt.toISOString(),
      },
    }, {
      durability: "short_lived",
      futureTaskValue: 0.5,
      contradictionState: "none",
      derivativeTrust: "original",
      canonicalEvidenceUris: [],
    });
    return record.id;
  }
}

export function createTenantConversationMemoryRepository(memoryBasePath: string): SqliteMemoryRepository {
  mkdirSync(memoryBasePath, { recursive: true });
  return new SqliteMemoryRepository({ dbPath: join(memoryBasePath, "memory.db") });
}

export function participantMemoryTag(participantId: string): string {
  return `participant:${participantId}`;
}

function channelMemoryTag(channel: string): string {
  return `channel:${channel}`;
}

function appMemoryTag(appName: string): string {
  return `app:${appName}`;
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / TOKEN_CHAR_ESTIMATE));
}

function resolvePersistedConversationIntegrity(
  repository: MemoryRepository,
  recordId: string,
): MemoryRecallIntegrityEvidence | undefined {
  const record = repository.getRecord(recordId);
  if (!record || !record.tags.includes(INTEGRITY_SCHEMA_TAG) || !record.tags.includes(DERIVATIVE_TRUST_TAG)) {
    return undefined;
  }
  const poisonedValue = uniqueTagValue(record.tags, POISONED_TAG_PREFIX);
  const expiresAt = uniqueTagValue(record.tags, EXPIRES_AT_TAG_PREFIX);
  if ((poisonedValue !== "true" && poisonedValue !== "false")
    || expiresAt === undefined || !Number.isFinite(Date.parse(expiresAt))) {
    return undefined;
  }
  const incomingRelations = repository.listIncomingRelations(record.id, { sourceScope: record.scope });
  const superseded = incomingRelations.some((relation) => relation.type === "supersedes");
  const contradictionSources = incomingRelations
    .filter((relation) => relation.type === "contradicts")
    .map((relation) => relation.sourceRecordId);
  const unresolvedContradiction = contradictionSources.some((sourceId) => !isRecordSuperseded(
    repository,
    sourceId,
    record.scope,
  ));
  return {
    contradictionState: unresolvedContradiction ? "unresolved"
      : contradictionSources.length > 0 ? "resolved" : "none",
    superseded,
    poisoned: poisonedValue === "true",
    derivativeTrust: "original",
    expired: Date.now() >= Date.parse(expiresAt),
    canonicalEvidenceAvailable: repository.getRecord(record.id) !== undefined,
  };
}

function isRecordSuperseded(
  repository: MemoryRepository,
  recordId: string,
  sourceScope: MemoryScope,
): boolean {
  return repository.listIncomingRelations(recordId, { sourceScope }).some((relation) => relation.type === "supersedes");
}

function uniqueTagValue(tags: readonly string[], prefix: string): string | undefined {
  const values = tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length));
  return values.length === 1 ? values[0] : undefined;
}

function isPotentialPromptInjection(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/gu, " ");
  return /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:previous|prior|system|developer|instructions?)\b/u.test(normalized)
    || /\b(?:reveal|expose|print|return|leak)\b.{0,80}\b(?:system prompt|developer message|credentials?|secrets?|another tenant)\b/u.test(normalized)
    || /\b(?:act as|pretend to be)\b.{0,60}\b(?:system|developer|administrator|root)\b/u.test(normalized);
}
