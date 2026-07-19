import { describe, expect, it, vi } from "vitest";
import { WebExtractTool, type WebExtractProvider } from "../../../src/tools/infrastructure/web-extract-tool.js";
import { WebFetchTool, type WebFetchClient } from "../../../src/tools/infrastructure/web-fetch-tool.js";
import {
  WebSearchProviderError,
  WebSearchTool,
  type WebSearchProvider,
} from "../../../src/tools/infrastructure/web-search-tool.js";
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
  it("fails closed when a provider violates strict domain postconditions", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "tavily",
      requestId: "req-domain-violation",
      durationMs: 42,
      sources: [{
        url: "https://spam.example/result",
        title: "Unrelated mirror",
        relevanceScore: 0.91,
      }],
    }));
    const tool = new WebSearchTool({ searchProvider });

    const result = await tool.execute({
      name: "web_search",
      input: {
        query: "official kiln docs",
        domains: ["docs.example.com"],
      },
    }, makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }));

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      errorCode: "provider_contract_violation",
      providerRequestId: "req-domain-violation",
      providerDurationMs: 42,
      domainPostcondition: {
        enforcement: "strict",
        acceptedCount: 0,
        rejectedCount: 1,
        rejectedSourceIds: ["https://spam.example/result"],
      },
    });
  });

  it("routes to the next capable provider after semantic evidence rejection", async () => {
    const tavily = vi.fn<WebSearchProvider>(async () => ({
      provider: "tavily",
      requestId: "req-tavily",
      sources: [{
        url: "https://schedule.example/chivas-toluca",
        title: "Chivas vs Toluca programado para el 19 de julio de 2026",
      }],
    }));
    const brave = vi.fn<WebSearchProvider>(async () => ({
      provider: "brave",
      requestId: "req-brave",
      sources: [{
        url: "https://espn.example/match",
        title: "Chivas 1-0 Toluca, resultado final, 18 de julio de 2026",
      }, {
        url: "https://tudn.example/match",
        snippet: "Resultado final del 18 de julio de 2026: Chivas 1-0 Toluca.",
      }],
    }));
    const tool = new WebSearchTool({
      searchProviders: [{
        id: "tavily-primary",
        search: tavily,
        capabilities: {
          provider: "tavily",
          recencyFilter: "enforced",
          topics: ["general", "news", "finance"],
          absoluteDateRange: true,
          exactMatch: true,
          countryTargeting: true,
          languageTargeting: false,
          highPrecisionSearch: true,
        },
      }, {
        id: "brave-fallback",
        search: brave,
        capabilities: {
          provider: "brave",
          recencyFilter: "enforced",
          topics: ["general", "news"],
          absoluteDateRange: true,
          exactMatch: true,
          countryTargeting: true,
          languageTargeting: true,
          highPrecisionSearch: true,
        },
      }],
    });

    const result = await tool.execute({
      name: "web_search",
      input: {
        query: "Chivas Toluca resultado hoy",
        recencyDays: 2,
        freshnessRequired: true,
        topic: "news",
        quality: "high",
        temporalRequirement: {
          exactLocalDate: "2026-07-18",
          requiredIdentityTerms: ["chivas", "toluca"],
          eventStatus: "completed",
          minimumIndependentSources: 2,
        },
      },
    }, makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }));

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      provider: "brave",
      providerRequestId: "req-brave",
      providerAttempts: [{
        providerId: "tavily-primary",
        outcome: "evidence_rejected",
      }, {
        providerId: "brave-fallback",
        outcome: "accepted",
      }],
    });
    expect(tavily).toHaveBeenCalledOnce();
    expect(brave).toHaveBeenCalledOnce();
  });

  it("preserves structured failure telemetry before accepting a fallback provider", async () => {
    const primary = vi.fn<WebSearchProvider>(async () => {
      throw new WebSearchProviderError("rate limited", {
        provider: "tavily",
        requestId: "req-failed",
        durationMs: 51,
        status: 429,
      });
    });
    const fallback = vi.fn<WebSearchProvider>(async () => ({
      provider: "brave",
      requestId: "req-accepted",
      durationMs: 37,
      sources: [{ url: "https://docs.example.com/kiln", title: "Kiln docs" }],
    }));
    const capable = (provider: string) => ({
      provider,
      recencyFilter: "enforced" as const,
      topics: ["general" as const],
      absoluteDateRange: true,
      exactMatch: true,
      countryTargeting: true,
      languageTargeting: true,
      highPrecisionSearch: true,
    });
    const tool = new WebSearchTool({
      searchProviders: [
        { id: "primary", search: primary, capabilities: capable("tavily") },
        { id: "fallback", search: fallback, capabilities: capable("brave") },
      ],
    });

    const result = await tool.execute(
      { name: "web_search", input: { query: "kiln docs", domains: ["docs.example.com"] } },
      makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }),
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      provider: "brave",
      providerAttempts: [
        {
          providerId: "primary",
          outcome: "provider_failed",
          requestId: "req-failed",
          durationMs: 51,
          providerStatus: 429,
        },
        { providerId: "fallback", outcome: "accepted", requestId: "req-accepted", durationMs: 37 },
      ],
    });
  });

  it("rejects providers that cannot satisfy required intent capabilities", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({ sources: [] }));
    const tool = new WebSearchTool({
      searchProviders: [{
        id: "limited-search",
        search: searchProvider,
        capabilities: {
          provider: "limited",
          recencyFilter: "unsupported",
          topics: ["general"],
          absoluteDateRange: false,
          exactMatch: false,
          countryTargeting: false,
          languageTargeting: false,
          highPrecisionSearch: false,
        },
      }],
    });

    const result = await tool.execute({
      name: "web_search",
      input: {
        query: "latest official result",
        freshnessRequired: true,
        recencyDays: 1,
        topic: "news",
        quality: "high",
      },
    }, makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }));

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      errorCode: "provider_capability_mismatch",
      providerAttempts: [{
        providerId: "limited-search",
        outcome: "capability_rejected",
        unmetCapabilities: expect.arrayContaining(["recency", "topic:news", "quality:high"]),
      }],
    });
    expect(searchProvider).not.toHaveBeenCalled();
  });

  it("omits unsupported targeting preferences without rejecting an otherwise capable provider", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "tavily",
      sources: [{ url: "https://example.com/match", title: "Match result" }],
    }));
    const tool = new WebSearchTool({
      searchProviders: [{
        id: "tavily-primary",
        search: searchProvider,
        capabilities: {
          provider: "tavily",
          recencyFilter: "enforced",
          topics: ["general", "news", "finance", "research"],
          absoluteDateRange: true,
          exactMatch: true,
          countryTargeting: true,
          countryTargetingTopics: ["general"],
          languageTargeting: false,
          highPrecisionSearch: true,
        },
      }],
    });

    const result = await tool.execute({
      name: "web_search",
      input: {
        query: "Chivas Toluca resultado",
        topic: "news",
        country: "MX",
        language: "es",
      },
    }, makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }));

    expect(result.isError).toBe(false);
    expect(searchProvider).toHaveBeenCalledWith({
      query: "Chivas Toluca resultado",
      domains: [],
      maxResults: 5,
      topic: "news",
    });
    expect(result.metadata).toMatchObject({
      providerAttempts: [{
        providerId: "tavily-primary",
        outcome: "accepted",
        omittedPreferences: ["country_targeting", "language_targeting"],
      }],
    });
  });

  it("rejects unsupported targeting when the caller explicitly requires it", async () => {
    const searchProvider = vi.fn<WebSearchProvider>();
    const tool = new WebSearchTool({
      searchProviders: [{
        id: "tavily-primary",
        search: searchProvider,
        capabilities: {
          provider: "tavily",
          recencyFilter: "enforced",
          topics: ["news"],
          absoluteDateRange: true,
          exactMatch: true,
          countryTargeting: true,
          countryTargetingTopics: ["general"],
          languageTargeting: false,
          highPrecisionSearch: true,
        },
      }],
    });

    const result = await tool.execute({
      name: "web_search",
      input: {
        query: "noticias mexicanas en español",
        topic: "news",
        country: "MX",
        language: "es",
        targetingRequired: true,
      },
    }, makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }));

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      errorCode: "provider_capability_mismatch",
      providerAttempts: [{
        outcome: "capability_rejected",
        unmetCapabilities: ["country_targeting", "language_targeting"],
      }],
    });
    expect(searchProvider).not.toHaveBeenCalled();
  });

  it("rejects freshness requirements that do not define a time boundary", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({ sources: [] }));
    const tool = new WebSearchTool({
      searchProvider,
      freshnessCapability: { provider: "tavily", recencyFilter: "enforced" },
    });

    const result = await tool.execute(
      { name: "web_search", input: { query: "latest result", freshnessRequired: true } },
      makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }),
    );

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({ errorCode: "invalid_input" });
    expect(result.output).toContain("freshnessRequired requires recencyDays, startDate, or endDate");
    expect(searchProvider).not.toHaveBeenCalled();
  });

  it("fails closed when required freshness is not enforced by the provider", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({ sources: [] }));
    const tool = new WebSearchTool({
      searchProvider,
      freshnessCapability: { provider: "searxng", recencyFilter: "ignored" },
    });

    const result = await tool.execute(
      { name: "web_search", input: { query: "score today", freshnessRequired: true, recencyDays: 1 } },
      makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }),
    );

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      toolName: "web_search",
      errorCode: "freshness_not_enforced",
      freshnessRequired: true,
      freshnessEnforcement: "not_enforced",
    });
    expect(searchProvider).not.toHaveBeenCalled();
  });

  it("records enforced required freshness in search metadata", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({ sources: [] }));
    const tool = new WebSearchTool({
      searchProvider,
      freshnessCapability: { provider: "tavily", recencyFilter: "enforced" },
    });

    const result = await tool.execute(
      { name: "web_search", input: { query: "score today", freshnessRequired: true, recencyDays: 1 } },
      makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }),
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      toolName: "web_search",
      freshnessRequired: true,
      freshnessEnforcement: "enforced",
    });
  });

  it("fails closed when temporal event evidence lacks independent semantic consensus", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "tavily",
      retrievedAt: "2026-07-19T05:34:48.312Z",
      sources: [{
        url: "https://www.espn.com.mx/futbol/partido/401877039",
        title: "Guadalajara vs. Toluca (18 de Jul., 2026) Resultados en Vivo",
        snippet: "Partido programado.",
      }],
    }));
    const tool = new WebSearchTool({
      searchProvider,
      freshnessCapability: { provider: "tavily", recencyFilter: "enforced" },
    });

    const result = await tool.execute({
      name: "web_search",
      input: {
        query: "Guadalajara Toluca resultado hoy",
        freshnessRequired: true,
        recencyDays: 2,
        temporalRequirement: {
          exactLocalDate: "2026-07-18",
          requiredIdentityTerms: ["guadalajara", "toluca"],
          eventStatus: "completed",
          minimumIndependentSources: 2,
        },
      },
    }, makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }));

    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({
      errorCode: "temporal_evidence_rejected",
      temporalEvidence: {
        accepted: false,
        reason: "independent_source_consensus_missing",
      },
      recoveryDirective: {
        kind: "progressive_web_research",
        action: "broaden_search",
        constraintPolicy: "relax_only_agent_added",
        preserveTemporalRequirement: true,
        nextActions: ["broaden_search", "extract_candidates"],
      },
    });
    expect(result.output).toContain("Retry web_search with a broader discovery query");
    expect(result.output).toContain("Do not copy the event date into publication-date filters");
    expect(searchProvider).toHaveBeenCalledWith(expect.objectContaining({
      topic: "general",
      quality: "high",
    }));
  });

  it("returns accepted temporal evidence when independent completed-event sources agree", async () => {
    const searchProvider = vi.fn<WebSearchProvider>(async () => ({
      provider: "tavily",
      retrievedAt: "2026-07-19T05:34:48.312Z",
      sources: [{
        url: "https://www.espn.com.mx/match",
        title: "Guadalajara 0-2 Toluca (18 de Jul., 2026) Resultado Final",
      }, {
        url: "https://www.tudn.com/match",
        title: "Guadalajara vs Toluca",
        snippet: "Resultado final del 18 de julio de 2026: Guadalajara 0-2 Toluca.",
      }],
    }));
    const tool = new WebSearchTool({
      searchProvider,
      freshnessCapability: { provider: "tavily", recencyFilter: "enforced" },
    });

    const result = await tool.execute({
      name: "web_search",
      input: {
        query: "Guadalajara Toluca resultado hoy",
        freshnessRequired: true,
        recencyDays: 2,
        temporalRequirement: {
          exactLocalDate: "2026-07-18",
          requiredIdentityTerms: ["guadalajara", "toluca"],
          eventStatus: "completed",
          minimumIndependentSources: 2,
        },
      },
    }, makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }));

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      temporalEvidence: {
        accepted: true,
        acceptedSourceIds: ["https://www.espn.com.mx/match", "https://www.tudn.com/match"],
      },
    });
  });

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
  it("verifies temporal event consensus from full independent page content", async () => {
    const extractProvider = vi.fn<WebExtractProvider>(async () => ({
      provider: "tavily",
      retrievedAt: "2026-07-19T05:34:48.312Z",
      pages: [{
        url: "https://www.espn.com.mx/match",
        text: "Resultado final del 18 de julio de 2026: Guadalajara 0-2 Toluca.",
      }, {
        url: "https://www.tudn.com/match",
        text: "Guadalajara contra Toluca terminó el 18 de julio de 2026. Marcador final 0-2.",
      }],
    }));
    const tool = new WebExtractTool({ extractProvider });

    const result = await tool.execute({
      name: "web_extract",
      input: {
        urls: ["https://www.espn.com.mx/match", "https://www.tudn.com/match"],
        temporalRequirement: {
          exactLocalDate: "2026-07-18",
          requiredIdentityTerms: ["guadalajara", "toluca"],
          eventStatus: "completed",
          minimumIndependentSources: 2,
        },
      },
    }, makeSandbox("C:/workspace", { netPolicy: "full", allowedDomains: ["*"] }));

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      temporalEvidence: { accepted: true },
    });
  });

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
