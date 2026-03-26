import type { MemoryEntry, MemoryStore } from "@kilnai/core";

interface ExtendedMemoryStore extends MemoryStore {
  listEntries(options?: { limit?: number; tags?: string }): readonly MemoryEntry[];
}

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

export class SwarmStore {
  private readonly store: ExtendedMemoryStore;

  constructor(store: MemoryStore) {
    if (!this.isExtendedMemoryStore(store)) {
      throw new Error("SwarmStore requires a memory store with listEntries");
    }
    this.store = store;
  }

  async join(
    swarmId: string,
    agentId: string,
    description?: string,
    _ttlSeconds?: number,
  ): Promise<{ members: string[] }> {
    const swarmTag = this.swarmTag(swarmId);
    const memberTag = this.memberTag(agentId);
    const existing = this.store.listEntries({ tags: `${swarmTag},${memberTag}`, limit: 1000000 });

    if (existing.length === 0) {
      const payload: SwarmMemberPayload = {
        agentId,
        description,
        joinedAt: new Date().toISOString(),
      };
      await this.store.save({
        layer: "project",
        content: JSON.stringify(payload),
        tags: [swarmTag, memberTag],
      });
    }

    return { members: this.currentMembers(swarmId) };
  }

  async leave(swarmId: string, agentId: string): Promise<void> {
    const swarmTag = this.swarmTag(swarmId);
    const memberTag = this.memberTag(agentId);
    const memberEntries = this.store.listEntries({ tags: `${swarmTag},${memberTag}`, limit: 1000000 });
    const claimEntries = this.store.listEntries({ tags: swarmTag, limit: 1000000 }).filter((entry) => {
      if (!entry.tags.some((tag) => tag.startsWith("_claim:"))) return false;
      const claim = this.parseJson<SwarmClaimPayload>(entry.content);
      return claim?.agentId === agentId;
    });
    const entries = [...memberEntries, ...claimEntries];
    await Promise.all(entries.map((entry) => this.store.forget(entry.id)));
  }

  async status(
    swarmId: string,
  ): Promise<{
    members: { agentId: string; description?: string; joinedAt: string }[];
    claims: { resourceId: string; agentId: string; claimedAt: string }[];
  }> {
    const entries = this.store.listEntries({ tags: this.swarmTag(swarmId), limit: 1000000 });
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
    const id = await this.store.save({
      layer: "project",
      content: JSON.stringify({
        agentId,
        message,
        sentAt: new Date().toISOString(),
      } satisfies SwarmBroadcastPayload),
      tags: [this.swarmTag(swarmId), "_broadcast", `_from:${agentId}`],
    });
    return { id };
  }

  async claim(
    swarmId: string,
    agentId: string,
    resourceId: string,
  ): Promise<{ claimed: boolean; claimedBy?: string }> {
    const entries = this.store.listEntries({
      tags: `${this.swarmTag(swarmId)},${this.claimTag(resourceId)}`,
      limit: 1000000,
    });

    if (entries.length > 0) {
      const existing = this.parseJson<SwarmClaimPayload>(entries[0]!.content);
      if (existing?.agentId === agentId) {
        return { claimed: true };
      }
      return { claimed: false, claimedBy: existing?.agentId };
    }

    await this.store.save({
      layer: "project",
      content: JSON.stringify({
        agentId,
        resourceId,
        claimedAt: new Date().toISOString(),
      } satisfies SwarmClaimPayload),
      tags: [this.swarmTag(swarmId), this.claimTag(resourceId)],
    });
    return { claimed: true };
  }

  async release(swarmId: string, agentId: string, resourceId: string): Promise<void> {
    const entries = this.store.listEntries({
      tags: `${this.swarmTag(swarmId)},${this.claimTag(resourceId)}`,
      limit: 1000000,
    });
    await Promise.all(entries.map(async (entry) => {
      const claim = this.parseJson<SwarmClaimPayload>(entry.content);
      if (claim?.agentId === agentId) {
        await this.store.forget(entry.id);
      }
    }));
  }

  private currentMembers(swarmId: string): string[] {
    const entries = this.store.listEntries({ tags: this.swarmTag(swarmId), limit: 1000000 });
    return [...new Set(
      entries
        .filter((entry) => entry.tags.some((tag) => tag.startsWith("_member:")))
        .map((entry) => entry.tags.find((tag) => tag.startsWith("_member:")) ?? "")
        .filter(Boolean)
        .map((tag) => tag.slice("_member:".length)),
    )];
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

  private isExtendedMemoryStore(store: MemoryStore): store is ExtendedMemoryStore {
    return (
      typeof (store as Partial<ExtendedMemoryStore>).listEntries === "function"
    );
  }
}
