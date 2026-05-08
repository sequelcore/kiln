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
});
