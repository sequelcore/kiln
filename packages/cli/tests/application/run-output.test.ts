import { describe, expect, it } from "vitest";
import { buildRunJsonOutputEnvelope } from "../../src/application/run-output.js";

function baseInput(): Parameters<typeof buildRunJsonOutputEnvelope>[0] {
  return {
    answer: "the answer",
    sessionId: "session-1",
    task: "inspect the repo",
    domain: "Generic",
    sessionSucceeded: true,
    costUsd: 0.1,
    inputTokens: 10,
    outputTokens: 20,
    toolCallCount: 2,
    turnDepth: 1,
    startedAt: "2026-08-08T00:00:00.000Z",
    completedAt: "2026-08-08T00:00:10.000Z",
    durationMs: 10000,
    lastError: null,
    attempts: [],
    exactArtifacts: [],
  };
}

describe("buildRunJsonOutputEnvelope", () => {
  it("omits resources.proposedPlan when the model never called submit_plan", () => {
    const envelope = buildRunJsonOutputEnvelope(baseInput());
    expect(envelope.resources).not.toHaveProperty("proposedPlan");
  });

  it("carries the submitted plan as structured data instead of requiring an interactive prompt", () => {
    const envelope = buildRunJsonOutputEnvelope({
      ...baseInput(),
      proposedPlan: "1. Read the config\n2. Apply the migration",
    });
    expect(envelope.resources.proposedPlan).toBe("1. Read the config\n2. Apply the migration");
  });
});
