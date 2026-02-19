import { describe, it, expect, beforeEach } from "vitest";
import { Orchestrator } from "@kiln/core";
import type { MemoryManager, MemoryLayer, MemoryEntry, MemorySearchResult } from "@kiln/core";
import { KilnMcpServer, KILN_TOOLS, type KilnTool } from "../../src/mcp/index.js";

describe("KilnMcpServer", () => {
  let orchestrator: Orchestrator;
  let server: KilnMcpServer;

  beforeEach(() => {
    orchestrator = new Orchestrator({ requireApproval: false });
    server = new KilnMcpServer(orchestrator);
  });

  it("creates without error", () => {
    expect(server).toBeDefined();
  });

  it("registers all 13 tool names", () => {
    const names = server.toolNames;
    expect(names).toHaveLength(13);

    const expectedTools: KilnTool[] = [
      "kiln_init",
      "kiln_phase_start",
      "kiln_phase_gate",
      "kiln_memory_save",
      "kiln_memory_recall",
      "kiln_memory_search",
      "kiln_task_create",
      "kiln_task_score",
      "kiln_task_action",
      "kiln_verify",
      "kiln_cost_track",
      "kiln_cost_summary",
      "kiln_domain_detect",
    ];

    for (const name of expectedTools) {
      expect(names).toContain(name);
    }
  });

  it("KILN_TOOLS array has 13 definitions", () => {
    expect(KILN_TOOLS).toHaveLength(13);
  });

  it("every handler returns structured JSON content", async () => {
    const handler = server.getHandler("kiln_init")!;
    const result = await handler({});
    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(() => JSON.parse(result.content[0]!.text as string)).not.toThrow();
  });

  describe("kiln_init", () => {
    it("returns session ID and status", async () => {
      const handler = server.getHandler("kiln_init")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.sessionId).toBeNull();
      expect(data.status).toBe("idle");
    });

    it("returns active session after start", async () => {
      orchestrator.start("test task");
      const handler = server.getHandler("kiln_init")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.sessionId).toBeDefined();
      expect(data.status).toBe("running");
    });
  });

  describe("kiln_phase_start", () => {
    it("advances phase when running", async () => {
      orchestrator.start("test task");
      const handler = server.getHandler("kiln_phase_start")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.phase).toBe("research");
      expect(data.advanced).toBe(true);
    });

    it("returns null phase when idle", async () => {
      const handler = server.getHandler("kiln_phase_start")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.phase).toBeNull();
      expect(data.advanced).toBe(false);
    });
  });

  describe("kiln_phase_gate", () => {
    it("returns current phase with passed=true", async () => {
      orchestrator.start("test task");
      const handler = server.getHandler("kiln_phase_gate")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.phase).toBe("analyze");
      expect(data.passed).toBe(true);
      expect(data.violations).toEqual([]);
    });
  });

  describe("kiln_memory_save", () => {
    it("returns saved=true with an id", async () => {
      const handler = server.getHandler("kiln_memory_save")!;
      const result = await handler({ content: "test", layer: "project" });
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.saved).toBe(true);
      expect(data.id).toBeDefined();
    });
  });

  describe("kiln_memory_recall", () => {
    it("returns empty results", async () => {
      const handler = server.getHandler("kiln_memory_recall")!;
      const result = await handler({ query: "test" });
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.results).toEqual([]);
    });
  });

  describe("kiln_memory_search", () => {
    it("returns empty results", async () => {
      const handler = server.getHandler("kiln_memory_search")!;
      const result = await handler({ query: "test" });
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.results).toEqual([]);
    });
  });

  describe("kiln_task_create", () => {
    it("returns a task ID", async () => {
      const handler = server.getHandler("kiln_task_create")!;
      const result = await handler({ statement: "do something" });
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.taskId).toBeDefined();
      expect(data.created).toBe(true);
    });
  });

  describe("kiln_task_score", () => {
    it("returns a score for the task", async () => {
      const handler = server.getHandler("kiln_task_score")!;
      const result = await handler({ taskId: "abc-123" });
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.taskId).toBe("abc-123");
      expect(data.score).toBe(0.5);
    });
  });

  describe("kiln_task_action", () => {
    it("returns applied=true", async () => {
      const handler = server.getHandler("kiln_task_action")!;
      const result = await handler({ taskId: "abc", action: "deepen" });
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.taskId).toBe("abc");
      expect(data.action).toBe("deepen");
      expect(data.applied).toBe(true);
    });
  });

  describe("kiln_verify", () => {
    it("returns passed=true", async () => {
      const handler = server.getHandler("kiln_verify")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.passed).toBe(true);
      expect(data.checks).toEqual([]);
    });
  });

  describe("kiln_cost_track", () => {
    it("records usage and returns recorded=true", async () => {
      orchestrator.start("test");
      const handler = server.getHandler("kiln_cost_track")!;
      const result = await handler({
        role: "architect",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
      });
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.recorded).toBe(true);
    });
  });

  describe("kiln_cost_summary", () => {
    it("returns valid cost summary", async () => {
      const handler = server.getHandler("kiln_cost_summary")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.totalInputTokens).toBe(0);
      expect(data.totalOutputTokens).toBe(0);
      expect(data.totalCostUsd).toBe(0);
      expect(data.byRole).toBeDefined();
    });

    it("reflects tracked costs", async () => {
      // Record some usage first
      const trackHandler = server.getHandler("kiln_cost_track")!;
      await trackHandler({
        role: "worker",
        inputTokens: 5000,
        outputTokens: 1000,
      });

      const summaryHandler = server.getHandler("kiln_cost_summary")!;
      const result = await summaryHandler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.totalInputTokens).toBe(5000);
      expect(data.totalOutputTokens).toBe(1000);
      expect(data.totalCostUsd).toBeGreaterThan(0);
      expect(data.byRole["worker"]).toBeDefined();
    });
  });

  describe("kiln_domain_detect", () => {
    it("returns unknown domain", async () => {
      const handler = server.getHandler("kiln_domain_detect")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0]!.text as string);
      expect(data.domain).toBe("unknown");
      expect(data.detected).toBe(false);
    });
  });

  describe("tool annotations", () => {
    it("read-only tools have readOnlyHint=true", () => {
      const readOnlyTools = ["kiln_init", "kiln_memory_recall", "kiln_memory_search", "kiln_phase_gate", "kiln_task_score", "kiln_verify", "kiln_cost_summary", "kiln_domain_detect"];
      for (const toolName of readOnlyTools) {
        const tool = KILN_TOOLS.find((t) => t.name === toolName);
        expect(tool?.annotations?.readOnlyHint, `${toolName} should be readOnly`).toBe(true);
      }
    });

    it("mutating tools do not have readOnlyHint=true", () => {
      const mutatingTools = ["kiln_phase_start", "kiln_memory_save", "kiln_task_create", "kiln_task_action", "kiln_cost_track"];
      for (const toolName of mutatingTools) {
        const tool = KILN_TOOLS.find((t) => t.name === toolName);
        expect(tool?.annotations?.readOnlyHint, `${toolName} should not be readOnly`).not.toBe(true);
      }
    });

    it("all tools have descriptions", () => {
      for (const tool of KILN_TOOLS) {
        expect(tool.description.length, `${tool.name} needs description`).toBeGreaterThan(0);
      }
    });
  });

  describe("with MemoryManager", () => {
    let memoryServer: KilnMcpServer;
    let savedEntries: Array<{ content: string; layer: MemoryLayer; tags: string[] }>;
    let searchCalls: Array<{ query: string; layer?: MemoryLayer; limit?: number }>;
    let recallCalls: Array<{ query: string; tokenBudget: number }>;

    const mockMemoryManager = {
      async save(entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">): Promise<string> {
        savedEntries.push({ content: entry.content, layer: entry.layer, tags: [...entry.tags] });
        return "mock-memory-id";
      },
      async search(query: string, layer?: MemoryLayer, limit?: number): Promise<readonly MemorySearchResult[]> {
        searchCalls.push({ query, layer, limit });
        return [{
          entry: {
            id: "result-1",
            layer: "user" as MemoryLayer,
            content: "mock result",
            tags: ["test"],
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            accessCount: 1,
          },
          score: 0.95,
          snippet: "mock result",
        }];
      },
      async recall(query: string, tokenBudget: number): Promise<string> {
        recallCalls.push({ query, tokenBudget });
        return "--- User Memory ---\nrecalled content";
      },
      async forget(): Promise<void> {},
      applyDecay(): void {},
      close(): void {},
    } as unknown as MemoryManager;

    beforeEach(() => {
      savedEntries = [];
      searchCalls = [];
      recallCalls = [];
      memoryServer = new KilnMcpServer(orchestrator, mockMemoryManager);
    });

    describe("kiln_memory_save (wired)", () => {
      it("calls memoryManager.save with correct args", async () => {
        const handler = memoryServer.getHandler("kiln_memory_save")!;
        const result = await handler({ content: "new pattern", layer: "agent", tags: ["pattern"] });
        const data = JSON.parse(result.content[0]!.text as string);

        expect(data.saved).toBe(true);
        expect(data.id).toBe("mock-memory-id");
        expect(savedEntries).toHaveLength(1);
        expect(savedEntries[0]!.content).toBe("new pattern");
        expect(savedEntries[0]!.layer).toBe("agent");
        expect(savedEntries[0]!.tags).toEqual(["pattern"]);
      });

      it("defaults to project layer when not specified", async () => {
        const handler = memoryServer.getHandler("kiln_memory_save")!;
        await handler({ content: "note" });

        expect(savedEntries[0]!.layer).toBe("project");
        expect(savedEntries[0]!.tags).toEqual([]);
      });
    });

    describe("kiln_memory_recall (wired)", () => {
      it("calls memoryManager.recall with query and token budget", async () => {
        const handler = memoryServer.getHandler("kiln_memory_recall")!;
        const result = await handler({ query: "react patterns", limit: 500 });
        const data = JSON.parse(result.content[0]!.text as string);

        expect(data.results).toContain("recalled content");
        expect(recallCalls).toHaveLength(1);
        expect(recallCalls[0]!.query).toBe("react patterns");
        expect(recallCalls[0]!.tokenBudget).toBe(500);
      });

      it("defaults token budget to 2000", async () => {
        const handler = memoryServer.getHandler("kiln_memory_recall")!;
        await handler({ query: "test" });

        expect(recallCalls[0]!.tokenBudget).toBe(2000);
      });
    });

    describe("kiln_memory_search (wired)", () => {
      it("calls memoryManager.search and returns formatted results", async () => {
        const handler = memoryServer.getHandler("kiln_memory_search")!;
        const result = await handler({ query: "patterns", limit: 5 });
        const data = JSON.parse(result.content[0]!.text as string);

        expect(data.results).toHaveLength(1);
        expect(data.results[0].id).toBe("result-1");
        expect(data.results[0].content).toBe("mock result");
        expect(data.results[0].score).toBe(0.95);
        expect(searchCalls).toHaveLength(1);
        expect(searchCalls[0]!.query).toBe("patterns");
        expect(searchCalls[0]!.limit).toBe(5);
      });

      it("passes layer filter when provided", async () => {
        const handler = memoryServer.getHandler("kiln_memory_search")!;
        await handler({ query: "test", layer: "user" });

        expect(searchCalls[0]!.layer).toBe("user");
      });
    });
  });
});
