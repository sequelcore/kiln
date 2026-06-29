import { describe, expect, it, vi } from "vitest";
import { WebExtractTool, type WebExtractProvider } from "../../../src/tools/infrastructure/web-extract-tool.js";
import { WebFetchTool, type WebFetchClient } from "../../../src/tools/infrastructure/web-fetch-tool.js";
import { WebSearchTool, type WebSearchProvider } from "../../../src/tools/infrastructure/web-search-tool.js";
import {
  normalizeWebDomain,
  normalizeWebUrl,
  sanitizeWebText,
} from "../../../src/tools/infrastructure/web-policy.js";
import { makeSandbox } from "./test-utils.js";

describe("web policy helpers", () => {
  it("normalizes HTTP URLs and rejects unsafe URL inputs", () => {
    expect(normalizeWebUrl("HTTPS://Example.COM/docs?q=1")).toEqual({
      ok: true,
      url: "https://example.com/docs?q=1",
      hostname: "example.com",
    });
    expect(normalizeWebUrl("file:///etc/passwd")).toMatchObject({
      ok: false,
      errorCode: "invalid_input",
    });
    expect(normalizeWebUrl("http://127.0.0.1:3000")).toMatchObject({
      ok: false,
      errorCode: "network_denied",
    });
  });

  it("normalizes domains without accepting URL-shaped values", () => {
    expect(normalizeWebDomain("Docs.Example.com")).toEqual({ ok: true, domain: "docs.example.com" });
    expect(normalizeWebDomain("https://example.com")).toMatchObject({
      ok: false,
      errorCode: "invalid_input",
    });
  });

  it("sanitizes web text before reinjection", () => {
    expect(sanitizeWebText("<script>bad()</script><style>x{}</style><h1>Title</h1>\u0000 Body")).toBe("Title Body");
  });
});

describe("WebFetchTool", () => {
  it("fetches allowed text content with sanitized structured output and metadata", async () => {
    const fetchClient = vi.fn<WebFetchClient>(async () => ({
      url: "https://docs.example.com/start",
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<html><script>bad()</script><h1>Docs</h1><p>Hello</p></html>",
      bytesRead: 61,
      redirectChain: ["https://example.com/start", "https://docs.example.com/start"],
    }));
    const tool = new WebFetchTool({ fetchClient });

    const result = await tool.execute(
      {
        name: "web_fetch",
        input: {
          url: "https://example.com/start",
          timeout: 1000,
          maxBytes: 2000,
          verbosity: "structured",
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({
      url: "https://docs.example.com/start",
      text: "Docs Hello",
      status: 200,
      contentType: "text/html; charset=utf-8",
      truncated: false,
    });
    expect(result.metadata).toMatchObject({
      toolName: "web_fetch",
      kind: "web",
      operation: "fetch",
      url: "https://example.com/start",
      normalizedUrl: "https://docs.example.com/start",
      status: 200,
      contentType: "text/html; charset=utf-8",
      bytesRead: 61,
      truncated: false,
      redirectChain: ["https://example.com/start", "https://docs.example.com/start"],
      verbosity: "structured",
    });
    expect(fetchClient).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.com/start",
      timeoutMs: 1000,
      maxBytes: 2000,
    }));
  });

  it("rejects URLs outside sandbox network policy before fetching", async () => {
    const fetchClient = vi.fn<WebFetchClient>();
    const tool = new WebFetchTool({ fetchClient });

    const result = await tool.execute(
      { name: "web_fetch", input: { url: "https://blocked.test" } },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["example.com"],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_fetch",
      kind: "web",
      operation: "fetch",
      errorCode: "network_denied",
    });
    expect(fetchClient).not.toHaveBeenCalled();
  });

  it("classifies missing network policy distinctly from domain denial", async () => {
    const fetchClient = vi.fn<WebFetchClient>();
    const tool = new WebFetchTool({ fetchClient });

    const result = await tool.execute({
      name: "web_fetch",
      input: { url: "https://example.com" },
    });

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_fetch",
      kind: "web",
      operation: "fetch",
      errorCode: "network_policy_missing",
    });
    expect(fetchClient).not.toHaveBeenCalled();
  });

  it("rejects redirect hops that leave network policy", async () => {
    const fetchClient = vi.fn<WebFetchClient>(async () => ({
      url: "https://evil.test/final",
      status: 200,
      contentType: "text/plain",
      body: "bad",
      bytesRead: 3,
      redirectChain: ["https://example.com/start", "https://evil.test/final"],
    }));
    const tool = new WebFetchTool({ fetchClient });

    const result = await tool.execute(
      { name: "web_fetch", input: { url: "https://example.com/start" } },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["example.com"],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_fetch",
      kind: "web",
      operation: "fetch",
      errorCode: "network_denied",
      redirectChain: ["https://example.com/start", "https://evil.test/final"],
    });
  });

  it("classifies unsuccessful HTTP responses as tool errors", async () => {
    const fetchClient = vi.fn<WebFetchClient>(async () => ({
      url: "https://example.com/missing",
      status: 404,
      contentType: "text/plain",
      body: "not found",
      bytesRead: 9,
      redirectChain: ["https://example.com/missing"],
    }));
    const tool = new WebFetchTool({ fetchClient });

    const result = await tool.execute(
      { name: "web_fetch", input: { url: "https://example.com/missing" } },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["example.com"],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toBe("Fetch returned 404");
    expect(result.metadata).toMatchObject({
      toolName: "web_fetch",
      kind: "web",
      operation: "fetch",
      status: 404,
      errorCode: "unavailable",
    });
  });
});

