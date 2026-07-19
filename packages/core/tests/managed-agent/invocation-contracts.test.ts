import { describe, expect, it } from "vitest";
import {
  MANAGED_AGENT_LIFECYCLE_STATES,
  buildManagedAgentLifecycleEvidence,
  defineManagedAgentInvocationRequest,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentCapabilitySnapshot,
  defineManagedAgentInvocationRecord,
  buildManagedAgentCapabilitySnapshot,
  buildManagedAgentAuthorityEvidence,
  assertManagedAgentResultHandoffContract,
  evaluateManagedAgentAdmission,
  getManagedAgentCrossHarnessInvocationCapability,
  listManagedAgentCrossHarnessInvocationCapabilities,
  supportsManagedAgentCrossHarnessProvider,
} from "../../src/agents/managed-invocation/index.js";
import type {
  ManagedAgentInvocationRequest,
  ManagedAgentInvocationRecord,
  ManagedAgentAdapterDescriptor,
  ManagedAgentObservedRuntimeAuthorityEvidence,
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
      tokenClasses: ["input", "output", "cache_read"],
      semanticSourceGranularity: "unknown",
      evidenceBasis: "adapter",
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

  it("preserves work classification diagnostics in invocation context", () => {
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      input: {
        ...makeRequest().input,
        context: {
          mode: "isolated",
          workClassification: {
            intents: ["write"],
            artifacts: ["document"],
            domains: ["education"],
            effects: ["write-artifact"],
            modes: ["coauthor"],
          },
          admittedSkills: ["clear-writing"],
          resolvedWorkClassification: {
            intents: ["write"],
            artifacts: ["document"],
          },
          workRecommendedSkills: ["clear-writing"],
        },
      },
    });

    expect(request.input.context).toEqual({
      mode: "isolated",
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      admittedSkills: ["clear-writing"],
      resolvedWorkClassification: {
        intents: ["write"],
        artifacts: ["document"],
      },
      workRecommendedSkills: ["clear-writing"],
    });
  });

  it("defines adapter descriptors without provider-native vocabulary leaking into the core contract", () => {
    const descriptor = makeDescriptor();

    expect(descriptor.adapterKind).toBe("harness");
    expect(descriptor.supportedProfiles).toEqual(["foundation-readonly-plan"]);
    expect(descriptor.usage).toMatchObject({
      tokenClasses: ["input", "output", "cache_read"],
      semanticSourceGranularity: "unknown",
      evidenceBasis: "adapter",
    });
    expect(JSON.stringify(descriptor)).not.toMatch(/\bsubagent\b|\bteam\b|\bfork\b/);
  });

  it("rejects provider-reported semantic source claims without provider usage evidence", () => {
    expect(() => defineManagedAgentAdapterDescriptor({
      ...makeDescriptor(),
      usage: {
        ...makeDescriptor().usage,
        semanticSourceGranularity: "provider_reported",
        evidenceBasis: "adapter",
      },
    })).toThrow("Managed invocation provider-reported semantic source granularity requires provider usage evidence");
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

  it("preserves normalized caller attachment identity and runtime invocation capability evidence", () => {
    const snapshot = buildManagedAgentCapabilitySnapshot(makeRequest(), makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
      callerIdentity: {
        kind: "external-harness",
        harness: "codex",
        attachmentId: " attachment:codex:session-parent ",
        evidenceId: " evidence:codex:session-parent ",
      },
      invocationCapabilityEvidence: {
        decision: "admitted",
        reason: " cross-harness-managed-invocation ",
        adapterEvidence: {
          adapterDescriptorId: " adapter:codex-oauth:cli-harness ",
          adapterId: " kiln-managed-invocation ",
        },
      },
    });

    expect(snapshot.callerIdentity).toEqual({
      kind: "external-harness",
      harness: "codex",
      attachmentId: "attachment:codex:session-parent",
      evidenceId: "evidence:codex:session-parent",
    });
    expect(snapshot.invocationCapabilityEvidence).toEqual({
      decision: "admitted",
      reason: "cross-harness-managed-invocation",
      adapterEvidence: {
        adapterDescriptorId: "adapter:codex-oauth:cli-harness",
        adapterId: "kiln-managed-invocation",
      },
    });
    expect(defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      capabilitySnapshot: snapshot,
    }).capabilitySnapshot).toMatchObject({
      callerIdentity: snapshot.callerIdentity,
      invocationCapabilityEvidence: snapshot.invocationCapabilityEvidence,
    });
  });

  it("preserves kiln runtime caller identity and admitted capability evidence", () => {
    const snapshot = buildManagedAgentCapabilitySnapshot(makeRequest(), makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "gateway",
        attachmentId: "attachment:kiln-runtime:gateway:session-parent",
      },
      invocationCapabilityEvidence: {
        decision: "admitted",
        reason: "runtime-adapter-admitted",
        adapterEvidence: {
          adapterDescriptorId: "adapter:codex-oauth:cli-harness",
          adapterId: "kiln-managed-invocation",
        },
      },
    });

    expect(defineManagedAgentCapabilitySnapshot(snapshot)).toMatchObject({
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "gateway",
        attachmentId: "attachment:kiln-runtime:gateway:session-parent",
      },
      invocationCapabilityEvidence: {
        decision: "admitted",
        reason: "runtime-adapter-admitted",
      },
    });
  });

  it("owns the cross-harness managed invocation support matrix", () => {
    expect(listManagedAgentCrossHarnessInvocationCapabilities()).toEqual([
      {
        harness: "claude",
        adapterId: "kiln-managed-invocation",
        supportedProviderIds: ["codex-oauth", "opencode-go", "opencode-zen", "openrouter"],
      },
      {
        harness: "codex",
        adapterId: "kiln-managed-invocation",
        supportedProviderIds: ["opencode-go", "opencode-zen", "openrouter"],
      },
      {
        harness: "opencode",
        adapterId: "kiln-managed-invocation",
        supportedProviderIds: ["codex-oauth"],
      },
    ]);

    expect(getManagedAgentCrossHarnessInvocationCapability("codex").adapterId).toBe("kiln-managed-invocation");
    expect(supportsManagedAgentCrossHarnessProvider("codex", "opencode-go")).toBe(true);
    expect(supportsManagedAgentCrossHarnessProvider("codex", "codex-oauth")).toBe(false);
  });

  it("rejects malformed caller identity and runtime capability evidence", () => {
    const snapshot = buildManagedAgentCapabilitySnapshot(makeRequest(), makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      callerIdentity: {
        kind: "external-harness",
        harness: "cursor" as "codex",
        attachmentId: "attachment:cursor",
        evidenceId: "evidence:cursor",
      },
    })).toThrow("Unsupported managed invocation caller harness: cursor");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      callerIdentity: {
        kind: "kiln-runtime",
        surface: " ",
        attachmentId: "attachment:kiln-runtime",
      },
    })).toThrow("Managed invocation caller surface is required");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      callerIdentity: {
        kind: "legacy" as "kiln-runtime",
        surface: "gateway",
        attachmentId: "attachment:legacy",
      },
    })).toThrow("Unsupported managed invocation caller identity kind: legacy");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      invocationCapabilityEvidence: {
        decision: "allowed" as "admitted",
        reason: "policy-admitted",
        adapterEvidence: {
          adapterDescriptorId: "adapter:codex-oauth:cli-harness",
          adapterId: "kiln-managed-invocation",
        },
      },
    })).toThrow("Unsupported managed invocation capability decision: allowed");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      invocationCapabilityEvidence: {
        decision: "denied",
        reason: " ",
        adapterEvidence: {
          adapterDescriptorId: "adapter:codex-oauth:cli-harness",
          adapterId: "kiln-managed-invocation",
        },
      },
    })).toThrow("Managed invocation capability decision reason is required");
    expect(() => defineManagedAgentCapabilitySnapshot({
      ...snapshot,
      invocationCapabilityEvidence: {
        decision: "admitted",
        reason: "adapter-missing",
        adapterEvidence: {
          adapterDescriptorId: " ",
          adapterId: "kiln-managed-invocation",
        },
      },
    })).toThrow("Managed invocation capability adapter descriptor id is required");
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

  it("records requested, projected, and observed child authority evidence separately", () => {
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      requestedAuthority: "read_only",
    });
    const snapshot = buildManagedAgentCapabilitySnapshot(request, makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(snapshot.authorityEvidence).toMatchObject({
      requested: {
        authority: "read_only",
        source: "managed-invocation-request",
        proof: "proven",
      },
      projected: {
        permissionProfile: "read-only",
        approval: "on-request",
        sandbox: "read-only",
        source: "managed-authority-profile",
        proof: "proven",
      },
      observedRuntime: {
        proof: "unavailable",
        source: "not-observed",
      },
      classification: "effective-policy-unproven",
    });
  });

  it("fails closed when observed child runtime authority contradicts the admitted projection", () => {
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      requestedAuthority: "read_only",
    });

    const decision = evaluateManagedAgentAdmission(request, makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-readonly",
      routeSource: "explicit-managed-route",
      authorityEvidence: {
        requested: {
          authority: "read_only",
          source: "managed-invocation-request",
          proof: "proven",
        },
        projected: {
          permissionProfile: "read-only",
          approval: "on-request",
          sandbox: "read-only",
          source: "managed-authority-profile",
          proof: "proven",
        },
        observedRuntime: {
          approval: "never",
          sandbox: "danger-full-access",
          source: "runtime-observation",
          proof: "contradictory",
          reason: "Child runtime resumed with Full Access despite read-only child authority.",
        },
        classification: "runtime-policy-mismatch",
        recommendation: "Stop the child invocation and re-run only after projected and observed authority match.",
      },
    });

    expect(decision).toMatchObject({
      status: "denied",
      missingCapabilities: ["authorityEvidence.runtimePolicyMismatch"],
    });
  });

  it("fails closed for unattended background child invocations when effective runtime authority is unproven", () => {
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      requestSource: "background-job",
      executionIntent: { attendance: "unattended", lifecycle: "background" },
      requestedAuthority: "audited",
    });

    const decision = evaluateManagedAgentAdmission(request, makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "codex-oauth-background",
      routeSource: "explicit-managed-route",
    });

    expect(decision).toMatchObject({
      status: "denied",
      missingCapabilities: ["authorityEvidence.effective-policy-unproven"],
    });
  });

  it("uses structured execution intent instead of request-source text", () => {
    const attended = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      requestSource: "background-looking-label",
      executionIntent: { attendance: "attended", lifecycle: "foreground" },
    });
    const unattended = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      requestSource: "manual",
      executionIntent: { attendance: "unattended", lifecycle: "automation" },
    });
    const input = { capturedAt: "2026-05-07T08:00:00.000Z", routeId: "route", routeSource: "explicit-managed-route" as const };

    expect(evaluateManagedAgentAdmission(attended, makeDescriptor(), input).status).toBe("admitted");
    expect(evaluateManagedAgentAdmission(unattended, makeDescriptor(), input)).toMatchObject({
      status: "denied",
      missingCapabilities: ["authorityEvidence.effective-policy-unproven"],
    });
  });

  const proofRequiredAuthorityCases: ReadonlyArray<{
    readonly name: string;
    readonly observedRuntime: ManagedAgentObservedRuntimeAuthorityEvidence;
    readonly expected: string;
  }> = [
    {
      name: "proven mismatch",
      observedRuntime: { approval: "never", sandbox: "danger-full-access", source: "runtime-observation", proof: "proven", observedAt: "2026-05-07T08:00:00.000Z", validUntil: "2099-05-07T08:00:00.000Z" },
      expected: "authorityEvidence.runtimePolicyMismatch",
    },
    {
      name: "stale proof",
      observedRuntime: { approval: "on-request", sandbox: "read-only", source: "runtime-observation", proof: "proven", observedAt: "2026-05-07T08:00:00.000Z", validUntil: "2026-05-07T08:01:00.000Z" },
      expected: "authorityEvidence.stale-evidence",
    },
    {
      name: "partial proof",
      observedRuntime: { approval: "on-request", source: "runtime-observation", proof: "proven", observedAt: "2026-05-07T08:00:00.000Z", validUntil: "2099-05-07T08:00:00.000Z" },
      expected: "authorityEvidence.partial-observation",
    },
    {
      name: "forged not-observed proof",
      observedRuntime: { approval: "on-request", sandbox: "read-only", source: "not-observed", proof: "proven", observedAt: "2026-05-07T08:00:00.000Z", validUntil: "2099-05-07T08:00:00.000Z" },
      expected: "authorityEvidence.effective-policy-unproven",
    },
    {
      name: "failed observation",
      observedRuntime: { source: "runtime-observation", proof: "failed", reason: "Harness runtime authority probe failed before child start." },
      expected: "authorityEvidence.failed-observation",
    },
  ];

  it.each(proofRequiredAuthorityCases)("fails closed for $name on proof-required execution", ({ observedRuntime, expected }) => {
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      executionIntent: { attendance: "unattended", lifecycle: "background" },
    });
    const authorityEvidence = buildManagedAgentAuthorityEvidence({
      request,
      projectedSource: "managed-authority-profile",
      observedRuntime,
    });
    const decision = evaluateManagedAgentAdmission(request, makeDescriptor(), {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "route",
      routeSource: "explicit-managed-route",
      authorityEvidence,
    });
    expect(decision).toMatchObject({ status: "denied", missingCapabilities: [expected] });
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
        { name: "input", value: 120 },
        { name: "output", value: 45 },
        { name: "cache_read", value: "unknown" },
      ],
      cost: { currency: "USD", amount: "unknown" },
    };

    const record: ManagedAgentInvocationRecord = defineManagedAgentInvocationRecord(makeCompletedRecordInput(usage));

    expect(record.lifecycleState).toBe("completed");
    expect(record.capabilitySnapshot.routeId).toBe("codex-oauth-readonly");
    expect(record.capabilitySnapshot.routeSource).toBe("explicit-managed-route");
    expect(record.transcript?.redacted).toBe(true);
    expect(record.usage?.tokenClasses[2]).toEqual({ name: "cache_read", value: "unknown" });
    expect(record.resultHandoff?.summary).toBe("No file writes were needed.");
  });

  it("validates required machine handoff fields against canonical structured state", () => {
    const structuredResult = {
      version: "structured-execution-result-v1" as const,
      status: "blocked" as const,
      summary: "Review completed with a blocking verification failure.",
      uncertainty: 0.25,
      limitations: ["Deployment was not exercised."],
      operatorDecisions: [{ id: "decision-1", summary: "Do not adopt." }],
      evidence: [{ uri: "kiln://artifacts/invocation-1/result", kind: "verification" as const }],
      citations: [],
      warnings: [],
      failures: ["Typecheck failed."],
      approvalRequirements: [],
      residualRisks: ["Deployment behavior remains unknown."],
      verificationResults: [{
        requirementId: "typecheck",
        method: "deterministic" as const,
        status: "failed" as const,
        summary: "Typecheck failed.",
        evidenceUris: ["kiln://artifacts/invocation-1/typecheck"],
      }],
    };
    const handoff = defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      resultHandoff: {
        ...makeCompletedRecordInput().resultHandoff,
        structuredResult,
      },
    }).resultHandoff;

    const completedRecord = defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      resultHandoff: handoff,
    });
    expect(() => assertManagedAgentResultHandoffContract({
      requiredResultFields: ["summary", "evidence", "verificationResults", "uncertainty", "limitations"],
      residualRiskRequired: true,
      outputVerbosity: "concise",
    }, completedRecord)).not.toThrow();
    expect(() => assertManagedAgentResultHandoffContract({
      requiredResultFields: ["verificationResults"],
    }, defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      resultHandoff: {
        summary: "Only prose was returned.",
        resourceUris: ["kiln://artifacts/invocation-1/result"],
        memoryWriteProposalUris: [],
      },
    }))).toThrow("missing required structured fields: verificationResults");
  });

  it("preserves non-completed terminal records without applying the successful handoff contract", () => {
    const timedOutRecord = defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      lifecycleState: "timed_out",
      resultHandoff: {
        summary: "Managed child timed out before submitting its result.",
        resourceUris: ["kiln://artifacts/invocation-1/timeout"],
        memoryWriteProposalUris: [],
      },
    });

    expect(() => assertManagedAgentResultHandoffContract({
      requiredResultFields: ["verificationResults", "residualRisks"],
      residualRiskRequired: true,
    }, timedOutRecord)).not.toThrow();
  });

  it("rejects non-canonical managed result field aliases at the request boundary", () => {
    expect(() => defineManagedAgentInvocationRequest({
      ...makeRequest(),
      input: {
        summary: "Inspect the contract.",
        handoff: {
          requiredResultFields: ["checks"] as never,
        },
      },
    })).toThrow("Unsupported managed invocation handoff result field: checks");
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

  it("rejects non-canonical usage token class names at the lifecycle boundary", () => {
    expect(() => defineManagedAgentInvocationRecord(makeCompletedRecordInput({
      source: "adapter",
      tokenClasses: [
        { name: "input_tokens" as unknown as "input", value: 120 },
      ],
      cost: { currency: "USD", amount: "unknown" },
    }))).toThrow("Unsupported managed invocation usage token class: input_tokens");
  });

  it("rejects usage claims outside the admitted adapter descriptor capability", () => {
    expect(() => defineManagedAgentInvocationRecord(makeCompletedRecordInput({
      source: "adapter",
      tokenClasses: [
        { name: "cache_write", value: 12 },
      ],
      cost: { currency: "USD", amount: "unknown" },
    }))).toThrow("Managed invocation usage token class is not supported by the admitted adapter descriptor: cache_write");
  });

  it("rejects usage evidence that claims a stronger source than the admitted adapter descriptor", () => {
    expect(() => defineManagedAgentInvocationRecord(makeCompletedRecordInput({
      source: "provider",
      tokenClasses: [
        { name: "input", value: 120 },
      ],
      cost: { currency: "USD", amount: 0.01 },
    }))).toThrow("Managed invocation usage evidence source must match the admitted adapter descriptor");
  });

  it("rejects duplicate or malformed managed usage values at the lifecycle boundary", () => {
    expect(() => defineManagedAgentInvocationRecord(makeCompletedRecordInput({
      source: "adapter",
      tokenClasses: [
        { name: "input", value: 120 },
        { name: "input", value: 12 },
      ],
      cost: { currency: "USD", amount: 0.01 },
    }))).toThrow("Managed invocation usage token class must be unique: input");
    expect(() => defineManagedAgentInvocationRecord(makeCompletedRecordInput({
      source: "adapter",
      tokenClasses: [{ name: "input", value: -1 }],
      cost: { currency: "USD", amount: 0.01 },
    }))).toThrow("Managed invocation usage token value must be a non-negative safe integer: input");
    expect(() => defineManagedAgentInvocationRecord(makeCompletedRecordInput({
      source: "adapter",
      tokenClasses: [{ name: "input", value: 1.5 }],
      cost: { currency: "USD", amount: 0.01 },
    }))).toThrow("Managed invocation usage token value must be a non-negative safe integer: input");
    expect(() => defineManagedAgentInvocationRecord(makeCompletedRecordInput({
      source: "adapter",
      tokenClasses: [{ name: "input", value: 1 }],
      cost: { currency: "USD", amount: -0.01 },
    }))).toThrow("Managed invocation usage cost amount must be a non-negative finite number");
  });

  it("rejects provider route drift from the admitted capability snapshot", () => {
    expect(() => defineManagedAgentInvocationRecord({
      ...makeCompletedRecordInput(),
      providerRoute: {
        providerId: "codex-oauth",
        surface: "cli",
        model: "different-model",
      },
    })).toThrow("Managed invocation usage route must match the admitted capability snapshot");
  });
});

function makeCompletedRecordInput(
  usage: ManagedAgentUsageReport = {
    source: "adapter",
    tokenClasses: [
      { name: "input", value: 120 },
      { name: "output", value: 45 },
      { name: "cache_read", value: "unknown" },
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
