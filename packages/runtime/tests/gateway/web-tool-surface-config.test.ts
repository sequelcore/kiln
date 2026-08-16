import { describe, expect, it } from "vitest";
import { SandboxPolicy } from "@kilnai/core/sandbox";
import type { DefaultBuiltinToolRegistryOptions } from "@kilnai/core/tools";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";

function webToolOptions(): DefaultBuiltinToolRegistryOptions {
  const networkPolicy = new SandboxPolicy({
    projectPath: "/project",
    config: {
      fsPolicy: "read-only",
      netPolicy: "documentation",
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: ["docs.example.com"],
    },
  });
  return {
    webFetch: { networkPolicy },
    webSearch: {
      networkPolicy,
      searchProvider: async (request) => ({
        provider: "test-search",
        sources: [
          {
            url: `https://${request.domains[0]}/result`,
            title: request.query,
          },
        ],
      }),
    },
    webExtract: {
      networkPolicy,
      extractProvider: async (request) => ({
        provider: "test-extract",
        pages: request.urls.map((url) => ({
          url,
          text: `Extracted ${url}`,
        })),
      }),
    },
  };
}

describe("attached runtime web tool configuration", () => {
  it("uses configured core web options in runtime executors and per-call tool projection", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: webToolOptions(),
    });

    const search = runtimeSurface.callBuiltinTools.get("web_search");
    expect(search).toBeDefined();

    const result = await search?.({ query: "runtime search", outputMode: "raw" });
    expect(result).toMatchObject({
      isError: false,
    });
    expect(JSON.stringify(result)).toContain("docs.example.com/result");

    const extract = runtimeSurface.callBuiltinTools.get("web_extract");
    expect(extract).toBeDefined();
    const extractResult = await extract?.({ urls: ["https://docs.example.com/source"], outputMode: "raw" });
    expect(extractResult).toMatchObject({
      isError: false,
    });
    expect(JSON.stringify(extractResult)).toContain("Extracted https://docs.example.com/source");

    const perCallConfig = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      builtinToolSurface: runtimeSurface,
    });
    expect(perCallConfig.perCallCapabilities?.get("web_search")).toBe(runtimeSurface.capabilities.get("web_search"));
    expect(perCallConfig.perCallCapabilities?.get("web_extract")).toBe(runtimeSurface.capabilities.get("web_extract"));
    expect(perCallConfig.perCallCapabilities?.has("write")).toBe(false);
    expect(perCallConfig.additionalTools?.map((tool) => tool.name)).toContain("web_search");
    expect(perCallConfig.additionalTools?.map((tool) => tool.name)).toContain("web_extract");
    expect(perCallConfig.additionalTools?.map((tool) => tool.name)).not.toContain("write");
  });
});
