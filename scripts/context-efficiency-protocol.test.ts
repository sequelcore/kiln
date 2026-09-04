import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  digestContextEfficiencyCanonicalValue,
  digestContextEfficiencyProtocol,
  freezeContextEfficiencyProtocol,
  type ContextEfficiencyExecutionIdentityOverrides,
} from "./context-efficiency-protocol.js";

function digest(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

interface TemplateFixture {
  schemaVersion: string;
  status: string;
  claim: { kind: string; decision: string };
  identity: { repository: string; legacy: string };
  design: {
    repetitionsPerCell: number;
    budgetsPerTrial: { maximumProviderRequests: number; maximumCumulativeInputTokens: number };
  };
  tasks: Array<{ id: string; conditions: string[] }>;
  requiredPerPhysicalRequestEvidence: string[];
  hardGates: string[];
  retention: { rawPrivateContent: string };
  collectionReadiness: { status: string; priorAttempts: Array<{ artifactDigest: string; verdict: string }> };
}

function template(): TemplateFixture {
  return {
    schemaVersion: "kiln-context-efficiency-post-fix-manifest-v1",
    status: "preregistered",
    claim: { kind: "bounded-control", decision: "compare later candidate" },
    identity: { repository: "sequelcore/kiln", legacy: "must-not-be-reused" },
    design: {
      repetitionsPerCell: 3,
      budgetsPerTrial: { maximumProviderRequests: 8, maximumCumulativeInputTokens: 500_000 },
    },
    tasks: [{ id: "exact", conditions: ["cold"] }],
    requiredPerPhysicalRequestEvidence: ["identity", "dispatch"],
    hardGates: ["task_outcome"],
    retention: { rawPrivateContent: "forbidden" },
    collectionReadiness: {
      status: "historical",
      priorAttempts: [{ artifactDigest: "sha256:old", verdict: "not_a_baseline" }],
    },
  };
}

function execution(overrides: Partial<ContextEfficiencyExecutionIdentityOverrides> = {}): ContextEfficiencyExecutionIdentityOverrides {
  return {
    startingCommit: "a".repeat(40),
    sourceContractDigest: digest("a"),
    sourceContractPaths: ["packages/cli/src/application/canonical-run-session-dispatcher.ts"],
    inputContractDigest: digest("b"),
    inputContractPaths: ["packages/core/evals/fixture.json"],
    compiledContractDigest: digest("9"),
    compiledContractPaths: ["packages/runtime/dist/session/runtime-session-orchestrator.js"],
    configurationRevisionId: digest("c"),
    bunVersion: "1.4.0",
    toolProjectionRecipeDigest: digest("d"),
    toolFixtureSeed: "context-efficiency-post-fix-v1-fixture-seed",
    runtime: {
      targetId: "target", providerId: "provider", modelId: "model", deliberationLevel: "low",
      fallback: "disabled", mcp: "disabled_by_strategy", concurrency: 1,
    },
    plusAccountPolicy: {
      plan: "plus", evidenceState: "fresh", allowedAccountIds: ["account-1"],
      observedAt: "2026-09-04T00:00:00.000Z", expiresAt: "2026-09-04T00:05:00.000Z",
      source: "provider-endpoint", confidence: "authoritative",
    },
    hardware: {
      platform: "win32", architecture: "x64", cpuModel: "fixture CPU", logicalCpuCount: 8,
      totalMemoryBytes: 16_000_000_000,
    },
    ...overrides,
  };
}

const FREEZE_NOW = new Date("2026-09-04T00:02:00.000Z");

function freeze(input: {
  readonly template?: unknown;
  readonly execution?: ContextEfficiencyExecutionIdentityOverrides;
  readonly now?: Date;
} = {}) {
  return freezeContextEfficiencyProtocol({
    template: input.template ?? template(),
    execution: input.execution ?? execution(),
    now: input.now ?? FREEZE_NOW,
  });
}

describe("context efficiency protocol freezer", () => {
  it("uses the diagnostic canonical JSON representation", () => {
    const canonical = '{"a":1,"b":2}';
    const expected = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;

    expect(digestContextEfficiencyCanonicalValue({ b: 2, omitted: undefined, a: 1 })).toBe(expected);
    expect(() => digestContextEfficiencyCanonicalValue(new Date("2026-09-04T00:00:00.000Z")))
      .toThrow(/JSON-compatible/u);
    expect(() => digestContextEfficiencyCanonicalValue([undefined])).toThrow(/JSON-compatible/u);
  });

  it("freezes new execution evidence, recalculates the protocol digest, and clears historical attempts", () => {
    const frozen = freeze();

    expect(frozen.status).toBe("frozen_uncollected");
    expect(frozen.collectionReadiness).toEqual({
      status: "frozen_uncollected", missing: [], priorAttempts: [],
    });
    expect(frozen.identity).toMatchObject({
      startingCommit: "a".repeat(40),
      toolProjectionRecipeDigest: digest("d"),
      toolFixtureSeed: "context-efficiency-post-fix-v1-fixture-seed",
      compiledContractDigest: digest("9"),
      compiledContractPaths: ["packages/runtime/dist/session/runtime-session-orchestrator.js"],
      targetId: "target",
      protocolContractDigestMethod:
        "sha256 of canonical claim, identity, design, tasks, evidence, gates, and retention with the protocol digest fields omitted",
    });
    expect(frozen.identity.protocolContractDigest).toBe(digestContextEfficiencyProtocol(frozen));
    expect(JSON.stringify(frozen)).not.toContain("sha256:old");
    expect(JSON.stringify(frozen)).not.toContain("must-not-be-reused");
  });

  it("changes the protocol digest when preregistered task, source, configuration, limits, or fixture seed change", () => {
    const base = freeze();
    const changedTaskTemplate = template();
    changedTaskTemplate.tasks[0]!.id = "other";
    const changedTask = freeze({ template: changedTaskTemplate });
    const changedSource = freeze({
      execution: execution({ sourceContractDigest: digest("e") }),
    });
    const changedConfiguration = freeze({
      execution: execution({ configurationRevisionId: digest("f") }),
    });
    const changedCompiledArtifact = freeze({
      execution: execution({ compiledContractDigest: digest("8") }),
    });
    const changedFixtureSeed = freeze({
      execution: execution({ toolFixtureSeed: "different-fixture-seed" }),
    });
    const changedLimitsTemplate = template();
    changedLimitsTemplate.design.budgetsPerTrial.maximumProviderRequests = 7;
    const changedLimits = freeze({ template: changedLimitsTemplate });

    expect(changedTask.identity.protocolContractDigest).not.toBe(base.identity.protocolContractDigest);
    expect(changedSource.identity.protocolContractDigest).not.toBe(base.identity.protocolContractDigest);
    expect(changedConfiguration.identity.protocolContractDigest).not.toBe(base.identity.protocolContractDigest);
    expect(changedCompiledArtifact.identity.protocolContractDigest).not.toBe(base.identity.protocolContractDigest);
    expect(changedFixtureSeed.identity.protocolContractDigest).not.toBe(base.identity.protocolContractDigest);
    expect(changedLimits.identity.protocolContractDigest).not.toBe(base.identity.protocolContractDigest);
  });

  it("intentionally excludes status and collection history from the protocol digest", () => {
    const frozen = freeze();
    const historical = {
      ...frozen,
      status: "interrupted",
      collectionReadiness: {
        status: "interrupted", missing: ["row"], priorAttempts: [{ legacy: true }],
      },
    };

    expect(digestContextEfficiencyProtocol(historical)).toBe(frozen.identity.protocolContractDigest);
  });

  it("rejects stale account evidence and invalid execution identities", () => {
    const stale = execution();
    Reflect.set(stale.plusAccountPolicy, "evidenceState", "stale");
    expect(() => freeze({ execution: stale })).toThrow(/fresh/u);
    expect(() => freeze({ execution: execution({ startingCommit: "short" }) })).toThrow(/40-character/u);
  });

  it.each([
    {
      name: "expired", policy: { observedAt: "2026-09-04T00:00:00.000Z", expiresAt: "2026-09-04T00:01:00.000Z" },
      failure: /expired/u,
    },
    {
      name: "reversed", policy: { observedAt: "2026-09-04T00:01:00.000Z", expiresAt: "2026-09-04T00:00:00.000Z" },
      failure: /after observedAt/u,
    },
    {
      name: "future", policy: { observedAt: "2026-09-04T00:03:00.000Z", expiresAt: "2026-09-04T00:05:00.000Z" },
      failure: /future/u,
    },
    {
      name: "malformed", policy: { observedAt: "not-a-timestamp", expiresAt: "2026-09-04T00:05:00.000Z" },
      failure: /ISO-8601/u,
    },
  ])("rejects $name account evidence before CLI verification", ({ policy, failure }) => {
    const base = execution();
    expect(() => freeze({
      execution: {
        ...base,
        plusAccountPolicy: { ...base.plusAccountPolicy, ...policy },
      },
    })).toThrow(failure);
  });

  it.each([
    { name: "non-plus plan", patch: { plan: "pro" }, failure: /plan must be plus/u },
    { name: "non-provider source", patch: { source: "cache" }, failure: /source must be provider-endpoint/u },
    { name: "non-authoritative confidence", patch: { confidence: "inferred" }, failure: /confidence must be authoritative/u },
  ])("rejects $name before CLI verification", ({ patch, failure }) => {
    const base = execution();
    expect(() => freeze({
      execution: {
        ...base,
        plusAccountPolicy: { ...base.plusAccountPolicy, ...patch },
      },
    })).toThrow(failure);
  });
});
