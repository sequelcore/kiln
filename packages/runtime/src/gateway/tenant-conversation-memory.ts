import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  MemoryMutationService,
  selectContextWithinBudget,
  SqliteMemoryRepository,
  type EventBus,
  type MemoryRecord,
  type MemoryRepository,
} from "@kilnai/core";

const DEFAULT_RECALL_LIMIT = 20;
const DEFAULT_TOKEN_BUDGET = 500;
const TOKEN_CHAR_ESTIMATE = 4;

export interface TenantConversationMemoryOptions {
  readonly repository: MemoryRepository;
  readonly eventBus?: EventBus;
}

export interface TenantConversationRecallInput {
  readonly tenantId: string;
  readonly participantId: string;
  readonly query: string;
  readonly tokenBudget?: number;
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

  constructor(options: TenantConversationMemoryOptions) {
    this.repository = options.repository;
    this.eventBus = options.eventBus;
  }

  recall(input: TenantConversationRecallInput): string | undefined {
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

    const queryTerms = tokenize(input.query);
    const candidates = records.map((record, index) => ({
      id: record.id,
      required: false,
      estimatedTokens: estimateTokens(record.content),
      score: scoreRecord(record, queryTerms, index),
      meta: record,
    }));
    const selection = selectContextWithinBudget(
      candidates,
      input.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
    );
    if (selection.selected.length === 0) {
      return undefined;
    }

    return [...selection.selected]
      .sort((left, right) => right.score - left.score)
      .map((candidate) => candidate.meta.content)
      .join("\n\n");
  }

  saveExchange(input: TenantConversationExchangeInput): string {
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
      ],
      provenance: {
        sourceType: "gateway_app",
        sourceId: `${input.appName}:${input.channel}`,
        actor: input.participantId,
        capturedAt: new Date().toISOString(),
      },
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

function scoreRecord(record: MemoryRecord, queryTerms: ReadonlySet<string>, recencyIndex: number): number {
  const contentTerms = tokenize(record.content);
  let overlap = 0;
  for (const term of queryTerms) {
    if (contentTerms.has(term)) {
      overlap += 1;
    }
  }
  return overlap + (1 / (recencyIndex + 1));
}

function tokenize(value: string): ReadonlySet<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 1),
  );
}
