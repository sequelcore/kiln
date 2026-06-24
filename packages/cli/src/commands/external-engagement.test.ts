import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildExternalEvidenceReport, type ResolvedSecret, type SecretResolver } from "@kilnai/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  externalEngagementCommand,
  type XEvidenceFetcher,
  type XLiveSmokeResult,
  type XLiveSmokeTester,
  type XOAuth2RefreshResult,
  type XOAuth2TokenRefresher,
} from "./external-engagement.js";
import type { XEvidenceReportCache } from "./x-evidence-report-cache.js";

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