describe("WebSearchTool", () => {
  it("fails closed when no search provider is configured", async () => {
    const tool = new WebSearchTool();

    const result = await tool.execute(
      { name: "web_search", input: { query: "kiln docs" } },
      makeSandbox("C:/workspace", {
        netPolicy: "full",
        allowedDomains: ["*"],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_search",
      kind: "web",
      operation: "search",
      errorCode: "provider_not_configured",
    });
  });

  it("classifies missing search network policy distinctly from provider errors", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({ sources: [] }));
    const tool = new WebSearchTool({ searchProvider });

    const result = await tool.execute({
      name: "web_search",
      input: { query: "kiln docs" },
    });

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_search",
      kind: "web",
      operation: "search",
      errorCode: "network_policy_missing",
    });
    expect(searchProvider).not.toHaveBeenCalled();
  });

  it("passes normalized search controls to the provider and returns ranked sources", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "test-search",
      retrievedAt: "2026-04-29T00:00:00.000Z",
      sources: [{
        url: "https://docs.example.com/kiln",
        title: "Kiln docs",
        snippet: "Current docs",
      }],
    }));
    const tool = new WebSearchTool({ searchProvider });

    const result = await tool.execute(
      {
        name: "web_search",
        input: {
          query: "kiln docs",
          domains: ["Docs.Example.com"],
          recencyDays: 14,
          maxResults: 3,
          verbosity: "structured",
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({
      query: "kiln docs",
      sources: [{
        url: "https://docs.example.com/kiln",
        title: "Kiln docs",
        rank: 1,
        snippet: "Current docs",
      }],
    });
    expect(result.metadata).toMatchObject({
      toolName: "web_search",
      kind: "web",
      operation: "search",
      provider: "test-search",
      query: "kiln docs",
      domains: ["docs.example.com"],
      recencyDays: 14,
      resultCount: 1,
      verbosity: "structured",
    });
    expect(searchProvider).toHaveBeenCalledWith({
      query: "kiln docs",
      domains: ["docs.example.com"],
      recencyDays: 14,
      maxResults: 3,
    });
  });

  it("keeps source URLs visible in summary output", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "test-search",
      sources: [{
        url: "https://docs.example.com/kiln",
        title: "Kiln docs",
        snippet: "Current docs",
      }],
    }));
    const tool = new WebSearchTool({ searchProvider });

    const result = await tool.execute(
      {
        name: "web_search",
        input: {
          query: "kiln docs",
          verbosity: "summary",
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("1 source for kiln docs");
    expect(result.output).toContain("1. Kiln docs https://docs.example.com/kiln Current docs");
  });

  it("bounds source summaries so provider snippets do not hide URLs behind artifacts", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "test-search",
      sources: Array.from({ length: 12 }, (_, index) => ({
        url: `https://docs.example.com/kiln-${index + 1}`,
        title: `Kiln docs ${index + 1}`,
        snippet: "large provider snippet ".repeat(100),
      })),
    }));
    const tool = new WebSearchTool({ searchProvider });

    const result = await tool.execute(
      {
        name: "web_search",
        input: {
          query: "kiln docs",
          maxResults: 12,
          verbosity: "summary",
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("https://docs.example.com/kiln-1");
    expect(result.output).toContain("4 more sources omitted from summary");
    expect(result.output).not.toContain("https://docs.example.com/kiln-9");
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThan(8 * 1024);
  });

  it("narrows search domains from sandbox policy when no per-call domains are provided", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "test-search",
      sources: [],
    }));
    const tool = new WebSearchTool({ searchProvider });

    const result = await tool.execute(
      { name: "web_search", input: { query: "kiln docs" } },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      toolName: "web_search",
      kind: "web",
      domains: ["docs.example.com"],
      resultCount: 0,
    });
    expect(searchProvider).toHaveBeenCalledWith({
      query: "kiln docs",
      domains: ["docs.example.com"],
      maxResults: 5,
    });
  });

  it("treats null recencyDays as no recency filter", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "test-search",
      sources: [],
    }));
    const tool = new WebSearchTool({ searchProvider });

    const result = await tool.execute(
      {
        name: "web_search",
        input: {
          query: "kiln docs",
          domains: ["docs.example.com"],
          recencyDays: null,
          verbosity: "structured",
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      toolName: "web_search",
      kind: "web",
      operation: "search",
      query: "kiln docs",
      domains: ["docs.example.com"],
    });
    expect(result.metadata).not.toMatchObject({
      recencyDays: expect.any(Number),
    });
    expect(searchProvider).toHaveBeenCalledWith({
      query: "kiln docs",
      domains: ["docs.example.com"],
      maxResults: 5,
    });
  });

  it("treats null domains as no per-call domain filter", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "test-search",
      sources: [],
    }));
    const tool = new WebSearchTool({ searchProvider });

    const result = await tool.execute(
      {
        name: "web_search",
        input: {
          query: "kiln docs",
          domains: null,
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      toolName: "web_search",
      kind: "web",
      operation: "search",
      query: "kiln docs",
      domains: ["docs.example.com"],
    });
    expect(searchProvider).toHaveBeenCalledWith({
      query: "kiln docs",
      domains: ["docs.example.com"],
      maxResults: 5,
    });
  });
});

