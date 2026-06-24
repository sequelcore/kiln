import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildExternalEvidenceReport, type SecretResolver } from "@kilnai/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { externalEngagementCommand, type XEvidenceFetcher } from "./external-engagement.js";

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
    ], {
      fetcher: { fetchEvidence: vi.fn() },
      env: {},
    })).rejects.toThrow(/requires KILN_X_OAUTH2_ACCESS_TOKEN/u);
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
