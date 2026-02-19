import { describe, it, expect } from "vitest";
import type { Memory, MemoryScope, MemoryEntry } from "../../src/engine/domain/memory.js";

describe("Memory interface", () => {
  it("accepts all 5 scope patterns as valid MemoryScope values", () => {
    const scopes: MemoryScope[] = [
      "user",
      "agent:architect",
      "team:development",
      "project:/path/to/project",
      "org",
    ];
    expect(scopes).toHaveLength(5);
  });

  it("template literal scopes accept any string suffix", () => {
    const agentScope: MemoryScope = "agent:any-role-name";
    const teamScope: MemoryScope = "team:any-team-name";
    const projectScope: MemoryScope = "project:/any/path";
    expect(agentScope).toBe("agent:any-role-name");
    expect(teamScope).toBe("team:any-team-name");
    expect(projectScope).toBe("project:/any/path");
  });

  it("MemoryEntry with required fields only", () => {
    const entry: MemoryEntry = {
      id: "entry-1",
      content: "Prefer functional components over class components",
      tags: ["react", "style"],
      createdAt: new Date("2026-01-01"),
    };
    expect(entry.id).toBe("entry-1");
    expect(entry.content).toBe("Prefer functional components over class components");
    expect(entry.tags).toEqual(["react", "style"]);
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.metadata).toBeUndefined();
  });

  it("MemoryEntry with optional metadata", () => {
    const entry: MemoryEntry = {
      id: "entry-2",
      content: "Use bun for package management",
      tags: ["tooling"],
      createdAt: new Date("2026-01-02"),
      metadata: { source: "session-42", confidence: 0.9 },
    };
    expect(entry.metadata).toEqual({ source: "session-42", confidence: 0.9 });
  });

  it("Memory mock implementation satisfies the interface contract", async () => {
    const store: MemoryEntry[] = [];

    const memory: Memory = {
      async store(scope: MemoryScope, entry: MemoryEntry): Promise<string> {
        store.push(entry);
        return entry.id;
      },
      async recall(scope: MemoryScope, query: string, budget?: number): Promise<MemoryEntry[]> {
        const results = store.filter((e) => e.content.includes(query));
        return budget !== undefined ? results.slice(0, budget) : results;
      },
      async forget(scope: MemoryScope, id: string): Promise<void> {
        const index = store.findIndex((e) => e.id === id);
        if (index !== -1) store.splice(index, 1);
      },
    };

    const entry: MemoryEntry = {
      id: "e1",
      content: "always validate at boundaries",
      tags: ["patterns"],
      createdAt: new Date(),
    };

    const returnedId = await memory.store("user", entry);
    expect(returnedId).toBe("e1");

    const recalled = await memory.recall("user", "validate");
    expect(recalled).toHaveLength(1);
    expect(recalled[0].id).toBe("e1");

    await memory.forget("user", "e1");
    const afterForget = await memory.recall("user", "validate");
    expect(afterForget).toHaveLength(0);
  });

  it("recall respects the budget parameter", async () => {
    const entries: MemoryEntry[] = [
      { id: "a", content: "match one", tags: [], createdAt: new Date() },
      { id: "b", content: "match two", tags: [], createdAt: new Date() },
      { id: "c", content: "match three", tags: [], createdAt: new Date() },
    ];

    const memory: Memory = {
      async store(): Promise<string> { return ""; },
      async recall(_scope, _query, budget): Promise<MemoryEntry[]> {
        return budget !== undefined ? entries.slice(0, budget) : entries;
      },
      async forget(): Promise<void> {},
    };

    const limited = await memory.recall("org", "match", 2);
    expect(limited).toHaveLength(2);

    const unlimited = await memory.recall("org", "match");
    expect(unlimited).toHaveLength(3);
  });
});
