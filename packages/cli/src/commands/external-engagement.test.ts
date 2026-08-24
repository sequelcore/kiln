import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ResolvedSecret, SecretResolver } from "@kilnai/core/credentials";
import { buildExternalEvidenceReport } from "@kilnai/core/external-engagement";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  externalEngagementCommand,
  type XEvidenceFetcher,
  type XSearchFetcher,
  type XLiveSmokeResult,
  type XLiveSmokeTester,
  type XOAuth2RefreshResult,
  type XOAuth2TokenRefresher,
} from "./external-engagement.js";
import type { XEvidenceReportCache } from "./x-evidence-report-cache.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";

const tempRoots: string[] = [];

describe("external engagement command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints a dry-run X report plan without calling the network", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: XEvidenceFetcher = {
      fetchEvidence: vi.fn(),
    };

    await externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--max-replies",
      "5",
      "--dry-run",
    ], {
      fetcher,
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      reportId: () => "report-test",
    });

    expect(fetcher.fetchEvidence).not.toHaveBeenCalled();
    const output = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(output).toMatchObject({
      reportId: "report-test",
      source: "x",
      query: {
        references: [{
          platform: "x",
          postId: "1000000000000000001",
          sourceUrl: "https://x.com/example_author/status/1000000000000000001",
        }],
        maxRepliesPerPost: 5,
      },
      budget: {
        rootPostReads: 1,
        replySearches: 1,
        maxReplyReads: 5,
        maxPostReads: 6,
      },
      artifacts: [],
      signals: [],
    });
  });

  it("prints a dry-run bounded X search plan without credential resolution or network access", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const searchFetcher: XSearchFetcher = {
      fetchSearch: vi.fn(),
    };
    const credentialResolver: SecretResolver = { resolve: vi.fn() };

    await externalEngagementCommand({} as never, "x-search", [
      "--query",
      "#mcp",
      "--max-posts",
      "25",
      "--max-replies",
      "3",
      "--max-requests",
      "30",
      "--dry-run",
    ], {
      searchFetcher,
      credentialResolver,
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      reportId: () => "search-plan-1",
    });

    expect(searchFetcher.fetchSearch).not.toHaveBeenCalled();
    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    const output = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(output).toMatchObject({
      reportId: "search-plan-1",
      source: "x",
      query: {
        references: [],
        maxRepliesPerPost: 3,
        discoveryScope: {
          provider: "x",
          method: "search",
          query: "#mcp",
          maxPosts: 25,
          maxRepliesPerPost: 3,
          searchScope: "recent",
          maxRequests: 30,
        },
      },
      budget: {
        rootPostReads: 25,
        replySearches: 25,
        maxReplyReads: 75,
        userReads: 100,
        maxPostReads: 100,
        estimatedRequests: 27,
        discoverySearches: 1,
      },
      artifacts: [],
      signals: [],
    });
    expect(JSON.stringify(output)).toContain("Hashtag and keyword search samples visible public posts");
  });

  it("runs bounded X search through secret refs and writes a composable evidence report", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const outputPath = join(tempRoot(), "x-search.json");
    const searchFetcher: XSearchFetcher = {
      fetchSearch: vi.fn(async ({ discoveryScope, generatedAt, reportId, budget }) =>
        buildExternalEvidenceReport({
          reportId,
          generatedAt,
          source: "x",
          query: {
            references: [],
            maxRepliesPerPost: discoveryScope.maxRepliesPerPost,
            discoveryScope,
          },
          budget,
          artifacts: [{
            platform: "x",
            artifactId: "1000000000000000001",
            kind: "post",
            sourceUrl: "https://x.com/i/status/1000000000000000001",
            text: "Synthetic search result asking for MCP workflow controls.",
            retrievedAt: generatedAt,
          }],
          signals: [],
        })),
    };

    await externalEngagementCommand({} as never, "x-search", [
      "--query",
      "#mcp",
      "--max-posts",
      "10",
      "--max-replies",
      "0",
      "--max-requests",
      "3",
      "--no-cache",
      "--output",
      outputPath,
    ], {
      searchFetcher,
      env: { KILN_X_OAUTH2_ACCESS_TOKEN: "token" },
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      reportId: () => "search-report-1",
    });

    expect(searchFetcher.fetchSearch).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "token",
      discoveryScope: expect.objectContaining({
        query: "#mcp",
        maxPosts: 10,
        maxRepliesPerPost: 0,
        maxRequests: 3,
      }),
      budget: expect.objectContaining({
        discoverySearches: 1,
        estimatedRequests: 2,
      }),
    }));
    expect(JSON.parse(readFileSync(outputPath, "utf-8"))).toMatchObject({
      reportId: "search-report-1",
      query: { discoveryScope: { query: "#mcp" } },
      artifacts: [{ text: "Synthetic search result asking for MCP workflow controls." }],
    });
    expect(log.mock.calls[0]?.[0]).toBe(`External engagement report written: ${outputPath}`);
  });

  it("rejects X search plans that exceed the configured request budget before credentials", async () => {
    const credentialResolver: SecretResolver = { resolve: vi.fn() };
    const searchFetcher: XSearchFetcher = { fetchSearch: vi.fn() };

    await expect(externalEngagementCommand({} as never, "x-search", [
      "--query",
      "#mcp",
      "--max-posts",
      "25",
      "--max-replies",
      "3",
      "--max-requests",
      "10",
    ], {
      credentialResolver,
      searchFetcher,
    })).rejects.toThrow(/estimated X search requests 27 exceed --max-requests 10/u);

    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(searchFetcher.fetchSearch).not.toHaveBeenCalled();
  });

  it("serves cached X search reports before credential resolution or network access", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cachedReport = buildExternalEvidenceReport({
      reportId: "cached-search-report",
      generatedAt: "2026-06-24T00:00:00.000Z",
      source: "x",
      query: {
        references: [],
        maxRepliesPerPost: 0,
        discoveryScope: {
          provider: "x",
          method: "search",
          query: "#mcp",
          maxPosts: 10,
          maxRepliesPerPost: 0,
          searchScope: "recent",
          maxRequests: 3,
          samplingLimitations: [
            "X recent search only covers the provider's recent-search window for the configured account.",
            "Hashtag and keyword search samples visible public posts matching the query, not the whole market.",
            "Replies are capped per discovered root post and may overrepresent highly active threads.",
            "Results are provider-ranked or reverse chronological depending on the X endpoint response.",
          ],
        },
      },
      budget: {
        discoverySearches: 1,
        rootPostReads: 10,
        replySearches: 0,
        maxReplyReads: 0,
        userReads: 10,
        maxPostReads: 10,
        estimatedRequests: 2,
      },
      artifacts: [],
      signals: [],
    });
    const reportCache: XEvidenceReportCache = {
      read: vi.fn(() => cachedReport),
      write: vi.fn(),
    };
    const credentialResolver: SecretResolver = { resolve: vi.fn() };
    const searchFetcher: XSearchFetcher = { fetchSearch: vi.fn() };

    await externalEngagementCommand({} as never, "x-search", [
      "--query",
      "#mcp",
      "--max-posts",
      "10",
      "--max-replies",
      "0",
      "--max-requests",
      "3",
    ], {
      credentialResolver,
      searchFetcher,
      reportCache,
    });

    expect(reportCache.read).toHaveBeenCalledWith(cachedReport.query);
    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(searchFetcher.fetchSearch).not.toHaveBeenCalled();
    expect(reportCache.write).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ reportId: "cached-search-report" });
  });

  it("reads URLs from an input file, deduplicates them, and writes fetched reports", async () => {
    const root = tempRoot();
    const inputPath = join(root, "x-sources.txt");
    const outputPath = join(root, "report.json");
    writeFileSync(inputPath, [
      "https://x.com/example_author/status/1000000000000000001",
      "1000000000000000002",
      "https://x.com/example_author/status/1000000000000000001",
      "",
    ].join("\n"), "utf-8");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: XEvidenceFetcher = {
      fetchEvidence: vi.fn(async ({ references, maxRepliesPerPost, generatedAt, reportId, budget }) =>
        buildExternalEvidenceReport({
          reportId,
          generatedAt,
          source: "x",
          query: { references, maxRepliesPerPost },
          budget,
          artifacts: [{
            platform: "x",
            artifactId: references[0]!.postId,
            kind: "post",
            sourceUrl: references[0]!.sourceUrl,
            text: "Synthetic root post",
            retrievedAt: generatedAt,
          }],
          signals: [],
        })),
    };

    await externalEngagementCommand({} as never, "x-report", [
      "--input",
      inputPath,
      "--max-replies",
      "2",
      "--no-cache",
      "--output",
      outputPath,
    ], {
      fetcher,
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      reportId: () => "report-test",
      env: { KILN_X_OAUTH2_ACCESS_TOKEN: "token" },
    });

    expect(fetcher.fetchEvidence).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "token",
      maxRepliesPerPost: 2,
      references: [
        expect.objectContaining({ postId: "1000000000000000001" }),
        expect.objectContaining({ postId: "1000000000000000002" }),
      ],
    }));
    expect(JSON.parse(readFileSync(outputPath, "utf-8"))).toMatchObject({
      reportId: "report-test",
      artifacts: [{ text: "Synthetic root post" }],
    });
    expect(log.mock.calls[0]?.[0]).toBe(`External engagement report written: ${outputPath}`);
  });

  it("serves cached X reports before credential resolution or network access", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cachedReport = buildExternalEvidenceReport({
      reportId: "cached-report",
      generatedAt: "2026-06-24T00:00:00.000Z",
      source: "x",
      query: {
        references: [{
          platform: "x",
          postId: "1000000000000000001",
          sourceUrl: "https://x.com/example_author/status/1000000000000000001",
        }],
        maxRepliesPerPost: 0,
      },
      budget: {
        rootPostReads: 1,
        replySearches: 0,
        maxReplyReads: 0,
        userReads: 1,
        maxPostReads: 1,
        estimatedRequests: 2,
      },
      artifacts: [],
      signals: [],
    });
    const reportCache: XEvidenceReportCache = {
      read: vi.fn(() => cachedReport),
      write: vi.fn(),
    };
    const credentialResolver: SecretResolver = { resolve: vi.fn() };
    const fetcher: XEvidenceFetcher = { fetchEvidence: vi.fn() };

    await externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--max-replies",
      "0",
    ], {
      credentialResolver,
      fetcher,
      reportCache,
    });

    expect(reportCache.read).toHaveBeenCalledWith(cachedReport.query);
    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(fetcher.fetchEvidence).not.toHaveBeenCalled();
    expect(reportCache.write).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ reportId: "cached-report" });
  });

  it("persists x-report cache files and reuses them without credentials", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cacheDir = join(tempRoot(), "x-report-cache");
    const fetcher: XEvidenceFetcher = {
      fetchEvidence: vi.fn(async ({ references, maxRepliesPerPost, generatedAt, reportId, budget }) =>
        buildExternalEvidenceReport({
          reportId,
          generatedAt,
          source: "x",
          query: { references, maxRepliesPerPost },
          budget,
          artifacts: [{
            platform: "x",
            artifactId: references[0]!.postId,
            kind: "post",
            sourceUrl: references[0]!.sourceUrl,
            text: "Cached root post",
            retrievedAt: generatedAt,
          }],
          signals: [],
        })),
    };

    await externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--max-replies",
      "0",
    ], {
      fetcher,
      defaultCacheDir: cacheDir,
      env: { KILN_X_OAUTH2_ACCESS_TOKEN: "token" },
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      reportId: () => "fresh-cache-report",
    });

    await externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--max-replies",
      "0",
    ], {
      fetcher: { fetchEvidence: vi.fn() },
      defaultCacheDir: cacheDir,
      env: {},
    });

    expect(fetcher.fetchEvidence).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[1]?.[0]))).toMatchObject({
      reportId: "fresh-cache-report",
      artifacts: [{ text: "Cached root post" }],
    });
  });

  it("fails closed when the private X report cache is redirected by a junction", async () => {
    const root = tempRoot();
    const binding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });
    const outside = join(root, "redirect-target");
    mkdirSync(outside, { recursive: true });
    mkdirSync(binding.projectStateRoot, { recursive: true });
    try {
      symlinkSync(outside, binding.cachePath, "junction");
    } catch {
      return;
    }

    const fetcher: XEvidenceFetcher = {
      fetchEvidence: vi.fn(async ({ references, maxRepliesPerPost, generatedAt, reportId, budget }) =>
        buildExternalEvidenceReport({
          reportId,
          generatedAt,
          source: "x",
          query: { references, maxRepliesPerPost },
          budget,
          artifacts: [],
          signals: [],
        })),
    };

    await expect(externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--max-replies",
      "0",
    ], {
      projectStateBinding: binding,
      fetcher,
      env: { KILN_X_OAUTH2_ACCESS_TOKEN: "token" },
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      reportId: () => "redirected-cache-report",
    })).rejects.toThrow(/unsafe/iu);
    expect(readdirSync(outside)).toHaveLength(0);
  });

  it("refreshes cache when requested", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const reportCache: XEvidenceReportCache = {
      read: vi.fn(),
      write: vi.fn(),
    };
    const fetcher: XEvidenceFetcher = {
      fetchEvidence: vi.fn(async ({ references, maxRepliesPerPost, generatedAt, reportId, budget }) =>
        buildExternalEvidenceReport({
          reportId,
          generatedAt,
          source: "x",
          query: { references, maxRepliesPerPost },
          budget,
          artifacts: [],
          signals: [],
        })),
    };

    await externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--refresh-cache",
    ], {
      fetcher,
      reportCache,
      env: { KILN_X_OAUTH2_ACCESS_TOKEN: "token" },
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      reportId: () => "fresh-report",
    });

    expect(reportCache.read).not.toHaveBeenCalled();
    expect(fetcher.fetchEvidence).toHaveBeenCalled();
    expect(reportCache.write).toHaveBeenCalledWith(expect.objectContaining({ reportId: "fresh-report" }));
  });

  it("disables cache reads and writes when requested", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const reportCache: XEvidenceReportCache = {
      read: vi.fn(),
      write: vi.fn(),
    };
    const fetcher: XEvidenceFetcher = {
      fetchEvidence: vi.fn(async ({ references, maxRepliesPerPost, generatedAt, reportId, budget }) =>
        buildExternalEvidenceReport({
          reportId,
          generatedAt,
          source: "x",
          query: { references, maxRepliesPerPost },
          budget,
          artifacts: [],
          signals: [],
        })),
    };

    await externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--no-cache",
    ], {
      fetcher,
      reportCache,
      env: { KILN_X_OAUTH2_ACCESS_TOKEN: "token" },
    });

    expect(reportCache.read).not.toHaveBeenCalled();
    expect(reportCache.write).not.toHaveBeenCalled();
    expect(fetcher.fetchEvidence).toHaveBeenCalled();
  });

  it("resolves the X access token through a governed secret reference", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: XEvidenceFetcher = {
      fetchEvidence: vi.fn(async ({ references, maxRepliesPerPost, generatedAt, reportId, budget }) =>
        buildExternalEvidenceReport({
          reportId,
          generatedAt,
          source: "x",
          query: { references, maxRepliesPerPost },
          budget,
          artifacts: [],
          signals: [],
        })),
    };
    const resolve = vi.fn<SecretResolver["resolve"]>(async (ref) => ({
      ref,
      value: "synthetic-token-value",
      diagnostic: {
        refId: ref.id,
        purpose: ref.purpose,
        scopes: ref.scopes,
        source: ref.source,
        status: "available",
        resolvedAt: "2026-06-24T00:00:00.000Z",
      },
    }));
    const credentialResolver: SecretResolver = { resolve };

    await externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--no-cache",
      "--access-token-env",
      "MY_X_ACCESS_TOKEN",
    ], {
      fetcher,
      credentialResolver,
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      reportId: () => "report-test",
    });

    expect(resolve).toHaveBeenCalledWith({
      id: "x-oauth2-access-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read", "x:user.read"],
      source: { kind: "env", name: "MY_X_ACCESS_TOKEN" },
    });
    expect(fetcher.fetchEvidence).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "synthetic-token-value",
    }));
    expect(JSON.stringify(resolve.mock.calls[0])).not.toContain("synthetic-token-value");
  });

  it("fails closed when a live run has no access token", async () => {
    await expect(externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--no-cache",
    ], {
      fetcher: { fetchEvidence: vi.fn() },
      env: {},
    })).rejects.toThrow(/requires KILN_X_OAUTH2_ACCESS_TOKEN/u);
  });

  it("fails closed before X network access when credential lifecycle is not usable", async () => {
    const fetcher: XEvidenceFetcher = {
      fetchEvidence: vi.fn(),
    };
    const credentialResolver: SecretResolver = {
      resolve: vi.fn<SecretResolver["resolve"]>(async (ref): Promise<ResolvedSecret> => ({
        ref,
        value: "synthetic-token-value",
        diagnostic: {
          refId: ref.id,
          purpose: ref.purpose,
          scopes: ref.scopes,
          source: ref.source,
          status: "available",
          resolvedAt: "2026-06-24T00:00:00.000Z",
          lifecycle: {
            status: "refresh-due",
            reason: "credential refresh is due",
            dueAt: "2026-06-23T23:50:00.000Z",
          },
        },
      })),
    };

    await expect(externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--no-cache",
    ], {
      fetcher,
      credentialResolver,
    })).rejects.toThrow(/x-oauth2-access-token.*refresh-due/u);

    expect(fetcher.fetchEvidence).not.toHaveBeenCalled();
  });

  it("rejects reply limits that exceed the X recent-search request limit", async () => {
    await expect(externalEngagementCommand({} as never, "x-report", [
      "--url",
      "https://x.com/example_author/status/1000000000000000001",
      "--max-replies",
      "101",
      "--dry-run",
    ])).rejects.toThrow(/--max-replies must be less than or equal to 100/u);
  });

  it("rejects root post batches that exceed the X lookup request limit", async () => {
    await expect(externalEngagementCommand({} as never, "x-report", [
      "--input",
      writeSyntheticSourceList(101),
      "--dry-run",
    ])).rejects.toThrow(/supports at most 100 root X posts/u);
  });

  it("requires explicit live approval before X smoke credential resolution", async () => {
    const credentialResolver: SecretResolver = {
      resolve: vi.fn(),
    };
    const smokeTester: XLiveSmokeTester = {
      smoke: vi.fn(),
    };

    await expect(externalEngagementCommand({} as never, "x-smoke", [], {
      credentialResolver,
      smokeTester,
    })).rejects.toThrow(/x-smoke requires --allow-live/u);

    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(smokeTester.smoke).not.toHaveBeenCalled();
  });

  it("runs an explicitly approved X smoke check through secret refs without exposing token values", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const credentialResolver: SecretResolver = {
      resolve: vi.fn<SecretResolver["resolve"]>(async (ref): Promise<ResolvedSecret> => ({
        ref,
        value: "synthetic-token-value",
        diagnostic: {
          refId: ref.id,
          purpose: ref.purpose,
          scopes: ref.scopes,
          source: ref.source,
          status: "available",
          resolvedAt: "2026-06-24T00:00:00.000Z",
          lifecycle: { status: "usable" },
        },
      })),
    };
    const smokeTester: XLiveSmokeTester = {
      smoke: vi.fn(async ({ generatedAt, credentialRefId }): Promise<XLiveSmokeResult> => ({
        source: "x",
        operation: "credential-smoke",
        status: "ok",
        generatedAt,
        credentialRefId,
        requestCount: 1,
        authenticatedUser: {
          id: "1000000000000000000",
          username: "example_author",
          displayName: "Example Author",
        },
        rateLimit: {
          limit: 75,
          remaining: 74,
          resetAt: "2026-06-24T00:15:00.000Z",
        },
      })),
    };

    await externalEngagementCommand({} as never, "x-smoke", [
      "--allow-live",
      "--access-token-env",
      "MY_X_ACCESS_TOKEN",
    ], {
      credentialResolver,
      smokeTester,
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });

    expect(credentialResolver.resolve).toHaveBeenCalledWith({
      id: "x-oauth2-access-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read", "x:user.read"],
      source: { kind: "env", name: "MY_X_ACCESS_TOKEN" },
    });
    expect(smokeTester.smoke).toHaveBeenCalledWith({
      accessToken: "synthetic-token-value",
      generatedAt: "2026-06-24T00:00:00.000Z",
      credentialRefId: "x-oauth2-access-token",
    });
    const output = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(output)).toMatchObject({
      source: "x",
      operation: "credential-smoke",
      status: "ok",
      requestCount: 1,
      authenticatedUser: { username: "example_author" },
      rateLimit: { remaining: 74 },
    });
    expect(output).not.toContain("synthetic-token-value");
  });

  it("requires explicit live approval before X OAuth refresh credential resolution", async () => {
    const credentialResolver: SecretResolver = {
      resolve: vi.fn(),
    };
    const tokenRefresher: XOAuth2TokenRefresher = {
      refresh: vi.fn(),
    };

    await expect(externalEngagementCommand({} as never, "x-refresh", [
      "--secret-output",
      join(tempRoot(), "x-oauth2-tokens.json"),
    ], {
      credentialResolver,
      tokenRefresher,
    })).rejects.toThrow(/x-refresh requires --allow-live/u);

    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(tokenRefresher.refresh).not.toHaveBeenCalled();
  });

  it("requires an explicit secret output path before X OAuth refresh credential resolution", async () => {
    const credentialResolver: SecretResolver = {
      resolve: vi.fn(),
    };
    const tokenRefresher: XOAuth2TokenRefresher = {
      refresh: vi.fn(),
    };

    await expect(externalEngagementCommand({} as never, "x-refresh", [
      "--allow-live",
    ], {
      credentialResolver,
      tokenRefresher,
    })).rejects.toThrow(/x-refresh requires --secret-output/u);

    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(tokenRefresher.refresh).not.toHaveBeenCalled();
  });

  it("refreshes X OAuth tokens through secret refs and writes secrets only to the requested file", async () => {
    const root = tempRoot();
    const secretOutputPath = join(root, "private", "x-oauth2-tokens.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const credentialResolver: SecretResolver = {
      resolve: vi.fn<SecretResolver["resolve"]>(async (ref): Promise<ResolvedSecret> => ({
        ref,
        value: `${ref.id}-value`,
        diagnostic: {
          refId: ref.id,
          purpose: ref.purpose,
          scopes: ref.scopes,
          source: ref.source,
          status: "available",
          resolvedAt: "2026-06-24T00:00:00.000Z",
          lifecycle: { status: "usable" },
        },
      })),
    };
    const tokenRefresher: XOAuth2TokenRefresher = {
      refresh: vi.fn(async ({ generatedAt }): Promise<XOAuth2RefreshResult> => ({
        generatedAt,
        tokenType: "bearer",
        expiresInSeconds: 7200,
        scopes: ["tweet.read", "users.read", "offline.access"],
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      })),
    };

    await externalEngagementCommand({} as never, "x-refresh", [
      "--allow-live",
      "--secret-output",
      secretOutputPath,
      "--refresh-token-env",
      "MY_X_REFRESH_TOKEN",
      "--client-id-env",
      "MY_X_CLIENT_ID",
      "--client-secret-env",
      "MY_X_CLIENT_SECRET",
    ], {
      credentialResolver,
      tokenRefresher,
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });

    expect(credentialResolver.resolve).toHaveBeenCalledWith({
      id: "x-oauth2-refresh-token",
      purpose: "external-engagement:x:oauth2-refresh",
      scopes: ["x:oauth2.refresh"],
      source: { kind: "env", name: "MY_X_REFRESH_TOKEN" },
    });
    expect(credentialResolver.resolve).toHaveBeenCalledWith({
      id: "x-oauth2-client-id",
      purpose: "external-engagement:x:oauth2-client",
      scopes: ["x:oauth2.token"],
      source: { kind: "env", name: "MY_X_CLIENT_ID" },
    });
    expect(credentialResolver.resolve).toHaveBeenCalledWith({
      id: "x-oauth2-client-secret",
      purpose: "external-engagement:x:oauth2-client",
      scopes: ["x:oauth2.token"],
      source: { kind: "env", name: "MY_X_CLIENT_SECRET" },
    });
    expect(tokenRefresher.refresh).toHaveBeenCalledWith({
      refreshToken: "x-oauth2-refresh-token-value",
      clientId: "x-oauth2-client-id-value",
      clientSecret: "x-oauth2-client-secret-value",
      generatedAt: "2026-06-24T00:00:00.000Z",
    });
    expect(JSON.parse(readFileSync(secretOutputPath, "utf-8"))).toEqual({
      source: "x",
      operation: "oauth2-refresh",
      generatedAt: "2026-06-24T00:00:00.000Z",
      tokenType: "bearer",
      expiresInSeconds: 7200,
      scopes: ["tweet.read", "users.read", "offline.access"],
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    });
    const output = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(output)).toMatchObject({
      source: "x",
      operation: "oauth2-refresh",
      status: "ok",
      secretOutputPath,
      accessTokenReceived: true,
      refreshTokenReceived: true,
      credentialRefIds: {
        refreshToken: "x-oauth2-refresh-token",
        clientId: "x-oauth2-client-id",
        clientSecret: "x-oauth2-client-secret",
      },
    });
    expect(output).not.toContain("new-access-token");
    expect(output).not.toContain("new-refresh-token");
    expect(output).not.toContain("x-oauth2-refresh-token-value");
  });

  it("refreshes X OAuth tokens for public clients without resolving a client secret", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const secretOutputPath = join(tempRoot(), "x-oauth2-public-client.json");
    const credentialResolver: SecretResolver = {
      resolve: vi.fn<SecretResolver["resolve"]>(async (ref): Promise<ResolvedSecret> => ({
        ref,
        value: `${ref.id}-value`,
        diagnostic: {
          refId: ref.id,
          purpose: ref.purpose,
          scopes: ref.scopes,
          source: ref.source,
          status: "available",
          resolvedAt: "2026-06-24T00:00:00.000Z",
          lifecycle: { status: "usable" },
        },
      })),
    };
    const tokenRefresher: XOAuth2TokenRefresher = {
      refresh: vi.fn(async ({ generatedAt }): Promise<XOAuth2RefreshResult> => ({
        generatedAt,
        accessToken: "new-public-client-access-token",
      })),
    };

    await externalEngagementCommand({} as never, "x-refresh", [
      "--allow-live",
      "--public-client",
      "--secret-output",
      secretOutputPath,
    ], {
      credentialResolver,
      tokenRefresher,
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });

    expect(credentialResolver.resolve).toHaveBeenCalledTimes(2);
    expect(credentialResolver.resolve).not.toHaveBeenCalledWith(expect.objectContaining({
      id: "x-oauth2-client-secret",
    }));
    expect(tokenRefresher.refresh).toHaveBeenCalledWith({
      refreshToken: "x-oauth2-refresh-token-value",
      clientId: "x-oauth2-client-id-value",
      generatedAt: "2026-06-24T00:00:00.000Z",
    });
  });

  it("builds feature candidates from an existing X evidence report without network access", async () => {
    const root = tempRoot();
    const reportPath = join(root, "x-report.json");
    const outputPath = join(root, "x-candidates.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeFileSync(reportPath, JSON.stringify(buildExternalEvidenceReport({
      reportId: "source-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      source: "x",
      query: {
        references: [{
          platform: "x",
          postId: "1000000000000000001",
          sourceUrl: "https://x.com/example_author/status/1000000000000000001",
        }],
        maxRepliesPerPost: 2,
      },
      budget: {
        rootPostReads: 1,
        replySearches: 1,
        maxReplyReads: 2,
        userReads: 3,
        maxPostReads: 3,
        estimatedRequests: 3,
      },
      artifacts: [{
        platform: "x",
        artifactId: "1000000000000000001",
        kind: "post",
        sourceUrl: "https://x.com/example_author/status/1000000000000000001",
        text: "We need review gates because agent loops keep failing on real work.",
        retrievedAt: "2026-06-24T00:00:00.000Z",
      }],
      signals: [],
    }), null, 2), "utf-8");

    await externalEngagementCommand({} as never, "x-candidates", [
      "--report",
      reportPath,
      "--output",
      outputPath,
    ], {
      now: () => new Date("2026-06-24T01:00:00.000Z"),
      reportId: () => "candidate-report-1",
      fetcher: { fetchEvidence: vi.fn() },
      credentialResolver: { resolve: vi.fn() },
    });

    const candidates = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>;
    expect(candidates).toMatchObject({
      reportId: "candidate-report-1",
      sourceReportId: "source-report-1",
    });
    expect(candidates.candidates).toEqual(expect.arrayContaining([expect.objectContaining({
        id: "candidate-agent-quality",
        recommendation: "adapt",
        evidenceArtifactIds: ["1000000000000000001"],
    })]));
    expect(log.mock.calls[0]?.[0]).toBe(`External engagement feature candidates written: ${outputPath}`);
  });

  it("builds an operator review report from existing candidates without exposing source text", async () => {
    const root = tempRoot();
    const candidatesPath = join(root, "x-candidates.json");
    const outputPath = join(root, "x-review.md");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeFileSync(candidatesPath, JSON.stringify({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "source-report-1",
      candidates: [{
        id: "candidate-agent-quality",
        title: "Agent quality and reliability support",
        summary: "Do not expose this source-derived summary in the default review.",
        sourceSignalKinds: ["pain_point"],
        sourceThemes: ["agent_quality"],
        evidenceArtifactIds: ["1000000000000000001"],
        recommendation: "adapt",
        confidence: "low",
        standardsAssessment: {
          publicValue: "community-grounded",
          architectureFit: "core-domain-first",
          implementationRisk: "medium",
          notes: [],
        },
      }],
    }, null, 2), "utf-8");

    await externalEngagementCommand({} as never, "x-review", [
      "--candidates",
      candidatesPath,
      "--output",
      outputPath,
    ], {
      now: () => new Date("2026-06-24T01:00:00.000Z"),
      reportId: () => "review-report-1",
    });

    const markdown = readFileSync(outputPath, "utf-8");
    expect(markdown).toContain("# External Engagement Review");
    expect(markdown).toContain("candidate-agent-quality");
    expect(markdown).toContain("1000000000000000001");
    expect(markdown).not.toContain("Do not expose this source-derived summary");
    expect(log.mock.calls[0]?.[0]).toBe(`External engagement review written: ${outputPath}`);
  });

  it("builds a governed candidate decision report offline", async () => {
    const root = tempRoot();
    const candidatesPath = join(root, "x-candidates.json");
    const decisionsPath = join(root, "x-decisions-input.json");
    const outputPath = join(root, "x-decisions.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeFileSync(candidatesPath, JSON.stringify({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "source-report-1",
      candidates: [{
        id: "candidate-workflow-controls",
        title: "Governed workflow pattern support",
        summary: "Do not copy this source-derived summary.",
        sourceSignalKinds: ["workflow_pattern"],
        sourceThemes: ["workflow_controls"],
        evidenceArtifactIds: ["1000000000000000001", "1000000000000000002"],
        recommendation: "adopt",
        confidence: "medium",
        standardsAssessment: {
          publicValue: "community-grounded",
          architectureFit: "core-domain-first",
          implementationRisk: "medium",
          notes: [],
        },
      }],
    }, null, 2), "utf-8");
    writeFileSync(decisionsPath, JSON.stringify({
      decisions: [{
        candidateId: "candidate-workflow-controls",
        decision: "narrow",
        evidenceArtifactIds: ["1000000000000000001"],
        reason: "Useful public workflow, but the first implementation should only cover offline intake.",
        narrowedScope: "Offline intake only.",
      }],
    }, null, 2), "utf-8");

    await externalEngagementCommand({} as never, "x-decide", [
      "--candidates",
      candidatesPath,
      "--decisions",
      decisionsPath,
      "--output",
      outputPath,
    ], {
      now: () => new Date("2026-06-24T01:00:00.000Z"),
      reportId: () => "decision-report-1",
      fetcher: { fetchEvidence: vi.fn() },
      credentialResolver: { resolve: vi.fn() },
    });

    const decisions = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>;
    expect(decisions).toEqual({
      reportId: "decision-report-1",
      generatedAt: "2026-06-24T01:00:00.000Z",
      sourceCandidateReportId: "candidate-report-1",
      decisions: [{
        candidateId: "candidate-workflow-controls",
        candidateTitle: "Governed workflow pattern support",
        decision: "narrow",
        sourceThemes: ["workflow_controls"],
        evidenceArtifactIds: ["1000000000000000001"],
        reason: "Useful public workflow, but the first implementation should only cover offline intake.",
        narrowedScope: "Offline intake only.",
      }],
    });
    expect(JSON.stringify(decisions)).not.toContain("Do not copy this source-derived summary.");
    expect(log.mock.calls[0]?.[0]).toBe(`External engagement candidate decisions written: ${outputPath}`);
  });

  it("promotes candidate decisions into default workspace feature intake storage", async () => {
    const root = tempRoot();
    const decisionsPath = join(root, "x-decisions.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeFileSync(decisionsPath, JSON.stringify({
      reportId: "decision-report-1",
      generatedAt: "2026-06-24T01:00:00.000Z",
      sourceCandidateReportId: "candidate-report-1",
      decisions: [{
        candidateId: "candidate-workflow-controls",
        candidateTitle: "Governed workflow pattern support",
        decision: "narrow",
        sourceThemes: ["workflow_controls"],
        evidenceArtifactIds: ["1000000000000000001"],
        reason: "Public workflow value is clear.",
        narrowedScope: "Offline intake only.",
      }, {
        candidateId: "candidate-adoption-risk",
        candidateTitle: "Objection and risk review support",
        decision: "defer",
        sourceThemes: ["adoption_risk"],
        evidenceArtifactIds: ["1000000000000000002"],
      }],
    }, null, 2), "utf-8");

    await externalEngagementCommand({} as never, "x-promote", [
      "--decisions",
      decisionsPath,
      "--workspace-dir",
      root,
    ], {
      now: () => new Date("2026-06-24T02:00:00.000Z"),
      reportId: () => "intake-report-1",
    });

    const outputPath = join(root, "feature-intake.json");
    const intake = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>;
    expect(intake).toEqual({
      reportId: "intake-report-1",
      generatedAt: "2026-06-24T02:00:00.000Z",
      sourceDecisionReportId: "decision-report-1",
      proposals: [{
        proposalId: "feature-intake-candidate-workflow-controls",
        candidateId: "candidate-workflow-controls",
        title: "Governed workflow pattern support",
        decision: "narrow",
        sourceThemes: ["workflow_controls"],
        evidenceArtifactIds: ["1000000000000000001"],
        problemStatement: "Public workflow value is clear.",
        scope: "Offline intake only.",
        architectureBoundary: "core-domain-first",
        nextAction: "Create an implementation plan from this provider-neutral feature intake proposal.",
      }],
    });
    expect(log.mock.calls[0]?.[0]).toBe(`External engagement feature intake written: ${outputPath}`);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-external-engagement-command-"));
  tempRoots.push(root);
  return root;
}

function writeSyntheticSourceList(count: number): string {
  const root = tempRoot();
  const inputPath = join(root, "x-sources.txt");
  writeFileSync(inputPath, Array.from({ length: count }, (_, index) =>
    `https://x.com/example_author/status/${1000000000000000000n + BigInt(index)}`).join("\n"), "utf-8");
  return inputPath;
}
