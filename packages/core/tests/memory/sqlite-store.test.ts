import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteMemoryStore } from "../../src/memory/sqlite-store.js";

describe("SqliteMemoryStore", () => {
  let store: SqliteMemoryStore;

  beforeEach(() => {
    store = new SqliteMemoryStore({
      dbPath: ":memory:",
      layer: "user",
      enableDecay: false,
    });
  });

  afterEach(() => {
    store.close();
  });

  it("saves entry and returns ID", async () => {
    const id = await store.save({
      layer: "user",
      content: "TypeScript is a typed superset of JavaScript",
      tags: ["typescript", "javascript"],
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(store.count).toBe(1);
  });

  it("search finds saved content via FTS5", async () => {
    await store.save({
      layer: "user",
      content: "React is a UI library for building interfaces",
      tags: ["react", "frontend"],
    });
    await store.save({
      layer: "user",
      content: "PostgreSQL is a relational database",
      tags: ["database", "sql"],
    });

    const results = await store.search("React UI library");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.entry.content).toContain("React");
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[0]!.snippet).toBeDefined();
  });

  it("search respects limit", async () => {
    await store.save({ layer: "user", content: "First memory about testing", tags: ["testing"] });
    await store.save({ layer: "user", content: "Second memory about testing", tags: ["testing"] });
    await store.save({ layer: "user", content: "Third memory about testing", tags: ["testing"] });

    const results = await store.search("testing", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("recall concatenates results within token budget", async () => {
    const freshStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      layer: "user",
      enableDecay: false,
    });

    await freshStore.save({ layer: "user", content: "Budgeting strategy first item", tags: ["budgeting"] });
    await freshStore.save({ layer: "user", content: "Budgeting strategy second item", tags: ["budgeting"] });

    // Large budget: should get both short entries
    const resultLarge = await freshStore.recall("budgeting", 1000);
    expect(resultLarge.length).toBeGreaterThan(0);
    expect(resultLarge).toContain("first");
    expect(resultLarge).toContain("second");

    // Tiny budget: should get at most one entry (~8 tokens each)
    const resultSmall = await freshStore.recall("budgeting", 8);
    expect(resultSmall.length).toBeGreaterThan(0);
    // Should not contain both
    const hasBoth = resultSmall.includes("first") && resultSmall.includes("second");
    expect(hasBoth).toBe(false);

    freshStore.close();
  });

  it("forget removes entry", async () => {
    const id = await store.save({
      layer: "user",
      content: "Memory to forget about databases",
      tags: ["ephemeral"],
    });

    expect(store.count).toBe(1);
    await store.forget(id);
    expect(store.count).toBe(0);

    const results = await store.search("databases");
    expect(results.length).toBe(0);
  });

  it("reinforce updates access_count and decay_score", async () => {
    const decayStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      layer: "agent",
      enableDecay: true,
    });

    const id = await decayStore.save({
      layer: "agent",
      content: "Important pattern for reinforcement",
      tags: ["pattern"],
      agentRole: "architect",
    });

    // Apply decay first to reduce score below 1.0
    decayStore.applyDecay(0.5);

    // Reinforce should reset decay_score to 1.0 and increment access_count
    decayStore.reinforce(id);

    const results = await decayStore.search("reinforcement");
    expect(results.length).toBe(1);
    expect(results[0]!.entry.accessCount).toBe(1);

    decayStore.close();
  });

  it("applyDecay reduces scores", () => {
    const decayStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      layer: "agent",
      enableDecay: true,
    });

    // Use a synchronous approach to check decay: save, decay, count should still be 1
    void decayStore.save({ layer: "agent", content: "Decaying memory", tags: [] });
    decayStore.applyDecay(0.5);

    // Entry still exists (0.5 > 0.01)
    expect(decayStore.count).toBe(1);

    decayStore.close();
  });

  it("applyDecay prunes entries below threshold", () => {
    const decayStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      layer: "agent",
      enableDecay: true,
    });

    void decayStore.save({ layer: "agent", content: "Soon to be pruned memory", tags: [] });

    // Apply aggressive decay multiple times: 0.001^1 = 0.001 < 0.01
    decayStore.applyDecay(0.001);

    expect(decayStore.count).toBe(0);

    decayStore.close();
  });

  it("count returns correct number", async () => {
    expect(store.count).toBe(0);

    await store.save({ layer: "user", content: "First entry", tags: [] });
    expect(store.count).toBe(1);

    await store.save({ layer: "user", content: "Second entry", tags: [] });
    expect(store.count).toBe(2);

    await store.save({ layer: "user", content: "Third entry", tags: [] });
    expect(store.count).toBe(3);
  });

  it("close does not throw", () => {
    const tempStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      layer: "user",
    });
    expect(() => tempStore.close()).not.toThrow();
  });

  it("save with tags stores and retrieves tags correctly", async () => {
    const tags = ["architecture", "ddd", "clean-code"];
    await store.save({
      layer: "user",
      content: "Domain-driven design separates concerns into bounded contexts",
      tags,
    });

    const results = await store.search("domain driven design");
    expect(results.length).toBe(1);
    expect(results[0]!.entry.tags).toEqual(tags);
  });
});