describe("WebExtractTool", () => {
  it("extracts allowed pages through the provider with structured output and metadata", async () => {
    const extractProvider = vi.fn<WebExtractProvider>(async () => ({
      provider: "test-extract",
      retrievedAt: "2026-05-08T00:00:00.000Z",
      pages: [{
        url: "https://docs.example.com/page",
        title: "<b>Docs</b>",
        contentType: "text/html",
        status: 200,
        text: "<script>bad()</script># Docs\n\nHello",
        bytesRead: 38,
      }],
    }));
    const tool = new WebExtractTool({ extractProvider });

    const result = await tool.execute(
      {
        name: "web_extract",
        input: {
          urls: ["https://docs.example.com/page"],
          format: "markdown",
          maxBytes: 2000,
          timeout: 1000,
          verbosity: "structured",
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({
      pages: [{
        url: "https://docs.example.com/page",
        title: "Docs",
        text: "# Docs\n\nHello",
        truncated: false,
      }],
    });
    expect(result.metadata).toMatchObject({
      toolName: "web_extract",
      kind: "web",
      operation: "extract",
      provider: "test-extract",
      urls: ["https://docs.example.com/page"],
      format: "markdown",
      extractCount: 1,
      bytesRead: 38,
      truncated: false,
      verbosity: "structured",
    });
    expect(extractProvider).toHaveBeenCalledWith({
      urls: ["https://docs.example.com/page"],
      format: "markdown",
      timeoutMs: 1000,
      maxBytes: 2000,
    });
  });

  it("keeps extracted page URLs visible in summary output", async () => {
    const extractProvider = vi.fn<WebExtractProvider>(async () => ({
      provider: "test-extract",
      pages: [{
        url: "https://docs.example.com/page",
        title: "Docs",
        contentType: "text/html",
        status: 200,
        text: "Hello",
        bytesRead: 5,
      }],
    }));
    const tool = new WebExtractTool({ extractProvider });

    const result = await tool.execute(
      {
        name: "web_extract",
        input: {
          urls: ["https://docs.example.com/page"],
          verbosity: "summary",
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("1 extracted page");
    expect(result.output).toContain("Docs: https://docs.example.com/page");
  });

  it("fails closed when no extract provider is configured", async () => {
    const tool = new WebExtractTool();

    const result = await tool.execute(
      { name: "web_extract", input: { urls: ["https://example.com"] } },
      makeSandbox("C:/workspace", {
        netPolicy: "full",
        allowedDomains: ["*"],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_extract",
      kind: "web",
      operation: "extract",
      errorCode: "provider_not_configured",
    });
  });

  it("requires explicit network policy before calling the provider", async () => {
    const extractProvider = vi.fn<WebExtractProvider>(async () => ({ pages: [] }));
    const tool = new WebExtractTool({ extractProvider });

    const result = await tool.execute({
      name: "web_extract",
      input: { urls: ["https://example.com"] },
    });

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_extract",
      kind: "web",
      operation: "extract",
      errorCode: "network_policy_missing",
    });
    expect(extractProvider).not.toHaveBeenCalled();
  });

  it("reports empty extraction as a tool error instead of ambiguous success", async () => {
    const extractProvider = vi.fn<WebExtractProvider>(async () => ({
      provider: "test-extract",
      retrievedAt: "2026-05-08T00:00:00.000Z",
      pages: [],
    }));
    const tool = new WebExtractTool({ extractProvider });

    const result = await tool.execute(
      {
        name: "web_extract",
        input: {
          urls: ["https://docs.example.com/report.pdf"],
          format: "markdown",
          verbosity: "structured",
        },
      },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("returned no extractable pages");
    expect(result.metadata).toMatchObject({
      toolName: "web_extract",
      kind: "web",
      operation: "extract",
      provider: "test-extract",
      urls: ["https://docs.example.com/report.pdf"],
      format: "markdown",
      extractCount: 0,
      pages: [],
      errorCode: "empty_extraction",
      verbosity: "structured",
    });
  });

  it("rejects denied domains before calling the provider", async () => {
    const extractProvider = vi.fn<WebExtractProvider>(async () => ({ pages: [] }));
    const tool = new WebExtractTool({ extractProvider });

    const result = await tool.execute(
      { name: "web_extract", input: { urls: ["https://blocked.test"] } },
      makeSandbox("C:/workspace", {
        netPolicy: "documentation",
        allowedDomains: ["example.com"],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_extract",
      kind: "web",
      operation: "extract",
      errorCode: "network_denied",
    });
    expect(extractProvider).not.toHaveBeenCalled();
  });
});
