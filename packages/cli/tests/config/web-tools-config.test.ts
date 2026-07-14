import { describe, expect, it, vi } from "vitest";
import { createDefaultBuiltinToolSurface } from "@kilnai/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  createWebToolSurfaceOptions,
  describeWebToolConfiguration,
} from "../../src/config/web-tools-config.js";
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

  it("builds one shared network policy for web_fetch, web_search, and web_extract", async () => {
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
    expect(options.webExtract?.networkPolicy).toBe(options.webFetch?.networkPolicy);
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
    const searchResult = await surface.bridge.execute({
      name: "memory_search",
      input: {
        query: "Model-facing",
        scopeKind: "project",
        scopeId,
        limit: 10,
      },
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
    expect(searchResult.result.isError).toBe(false);
    expect(searchResult.result.output).toContain("Model-facing memory read seed.");
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
        topicKey: "allowed-write",
        confidence: 0.9,
        futureTaskValue: 0.8,
        canonicalEvidenceUris: ["kiln://artifacts/test/source/content"],
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
    const searchResult = await surface.bridge.execute({
      name: "memory_search",
      input: {
        query: "Denied",
        scopeKind: "project",
        scopeId,
        limit: 10,
      },
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
    expect(searchResult.result.isError).toBe(true);
    expect(searchResult.result.output).toContain("Memory search denied by authority policy.");
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

  it("adapts an HTTP extract provider without making consumers provider-specific", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(_url).toBe("https://extract.example.com/pages");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        urls: ["https://docs.example.com/kiln"],
        format: "markdown",
        maxBytes: 2000,
      });
      return new Response(JSON.stringify({
        provider: "test-extract",
        retrievedAt: "2026-05-08T00:00:00.000Z",
        pages: [{
          url: "https://docs.example.com/kiln",
          title: "Kiln docs",
          text: "# Kiln\n\nControlled web extract",
        }],
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
        extractProvider: {
          type: "http",
          url: "https://extract.example.com/pages",
          headers: { "x-test": "yes" },
        },
      }),
      projectPath: "/project",
      fetchImpl,
    }));

    const result = await surface.bridge.execute({
      name: "web_extract",
      input: {
        urls: ["https://docs.example.com/kiln"],
        maxBytes: 2000,
        verbosity: "structured",
      },
    });

    expect(result.result.isError).toBe(false);
    expect(JSON.parse(result.result.output)).toMatchObject({
      pages: [{
        url: "https://docs.example.com/kiln",
        title: "Kiln docs",
        text: "# Kiln\n\nControlled web extract",
      }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("adapts a SearXNG search provider into the canonical source shape", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("https://searx.example.com/search?");
      expect(String(url)).toContain("q=kiln+tools+site%3Adocs.example.com");
      expect(String(url)).toContain("format=json");
      return new Response(JSON.stringify({
        results: [{
          url: "https://docs.example.com/kiln",
          title: "Kiln docs",
          content: "Controlled web tools",
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const surface = createDefaultBuiltinToolSurface(createWebToolSurfaceOptions({
      config: config({
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com", "searx.example.com"],
        searchProvider: {
          type: "searxng",
          url: "https://searx.example.com",
        },
      }),
      projectPath: "/project",
      fetchImpl,
    }));

    const result = await surface.bridge.execute({
      name: "web_search",
      input: { query: "kiln tools", domains: ["docs.example.com"], verbosity: "structured" },
    });

    expect(result.result.isError).toBe(false);
    expect(JSON.parse(result.result.output)).toMatchObject({
      sources: [{
        url: "https://docs.example.com/kiln",
        title: "Kiln docs",
        snippet: "Controlled web tools",
      }],
    });
  });

  it("adapts a Tavily search provider with API-key env indirection", async () => {
    process.env.KILN_TEST_TAVILY_KEY = "tvly-test";
    try {
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(_url).toBe("https://api.tavily.com/search");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer tvly-test",
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          query: "kiln tools",
          max_results: 2,
          include_domains: ["docs.example.com"],
        });
        return new Response(JSON.stringify({
          results: [{
            url: "https://docs.example.com/kiln",
            title: "Kiln docs",
            content: "Controlled web tools",
            published_date: "2026-05-01",
          }],
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
            type: "tavily",
            apiKeyEnv: "KILN_TEST_TAVILY_KEY",
          },
        }),
        projectPath: "/project",
        fetchImpl,
      }));

      const result = await surface.bridge.execute({
        name: "web_search",
        input: { query: "kiln tools", domains: ["docs.example.com"], maxResults: 2 },
      });

      expect(result.result.isError).toBe(false);
      expect(result.result.output).toContain("Kiln docs");
    } finally {
      delete process.env.KILN_TEST_TAVILY_KEY;
    }
  });

  it("adapts a Tavily extract provider with API-key env indirection", async () => {
    process.env.KILN_TEST_TAVILY_KEY = "tvly-test";
    try {
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(_url).toBe("https://api.tavily.com/extract");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer tvly-test",
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          urls: "https://docs.example.com/kiln",
          extract_depth: "basic",
          format: "text",
        });
        return new Response(JSON.stringify({
          results: [{
            url: "https://docs.example.com/kiln",
            raw_content: "Kiln docs\nControlled web extract",
          }],
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
          extractProvider: {
            type: "tavily",
            apiKeyEnv: "KILN_TEST_TAVILY_KEY",
          },
        }),
        projectPath: "/project",
        fetchImpl,
      }));

      const result = await surface.bridge.execute({
        name: "web_extract",
        input: { urls: ["https://docs.example.com/kiln"], format: "text" },
      });

      expect(result.result.isError).toBe(false);
      expect(result.result.output).toContain("Kiln docs");
    } finally {
      delete process.env.KILN_TEST_TAVILY_KEY;
    }
  });

  it("adapts a Brave search provider with API-key env indirection", async () => {
    process.env.KILN_TEST_BRAVE_KEY = "brave-test";
    try {
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toContain("https://api.search.brave.com/res/v1/web/search?");
        expect(String(url)).toContain("q=kiln+tools+site%3Adocs.example.com");
        expect(init?.headers).toMatchObject({
          "x-subscription-token": "brave-test",
        });
        return new Response(JSON.stringify({
          web: {
            results: [{
              url: "https://docs.example.com/kiln",
              title: "Kiln docs",
              description: "Controlled web tools",
            }],
          },
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
            type: "brave",
            apiKeyEnv: "KILN_TEST_BRAVE_KEY",
          },
        }),
        projectPath: "/project",
        fetchImpl,
      }));

      const result = await surface.bridge.execute({
        name: "web_search",
        input: { query: "kiln tools", domains: ["docs.example.com"] },
      });

      expect(result.result.isError).toBe(false);
      expect(result.result.output).toContain("Kiln docs");
    } finally {
      delete process.env.KILN_TEST_BRAVE_KEY;
    }
  });

  it("adapts an Exa search provider with API-key env indirection", async () => {
    process.env.KILN_TEST_EXA_KEY = "exa-test";
    try {
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(_url).toBe("https://api.exa.ai/search");
        expect(init?.headers).toMatchObject({
          "x-api-key": "exa-test",
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          query: "kiln tools site:docs.example.com",
          numResults: 5,
          type: "auto",
        });
        return new Response(JSON.stringify({
          results: [{
            url: "https://docs.example.com/kiln",
            title: "Kiln docs",
            highlights: ["Controlled web tools"],
          }],
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
            type: "exa",
            apiKeyEnv: "KILN_TEST_EXA_KEY",
          },
        }),
        projectPath: "/project",
        fetchImpl,
      }));

      const result = await surface.bridge.execute({
        name: "web_search",
        input: { query: "kiln tools", domains: ["docs.example.com"] },
      });

      expect(result.result.isError).toBe(false);
      expect(result.result.output).toContain("Kiln docs");
    } finally {
      delete process.env.KILN_TEST_EXA_KEY;
    }
  });

  it("adapts a Firecrawl extract provider with API-key env indirection", async () => {
    process.env.KILN_TEST_FIRECRAWL_KEY = "fc-test";
    try {
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(_url).toBe("https://api.firecrawl.dev/v2/scrape");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer fc-test",
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          url: "https://docs.example.com/kiln",
          formats: ["markdown"],
          onlyMainContent: true,
        });
        return new Response(JSON.stringify({
          data: {
            markdown: "# Kiln\n\nControlled web extract",
            metadata: {
              sourceURL: "https://docs.example.com/kiln",
              title: "Kiln docs",
              statusCode: 200,
            },
          },
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
          extractProvider: {
            type: "firecrawl",
            apiKeyEnv: "KILN_TEST_FIRECRAWL_KEY",
          },
        }),
        projectPath: "/project",
        fetchImpl,
      }));

      const result = await surface.bridge.execute({
        name: "web_extract",
        input: { urls: ["https://docs.example.com/kiln"], verbosity: "structured" },
      });

      expect(result.result.isError).toBe(false);
      expect(JSON.parse(result.result.output)).toMatchObject({
        pages: [{
          url: "https://docs.example.com/kiln",
          title: "Kiln docs",
          text: "# Kiln\n\nControlled web extract",
        }],
      });
    } finally {
      delete process.env.KILN_TEST_FIRECRAWL_KEY;
    }
  });

  it("keeps the tool surface available when optional web provider API-key env is missing", async () => {
    delete process.env.KILN_TEST_MISSING_TAVILY_KEY;
    const surface = createDefaultBuiltinToolSurface(createWebToolSurfaceOptions({
      config: config({
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
        searchProvider: {
          type: "tavily",
          apiKeyEnv: "KILN_TEST_MISSING_TAVILY_KEY",
        },
        extractProvider: {
          type: "tavily",
          apiKeyEnv: "KILN_TEST_MISSING_TAVILY_KEY",
        },
      }),
      projectPath: "/project",
    }));

    const searchResult = await surface.bridge.execute({
      name: "web_search",
      input: { query: "kiln tools", domains: ["docs.example.com"] },
    });
    const extractResult = await surface.bridge.execute({
      name: "web_extract",
      input: { urls: ["https://docs.example.com/kiln"] },
    });
    const fetchResult = await surface.bridge.execute({
      name: "web_fetch",
      input: { url: "https://docs.example.com/kiln", outputMode: "raw" },
    });

    expect(searchResult.result.isError).toBe(true);
    expect(searchResult.result.output).toContain("Web search provider is not configured");
    expect(extractResult.result.isError).toBe(true);
    expect(extractResult.result.output).toContain("Web extract provider is not configured");
    expect(fetchResult.result.output).not.toContain("explicit network policy is required");
  });

  it("reports web diagnostics without executing a provider", () => {
    process.env.KILN_TEST_FIRECRAWL_KEY = "fc-test";
    try {
      const diagnostics = describeWebToolConfiguration(config({
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
        searchProvider: { type: "searxng", url: "https://searx.example.com" },
        extractProvider: { type: "firecrawl", apiKeyEnv: "KILN_TEST_FIRECRAWL_KEY" },
      }));

      expect(diagnostics).toEqual({
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
        searchProviderType: "searxng",
        searchProviderConfigured: true,
        searchProviderSource: "effective",
        extractProviderType: "firecrawl",
        extractProviderConfigured: true,
        extractProviderSource: "effective",
        issues: [],
      });
    } finally {
      delete process.env.KILN_TEST_FIRECRAWL_KEY;
    }
  });

  it("reports inherited global web providers separately from project web authority", () => {
    const previousTavilyKey = process.env.TAVILY_API_KEY;
    const previousFirecrawlKey = process.env.FIRECRAWL_API_KEY;
    process.env.TAVILY_API_KEY = "tv-test";
    process.env.FIRECRAWL_API_KEY = "fc-test";
    try {
      const diagnostics = describeWebToolConfiguration(
        config({
          enabled: true,
          netPolicy: "documentation",
          searchProvider: { type: "tavily", apiKeyEnv: "TAVILY_API_KEY" },
          extractProvider: { type: "firecrawl", apiKeyEnv: "FIRECRAWL_API_KEY" },
        }),
        {
          globalWeb: {
            searchProvider: { type: "tavily", apiKeyEnv: "TAVILY_API_KEY" },
            extractProvider: { type: "firecrawl", apiKeyEnv: "FIRECRAWL_API_KEY" },
          },
          projectWeb: {
            enabled: true,
            netPolicy: "documentation",
          },
        },
      );

      expect(diagnostics.searchProviderSource).toBe("global");
      expect(diagnostics.extractProviderSource).toBe("global");
      expect(diagnostics.issues).toEqual([]);
    } finally {
      if (previousTavilyKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = previousTavilyKey;
      }
      if (previousFirecrawlKey === undefined) {
        delete process.env.FIRECRAWL_API_KEY;
      } else {
        process.env.FIRECRAWL_API_KEY = previousFirecrawlKey;
      }
    }
  });

  it("reports missing optional web provider API-key env vars as diagnostics", () => {
    delete process.env.KILN_TEST_MISSING_TAVILY_KEY;

    const diagnostics = describeWebToolConfiguration(config({
      enabled: true,
      netPolicy: "documentation",
      searchProvider: { type: "tavily", apiKeyEnv: "KILN_TEST_MISSING_TAVILY_KEY" },
      extractProvider: { type: "tavily", apiKeyEnv: "KILN_TEST_MISSING_TAVILY_KEY" },
    }));

    expect(diagnostics.searchProviderConfigured).toBe(false);
    expect(diagnostics.extractProviderConfigured).toBe(false);
    expect(diagnostics.issues).toEqual([
      "web.search_provider_env_missing:KILN_TEST_MISSING_TAVILY_KEY",
      "web.extract_provider_env_missing:KILN_TEST_MISSING_TAVILY_KEY",
    ]);
  });
});
