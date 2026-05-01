import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteMemoryRepository } from "@kilnai/core";
import { SwarmStore } from "../../src/mcp/swarm-store.js";

describe("SwarmStore", () => {
  let memoryRepository: SqliteMemoryRepository;
  let swarmStore: SwarmStore;

  beforeEach(() => {
    memoryRepository = new SqliteMemoryRepository({ dbPath: ":memory:" });
    swarmStore = new SwarmStore({ repository: memoryRepository });
  });

  afterEach(() => {
    memoryRepository.close();
  });

  it("join adds member entry and returns members list", async () => {
    const result = await swarmStore.join("swarm-a", "agent-1", "Planner");
    expect(result.members).toEqual(["agent-1"]);

    const entries = memoryRepository.listRecords({
      layer: "coordination",
      tags: ["_swarm:swarm-a", "_member:agent-1"],
    });
    expect(entries).toHaveLength(1);
  });

  it("join twice same agent is idempotent (no duplicate entries)", async () => {
    await swarmStore.join("swarm-a", "agent-1");
    await swarmStore.join("swarm-a", "agent-1");

    const entries = memoryRepository.listRecords({
      layer: "coordination",
      tags: ["_swarm:swarm-a", "_member:agent-1"],
      limit: 500,
    });
    expect(entries).toHaveLength(1);
  });

  it("leave removes member entries", async () => {
    await swarmStore.join("swarm-a", "agent-1");
    await swarmStore.leave("swarm-a", "agent-1");

    const entries = memoryRepository.listRecords({
      layer: "coordination",
      tags: ["_swarm:swarm-a", "_member:agent-1"],
      limit: 500,
    });
    expect(entries).toHaveLength(0);
  });

  it("status returns current members and claims", async () => {
    await swarmStore.join("swarm-a", "agent-1");
    await swarmStore.claim("swarm-a", "agent-1", "file.ts");

    const status = await swarmStore.status("swarm-a");
    expect(status.members).toHaveLength(1);
    expect(status.members[0]!.agentId).toBe("agent-1");
    expect(status.claims).toHaveLength(1);
    expect(status.claims[0]!.resourceId).toBe("file.ts");
  });

  it("claim returns claimed: true when unclaimed", async () => {
    const result = await swarmStore.claim("swarm-a", "agent-1", "file.ts");
    expect(result).toEqual({ claimed: true });
  });

  it("claim returns claimed: false with claimedBy when already claimed by another agent", async () => {
    await swarmStore.claim("swarm-a", "agent-1", "file.ts");
    const result = await swarmStore.claim("swarm-a", "agent-2", "file.ts");
    expect(result).toEqual({ claimed: false, claimedBy: "agent-1" });
  });

  it("claim by same agent returns claimed: true (re-entrancy)", async () => {
    await swarmStore.claim("swarm-a", "agent-1", "file.ts");
    const result = await swarmStore.claim("swarm-a", "agent-1", "file.ts");
    expect(result).toEqual({ claimed: true });
  });

  it("release removes claim only if owned by the requesting agent", async () => {
    await swarmStore.claim("swarm-a", "agent-1", "file.ts");
    await swarmStore.release("swarm-a", "agent-1", "file.ts");

    const entries = memoryRepository.listRecords({
      layer: "coordination",
      tags: ["_swarm:swarm-a", "_claim:file.ts"],
      limit: 500,
    });
    expect(entries).toHaveLength(0);
  });

  it("release does nothing if agent does not own the claim", async () => {
    await swarmStore.claim("swarm-a", "agent-1", "file.ts");
    await swarmStore.release("swarm-a", "agent-2", "file.ts");

    const entries = memoryRepository.listRecords({
      layer: "coordination",
      tags: ["_swarm:swarm-a", "_claim:file.ts"],
      limit: 500,
    });
    expect(entries).toHaveLength(1);
  });

  it("broadcast stores message and returns id", async () => {
    const result = await swarmStore.broadcast("swarm-a", "agent-1", "hello");
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);

    const entries = memoryRepository.listRecords({
      layer: "coordination",
      tags: ["_swarm:swarm-a", "_broadcast"],
      limit: 500,
    });
    expect(entries).toHaveLength(1);
    const payload = JSON.parse(entries[0]!.content) as { message: string; agentId: string };
    expect(payload.message).toBe("hello");
    expect(payload.agentId).toBe("agent-1");
  });
});
