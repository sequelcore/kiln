import { describe, expect, it } from "vitest";
import {
  MANAGED_AGENT_LIFECYCLE_STATES,
  buildManagedAgentLifecycleEvidence,
  defineManagedAgentInvocationRequest,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentCapabilitySnapshot,
  defineManagedAgentInvocationRecord,
  buildManagedAgentCapabilitySnapshot,
} from "../../src/agents/managed-invocation/index.js";
import type {
  ManagedAgentInvocationRequest,
  ManagedAgentInvocationRecord,
  ManagedAgentAdapterDescriptor,
  ManagedAgentUsageReport,
} from "../../src/agents/managed-invocation/index.js";

function makeRequest(): ManagedAgentInvocationRequest {
  return {
    invocationId: "invocation-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "codex-oauth",
      surface: "cli-harness",
      model: "gpt-5.4",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "foundation-readonly",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["read", "rg"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "read-only",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: "credential-route:codex-oauth:primary",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
    input: {
      summary: "Review the managed invocation contract",
      prompt: "Inspect the planned contract without writing files.",
    },
  };
}

function makeDescriptor(): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:codex-oauth:cli",
    providerId: "codex-oauth",
    adapterKind: "harness",
    supportedProfiles: ["foundation-readonly-plan"],
    supportedExecutionModes: ["cli-harness"],
    lifecycle: {
      exposesStart: true,
      exposesTerminal: true,
      exposesCleanup: true,
    },
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
    },
    resultHandoff: {
      boundedSummary: true,
      resourcePointers: true,
    },
    credentialRoute: { supported: true },
    memoryContext: { governedAdmission: true },
    unsupportedFieldPolicy: "reject",
    cleanup: { supported: true },
  });
}

