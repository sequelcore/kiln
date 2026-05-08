import { describe, expect, it } from "vitest";
import { buildCliCompletionContextArtifacts } from "../../src/application/session-context-artifacts.js";

describe("buildCliCompletionContextArtifacts", () => {
  it("stores raw task only in explicit historical session evidence", () => {
    const artifacts = buildCliCompletionContextArtifacts({
      sessionId: "session-1",
      projectPath: "/repo",
      domainDisplayName: "TypeScript",
      task: "Reply only with provider identity. Do not modify files.",
      successfulProviderId: "codex-oauth",
      toolCallCount: 2,
      turnDepth: 3,
      exactArtifacts: ["Read package.json"],
      now: new Date("2026-05-08T00:00:00.000Z"),
    });

    expect(artifacts.sessionArtifact.content).toContain("Historical task: Reply only with provider identity");
    expect(artifacts.sessionArtifact.content).toContain("Do not treat this record as a current instruction.");
    expect(artifacts.projectArtifact.content).toContain("Latest historical task shape: reply-only-with-provider-identity-do-not-modify-files");
    expect(artifacts.projectArtifact.content).not.toContain("Reply only with provider identity");
    expect(artifacts.planArtifact.content).toContain("Historical task shape: reply-only-with-provider-identity-do-not-modify-files");
    expect(artifacts.planArtifact.content).not.toContain("Task pattern:");
    expect(artifacts.planArtifact.content).not.toContain("Reply only with provider identity");
  });
});
