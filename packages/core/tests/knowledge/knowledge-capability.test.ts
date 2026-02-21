import { describe, it, expect, vi } from "vitest";
import { createKnowledgeCapability, executeKnowledgeSearch, isAgentAllowed } from "../../src/knowledge/knowledge-capability.js";

describe("createKnowledgeCapability", () => {
  it("returns a valid Capability", () => {
    const cap = createKnowledgeCapability();
    expect(cap.name).toBe("knowledge_search");
    expect(cap.description).toBeDefined();
    expect(cap.schema).toBeDefined();
    expect(cap.tags).toContain("knowledge");
    expect(cap.tags).toContain("search");
    expect(cap.tags).toContain("rag");
  });

  it("has correct schema properties", () => {
    const cap = createKnowledgeCapability();
    const schema = cap.schema as { properties: Record<string, unknown> };
    expect(schema.properties.query).toBeDefined();
    expect(schema.properties.source).toBeDefined();
    expect(schema.properties.topK).toBeDefined();
  });

  it("has correct annotations", () => {
    const cap = createKnowledgeCapability();
    expect(cap.annotations?.readOnly).toBe(true);
    expect(cap.annotations?.idempotent).toBe(true);
    expect(cap.annotations?.cacheTtl).toBe(60);
  });

  it("marks query as required", () => {
    const cap = createKnowledgeCapability();
    const schema = cap.schema as { required: string[] };
    expect(schema.required).toContain("query");
  });
});

describe("isAgentAllowed", () => {
  it("returns true when allowedAgents is undefined", () => {
    expect(isAgentAllowed("agent1", undefined)).toBe(true);
  });

  it("returns true when allowedAgents is empty", () => {
    expect(isAgentAllowed("agent1", [])).toBe(true);
  });

  it("returns true when agent is in allowedAgents", () => {
    expect(isAgentAllowed("agent1", ["agent1", "agent2"])).toBe(true);
  });

  it("returns false when agent is not in allowedAgents", () => {
    expect(isAgentAllowed("agent3", ["agent1", "agent2"])).toBe(false);
  });
});

describe("executeKnowledgeSearch", () => {
  it("calls pipeline.retrieve with correct arguments", async () => {
    const mockPipeline = {
      retrieve: vi.fn().mockResolvedValue([
        { id: "1", content: "result 1", score: 0.9, metadata: { source: "docs" } },
        { id: "2", content: "result 2", score: 0.8, metadata: { source: "docs" } },
      ]),
    };

    const result = await executeKnowledgeSearch(mockPipeline as never, { query: "test query" });

    expect(mockPipeline.retrieve).toHaveBeenCalledWith("test query", { topK: 5, source: undefined });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.content).toBe("result 1");
  });

  it("respects topK parameter", async () => {
    const mockPipeline = {
      retrieve: vi.fn().mockResolvedValue([]),
    };

    await executeKnowledgeSearch(mockPipeline as never, { query: "test", topK: 10 });

    expect(mockPipeline.retrieve).toHaveBeenCalledWith("test", { topK: 10, source: undefined });
  });

  it("respects source filter", async () => {
    const mockPipeline = {
      retrieve: vi.fn().mockResolvedValue([]),
    };

    await executeKnowledgeSearch(mockPipeline as never, { query: "test", source: "docs" });

    expect(mockPipeline.retrieve).toHaveBeenCalledWith("test", { topK: 5, source: "docs" });
  });

  it("maps results correctly", async () => {
    const mockPipeline = {
      retrieve: vi.fn().mockResolvedValue([
        { id: "1", content: "content", score: 0.5, metadata: { custom: "meta" } },
      ]),
    };

    const result = await executeKnowledgeSearch(mockPipeline as never, { query: "test" });

    expect(result.results[0]!.content).toBe("content");
    expect(result.results[0]!.score).toBe(0.5);
    expect(result.results[0]!.metadata.custom).toBe("meta");
  });
});
