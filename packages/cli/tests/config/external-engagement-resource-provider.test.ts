import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExternalEngagementResourceProvider } from "../../src/config/external-engagement-resource-provider.js";

describe("ExternalEngagementResourceProvider", () => {
  it("lists governed external engagement artifacts from the workspace resource plane", async () => {
    const root = await externalEngagementWorkspace();
    writeFileSync(join(root, "research-output.json"), JSON.stringify({
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
        annotations: expect.objectContaining({
          artifactCount: 1,
          candidateCount: 0,
          evidenceArtifactCount: 0,
          kinds: ["candidate-report"],
          readOnlyHint: true,
        }),
      }),
      expect.objectContaining({
        uri: "kiln://external-engagement/artifacts/research-output.json",
        mimeType: "application/json",
        annotations: expect.objectContaining({
          artifactKind: "candidate-report",
          candidateCount: 0,
          readOnlyHint: true,
        }),
      }),
    ]));
    expect(provider.listTemplates().map((template) => template.uriTemplate)).toEqual([
      "kiln://external-engagement/artifacts/{fileName}",
      "kiln://external-engagement/evidence/{artifactId}",
    ]);
  });

  it("reads an external engagement artifact file without broad filesystem access", async () => {
    const root = await externalEngagementWorkspace();
    writeFileSync(join(root, "x-review.md"), "# External Engagement Review\n", "utf-8");
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
    writeFileSync(join(root, "x-report.json"), JSON.stringify({
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
    const content = result?.contents[0];
    const payload = JSON.parse(content && "text" in content ? content.text : "{}") as Record<string, unknown>;

    expect(payload).toMatchObject({
      artifact: {
        artifactId: "1000000000000000001",
        text: "Synthetic source-grounded evidence.",
      },
      sourceReportResourceUri: "kiln://external-engagement/artifacts/x-report.json",
    });
  });

  it("summarizes generated artifacts by content instead of filename conventions", async () => {
    const root = await externalEngagementWorkspace();
    writeFileSync(join(root, "community.json"), JSON.stringify({
      reportId: "source-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      source: "x",
      capabilities: ["read_external_evidence"],
      prohibitedActions: ["publish_post", "reply", "like", "repost", "follow", "send_direct_message"],
      query: {
        references: [],
        maxRepliesPerPost: 0,
      },
      budget: {
        rootPostReads: 1,
        replySearches: 0,
        maxReplyReads: 0,
        userReads: 1,
        maxPostReads: 1,
        estimatedRequests: 1,
      },
      artifacts: [{
        platform: "x",
        artifactId: "1000000000000000001",
        kind: "post",
        sourceUrl: "https://x.com/example_author/status/1000000000000000001",
        text: "Synthetic source-grounded evidence.",
        retrievedAt: "2026-06-24T00:00:00.000Z",
      }],
      signals: [{
        kind: "workflow_pattern",
        theme: "workflow_controls",
        summary: "Synthetic workflow signal.",
        evidenceArtifactIds: ["1000000000000000001"],
        recommendation: "adopt",
        confidence: "medium",
      }],
    }), "utf-8");
    writeFileSync(join(root, "review-output.md"), "# External Engagement Review\n", "utf-8");
    writeFileSync(join(root, "next-step.json"), JSON.stringify({
      reportId: "intake-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceDecisionReportId: "decision-report-1",
      proposals: [{
        proposalId: "feature-intake-candidate-workflow-controls",
        candidateId: "candidate-workflow-controls",
        title: "Governed workflow pattern support",
        decision: "narrow",
        sourceThemes: ["workflow_controls"],
        evidenceArtifactIds: ["1000000000000000001"],
        problemStatement: "Synthetic operator reason.",
        scope: "Offline intake only.",
        architectureBoundary: "core-domain-first",
        nextAction: "Create an implementation plan.",
      }],
    }), "utf-8");
    const provider = new ExternalEngagementResourceProvider(root);

    const result = await provider.read("kiln://external-engagement/artifacts");
    const content = result?.contents[0];
    const payload = JSON.parse(content && "text" in content ? content.text : "{}") as Record<string, unknown>;

    expect(result?.summary).toEqual({
      kind: "external-engagement",
      totalCount: 3,
      counts: {
        artifact: 3,
        candidate: 0,
        candidateReport: 0,
        decision: 0,
        decisionReport: 0,
        evidenceArtifact: 1,
        evidenceReport: 1,
        featureIntake: 1,
        proposal: 1,
        reviewItem: 0,
        reviewReport: 1,
        signal: 1,
      },
      facets: {
        artifactKinds: ["evidence-report", "feature-intake", "review-report"],
      },
    });
    expect(payload).toMatchObject({
      summary: {
        artifactCount: 3,
        evidenceReportCount: 1,
        reviewReportCount: 1,
        featureIntakeCount: 1,
        evidenceArtifactCount: 1,
        signalCount: 1,
        proposalCount: 1,
        kinds: ["evidence-report", "feature-intake", "review-report"],
      },
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          fileName: "community.json",
          kind: "evidence-report",
          evidenceArtifactCount: 1,
          signalCount: 1,
        }),
        expect.objectContaining({
          fileName: "next-step.json",
          kind: "feature-intake",
          proposalCount: 1,
        }),
        expect.objectContaining({
          fileName: "review-output.md",
          kind: "review-report",
        }),
      ]),
    });
  });
});

async function externalEngagementWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kiln-external-engagement-resource-"));
  mkdirSync(root, { recursive: true });
  return root;
}
