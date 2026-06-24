import { describe, expect, it } from "vitest";
import {
  EXTERNAL_EVIDENCE_READ_EFFECT,
  buildFeatureCandidateDecisionReport,
  buildExternalEngagementReviewReport,
  buildExternalEvidenceReport,
  buildFeatureCandidateReport,
  createXOAuth2ClientIdRef,
  createXOAuth2ClientSecretRef,
  createXOAuth2RefreshTokenRef,
  createXReadAccessTokenRef,
  estimateXEvidenceRequestBudget,
  extractCommunitySignalsFromEvidence,
  normalizeXPostReferences,
} from "../../src/external-engagement/index.js";
import { deriveAuthorityFromEffect } from "../../src/engine/domain/action-effect.js";

describe("X evidence source", () => {
  it("declares the X read credential as a provider-agnostic secret reference", () => {
    expect(createXReadAccessTokenRef({ envName: "MY_X_ACCESS_TOKEN" })).toEqual({
      id: "x-oauth2-access-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read", "x:user.read"],
      source: { kind: "env", name: "MY_X_ACCESS_TOKEN" },
    });
  });

  it("supports lifecycle metadata on the X read credential declaration", () => {
    expect(createXReadAccessTokenRef({
      envName: "KILN_X_OAUTH2_ACCESS_TOKEN",
      expiresAt: "2026-06-24T02:00:00.000Z",
      refreshSecretRefId: "x-oauth2-refresh-token",
      nextRefreshAt: "2026-06-24T01:30:00.000Z",
    })).toEqual({
      id: "x-oauth2-access-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read", "x:user.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      expiresAt: "2026-06-24T02:00:00.000Z",
      refresh: {
        kind: "oauth2-refresh-token",
        refreshSecretRefId: "x-oauth2-refresh-token",
        nextRefreshAt: "2026-06-24T01:30:00.000Z",
      },
    });
  });

  it("declares X OAuth refresh credentials as provider-agnostic secret references", () => {
    expect(createXOAuth2RefreshTokenRef({ envName: "MY_X_REFRESH_TOKEN" })).toEqual({
      id: "x-oauth2-refresh-token",
      purpose: "external-engagement:x:oauth2-refresh",
      scopes: ["x:oauth2.refresh"],
      source: { kind: "env", name: "MY_X_REFRESH_TOKEN" },
    });
    expect(createXOAuth2ClientIdRef({ envName: "MY_X_CLIENT_ID" })).toEqual({
      id: "x-oauth2-client-id",
      purpose: "external-engagement:x:oauth2-client",
      scopes: ["x:oauth2.token"],
      source: { kind: "env", name: "MY_X_CLIENT_ID" },
    });
    expect(createXOAuth2ClientSecretRef({ envName: "MY_X_CLIENT_SECRET" })).toEqual({
      id: "x-oauth2-client-secret",
      purpose: "external-engagement:x:oauth2-client",
      scopes: ["x:oauth2.token"],
      source: { kind: "env", name: "MY_X_CLIENT_SECRET" },
    });
  });

  it("normalizes X and Twitter post URLs into unique ordered references", () => {
    const references = normalizeXPostReferences([
      "https://x.com/example_author/status/1000000000000000001",
      "https://twitter.com/another_author/status/1000000000000000002?s=20",
      "1000000000000000001",
    ]);

    expect(references).toEqual([
      {
        platform: "x",
        postId: "1000000000000000001",
        sourceUrl: "https://x.com/example_author/status/1000000000000000001",
      },
      {
        platform: "x",
        postId: "1000000000000000002",
        sourceUrl: "https://twitter.com/another_author/status/1000000000000000002?s=20",
      },
    ]);
  });

  it("rejects unsupported URLs and malformed ids", () => {
    expect(() => normalizeXPostReferences(["https://example.com/post/123"])).toThrow(
      /Unsupported X post reference/u,
    );
    expect(() => normalizeXPostReferences(["abc123"])).toThrow(/Unsupported X post reference/u);
  });

  it("estimates a bounded request budget before network access", () => {
    const budget = estimateXEvidenceRequestBudget({
      rootPostCount: 3,
      maxRepliesPerPost: 25,
      includeAuthors: true,
    });

    expect(budget).toEqual({
      rootPostReads: 3,
      replySearches: 3,
      maxReplyReads: 75,
      userReads: 78,
      maxPostReads: 78,
      estimatedRequests: 5,
    });
  });

  it("classifies X evidence reads as audited external observation", () => {
    const decision = deriveAuthorityFromEffect(EXTERNAL_EVIDENCE_READ_EFFECT);

    expect(decision).toMatchObject({
      level: 2,
      allowed: true,
      requiresApproval: false,
      reason: "Observation with external access, audited execution",
    });
  });

  it("builds source-grounded reports without inventing action authority", () => {
    const report = buildExternalEvidenceReport({
        reportId: "report-1",
        generatedAt: "2026-06-24T00:00:00.000Z",
        source: "x",
        query: {
        references: normalizeXPostReferences(["https://x.com/example_author/status/1000000000000000002"]),
        maxRepliesPerPost: 10,
      },
      artifacts: [{
        platform: "x",
        artifactId: "1000000000000000002",
        kind: "post",
        sourceUrl: "https://x.com/example_author/status/1000000000000000002",
        text: "I think \"/goal\" might be one of the worst loop implementations",
        author: { id: "1000000000000000000", username: "example_author", displayName: "Example Author" },
        metrics: { replies: 214, reposts: 16, likes: 1737, quotes: 15, bookmarks: 236 },
        retrievedAt: "2026-06-24T00:00:00.000Z",
      }],
      signals: [{
        kind: "objection",
        summary: "/goal needs explicit loop design and validation before execution.",
        evidenceArtifactIds: ["1000000000000000002"],
        recommendation: "adapt",
        confidence: "medium",
      }],
      budget: estimateXEvidenceRequestBudget({
        rootPostCount: 1,
        maxRepliesPerPost: 10,
        includeAuthors: true,
      }),
    });

    expect(report.capabilities).toEqual(["read_external_evidence"]);
    expect(report.prohibitedActions).toContain("publish_post");
    expect(report.signals[0]!.recommendation).toBe("adapt");
  });

  it("extracts conservative community signals from evidence artifacts", () => {
    const signals = extractCommunitySignalsFromEvidence({
      artifacts: [
        syntheticArtifact("1000000000000000001", "The agent loop failed again; I need a review gate before it edits files."),
        syntheticArtifact("1000000000000000002", "A cached evidence workflow would make paid API research less risky."),
        syntheticArtifact("1000000000000000003", "This found real bugs and the output was useful for planning."),
      ],
    });

    expect(signals).toEqual([
      {
        kind: "pain_point",
        theme: "agent_quality",
        summary: "Evidence reports agent or workflow failure, friction, or low-quality output.",
        evidenceArtifactIds: ["1000000000000000001"],
        recommendation: "adapt",
        confidence: "low",
      },
      {
        kind: "workflow_pattern",
        theme: "workflow_controls",
        summary: "Evidence describes repeatable process controls such as plans, review gates, tests, guardrails, or loops.",
        evidenceArtifactIds: ["1000000000000000001", "1000000000000000003"],
        recommendation: "adopt",
        confidence: "medium",
      },
      {
        kind: "pain_point",
        theme: "cost_control",
        summary: "Evidence highlights cost, paid API, cache, budget, or spend-control pressure.",
        evidenceArtifactIds: ["1000000000000000002"],
        recommendation: "adapt",
        confidence: "low",
      },
      {
        kind: "workflow_pattern",
        theme: "cost_control",
        summary: "Evidence describes cache or budget controls as part of repeatable research workflow.",
        evidenceArtifactIds: ["1000000000000000002"],
        recommendation: "adopt",
        confidence: "low",
      },
      {
        kind: "validation_evidence",
        theme: "useful_outcome",
        summary: "Evidence reports useful outcomes, found issues, shipped work, or practical validation.",
        evidenceArtifactIds: ["1000000000000000003"],
        recommendation: "adapt",
        confidence: "low",
      },
    ]);
  });

  it("builds feature candidates from signals against long-term engineering standards", () => {
    const signal = {
      kind: "workflow_pattern" as const,
      theme: "workflow_controls" as const,
      summary: "Evidence asks for review gates and cached evidence workflows.",
      evidenceArtifactIds: ["1000000000000000001", "1000000000000000002"],
      recommendation: "adopt" as const,
      confidence: "medium" as const,
    };

    const report = buildFeatureCandidateReport({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "evidence-report-1",
      signals: [signal],
    });

    expect(report).toEqual({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "evidence-report-1",
      candidates: [{
        id: "candidate-workflow-controls",
        title: "Governed workflow pattern support",
        summary: "Evidence asks for review gates and cached evidence workflows.",
        sourceSignalKinds: ["workflow_pattern"],
        sourceThemes: ["workflow_controls"],
        evidenceArtifactIds: ["1000000000000000001", "1000000000000000002"],
        recommendation: "adopt",
        confidence: "medium",
        standardsAssessment: {
          publicValue: "community-grounded",
          architectureFit: "core-domain-first",
          implementationRisk: "medium",
          notes: [
            "Keep source evidence separate from write-capable actions.",
            "Prefer pure domain contracts before provider adapters.",
            "Avoid compatibility shims, generated boilerplate, and hidden side effects.",
          ],
        },
      }],
    });
  });

  it("merges multiple signals for the same theme into one feature candidate", () => {
    const report = buildFeatureCandidateReport({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "evidence-report-1",
      signals: [
        {
          kind: "workflow_pattern",
          theme: "workflow_controls",
          summary: "Evidence asks for review gates.",
          evidenceArtifactIds: ["1000000000000000001"],
          recommendation: "adopt",
          confidence: "low",
        },
        {
          kind: "feature_request",
          theme: "workflow_controls",
          summary: "Evidence asks for product support.",
          evidenceArtifactIds: ["1000000000000000002"],
          recommendation: "adapt",
          confidence: "low",
        },
      ],
    });

    expect(report.candidates).toEqual([expect.objectContaining({
      id: "candidate-workflow-controls",
      summary: "Evidence asks for review gates.",
      sourceSignalKinds: ["workflow_pattern", "feature_request"],
      sourceThemes: ["workflow_controls"],
      evidenceArtifactIds: ["1000000000000000001", "1000000000000000002"],
      recommendation: "adopt",
      confidence: "medium",
    })]);
  });

  it("limits noisy artifact fan-out when evidence matches many signal keywords", () => {
    const signals = extractCommunitySignalsFromEvidence({
      artifacts: [
        syntheticArtifact(
          "1000000000000000001",
          "We need a review gate because the loop failed and maybe should add support.",
        ),
      ],
    });

    expect(signals.flatMap((signal) => signal.evidenceArtifactIds)).toHaveLength(2);
    expect(signals.map((signal) => signal.theme)).toEqual(["agent_quality", "workflow_controls"]);
  });

  it("builds a review report without exposing full artifact text by default", () => {
    const candidateReport = buildFeatureCandidateReport({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "evidence-report-1",
      signals: [{
        kind: "pain_point",
        theme: "agent_quality",
        summary: "Evidence reports agent failures.",
        evidenceArtifactIds: ["1000000000000000001"],
        recommendation: "adapt",
        confidence: "low",
      }],
    });

    const review = buildExternalEngagementReviewReport({
      reportId: "review-report-1",
      generatedAt: "2026-06-24T00:05:00.000Z",
      candidateReport,
    });

    expect(review).toEqual({
      reportId: "review-report-1",
      generatedAt: "2026-06-24T00:05:00.000Z",
      sourceCandidateReportId: "candidate-report-1",
      items: [{
        candidateId: "candidate-agent-quality",
        title: "Agent quality and reliability support",
        recommendation: "adapt",
        confidence: "low",
        evidenceArtifactIds: ["1000000000000000001"],
        reviewPrompts: [
          "Does this candidate solve a public Kiln user need, not only an internal Sequel workflow?",
          "Can this be implemented through core domain contracts before provider adapters?",
          "What would make this safe to reject, defer, or narrow?",
        ],
      }],
      markdown: [
        "# External Engagement Review",
        "",
        "Source candidate report: candidate-report-1",
        "",
        "## Agent quality and reliability support",
        "",
        "- Candidate: candidate-agent-quality",
        "- Recommendation: adapt",
        "- Confidence: low",
        "- Evidence artifacts: 1000000000000000001",
        "- Themes: agent_quality",
        "",
        "Review prompts:",
        "- Does this candidate solve a public Kiln user need, not only an internal Sequel workflow?",
        "- Can this be implemented through core domain contracts before provider adapters?",
        "- What would make this safe to reject, defer, or narrow?",
      ].join("\n"),
    });
    expect(review.markdown).not.toContain("Evidence reports agent failures.");
  });

  it("builds governed feature candidate decisions without copying source text", () => {
    const candidateReport = buildFeatureCandidateReport({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "evidence-report-1",
      signals: [{
        kind: "workflow_pattern",
        theme: "workflow_controls",
        summary: "Evidence asks for review gates and cached evidence workflows.",
        evidenceArtifactIds: ["1000000000000000001", "1000000000000000002"],
        recommendation: "adopt",
        confidence: "medium",
      }],
    });

    const report = buildFeatureCandidateDecisionReport({
      reportId: "decision-report-1",
      generatedAt: "2026-06-24T00:10:00.000Z",
      candidateReport,
      decisions: [{
        candidateId: "candidate-workflow-controls",
        decision: "narrow",
        evidenceArtifactIds: ["1000000000000000001"],
        reason: "Useful public workflow, but the first implementation should only cover offline intake.",
        narrowedScope: "Offline candidate intake only; no write-capable provider actions.",
      }],
    });

    expect(report).toEqual({
      reportId: "decision-report-1",
      generatedAt: "2026-06-24T00:10:00.000Z",
      sourceCandidateReportId: "candidate-report-1",
      decisions: [{
        candidateId: "candidate-workflow-controls",
        candidateTitle: "Governed workflow pattern support",
        decision: "narrow",
        sourceThemes: ["workflow_controls"],
        evidenceArtifactIds: ["1000000000000000001"],
        reason: "Useful public workflow, but the first implementation should only cover offline intake.",
        narrowedScope: "Offline candidate intake only; no write-capable provider actions.",
      }],
    });
    expect(JSON.stringify(report)).not.toContain("Evidence asks for review gates");
  });

  it("rejects candidate decisions that are not grounded in the source candidate report", () => {
    const candidateReport = buildFeatureCandidateReport({
      reportId: "candidate-report-1",
      generatedAt: "2026-06-24T00:00:00.000Z",
      sourceReportId: "evidence-report-1",
      signals: [{
        kind: "pain_point",
        theme: "agent_quality",
        summary: "Evidence reports agent failures.",
        evidenceArtifactIds: ["1000000000000000001"],
        recommendation: "adapt",
        confidence: "low",
      }],
    });

    expect(() => buildFeatureCandidateDecisionReport({
      reportId: "decision-report-1",
      generatedAt: "2026-06-24T00:10:00.000Z",
      candidateReport,
      decisions: [{
        candidateId: "candidate-agent-quality",
        decision: "accept",
        evidenceArtifactIds: ["1000000000000000002"],
        reason: "Grounded enough for intake.",
      }],
    })).toThrow(/not part of candidate candidate-agent-quality/u);

    expect(() => buildFeatureCandidateDecisionReport({
      reportId: "decision-report-1",
      generatedAt: "2026-06-24T00:10:00.000Z",
      candidateReport,
      decisions: [{
        candidateId: "candidate-agent-quality",
        decision: "accept",
        evidenceArtifactIds: ["1000000000000000001"],
      }],
    })).toThrow(/requires a reason/u);
  });
});

function syntheticArtifact(artifactId: string, text: string) {
  return {
    platform: "x" as const,
    artifactId,
    kind: "post" as const,
    sourceUrl: `https://x.com/example_author/status/${artifactId}`,
    text,
    retrievedAt: "2026-06-24T00:00:00.000Z",
  };
}
