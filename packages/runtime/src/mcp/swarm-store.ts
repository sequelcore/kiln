import {
  MemoryMutationService,
  type EventBus,
  type MemoryRecord,
  type MemoryRepository,
  type MemoryScope,
  trustedInternalMemoryAuthority,
} from "@kilnai/core";

const SWARM_RECORD_LIMIT = 500;
const DEFAULT_SWARM_SCOPE: MemoryScope = { kind: "project", id: "gateway-swarm" };

interface SwarmMemberPayload {
  agentId: string;
  description?: string;
  joinedAt: string;
}

interface SwarmClaimPayload {
  agentId: string;
  resourceId: string;
  claimedAt: string;
}

interface SwarmBroadcastPayload {
  agentId: string;
  message: string;
  sentAt: string;
}

export interface SwarmStoreOptions {
  readonly repository: MemoryRepository;
  readonly eventBus?: EventBus;
  readonly scope?: MemoryScope;
}

export class SwarmStore {
  private readonly repository: MemoryRepository;
  private readonly mutationService: MemoryMutationService;
  private readonly scope: MemoryScope;

  constructor(options: SwarmStoreOptions) {
    this.repository = options.repository;
    this.scope = options.scope ?? DEFAULT_SWARM_SCOPE;
    this.mutationService = new MemoryMutationService({
      repository: options.repository,
      eventBus: options.eventBus,
      sessionId: "mcp:swarm",
      authority: trustedInternalMemoryAuthority(),
    });
  }

  async join(
    swarmId: string,
    agentId: string,
    description?: string,
    _ttlSeconds?: number,
  ): Promise<{ members: string[] }> {
    const swarmTag = this.swarmTag(swarmId);
    const memberTag = this.memberTag(agentId);
    const existing = this.listRecords(swarmTag, memberTag);

    if (existing.length === 0) {
      const payload: SwarmMemberPayload = {
        agentId,
        description,
        joinedAt: new Date().toISOString(),
      };
      this.saveCoordinationRecord(agentId, payload, [swarmTag, memberTag]);
    }

    return { members: this.currentMembers(swarmId) };
  }

  async leave(swarmId: string, agentId: string): Promise<void> {
    const swarmTag = this.swarmTag(swarmId);
    const memberTag = this.memberTag(agentId);
    const memberEntries = this.listRecords(swarmTag, memberTag);
    const claimEntries = this.listRecords(swarmTag).filter((entry) => {
      if (!entry.tags.some((tag) => tag.startsWith("_claim:"))) return false;
      const claim = this.parseJson<SwarmClaimPayload>(entry.content);
      return claim?.agentId === agentId;
    });
    const entries = [...memberEntries, ...claimEntries];
    await Promise.all(entries.map((entry) => this.deleteRecord(entry.id)));
  }

  async status(
    swarmId: string,
  ): Promise<{
    members: { agentId: string; description?: string; joinedAt: string }[];
    claims: { resourceId: string; agentId: string; claimedAt: string }[];
  }> {
    const entries = this.listRecords(this.swarmTag(swarmId));
    const members = entries
      .filter((entry) => entry.tags.some((tag) => tag.startsWith("_member:")))
      .map((entry) => this.parseJson<SwarmMemberPayload>(entry.content))
      .filter((value): value is SwarmMemberPayload => value !== undefined)
      .map((value) => ({
        agentId: value.agentId,
        ...(value.description ? { description: value.description } : {}),
        joinedAt: value.joinedAt,
      }));

    const claims = entries
      .filter((entry) => entry.tags.some((tag) => tag.startsWith("_claim:")))
      .map((entry) => this.parseJson<SwarmClaimPayload>(entry.content))
      .filter((value): value is SwarmClaimPayload => value !== undefined)
      .map((value) => ({
        resourceId: value.resourceId,
        agentId: value.agentId,
        claimedAt: value.claimedAt,
      }));

    return { members, claims };
  }

  async broadcast(swarmId: string, agentId: string, message: string): Promise<{ id: string }> {
    const record = this.saveCoordinationRecord(
      agentId,
      {
        agentId,
        message,
        sentAt: new Date().toISOString(),
      } satisfies SwarmBroadcastPayload,
      [this.swarmTag(swarmId), "_broadcast", `_from:${agentId}`],
    );
    return { id: record.id };
  }

  async claim(
    swarmId: string,
    agentId: string,
    resourceId: string,
  ): Promise<{ claimed: boolean; claimedBy?: string }> {
    const entries = this.listRecords(this.swarmTag(swarmId), this.claimTag(resourceId));

    if (entries.length > 0) {
      const existing = this.parseJson<SwarmClaimPayload>(entries[0]!.content);
      if (existing?.agentId === agentId) {
        return { claimed: true };
      }
      return { claimed: false, claimedBy: existing?.agentId };
    }

    this.saveCoordinationRecord(
      agentId,
      {
        agentId,
        resourceId,
        claimedAt: new Date().toISOString(),
      } satisfies SwarmClaimPayload,
      [this.swarmTag(swarmId), this.claimTag(resourceId)],
    );
    return { claimed: true };
  }

  async release(swarmId: string, agentId: string, resourceId: string): Promise<void> {
    const entries = this.listRecords(this.swarmTag(swarmId), this.claimTag(resourceId));
    await Promise.all(entries.map(async (entry) => {
      const claim = this.parseJson<SwarmClaimPayload>(entry.content);
      if (claim?.agentId === agentId) {
        await this.deleteRecord(entry.id);
      }
    }));
  }

  private currentMembers(swarmId: string): string[] {
    const entries = this.listRecords(this.swarmTag(swarmId));
    return [...new Set(
      entries
        .filter((entry) => entry.tags.some((tag) => tag.startsWith("_member:")))
        .map((entry) => entry.tags.find((tag) => tag.startsWith("_member:")) ?? "")
        .filter(Boolean)
        .map((tag) => tag.slice("_member:".length)),
    )];
  }

  private listRecords(...tags: string[]): readonly MemoryRecord[] {
    return this.repository.listRecords({
      scope: this.scope,
      layer: "coordination",
      tags,
      limit: SWARM_RECORD_LIMIT,
    });
  }

  private saveCoordinationRecord(
    agentId: string,
    payload: SwarmMemberPayload | SwarmClaimPayload | SwarmBroadcastPayload,
    tags: readonly string[],
  ): MemoryRecord {
    return this.mutationService.saveRecord({
      layer: "coordination",
      scope: this.scope,
      content: JSON.stringify(payload),
      tags,
      provenance: {
        sourceType: "agent",
        sourceId: agentId,
        actor: agentId,
        capturedAt: new Date().toISOString(),
      },
    });
  }

  private async deleteRecord(recordId: string): Promise<void> {
    this.mutationService.deleteRecord(recordId);
  }

  private swarmTag(swarmId: string): string {
    return `_swarm:${swarmId}`;
  }

  private memberTag(agentId: string): string {
    return `_member:${agentId}`;
  }

  private claimTag(resourceId: string): string {
    return `_claim:${resourceId}`;
  }

  private parseJson<T>(content: string): T | undefined {
    try {
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }
}
