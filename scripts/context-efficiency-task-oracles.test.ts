import { describe, expect, it } from "vitest";
import {
  evaluateContextEfficiencyTaskOracle,
  hasUnsettledManagedChildInvocation,
} from "./context-efficiency-task-oracles.js";

const READS = [
  { toolName: "read", authorizedRootIndex: 1, relativePath: "shard-01.txt", succeeded: true, complete: true },
  { toolName: "read", authorizedRootIndex: 1, relativePath: "shard-02.txt", succeeded: true, complete: true },
] as const;

const COMPLETE_CHILD_TRANSPORT = [{
  dispatch: { attempt: { state: "observed", value: 1 }, outcome: "completed" },
  usage: {
    input: { measurement: "provider_reported", tokens: 10 },
    output: { measurement: "provider_reported", tokens: 5 },
  },
}] as const;

describe("evaluateContextEfficiencyTaskOracle", () => {
  it.each([
    ["reference success", "OK", 0, true],
    ["wrong answer", "NO", 0, false],
    ["tool shortcut", "OK", 1, false],
  ])("checks no-tool exact text: %s", (_name, answer, toolCallCount, passed) => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer,
      oracle: { kind: "exact_text", value: "OK", maximumToolCalls: 0 },
      evidence: { toolCallCount },
    }).passed).toBe(passed);
  });

  it.each([
    [
      "reference success",
      "RuntimeSessionOrchestrator packages/runtime/src/session/runtime-session-orchestrator.ts\nDefaultContextGovernor packages/cli/src/wrapper/session-manager.ts\nCapability Fabric docs/architecture/tooling/capability-catalog.md",
      [{ toolName: "read", authorizedRootIndex: 0, relativePath: "packages/runtime/src/session/runtime-session-orchestrator.ts", succeeded: true, complete: true }],
      true,
    ],
    [
      "missing citation",
      "RuntimeSessionOrchestrator\nDefaultContextGovernor\nCapability Fabric",
      [{ toolName: "read", authorizedRootIndex: 0, relativePath: "packages/runtime/src/session/runtime-session-orchestrator.ts", succeeded: true, complete: true }],
      false,
    ],
    [
      "prose-only shortcut",
      "RuntimeSessionOrchestrator packages/runtime/src/session/runtime-session-orchestrator.ts\nDefaultContextGovernor packages/cli/src/wrapper/session-manager.ts\nCapability Fabric docs/architecture/tooling/capability-catalog.md",
      [],
      false,
    ],
  ])("checks repository citations and declared reads: %s", (_name, answer, readToolEvidence, passed) => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer,
      oracle: {
        kind: "required_terms_and_no_diff",
        requiredTerms: ["RuntimeSessionOrchestrator", "DefaultContextGovernor", "Capability Fabric"],
        requiredCitations: [
          "packages/runtime/src/session/runtime-session-orchestrator.ts",
          "packages/cli/src/wrapper/session-manager.ts",
          "docs/architecture/tooling/capability-catalog.md",
        ],
        requiredReadTargets: [{ authorizedRootIndex: 0, relativePath: "packages/runtime/src/session/runtime-session-orchestrator.ts" }],
      },
      evidence: { workspaceUnchanged: true, readToolEvidence },
    }).passed).toBe(passed);
  });

  it("accepts a successful targeted source read without requiring the entire source file", () => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "RuntimeSessionOrchestrator packages/runtime/src/session/runtime-session-orchestrator.ts",
      oracle: {
        kind: "required_terms_and_no_diff",
        requiredTerms: ["RuntimeSessionOrchestrator"],
        requiredCitations: ["packages/runtime/src/session/runtime-session-orchestrator.ts"],
        requiredReadTargets: [{ authorizedRootIndex: 0, relativePath: "packages/runtime/src/session/runtime-session-orchestrator.ts" }],
      },
      evidence: {
        workspaceUnchanged: true,
        readToolEvidence: [{
          toolName: "read",
          authorizedRootIndex: 0,
          relativePath: "packages/runtime/src/session/runtime-session-orchestrator.ts",
          succeeded: true,
          complete: false,
        }],
      },
    }).passed).toBe(true);
  });

  it.each([
    ["missing terms", { requiredCitations: ["docs/architecture/tooling/capability-catalog.md"], requiredReadTargets: [{ authorizedRootIndex: 0, relativePath: "docs/architecture/tooling/capability-catalog.md" }] }],
    ["malformed citations", { requiredTerms: ["Capability Fabric"], requiredCitations: [42], requiredReadTargets: [{ authorizedRootIndex: 0, relativePath: "docs/architecture/tooling/capability-catalog.md" }] }],
    ["malformed read targets", { requiredTerms: ["Capability Fabric"], requiredCitations: ["docs/architecture/tooling/capability-catalog.md"], requiredReadTargets: [{ authorizedRootIndex: 0, relativePath: "../outside.txt" }] }],
    ["missing read targets", { requiredTerms: ["Capability Fabric"], requiredCitations: ["docs/architecture/tooling/capability-catalog.md"] }],
  ])("fails closed for incomplete repository oracle declarations: %s", (_name, oracle) => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "Capability Fabric docs/architecture/tooling/capability-catalog.md",
      oracle: { kind: "required_terms_and_no_diff", ...oracle },
      evidence: {
        workspaceUnchanged: true,
        readToolEvidence: [{ toolName: "read", authorizedRootIndex: 0, relativePath: "docs/architecture/tooling/capability-catalog.md", succeeded: true, complete: true }],
      },
    }).passed).toBe(false);
  });

  it.each([
    ["reference success", READS, 8, true, true],
    ["verifier failure", READS, 8, false, false],
    ["checksum shortcut without one shard", [READS[0]], 8, true, false],
    ["partial read shortcut", [{ ...READS[0], complete: false }, READS[1]], 8, true, false],
  ])("requires every shard and private checksum verification: %s", (_name, readToolEvidence, toolCallCount, answerVerified, passed) => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "not-retained-by-the-evaluator",
      oracle: {
        kind: "fixture_checksum_and_tool_trajectory",
        minimumToolCalls: 8,
        requiredReadTargets: READS.map(({ authorizedRootIndex, relativePath }) => ({ authorizedRootIndex, relativePath })),
      },
      evidence: { readToolEvidence, toolCallCount, answerVerified },
    }).passed).toBe(passed);
  });

  it.each([
    ["one summary read_many cannot replace eight reads", 1, false],
    ["eight calls with complete read_many evidence cannot replace singular reads", 8, true],
  ])("rejects read_many shortcuts for the shard task: %s", (_name, toolCallCount, answerVerified) => {
    const readManyEvidence = READS.map(({ authorizedRootIndex, relativePath }) => ({
      toolName: "read_many",
      authorizedRootIndex,
      relativePath,
      succeeded: true,
      complete: true,
    }));
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "not-retained-by-the-evaluator",
      oracle: {
        kind: "fixture_checksum_and_tool_trajectory",
        minimumToolCalls: 8,
        requiredReadTargets: READS.map(({ authorizedRootIndex, relativePath }) => ({ authorizedRootIndex, relativePath })),
      },
      evidence: { readToolEvidence: readManyEvidence, toolCallCount, answerVerified },
    }).passed).toBe(false);
  });

  it("fails closed when the shard task omits its minimum tool-call declaration", () => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "not-retained-by-the-evaluator",
      oracle: {
        kind: "fixture_checksum_and_tool_trajectory",
        requiredReadTargets: READS.map(({ authorizedRootIndex, relativePath }) => ({ authorizedRootIndex, relativePath })),
      },
      evidence: { readToolEvidence: READS, toolCallCount: 8, answerVerified: true },
    }).reasonCodes).toContain("minimum_tool_calls_missing");
  });

  it.each([
    [
      "reference success",
      {
        verifierId: "kiln.context-efficiency.bounded-implementation.v1", verifierVersion: "2",
        status: "passed", infrastructureFailure: false, violations: [],
        changes: { changed: [{ path: "src/normalize.ts", beforeHash: `sha256:${"a".repeat(64)}`, afterHash: `sha256:${"b".repeat(64)}` }], added: [], deleted: [] },
        tests: { status: "completed", exitCode: 0, passed: 8, failed: 0, timedOut: false },
      },
      { changed: [{ path: "src/normalize.ts" }], added: [], deleted: [] },
      true,
    ],
    [
      "verification failure",
      { status: "failed", tests: { exitCode: 1, failed: 1, timedOut: false } },
      { changed: [{ path: "src/normalize.ts" }], added: [], deleted: [] },
      false,
    ],
    [
      "passing tests with an out-of-scope change",
      {
        verifierId: "kiln.context-efficiency.bounded-implementation.v1", verifierVersion: "2",
        status: "passed", infrastructureFailure: false, violations: [],
        changes: { changed: [{ path: "src/normalize.ts", beforeHash: `sha256:${"a".repeat(64)}`, afterHash: `sha256:${"b".repeat(64)}` }], added: [], deleted: [] },
        tests: { status: "completed", exitCode: 0, passed: 8, failed: 0, timedOut: false },
      },
      { changed: [{ path: "src/normalize.ts" }, { path: "verification/normalize.fixture.ts" }], added: [], deleted: [] },
      false,
    ],
  ])("requires fixture verification and bounded diff: %s", (_name, observedVerification, workspaceChanges, passed) => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "implemented",
      oracle: { kind: "fixture_test_and_allowed_diff", allowedPaths: ["src/normalize.ts"] },
      evidence: { observedVerification, workspaceChanges },
    }).passed).toBe(passed);
  });

  it("rejects malformed diff arrays rather than treating them as empty", () => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "implemented",
      oracle: { kind: "fixture_test_and_allowed_diff", allowedPaths: ["src/normalize.ts"] },
      evidence: {
        observedVerification: {
        verifierId: "kiln.context-efficiency.bounded-implementation.v1", verifierVersion: "2",
        status: "passed", infrastructureFailure: false, violations: [],
        changes: { changed: [{ path: "src/normalize.ts", beforeHash: `sha256:${"a".repeat(64)}`, afterHash: `sha256:${"b".repeat(64)}` }], added: [], deleted: [] },
        tests: { status: "completed", exitCode: 0, passed: 8, failed: 0, timedOut: false },
      },
        workspaceChanges: { changed: [{ path: "src/normalize.ts" }], added: "unknown", deleted: [] },
      },
    }).passed).toBe(false);
  });

  const completedChild = {
    access: "read-only",
    lifecycleState: "completed",
    providerRoute: { providerId: "codex-oauth", model: "gpt-5.6-luna" },
    authority: { authorityProfileId: "read-only" },
    requestedAuthority: "read_only",
    authorityProfileId: "authority:read-only",
    authoritySnapshot: {
      toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false },
      workingDirectory: { mode: "read-only" },
    },
    capabilitySnapshot: { routeId: "luna-scout" },
    providerRequestObservations: COMPLETE_CHILD_TRANSPORT,
    resultHandoff: { summary: "DefaultContextGovernor", resourceUris: ["kiln://managed/invocation/result"] },
  };

  it.each([
    ["reference success", [completedChild], true],
    ["terminal child failure", [{ ...completedChild, lifecycleState: "failed" }], false],
    ["second child shortcut", [completedChild, completedChild], false],
  ])("requires one settled read-only child with canonical evidence: %s", (_name, managedInvocations, passed) => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "child said DefaultContextGovernor",
      oracle: {
        kind: "managed_child_settlement",
        requiredChildCount: 1,
        requiredAccess: "read-only",
        requiredHandoffTerms: ["DefaultContextGovernor"],
      },
      evidence: { managedInvocations },
    }).passed).toBe(passed);
  });

  it.each([
    ["completed", "completed", false],
    ["failed terminal failure", "failed", false],
    ["timed out terminal failure", "timed_out", true],
    ["cancelled terminal failure", "cancelled", true],
    ["stale terminal failure", "stale", true],
    ["recovered terminal result", "recovered", true],
    ["pending", "pending", true],
    ["running", "running", true],
    ["unknown lifecycle", "route_profile_conflict", true],
  ])("separates unsettled children from terminal task failures: %s", (_name, lifecycleState, unsettled) => {
    expect(hasUnsettledManagedChildInvocation([{ ...completedChild, lifecycleState }])).toBe(unsettled);
  });

  it.each([
    ["missing transport evidence", { ...completedChild, providerRequestObservations: undefined }],
    ["unknown dispatch", { ...completedChild, providerRequestObservations: [{
      ...COMPLETE_CHILD_TRANSPORT[0], dispatch: { attempt: { state: "unknown" }, outcome: "completed" },
    }] }],
    ["estimated usage", { ...completedChild, providerRequestObservations: [{
      ...COMPLETE_CHILD_TRANSPORT[0], usage: {
        ...COMPLETE_CHILD_TRANSPORT[0].usage,
        input: { measurement: "estimated", tokens: 10 },
      },
    }] }],
  ])("requires complete transport evidence for an otherwise completed child: %s", (_name, child) => {
    expect(hasUnsettledManagedChildInvocation([child])).toBe(true);
  });

  it("reports an unsettled child separately from a terminal child failure", () => {
    const oracle = {
      kind: "managed_child_settlement",
      requiredChildCount: 1,
      requiredAccess: "read-only",
      requiredHandoffTerms: ["DefaultContextGovernor"],
    } as const;
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "child result",
      oracle,
      evidence: { managedInvocations: [{ ...completedChild, lifecycleState: "failed" }] },
    }).reasonCodes).toContain("managed_child_not_completed");
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "child result",
      oracle,
      evidence: { managedInvocations: [{ ...completedChild, lifecycleState: "running" }] },
    }).reasonCodes).toContain("managed_child_unsettled");
  });

  it.each([
    ["write-capable authority", { ...completedChild, authoritySnapshot: { ...completedChild.authoritySnapshot, toolAuthority: { allowedToolNames: ["read", "write"], writeAllowed: true, networkAllowed: false } } }],
    ["handoff omits required owner", { ...completedChild, resultHandoff: { summary: "completed", resourceUris: ["kiln://managed/invocation/result"] } }],
  ])("rejects weak read-only child evidence: %s", (_name, child) => {
    expect(evaluateContextEfficiencyTaskOracle({
      answer: "child result",
      oracle: {
        kind: "managed_child_settlement",
        requiredChildCount: 1,
        requiredAccess: "read-only",
        requiredHandoffTerms: ["DefaultContextGovernor"],
      },
      evidence: { managedInvocations: [child] },
    }).passed).toBe(false);
  });
});
