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

  it("accepts batch and resource reads as grounded read trajectories", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-model-roster")!;
    const trajectory = createBenchmarkProfileScorers(profile).find((scorer) => scorer.name === "tool-trajectory")!;

    await expect(trajectory.score({
      input: "Read the fixture sources.",
      output: "Grounded synthesis.",
      metadata: {
        expectedToolCalls: [{ name: "read" }],
        toolCalls: [{ name: "read_many", args: { paths: ["research/a.md", "research/b.md"] } }],
      },
    })).resolves.toMatchObject({ score: 1 });
    await expect(trajectory.score({
      input: "Read the fixture sources.",
      output: "Unsupported synthesis.",
      metadata: {
        expectedToolCalls: [{ name: "read" }],
        toolCalls: [{ name: "grep", args: { pattern: "budget" } }],
      },
    })).resolves.toMatchObject({ score: 0 });
  });

  it("scores governed team roles and dependency contracts from the orchestration work graph", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-managed-frontend-team")!;
    const composition = createBenchmarkProfileScorers(profile)
      .find((scorer) => scorer.name === "team-composition")!;

    await expect(composition.score({
      input: "Produce and refine a frontend handoff.",
      output: "Completed team handoff.",
      metadata: {
        expectedTeam: [
          { id: "producer", agentProfile: "frontend-producer", dependencies: [] },
          { id: "advisor", agentProfile: "frontend-implementation-advisor", dependencies: ["producer"] },
        ],
        toolCalls: [{
          name: "managed_agent.orchestrate",
          args: {
            workItems: [
              { id: "producer", agentProfile: "frontend-producer" },
              { id: "advisor", agentProfile: "frontend-implementation-advisor", dependencies: ["producer"] },
            ],
          },
        }],
      },
    })).resolves.toMatchObject({ score: 1 });
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

  it("fails execution integrity when the route did not terminate successfully", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-tool-agent")!;
    const integrity = createBenchmarkProfileScorers(profile)
      .find((scorer) => scorer.name === "execution-integrity")!;

    await expect(integrity.score({
      input: "Read a file.",
      output: "partial answer",
      metadata: {
        sessionSucceeded: false,
        providerId: "opencode-go",
        modelId: "kimi-k3",
        expectedToolCalls: [{ name: "read" }],
        toolCalls: [{ name: "read" }],
        policyViolations: ["provider rate limit exceeded"],
      },
    })).resolves.toMatchObject({
      score: 0,
      reasoning: expect.stringContaining("session did not complete successfully"),
    });

    await expect(integrity.score({
      input: "Read a file.",
      output: "complete answer",
      metadata: {
        sessionSucceeded: true,
        providerId: "codex-oauth",
        modelId: "gpt-5.6-terra",
      },
    })).resolves.toMatchObject({ score: 1 });
  });

  it("scores roster evidence only from grounded output, not predeclared milestones", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-model-roster")!;
    const scorers = createBenchmarkProfileScorers(profile);
    const coverage = scorers.find((scorer) => scorer.name === "evidence-coverage")!;
    const grounding = scorers.find((scorer) => scorer.name === "citation-grounding")!;
    const metadata = {
      expectedEvidence: [
        { id: "boundary", terms: ["inventory", "reservation"] },
        { id: "idempotency", terms: ["retry", "duplicate"] },
      ],
      expectedCitations: ["src/inventory-service.ts", "docs/retry-contract.md"],
      milestones: [
        { name: "must-not-be-trusted", completed: true },
      ],
    };

    await expect(coverage.score({
      input: "Inspect the fixture.",
      output: "The inventory reservation can create a duplicate on retry.",
      metadata,
    })).resolves.toMatchObject({ score: 1 });
    await expect(coverage.score({
      input: "Inspect the fixture.",
      output: "Everything looks correct.",
      metadata,
    })).resolves.toMatchObject({ score: 0 });
    await expect(grounding.score({
      input: "Inspect the fixture.",
      output: "Evidence: src/inventory-service.ts and docs/retry-contract.md.",
      metadata,
    })).resolves.toMatchObject({ score: 1 });
    await expect(grounding.score({
      input: "Inspect the fixture.",
      output: "The code and documentation agree.",
      metadata,
    })).resolves.toMatchObject({ score: 0 });
  });

  it("scores backend writes only from executor-owned verifier and diff evidence", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-model-roster-backend-write")!;
    const scorers = createBenchmarkProfileScorers(profile);
    const verification = scorers.find((scorer) => scorer.name === "test-verification")!;
    const diff = scorers.find((scorer) => scorer.name === "diff-integrity")!;
    const metadata = {
      observedVerification: {
        verifierId: "kiln.backend-write.v2",
        verifierVersion: "2",
        benchmarkCaseId: "idempotent-reservation",
        status: "passed",
        testDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        violations: [],
        changes: {
          changed: [{
            path: "src/solution.mjs",
            beforeHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            afterHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          }],
          added: [],
          deleted: [],
        },
        tests: { exitCode: 0, passed: 4, failed: 0, timedOut: false },
      },
    };

    await expect(verification.score({ input: "fix", output: "done", metadata })).resolves.toMatchObject({ score: 1 });
    await expect(diff.score({ input: "fix", output: "done", metadata })).resolves.toMatchObject({ score: 1 });
    await expect(verification.score({
      input: "fix",
      output: "claimed pass",
      metadata: { ...metadata, observedVerification: { ...metadata.observedVerification, status: "failed" } },
    })).resolves.toMatchObject({ score: 0 });
    await expect(diff.score({
      input: "fix",
      output: "done",
      metadata: {
        observedVerification: {
          ...metadata.observedVerification,
          changes: {
            changed: metadata.observedVerification.changes.changed,
            added: [{ path: "hidden.test.mjs", hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" }],
            deleted: [],
          },
        },
      },
    })).resolves.toMatchObject({ score: 0 });
  });

  it("does not treat a verification read after a workspace mutation as redundant", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-model-roster-backend-write")!;
    const trajectory = createBenchmarkProfileScorers(profile)
      .find((scorer) => scorer.name === "tool-trajectory")!;
    const metadata = {
      expectedToolCalls: [{ name: "read" }],
      toolCalls: [
        { name: "read", args: { filePath: "src/order-service.mjs" } },
        { name: "edit", args: { filePath: "src/order-service.mjs" } },
        { name: "read", args: { filePath: "src/order-service.mjs" } },
      ],
      toolBudgets: { maxToolCalls: 8 },
    };

    await expect(trajectory.score({ input: "fix", output: "done", metadata }))
      .resolves.toMatchObject({ score: 1 });
  });

  it("scores frontend work only from rendered interaction, accessibility, screenshot, and bounded diff evidence", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-model-roster-frontend-render")!;
    const scorers = createBenchmarkProfileScorers(profile);
    const render = scorers.find((scorer) => scorer.name === "render-verification")!;
    const diff = scorers.find((scorer) => scorer.name === "frontend-diff-integrity")!;
    const metadata = {
      observedVerification: {
        verifierId: "kiln.frontend-render.v2",
        verifierVersion: "2",
        benchmarkCaseId: "modal-focus",
        status: "passed",
        violations: [],
        runner: {
          kind: "docker-playwright",
          image: "kiln/frontend-benchmark-verifier:2",
          imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sourceDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        changes: {
          changed: [{
            path: "src/Challenge.jsx",
            beforeHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            afterHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          }],
          added: [],
          deleted: [],
        },
        render: {
          browserVersion: "Chrome/140",
          assertions: {
            heading: true,
            tableAccessibleName: true,
            keyboardActivation: true,
            dialogAccessibleName: true,
            dialogInitialFocus: true,
            dialogFocusTrap: true,
            escapeCloses: true,
            focusRestored: true,
          },
          accessibility: { engine: "axe-core", version: "4.12.1", violationCount: 0 },
        },
        screenshot: {
          sha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          bytes: 1024,
          base64: "iVBORw0KGgo=",
        },
      },
    };

    await expect(render.score({ input: "repair", output: "done", metadata })).resolves.toMatchObject({ score: 1 });
    await expect(diff.score({ input: "repair", output: "done", metadata })).resolves.toMatchObject({ score: 1 });
    await expect(render.score({
      input: "repair",
      output: "claimed accessible",
      metadata: {
        observedVerification: {
          ...metadata.observedVerification,
          render: {
            ...metadata.observedVerification.render,
            accessibility: { engine: "axe-core", version: "4.12.1", violationCount: 1 },
          },
        },
      },
    })).resolves.toMatchObject({ score: 0 });
  });

  it("scores cache topology only when request evidence includes prefix partition and invalid-reuse probes", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-tool-agent")!;
    const scorer = createBenchmarkProfileScorers({
      ...profile,
      requiredScorers: ["cache-topology"],
    }).find((entry) => entry.name === "cache-topology")!;

    await expect(scorer.score({
      input: "Use stable tools.",
      output: "done",
      metadata: {
        providerRequests: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          stablePrefixBytes: 120,
          stablePrefixRegionCount: 2,
          volatileRegionBytes: 40,
          cacheRegions: [
            { source: "tool_schema", stability: "stable", hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", bytes: 80, includedInStablePrefix: true },
            { source: "system", stability: "stable", hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", bytes: 40, includedInStablePrefix: true },
            { source: "messages", stability: "volatile", hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", bytes: 40, includedInStablePrefix: false },
          ],
          cachePartition: {
            hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            dimensions: [
              { source: "tenant", hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111", evidenceBasis: "session tenant identity" },
              { source: "route", hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222", evidenceBasis: "provider route identity" },
              { source: "policy", hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333", evidenceBasis: "policy identity" },
              { source: "authority", hash: "sha256:4444444444444444444444444444444444444444444444444444444444444444", evidenceBasis: "authority scope" },
            ],
          },
        }],
        cacheInvalidReuseProbes: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          leftPartitionHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          rightPartitionHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          changedDimension: "tenant",
        }],
        cacheGainComparisons: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          baselineInputTokens: 2000,
          candidateInputTokens: 2000,
          baselineCachedInputTokens: 0,
          candidateCachedInputTokens: 1200,
          baselineLatencyMs: 1500,
          candidateLatencyMs: 900,
          baselineCostUsd: 0.02,
          candidateCostUsd: 0.012,
        }],
      },
    })).resolves.toMatchObject({ score: 1 });

    await expect(scorer.score({
      input: "Use stable tools.",
      output: "done",
      metadata: {
        providerRequests: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          stablePrefixBytes: 120,
          stablePrefixRegionCount: 2,
          volatileRegionBytes: 40,
          cacheRegions: [],
          cachePartition: {
            hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            dimensions: [],
          },
        }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("partition") });

    await expect(scorer.score({
      input: "Use stable tools.",
      output: "done",
      metadata: {
        providerRequests: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          stablePrefixBytes: 120,
          stablePrefixRegionCount: 2,
          volatileRegionBytes: 40,
          cacheRegions: [
            { source: "tool_schema", stability: "stable", hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", bytes: 80, includedInStablePrefix: true },
            { source: "messages", stability: "volatile", hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", bytes: 40, includedInStablePrefix: false },
          ],
          cachePartition: {
            hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            dimensions: [
              { source: "tenant", hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
              { source: "route", hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
              { source: "policy", hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333" },
              { source: "authority", hash: "sha256:4444444444444444444444444444444444444444444444444444444444444444" },
            ],
          },
        }],
        cacheGainComparisons: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          baselineInputTokens: 2000,
          candidateInputTokens: 2000,
          baselineCachedInputTokens: 0,
          candidateCachedInputTokens: 1200,
        }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("invalid-reuse") });

    await expect(scorer.score({
      input: "Use stable tools.",
      output: "done",
      metadata: {
        providerRequests: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          stablePrefixBytes: 120,
          stablePrefixRegionCount: 2,
          volatileRegionBytes: 40,
          cacheRegions: [
            { source: "tool_schema", stability: "stable", hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", bytes: 80, includedInStablePrefix: true },
            { source: "messages", stability: "volatile", hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", bytes: 40, includedInStablePrefix: false },
          ],
          cachePartition: {
            hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            dimensions: [
              { source: "tenant", hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
              { source: "route", hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
              { source: "policy", hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333" },
              { source: "authority", hash: "sha256:4444444444444444444444444444444444444444444444444444444444444444" },
            ],
          },
        }],
        cacheInvalidReuseProbes: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          leftPartitionHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          rightPartitionHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          changedDimension: "tenant",
        }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("cache gain") });
  });
});

describe("execution integrity route identity", () => {
  const integrityScorer = () => createBenchmarkProfileScorers(
    KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-tool-agent")!,
  ).find((scorer) => scorer.name === "execution-integrity")!;

  const clean = {
    sessionSucceeded: true,
    providerId: "opencode-go",
    modelId: "kimi-k3",
    expectedToolCalls: [{ name: "read" }],
    toolCalls: [{ name: "read" }],
  };

  it("fails when the trial ran on a different model than it requested", async () => {
    const result = await integrityScorer().score({
      input: "Read a file.",
      output: "answer",
      metadata: { ...clean, expectedProviderId: "opencode-go", expectedModelId: "glm-5.3" },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("not the requested");
  });

  it("fails when the trial ran on a different provider than it requested", async () => {
    const result = await integrityScorer().score({
      input: "Read a file.",
      output: "answer",
      metadata: { ...clean, expectedProviderId: "codex-oauth", expectedModelId: "kimi-k3" },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("not the requested");
  });

  it("passes when the resolved route is the requested route", async () => {
    const result = await integrityScorer().score({
      input: "Read a file.",
      output: "answer",
      metadata: { ...clean, expectedProviderId: "opencode-go", expectedModelId: "kimi-k3" },
    });
    expect(result.score).toBe(1);
  });

  it("says so when no route was requested, rather than implying a match", async () => {
    const result = await integrityScorer().score({
      input: "Read a file.",
      output: "answer",
      metadata: clean,
    });
    expect(result.score).toBe(1);
    expect(result.reasoning).toContain("no route was requested");
  });
});
