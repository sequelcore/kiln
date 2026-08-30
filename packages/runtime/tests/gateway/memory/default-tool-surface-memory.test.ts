import { describe, expect, it } from "vitest";
import { createDefaultBuiltinToolSurface } from "../../../src/tools/default-builtin-tool-surface.js";
import {
  defineMemoryAuthorityPolicy,
  governedMemoryAuthority,
  trustedInternalMemoryAuthority,
  type MemoryRepository,
} from "@kilnai/core/memory";
import { createSqliteMemoryRepository } from "../../../src/index.js";

function createAuthorityDeniedMemoryReadRepository(repository: MemoryRepository): MemoryRepository {
  const denyRead = () => {
    const error = new Error("Memory read denied by authority policy. hidden-payload-token");
    Object.assign(error, {
      code: "MEMORY_AUTHORIZATION_DENIED",
      payload: {
        hidden: "hidden-payload-token",
      },
    });
    throw error;
  };

  return {
    transaction: (work) => repository.transaction(work),
    saveRecord: (input) => repository.saveRecord(input),
    getRecord: () => denyRead(),
    getRecordByTopicKey: () => denyRead(),
    listRecords: () => denyRead(),
    searchRecords: () => denyRead(),
    deleteRecord: (id, scope) => repository.deleteRecord(id, scope),
    countRecords: (scope) => repository.countRecords(scope),
    saveRevision: (revision) => repository.saveRevision(revision),
    listRevisions: () => denyRead(),
    saveRelation: (relation) => repository.saveRelation(relation),
    getRelation: () => denyRead(),
    listRelations: () => denyRead(),
    listIncomingRelations: () => denyRead(),
    saveContextAdmission: (admission) => repository.saveContextAdmission(admission),
    listContextAdmissions: () => denyRead(),
    close: () => repository.close(),
  };
}

describe("default builtin tool surface memory integration", () => {
  it("exposes memory resources through the default builtin surface when configured", async () => {
    const repository = createSqliteMemoryRepository({ dbPath: ":memory:" });
    try {
      repository.saveRecord({
        id: "root",
        layer: "semantic",
        scope: { kind: "project", id: "kiln" },
        content: "Root memory.",
        tags: ["memory"],
        topicKey: "root",
        provenance: {
          sourceType: "operator",
          sourceId: "seed",
          actor: "synthetic-test-actor",
          capturedAt: "2026-04-30T12:00:00.000Z",
        },
        createdAt: "2026-04-30T12:00:00.000Z",
      });
      const surface = createDefaultBuiltinToolSurface({
        memoryResources: { repository, authority: trustedInternalMemoryAuthority() },
      });

      expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://memory/graph");
      expect(surface.toolNames).toContain("memory_search");
      expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain(
        "kiln://memory/nodes/{id}{?scope,scopeKind,scopeId}",
      );
      await expect(surface.bridge.execute({
        name: "memory_search",
        input: {
          query: "root",
          scopeKind: "project",
          scopeId: "kiln",
          limit: 5,
        },
      })).resolves.toMatchObject({
        attempts: 1,
        fallbackUsed: false,
        result: {
          isError: false,
          output: expect.stringContaining("Root memory."),
          metadata: expect.objectContaining({
            toolName: "memory_search",
            kind: "memory",
            operation: "search",
            scopeKind: "project",
            scopeId: "kiln",
            query: "root",
            resultCount: 1,
            resourceUri: "kiln://memory/graph?scopeKind=project&scopeId=kiln&query=root&limit=5",
          }),
        },
      });
      const graph = await surface.resources.read("kiln://memory/graph?query=root&limit=5");
      expect(graph.summary).toEqual({
        kind: "memory-graph",
        totalCount: 1,
        counts: {
          node: 1,
          edge: 0,
          truncated: 0,
        },
        facets: {
          layers: ["semantic"],
          scopeKinds: ["project"],
        },
        meta: {
          depth: 0,
          limit: 5,
        },
      });
      await expect(surface.bridge.execute({
        name: "resource_read",
        input: { uri: "kiln://memory/graph?query=root&limit=5" },
      })).resolves.toMatchObject({
        attempts: 1,
        fallbackUsed: false,
        result: {
          isError: false,
          output: expect.stringContaining("\"recordId\": \"root\""),
        },
      });
    } finally {
      repository.close();
    }
  });

  it("returns structured authorization-denied metadata for unauthorized memory resource reads", async () => {
    const repository = createSqliteMemoryRepository({ dbPath: ":memory:" });
    try {
      const surface = createDefaultBuiltinToolSurface({
        memoryResources: {
          repository: createAuthorityDeniedMemoryReadRepository(repository),
          authority: trustedInternalMemoryAuthority(),
        },
      });
      const resourceReadResult = await surface.bridge.execute({
        name: "resource_read",
        input: { uri: "kiln://memory/graph?query=root&limit=5" },
      });

      expect(resourceReadResult.result.isError).toBe(true);
      expect(resourceReadResult.result.output).toBe("Resource read denied by authority policy.");
      expect(resourceReadResult.result.output).not.toContain("hidden-payload-token");
      expect(resourceReadResult.result.metadata).toMatchObject({
        toolName: "resource_read",
        kind: "resource",
        operation: "read",
        uri: "kiln://memory/graph?query=root&limit=5",
        errorCode: "authorization_denied",
      });

      const memorySearchResult = await surface.bridge.execute({
        name: "memory_search",
        input: {
          query: "root",
          scopeKind: "project",
          scopeId: "kiln",
          limit: 5,
        },
      });

      expect(memorySearchResult.result.isError).toBe(true);
      expect(memorySearchResult.result.output).toBe("Memory search denied by authority policy.");
      expect(memorySearchResult.result.output).not.toContain("hidden-payload-token");
      expect(memorySearchResult.result.metadata).toMatchObject({
        toolName: "memory_search",
        kind: "memory",
        operation: "search",
        resourceUri: "kiln://memory/graph?scopeKind=project&scopeId=kiln&query=root&limit=5",
        errorCode: "authorization_denied",
      });
    } finally {
      repository.close();
    }
  });

  it("fails closed for memory_save when fallback mutation service inherits zero-rule memory resource authority", async () => {
    const repository = createSqliteMemoryRepository({ dbPath: ":memory:" });
    try {
      const surface = createDefaultBuiltinToolSurface({
        memoryResources: {
          repository,
          authority: governedMemoryAuthority(defineMemoryAuthorityPolicy({
            caller: { kind: "agent", id: "surface-zero-rule" },
            rules: [],
          })),
        },
      });
      const result = await surface.bridge.execute({
        name: "memory_save",
        input: {
          layer: "semantic",
          scopeKind: "project",
          scopeId: "kiln",
          content: "Denied save should fail closed through fallback service authority.",
          provenance: {
            sourceType: "operator",
            sourceId: "default-tool-surface-fallback-authority-test",
            actor: "test",
          },
        },
      });

      expect(result.result.isError).toBe(true);
      expect(result.result.output).toContain("Memory save denied by authority policy.");
      expect(result.result.metadata).toMatchObject({
        toolName: "memory_save",
        kind: "memory",
        operation: "save",
        errorCode: "repository_error",
        scopeKind: "project",
        scopeId: "kiln",
        layer: "semantic",
      });
    } finally {
      repository.close();
    }
  });
});
