import { describe, expect, it } from "vitest";
import { KILN_BENCHMARK_PROFILES, createBenchmarkProfileScorers } from "../../src/index.js";

describe("createBenchmarkProfileScorers", () => {
  it("creates one structural scorer per required benchmark scorer", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-managed-child-agent")!;
    const scorers = createBenchmarkProfileScorers(profile);

    expect(scorers.map((scorer) => scorer.name)).toEqual(profile.requiredScorers);
    await expect(scorers[0]!.score({
      input: "delegate",
      output: "child result",
      metadata: {
        expectedAgentId: "kiln-managed-child-agent",
        activeAgentId: "kiln-managed-child-agent",
        expectedToolCalls: [{ name: "managed_agent.invoke" }],
        toolCalls: [{ name: "managed_agent.invoke" }],
      },
    })).resolves.toMatchObject({ score: 1 });
  });

  it("keeps expected tool recall separate from bounded supporting calls", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-tool-agent")!;
    const scorers = createBenchmarkProfileScorers(profile);
    const accuracy = scorers.find((scorer) => scorer.name === "tool-calling-accuracy")!;
    const trajectory = scorers.find((scorer) => scorer.name === "tool-trajectory")!;
    const input = {
      input: "Read and verify docs.",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "read" }],
        allowedExtraToolCalls: ["grep"],
        toolCalls: [{ name: "read", args: { filePath: "docs/a.md" } }, { name: "grep", args: { pattern: "authority" } }],
      },
    };

    await expect(accuracy.score(input)).resolves.toMatchObject({ score: 1 });
    await expect(trajectory.score(input)).resolves.toMatchObject({ score: 1 });
  });

  it("fails trajectory for prohibited tools, exact redundant calls, and declared tool budget excess", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-tool-agent")!;
    const trajectory = createBenchmarkProfileScorers(profile).find((scorer) => scorer.name === "tool-trajectory")!;

    await expect(trajectory.score({
      input: "Read only.",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "read" }],
        forbiddenToolCalls: [{ name: "write" }],
        toolCalls: [{ name: "read" }, { name: "write" }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("forbidden") });

    await expect(trajectory.score({
      input: "Read once.",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "read" }],
        toolCalls: [{ name: "read", args: { filePath: "docs/a.md" } }, { name: "read", args: { filePath: "docs/a.md" } }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("redundant") });

    await expect(trajectory.score({
      input: "Search.",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "grep" }],
        toolBudgets: { maxToolCalls: 1 },
        toolCalls: [{ name: "grep" }, { name: "read" }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("tool budget") });
  });
});
