import { describe, expect, it } from "vitest";
import {
  defineManagedAgentInvocationRecord,
  type ExecutionSessionEphemeralHarnessStateEvidence,
  type ManagedAgentInvocationRecord,
} from "../../src/index.js";

const PRIVATE_PLAN_EVIDENCE: ExecutionSessionEphemeralHarnessStateEvidence = {
  capabilityId: "claude-code-private-plan-artifacts-v1",
  harness: "claude-code",
  artifactCount: 3,
  createdCount: 1,
  modifiedCount: 1,
  deletedCount: 1,
  artifactDigest: "a".repeat(64),
  cleanupStatus: "completed",
  unexpectedDelta: false,
};

function recordInput(): ManagedAgentInvocationRecord {
  return {
    invocationId: "invocation-private-plan",
    agentId: "agent-planner",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    profile: "foundation-readonly-plan",
    lifecycleState: "completed",
    providerRoute: { providerId: "claude", surface: "cli-harness", model: "claude-sonnet-5" },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "foundation-readonly",
      permissionProfile: "read-only",
      toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false },
      workingDirectory: { path: "C:/synthetic/workspace", mode: "read-only" },
      timeoutMs: 1000,
      credentialRoute: { mode: "credentialless" },
      memoryScope: { scope: { kind: "project", id: "synthetic" }, access: "read-only" },
    },
    capabilitySnapshot: {
      snapshotId: "snapshot-private-plan",
      capturedAt: "2026-08-09T00:00:00.000Z",
      routeId: "claude-private-plan",
      routeSource: "explicit-managed-route",
      routeHealth: { status: "healthy", reason: "Synthetic admitted route" },
      providerModelProof: {
        status: "live-proven",
        source: "test",
      },
      providerRoute: { providerId: "claude", surface: "cli-harness", model: "claude-sonnet-5" },
      adapterKind: "harness",
      executionMode: "cli-harness",
      adapterDescriptor: {
        adapterDescriptorId: "adapter:claude:cli-harness",
        providerId: "claude",
        adapterKind: "harness",
        supportedProfiles: ["foundation-readonly-plan"],
        supportedExecutionModes: ["cli-harness"],
        lifecycle: { exposesStart: true, exposesTerminal: true, exposesCleanup: true },
        cancellation: { supported: true },
        timeout: { supported: true, diagnosticArtifactOnTimeout: true },
        transcript: {
          supported: true,
          redactionKnown: true,
          truncationKnown: true,
          persistenceKnown: true,
          retentionKnown: true,
        },
        usage: {
          supported: true,
          preservesProviderTokenClasses: true,
          supportsExplicitUnknowns: true,
          tokenClasses: ["input", "output", "cache_read"],
          semanticSourceGranularity: "unknown",
          evidenceBasis: "adapter",
        },
        resultHandoff: { boundedSummary: true, resourcePointers: true },
        credentialRoute: { supported: true },
        memoryContext: { governedAdmission: true },
        cleanup: { supported: true },
        unsupportedFieldPolicy: "reject",
      },
      authorityProfile: {
        authorityProfileId: "foundation-readonly",
        permissionProfile: "read-only",
        toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false },
        workingDirectory: { path: "C:/synthetic/workspace", mode: "read-only" },
        timeoutMs: 1000,
        credentialRoute: { mode: "credentialless" },
        memoryScope: { scope: { kind: "project", id: "synthetic" }, access: "read-only" },
      },
      authorityEvidence: {
        requested: { authority: "read_only", source: "managed-invocation-request", proof: "proven" },
        projected: {
          permissionProfile: "read-only",
          approval: "untrusted",
          sandbox: "read-only",
          source: "cli-harness-session-factory",
          proof: "proven",
        },
        observedRuntime: { source: "not-observed", proof: "unavailable" },
        classification: "effective-policy-unproven",
      },
      contextMode: "isolated",
      resourcePlane: { available: true, resourceUris: [] },
      resourceLease: {
        leaseId: "lease-private-plan",
        createdAt: "2026-08-09T00:00:00.000Z",
        healthStatus: "healthy",
        cleanupStatus: "not-required",
        workingDirectoryPath: "C:/synthetic/workspace",
        workingDirectoryMode: "read-only",
        resourceUris: [],
        diagnosticUris: [],
      },
      childIdentity: {
        agentId: "agent-planner",
      },
    },
    resultHandoff: {
      provenance: { delivery: "native-structured-output", configuredModelId: "claude-sonnet-5", observedModelIds: ["claude-sonnet-5"] },
      summary: "The child reported a plan.",
      summaryAuthority: "child-untrusted",
      resourceUris: [],
      memoryWriteProposalUris: [],
      ephemeralHarnessState: [PRIVATE_PLAN_EVIDENCE],
    },
  };
}

describe("private Claude plan artifact contract", () => {
  it("preserves redacted runtime evidence and child-summary trust labeling", () => {
    const record = defineManagedAgentInvocationRecord(recordInput());

    expect(record.resultHandoff).toMatchObject({
      summaryAuthority: "child-untrusted",
      ephemeralHarnessState: [PRIVATE_PLAN_EVIDENCE],
    });
    expect(JSON.stringify(record)).not.toContain("C:/synthetic/harness-home");
    expect(JSON.stringify(record)).not.toContain("plans/secret");
  });

  it("rejects inconsistent or non-redacted private artifact evidence", () => {
    expect(() => defineManagedAgentInvocationRecord({
      ...recordInput(),
      resultHandoff: {
        ...recordInput().resultHandoff!,
        ephemeralHarnessState: [{
          ...PRIVATE_PLAN_EVIDENCE,
          artifactCount: 1,
          createdCount: 0,
          artifactDigest: "raw-path" as string,
        }],
      },
    })).toThrow("artifact count");
  });
});