describe("managed agent invocation contracts", () => {
  it("defines the canonical background-child lifecycle vocabulary without admission-only states", () => {
    expect(MANAGED_AGENT_LIFECYCLE_STATES).toEqual([
      "pending",
      "starting",
      "running",
      "waiting_for_approval",
      "completed",
      "failed",
      "timed_out",
      "cancelled",
      "stale",
      "recovered",
    ]);
    expect(() => defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      lifecycleState: "timed-out" as ManagedAgentInvocationRecord["lifecycleState"],
    })).toThrow("Unsupported managed invocation lifecycle state: timed-out");
  });

  it("defines the foundation request with explicit route, authority, credential, memory, timeout, and lineage", () => {
    const request = defineManagedAgentInvocationRequest(makeRequest());

    expect(request).toMatchObject({
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-oauth",
        surface: "cli-harness",
        model: "gpt-5.4",
      },
      adapterKind: "harness",
      executionMode: "cli-harness",
      authority: {
        authorityProfileId: "foundation-readonly",
        permissionProfile: "read-only",
        toolAuthority: {
          allowedToolNames: ["read", "rg"],
          writeAllowed: false,
          networkAllowed: false,
        },
        workingDirectory: {
          path: "C:/workspace/kiln",
          mode: "read-only",
        },
        timeoutMs: 120000,
        credentialRoute: {
          mode: "runtime-selected",
          routeId: "credential-route:codex-oauth:primary",
        },
        memoryScope: {
          scope: { kind: "project", id: "kiln" },
          access: "read-only",
        },
      },
    });
  });

  it("defines adapter descriptors without provider-native vocabulary leaking into the core contract", () => {
    const descriptor = makeDescriptor();

    expect(descriptor.adapterKind).toBe("harness");
    expect(descriptor.supportedProfiles).toEqual(["foundation-readonly-plan"]);
    expect(JSON.stringify(descriptor)).not.toMatch(/\bsubagent\b|\bteam\b|\bfork\b/);
  });

  it("preserves remote-harness limitations as route capability evidence without changing adapter kind", () => {
    const descriptor = defineManagedAgentAdapterDescriptor({
      ...makeDescriptor(),
      adapterDescriptorId: "adapter:codex-cloud:remote-harness",
      providerId: "codex-cloud",
      supportedExecutionModes: ["remote-harness"],
      limitations: [
        "Remote harness reports aggregate token classes only.",
        "Remote harness cannot expose local live terminal streaming.",
      ],
    });
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      providerRoute: {
        providerId: "codex-cloud",
        surface: "remote-harness",
        model: "gpt-5.5",
      },
      executionMode: "remote-harness",
    });
    const snapshot = buildManagedAgentCapabilitySnapshot(request, descriptor, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-cloud-remote-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(descriptor.adapterKind).toBe("harness");
    expect(descriptor.supportedExecutionModes).toEqual(["remote-harness"]);
    expect(descriptor.limitations).toEqual([
      "Remote harness reports aggregate token classes only.",
      "Remote harness cannot expose local live terminal streaming.",
    ]);
    expect(snapshot.adapterDescriptor.limitations).toEqual(descriptor.limitations);
    expect(snapshot.routeSource).toBe("explicit-managed-route");
    expect(snapshot.providerRoute.surface).toBe("remote-harness");
  });

  it("derives a replayable resource lease in the capability snapshot", () => {
    const baseRequest = makeRequest();
    const request = defineManagedAgentInvocationRequest({
      ...baseRequest,
      input: {
        ...baseRequest.input,
        resourceUris: ["kiln://resources/context.md", "kiln://artifacts/invocation-1/input"],
      },
    });
    const snapshot = buildManagedAgentCapabilitySnapshot(request, makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(snapshot.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "healthy",
      cleanupStatus: "not-required",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only",
      resourceUris: ["kiln://resources/context.md", "kiln://artifacts/invocation-1/input"],
      diagnosticUris: [],
    });
  });

  it("marks writable default resource leases as pending cleanup obligations", () => {
    const baseRequest = makeRequest();
    const request = defineManagedAgentInvocationRequest({
      ...baseRequest,
      authority: {
        ...baseRequest.authority,
        permissionProfile: "workspace-write",
        toolAuthority: {
          ...baseRequest.authority.toolAuthority,
          writeAllowed: true,
        },
        workingDirectory: {
          path: "C:/workspace/kiln",
          mode: "workspace-write",
        },
      },
    });
    const snapshot = buildManagedAgentCapabilitySnapshot(request, makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-workspace-write",
      routeSource: "explicit-managed-route",
    });

    expect(snapshot.resourceLease).toMatchObject({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "healthy",
      cleanupStatus: "pending",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "workspace-write",
      diagnosticUris: [],
    });
  });

  it("rejects malformed resource lease fields at the snapshot boundary", () => {
    const snapshot = buildManagedAgentCapabilitySnapshot(makeRequest(), makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      routeSource: "legacy-shim" as typeof snapshot.routeSource,
    })).toThrow("Unsupported managed capability snapshot route source: legacy-shim");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      resourceLease: {
        ...snapshot.resourceLease,
        workingDirectoryMode: "shared-checkout" as typeof snapshot.resourceLease.workingDirectoryMode,
      },
    })).toThrow("Unsupported managed invocation working directory mode: shared-checkout");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      resourceLease: {
        ...snapshot.resourceLease,
        resourceUris: [""],
      },
    })).toThrow("Managed capability snapshot lease resource uri is required");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      resourceLease: {
        ...snapshot.resourceLease,
        healthStatus: "unknown" as typeof snapshot.resourceLease.healthStatus,
      },
    })).toThrow("Unsupported managed capability snapshot lease health status: unknown");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      resourceLease: {
        ...snapshot.resourceLease,
        cleanupStatus: "lost" as typeof snapshot.resourceLease.cleanupStatus,
      },
    })).toThrow("Unsupported managed capability snapshot lease cleanup status: lost");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      resourceLease: {
        ...snapshot.resourceLease,
        diagnosticUris: [""],
      },
    })).toThrow("Managed capability snapshot lease diagnostic uri is required");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      resourceLease: {
        ...snapshot.resourceLease,
        worktreeReview: {
          status: "approved" as "required",
          reason: "dirty-worktree-preserved",
          resourceUris: [`kiln://artifacts/${snapshot.snapshotId}/worktree-review`],
          diagnosticUris: [`kiln://artifacts/${snapshot.snapshotId}/worktree-review-required`],
        },
      },
    })).toThrow("Unsupported managed capability snapshot worktree review status: approved");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      resourceLease: {
        ...snapshot.resourceLease,
        worktreeReview: {
          status: "required",
          reason: " ",
          resourceUris: [`kiln://artifacts/${snapshot.snapshotId}/worktree-review`],
          diagnosticUris: [`kiln://artifacts/${snapshot.snapshotId}/worktree-review-required`],
        },
      },
    })).toThrow("Managed capability snapshot worktree review reason is required");
  });

  it("records replayable lifecycle evidence, transcript flags, usage unknowns, and bounded result handoff", () => {
    const usage: ManagedAgentUsageReport = {
      source: "adapter",
      tokenClasses: [
        { name: "input_tokens", value: 120 },
        { name: "output_tokens", value: 45 },
        { name: "cached_tokens", value: "unknown" },
      ],
      cost: { currency: "USD", amount: "unknown" },
    };

    const record: ManagedAgentInvocationRecord = defineManagedAgentInvocationRecord(makeCompletedRecordInput(usage));

    expect(record.lifecycleState).toBe("completed");
    expect(record.capabilitySnapshot.routeId).toBe("codex-oauth-readonly");
    expect(record.capabilitySnapshot.routeSource).toBe("explicit-managed-route");
    expect(record.transcript?.redacted).toBe(true);
    expect(record.usage?.tokenClasses[2]).toEqual({ name: "cached_tokens", value: "unknown" });
    expect(record.resultHandoff?.summary).toBe("No file writes were needed.");
  });

  it("preserves full replay resources without adding unbounded content to lifecycle evidence", () => {
    const record = defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      capabilitySnapshot: defineManagedAgentCapabilitySnapshot({
        ...makeCompletedRecordInput().capabilitySnapshot,
        resourcePlane: {
          available: true,
          resourceUris: ["kiln://session/work-items/work-source"],
        },
      }),
      resultHandoff: {
        summary: "Bounded review summary.",
        resourceUris: ["kiln://managed-agents/invocations/invocation-1/resources/result/final"],
        memoryWriteProposalUris: [],
      },
      replayResources: [{
        uri: "kiln://managed-agents/invocations/invocation-1/resources/result/final",
        title: "Managed invocation final result",
        mimeType: "text/markdown",
        text: "Full child result with actionable finding tail.",
      }],
    });
    const lifecycleEvidence = buildManagedAgentLifecycleEvidence(record);

    expect(record.replayResources).toEqual([{
      uri: "kiln://managed-agents/invocations/invocation-1/resources/result/final",
      title: "Managed invocation final result",
      mimeType: "text/markdown",
      text: "Full child result with actionable finding tail.",
    }]);
    expect(lifecycleEvidence).toMatchObject({
      sourceResourceUris: ["kiln://session/work-items/work-source"],
      resultSummary: "Bounded review summary.",
      handoffResourceUris: ["kiln://managed-agents/invocations/invocation-1/resources/result/final"],
    });
    expect(JSON.stringify(lifecycleEvidence)).not.toContain("Full child result with actionable finding tail.");
  });

  it("derives replayable lifecycle evidence from the invocation record without a second lifecycle store", () => {
    const record = defineManagedAgentInvocationRecord(makeCompletedRecordInput());
    const lifecycleEvidence = buildManagedAgentLifecycleEvidence(record, { heartbeatAt: "2026-05-07T08:00:03.000Z" });

    expect(lifecycleEvidence).toMatchObject({
      lifecycleState: "completed",
      invocationId: "invocation-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
      providerId: "codex-oauth",
      model: "gpt-5.4",
      profile: "foundation-readonly-plan",
      contextMode: "isolated",
      authorityProfileId: "foundation-readonly",
      resourceLease: {
        leaseId: "invocation-1:resource-lease",
        createdAt: "2026-05-07T08:00:00.000Z",
        healthStatus: "healthy",
        cleanupStatus: "not-required",
        workingDirectoryPath: "C:/workspace/kiln",
        workingDirectoryMode: "read-only",
        resourceUris: [],
        diagnosticUris: [],
      },
      transcriptUri: "kiln://artifacts/invocation-1/transcript",
      heartbeatAt: "2026-05-07T08:00:03.000Z",
      resultSummary: "No file writes were needed.",
      diagnosticUris: ["kiln://artifacts/invocation-1/diagnostics"],
      handoffResourceUris: ["kiln://artifacts/invocation-1/result"],
    });
    expect(lifecycleEvidence.resourceLease).toEqual(record.capabilitySnapshot.resourceLease);
  });

  it("uses terminal resource lease evidence without mutating the admitted capability snapshot", () => {
    const record = defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      resourceLease: {
        leaseId: "invocation-1:resource-lease",
        createdAt: "2026-05-07T08:00:00.000Z",
        healthStatus: "released",
        cleanupStatus: "completed",
        workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/invocation-1",
        workingDirectoryMode: "isolated-worktree",
        resourceUris: ["kiln://artifacts/invocation-1/worktree-lease"],
        diagnosticUris: ["kiln://artifacts/invocation-1/worktree-cleanup"],
      },
    });

    const lifecycleEvidence = buildManagedAgentLifecycleEvidence(record);

    expect(record.capabilitySnapshot.resourceLease.cleanupStatus).toBe("not-required");
    expect(lifecycleEvidence.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "released",
      cleanupStatus: "completed",
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/invocation-1",
      workingDirectoryMode: "isolated-worktree",
      resourceUris: ["kiln://artifacts/invocation-1/worktree-lease"],
      diagnosticUris: ["kiln://artifacts/invocation-1/worktree-cleanup"],
    });
  });

  it("preserves typed dirty-worktree review evidence in terminal lifecycle evidence", () => {
    const record = defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      resourceLease: {
        leaseId: "invocation-1:resource-lease",
        createdAt: "2026-05-07T08:00:00.000Z",
        healthStatus: "leaked",
        cleanupStatus: "failed",
        workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/invocation-1",
        workingDirectoryMode: "isolated-worktree",
        resourceUris: ["kiln://artifacts/invocation-1/worktree-lease"],
        diagnosticUris: ["kiln://artifacts/invocation-1/worktree-lease-cleanup-failed"],
        worktreeReview: {
          status: "required",
          reason: "dirty-worktree-preserved",
          resourceUris: ["kiln://artifacts/invocation-1/worktree-review"],
          diagnosticUris: ["kiln://artifacts/invocation-1/worktree-review-required"],
        },
      },
    });

    expect(buildManagedAgentLifecycleEvidence(record).resourceLease.worktreeReview).toEqual({
      status: "required",
      reason: "dirty-worktree-preserved",
      resourceUris: ["kiln://artifacts/invocation-1/worktree-review"],
      diagnosticUris: ["kiln://artifacts/invocation-1/worktree-review-required"],
    });
  });

  it("rejects request-local timeout provenance at the authority boundary", () => {
    expect(() => defineManagedAgentInvocationRequest({
      ...makeRequest(),
      authority: {
        ...makeRequest().authority,
        timeoutSource: "request" as ManagedAgentInvocationRequest["authority"]["timeoutSource"],
      },
    })).toThrow("Unsupported managed invocation timeout source: request");
  });
});

function makeCompletedRecordInput(
  usage: ManagedAgentUsageReport = {
    source: "adapter",
    tokenClasses: [
      { name: "input_tokens", value: 120 },
      { name: "output_tokens", value: 45 },
      { name: "cached_tokens", value: "unknown" },
    ],
    cost: { currency: "USD", amount: "unknown" },
  },
): ManagedAgentInvocationRecord {
  return {
    invocationId: "invocation-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    profile: "foundation-readonly-plan",
    lifecycleState: "completed",
    providerRoute: makeRequest().providerRoute,
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: makeRequest().authority,
    capabilitySnapshot: buildManagedAgentCapabilitySnapshot(makeRequest(), makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
    }),
    childSessionId: "child-session-1",
    transcript: {
      uri: "kiln://artifacts/invocation-1/transcript",
      redacted: true,
      truncated: false,
      persisted: true,
      retention: "session",
    },
    diagnostics: [{
      uri: "kiln://artifacts/invocation-1/diagnostics",
      kind: "timeout",
    }],
    usage,
    resultHandoff: {
      summary: "No file writes were needed.",
      resourceUris: ["kiln://artifacts/invocation-1/result"],
      memoryWriteProposalUris: [],
    },
  };
}
