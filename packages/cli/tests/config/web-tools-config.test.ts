import { describe, expect, it, vi } from "vitest";
import { createDefaultBuiltinToolSurface } from "@kilnai/core";
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
