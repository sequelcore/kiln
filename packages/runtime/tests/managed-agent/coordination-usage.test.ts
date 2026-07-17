import { describe, expect, it } from "vitest";
import { buildManagedAgentCoordinationUsage } from "../../src/agents/managed-invocation/coordination-usage.js";

describe("managed-agent coordination usage", () => {
  it("reports every coordination stage without fabricating unknown cost", () => {
    const report = buildManagedAgentCoordinationUsage({
      invocationId: "invocation-1",
      childSessionId: "child-session",
      parentPrompt: "Inspect the bounded context and report evidence.",
      sourceResourceUris: ["kiln://artifacts/context/source/content"],
      resultHandoff: {
        summary: "Found one boundary issue.",
        resourceUris: ["kiln://artifacts/results/finding/content"],
        memoryWriteProposalUris: [],
      },
    });

    expect(report).toMatchObject({
      version: "managed-agent-coordination-usage-v1",
      workerId: "child-session",
      coverage: "partial",
      reconciliation: "mutually-exclusive",
    });
    expect(report.components.map((component) => component.stage)).toEqual([
      "parent_prompt",
      "child_bootstrap",
      "duplicated_reads",
      "handoff",
      "review",
      "synthesis",
    ]);
    expect(report.components.find((component) => component.stage === "parent_prompt")).toMatchObject({
      providerTokenClass: "input",
      tokens: { source: "estimated" },
      evidenceUris: ["kiln://artifacts/context/source/content"],
    });
    expect(report.components.find((component) => component.stage === "handoff")).toMatchObject({
      providerTokenClass: "output",
      tokens: { source: "estimated" },
      costUsd: { value: "unknown", source: "unknown" },
      evidenceUris: ["kiln://artifacts/results/finding/content"],
    });
    expect(JSON.stringify(report)).not.toContain("Inspect the bounded context");
  });
});
