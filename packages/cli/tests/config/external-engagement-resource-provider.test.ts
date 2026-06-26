import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExternalEngagementResourceProvider } from "../../src/config/external-engagement-resource-provider.js";

describe("ExternalEngagementResourceProvider", () => {
  it("lists governed external engagement artifacts from the workspace resource plane", async () => {
    const root = await externalEngagementWorkspace();
    writeFileSync(join(root, ".kiln", "external-engagement", "x-candidates.json"), JSON.stringify({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "source-report-1",
      candidates: [],
    }), "utf-8");

    const provider = new ExternalEngagementResourceProvider(root);

    expect(provider.listResources()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uri: "kiln://external-engagement/artifacts",
        name: "external_engagement_artifacts",
      }),
      expect.objectContaining({
        uri: "kiln://external-engagement/artifacts/x-candidates.json",
        mimeType: "application/json",
      }),
    ]));
    expect(provider.listTemplates().map((template) => template.uriTemplate)).toEqual([
      "kiln://external-engagement/artifacts/{fileName}",
      "kiln://external-engagement/evidence/{artifactId}",
    ]);
  });

  it("reads an external engagement artifact file without broad filesystem access", async () => {
    const root = await externalEngagementWorkspace();
    writeFileSync(join(root, ".kiln", "external-engagement", "x-review.md"), "# External Engagement Review\n", "utf-8");
    const provider = new ExternalEngagementResourceProvider(root);

    const result = await provider.read("kiln://external-engagement/artifacts/x-review.md");
    const traversal = await expect(provider.read("kiln://external-engagement/artifacts/..%2Fsecret.json"));

    expect(result?.contents[0]).toEqual({
      uri: "kiln://external-engagement/artifacts/x-review.md",
      mimeType: "text/markdown",
      text: "# External Engagement Review\n",
      _meta: {
        fileName: "x-review.md",
        artifactKind: "review-report",
      },
    });
    await traversal.rejects.toThrow("Unsupported external engagement artifact file");
  });

  it("resolves source evidence artifacts by provider artifact id from evidence reports", async () => {
    const root = await externalEngagementWorkspace();
    writeFileSync(join(root, ".kiln", "external-engagement", "x-report.json"), JSON.stringify({
      reportId: "source-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      source: "x",
      capabilities: ["read_external_evidence"],
      prohibitedActions: ["publish_post", "reply", "like", "repost", "follow", "send_direct_message"],
      query: {
        references: [{
          platform: "x",
          postId: "1000000000000000001",
          sourceUrl: "https://x.com/example_author/status/1000000000000000001",
        }],
        maxRepliesPerPost: 1,
      },
      budget: {
        rootPostReads: 1,
        replySearches: 1,
        maxReplyReads: 1,
        userReads: 2,
        maxPostReads: 2,
        estimatedRequests: 3,
      },
      artifacts: [{
        platform: "x",
        artifactId: "1000000000000000001",
        kind: "post",
        sourceUrl: "https://x.com/example_author/status/1000000000000000001",
        text: "Synthetic source-grounded evidence.",
        retrievedAt: "2026-06-24T00:00:00.000Z",
      }],
      signals: [],
    }), "utf-8");
    const provider = new ExternalEngagementResourceProvider(root);

    const result = await provider.read("kiln://external-engagement/evidence/1000000000000000001");
    const payload = JSON.parse(result?.contents[0]?.text ?? "{}") as Record<string, unknown>;

    expect(payload).toMatchObject({
      artifact: {
        artifactId: "1000000000000000001",
        text: "Synthetic source-grounded evidence.",
      },
      sourceReportResourceUri: "kiln://external-engagement/artifacts/x-report.json",
    });
  });
});

async function externalEngagementWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kiln-external-engagement-resource-"));
  mkdirSync(join(root, ".kiln", "external-engagement"), { recursive: true });
  return root;
}
