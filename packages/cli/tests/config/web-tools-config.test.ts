import { describe, expect, it, vi } from "vitest";
import { createDefaultBuiltinToolSurface } from "@kilnai/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createWebToolSurfaceOptions } from "../../src/config/web-tools-config.js";
import type { KilnYaml } from "../../src/kiln-yaml-types.js";

function config(web: KilnYaml["web"]): KilnYaml {
  return {
    version: "1",
    web,
  };
}

describe("web tool config", () => {
  it("keeps web tools fail-closed when no web config is enabled", async () => {
    const surface = createDefaultBuiltinToolSurface(
      createWebToolSurfaceOptions({ config: { version: "1" }, projectPath: "/project" }),
    );

    const result = await surface.bridge.execute({
      name: "web_fetch",
      input: { url: "https://example.com", outputMode: "raw" },
    });

    expect(result.result.isError).toBe(true);
    expect(result.result.output).toContain("explicit network policy is required");
  });

  it("builds one shared network policy for web_fetch and web_search", async () => {
    const options = createWebToolSurfaceOptions({
      config: config({
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
      projectPath: "/project",
    });

    expect(options.webFetch?.networkPolicy?.canAccess("docs.example.com")).toBe(true);
    expect(options.webSearch?.networkPolicy).toBe(options.webFetch?.networkPolicy);
    expect(options.webSearch?.networkPolicy?.canAccess("api.example.com")).toBe(false);
  });

  it("registers the project Memory Lattice resource with shared tool surfaces", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-web-tools-memory-"));
    const surface = createDefaultBuiltinToolSurface(createWebToolSurfaceOptions({
      config: { version: "1" },
      projectPath,
    }));

    const result = await surface.resources.read("kiln://memory/graph?depth=0&limit=25");

    expect(result?.contents[0]?.mimeType).toBe("application/json");
    expect(JSON.parse(result?.contents[0]?.text ?? "{}")).toMatchObject({
      snapshot: {
        nodes: [],
        edges: [],
        limits: { maxNodes: 25, maxEdges: 50 },
        truncated: false,
      },
      filters: { depth: 0 },
    });
  });

  it("applies read-only memory authority defaults for model-facing sessions", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-web-tools-model-memory-"));
    const scopeId = basename(projectPath);
    const options = createWebToolSurfaceOptions({
      config: { version: "1" },
      projectPath,
      memoryAuthority: {
        modelFacingSession: true,
        caller: { kind: "operator_surface", id: "tui" },
      },
    });
    options.memoryResources?.repository.saveRecord({
      id: "record-1",
      layer: "semantic",
      scope: { kind: "project", id: scopeId },
      content: "Model-facing memory read seed.",
      topicKey: "record-1",
      tags: ["memory"],
      provenance: {
        sourceType: "operator",
        sourceId: "seed",
        capturedAt: "2026-04-30T12:00:00.000Z",
      },
      createdAt: "2026-04-30T12:00:00.000Z",
    });
    const surface = createDefaultBuiltinToolSurface(options);

    const readResult = await surface.bridge.execute({
      name: "resource_read",
      input: { uri: `kiln://memory/graph?scope=project%3A${encodeURIComponent(scopeId)}&layer=semantic&limit=10` },
    });
    const writeResult = await surface.bridge.execute({
      name: "memory_save",
      input: {
        layer: "semantic",
        scopeKind: "project",
        scopeId,
        content: "Write should be denied by default model-facing authority.",
        provenance: {
          sourceType: "operator",
          sourceId: "test",
          capturedAt: "2026-04-30T12:00:00.000Z",
        },
      },
    });

    expect(options.memoryResources?.authority?.caller).toEqual({ kind: "operator_surface", id: "tui" });
    expect(options.memoryMutations?.callerContext).toMatchObject({
      actorType: "operator_surface",
      actorId: "tui",
    });
    expect(readResult.result.isError).toBe(false);
    expect(writeResult.result.isError).toBe(true);
    expect(writeResult.result.output).toContain("Memory save denied by authority policy.");
  });

  it("honors explicit permissions.memory write rules for model-facing sessions", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-web-tools-memory-policy-"));
    const scopeId = basename(projectPath);
    const surface = createDefaultBuiltinToolSurface(createWebToolSurfaceOptions({
      config: {
        version: "1",
        permissions: {
          memory: {
            write: [{
              operations: ["save"],
              scopeKinds: ["project"],
              scopeIds: [scopeId],
              layers: ["semantic"],
            }],
          },
        },
      },
      projectPath,
      memoryAuthority: {
        modelFacingSession: true,
        caller: { kind: "operator_surface", id: "gui" },
      },
    }));

    const writeResult = await surface.bridge.execute({
      name: "memory_save",
      input: {
        layer: "semantic",
        scopeKind: "project",
        scopeId,
        content: "Allowed write.",
        provenance: {
          sourceType: "operator",
          sourceId: "test",
          capturedAt: "2026-04-30T12:00:00.000Z",
        },
      },
    });

    expect(writeResult.result.isError).toBe(false);
    expect(writeResult.result.output).toContain(`"id": "${scopeId}"`);
  });

  it("fails closed when explicit memory policy resolves to zero authority rules", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-web-tools-memory-empty-policy-"));
    const scopeId = basename(projectPath);
    const options = createWebToolSurfaceOptions({
      config: {
        version: "1",
        permissions: {
          memory: {},
        },
      },
      projectPath,
      memoryAuthority: {
        modelFacingSession: true,
        caller: { kind: "operator_surface", id: "gui" },
      },
    });
    options.memoryResources?.repository.saveRecord({
      id: "record-2",
      layer: "semantic",
      scope: { kind: "project", id: scopeId },
      content: "Denied read seed.",
      topicKey: "record-2",
      tags: ["memory"],
      provenance: {
        sourceType: "operator",
        sourceId: "seed",
        capturedAt: "2026-04-30T12:00:00.000Z",
      },
      createdAt: "2026-04-30T12:00:00.000Z",
    });
    const surface = createDefaultBuiltinToolSurface(options);

    const readResult = await surface.bridge.execute({
      name: "resource_read",
      input: { uri: `kiln://memory/graph?scope=project%3A${encodeURIComponent(scopeId)}&layer=semantic&limit=10` },
    });
    const writeResult = await surface.bridge.execute({
      name: "memory_save",
      input: {
        layer: "semantic",
        scopeKind: "project",
        scopeId,
        content: "Write should fail closed with zero explicit rules.",
        provenance: {
          sourceType: "operator",
          sourceId: "test",
          capturedAt: "2026-04-30T12:00:00.000Z",
        },
      },
    });

    expect(options.memoryResources?.authority?.rules).toHaveLength(0);
    expect(readResult.result.isError).toBe(true);
    expect(readResult.result.output).toContain("Resource read denied by authority policy.");
    expect(writeResult.result.isError).toBe(true);
    expect(writeResult.result.output).toContain("Memory save denied by authority policy.");
  });

  it("does not grant memory write authority from generic memory_save tool allow", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-web-tools-memory-tool-allow-"));
    const scopeId = basename(projectPath);
    const surface = createDefaultBuiltinToolSurface(createWebToolSurfaceOptions({
      config: {
        version: "1",
        permissions: {
          tools: [{ tool: "memory_save", action: "allow" }],
        },
      },
      projectPath,
      memoryAuthority: {
        modelFacingSession: true,
        caller: { kind: "operator_surface", id: "gui" },
      },
    }));

    const writeResult = await surface.bridge.execute({
      name: "memory_save",
      input: {
        layer: "semantic",
        scopeKind: "project",
        scopeId,
        content: "Write should remain denied without permissions.memory.",
        provenance: {
          sourceType: "operator",
          sourceId: "test",
          capturedAt: "2026-04-30T12:00:00.000Z",
        },
      },
    });

    expect(writeResult.result.isError).toBe(true);
    expect(writeResult.result.output).toContain("Memory save denied by authority policy.");
  });

  it("adapts an HTTP search provider without making consumers provider-specific", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        query: "kiln tools",
        domains: ["docs.example.com"],
        maxResults: 5,
      });
      return new Response(JSON.stringify({
        provider: "test-search",
        retrievedAt: "2026-04-29T00:00:00.000Z",
        sources: [
          {
            url: "https://docs.example.com/kiln",
            title: "Kiln docs",
            snippet: "Controlled web tools",
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const surface = createDefaultBuiltinToolSurface(createWebToolSurfaceOptions({
      config: config({
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
        searchProvider: {
          type: "http",
          url: "https://search.example.com/query",
          headers: { "x-test": "yes" },
        },
      }),
      projectPath: "/project",
      fetchImpl,
    }));

    const result = await surface.bridge.execute({
      name: "web_search",
      input: { query: "kiln tools", outputMode: "raw" },
    });

    expect(result.result.isError).toBe(false);
    expect(result.result.output).toContain("Kiln docs");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
