import { describe, expect, it } from "vitest";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteEvidence,
  defineManagedAgentWriteScope,
} from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  appendManagedInvocationSessionEvents,
  appendManagedInvocationStartSessionEvents,
} from "../../src/agents/managed-invocation/session-events.js";

function makeSession(sessionId = "session-parent"): RuntimeSession {
  return new RuntimeSession({
    sessionId,
    appName: "test-app",
    tenantId: "tenant-a",
    userId: "user-1",
    systemPrompt: "test",
  });
}

function makeRequest(sessionId = "session-parent", turnId = `${sessionId}:turn:1`): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-1",
    agentId: "agent-reviewer",
    parentSessionId: sessionId,
    parentTurnId: turnId,
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "opencode",
      surface: "cli-harness",
      model: "sonic",
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
        routeId: "credential-route:opencode:primary",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect invocation contract",
    },
  });
}

function makeWriteScope(resourceUris: readonly string[] = ["kiln://artifacts/managed-agent-write/proposal-1"]) {
  return defineManagedAgentWriteScope({
    workspace: {
      mode: "propose",
      allowedPaths: ["C:/workspace/kiln/packages/core/src/agents/managed-invocation"],
      deniedPaths: ["C:/workspace/kiln/.git"],
    },
    memory: {
      mode: "propose",
      scope: { kind: "project", id: "kiln" },
      operations: ["create", "update"],
    },
    artifacts: {
      mode: "propose",
      resourceUris,
      retention: "session",
    },
    tools: {
      allowedToolNames: ["read", "rg"],
      deniedToolNames: ["git-commit"],
    },
  });
}

function makeDescriptor() {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:opencode:harness",
    providerId: "opencode",
    adapterKind: "harness",
    supportedProfiles: ["foundation-readonly-plan", "foundation-propose-writes"],
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

function makeCapabilitySnapshot(request: ManagedAgentInvocationRequest) {
  return buildManagedAgentCapabilitySnapshot(request, makeDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: `${request.providerRoute.providerId}-readonly`,
    routeSource: "explicit-managed-route",
  });
}

function makeWriteRequest(
  sessionId = "session-parent",
  turnId = `${sessionId}:turn:1`,
  writeResourceUris?: readonly string[],
): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-write-1",
    agentId: "agent-implementer",
    parentSessionId: sessionId,
    parentTurnId: turnId,
    profile: "foundation-propose-writes",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "opencode",
      surface: "cli-harness",
      model: "sonic",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "authority:foundation-propose-writes",
      permissionProfile: "propose-writes",
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
        routeId: "credential-route:opencode:primary",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "write-proposals",
      },
      writeAuthority: defineManagedAgentWriteAuthority({
        profile: "foundation-propose-writes",
        scope: makeWriteScope(writeResourceUris),
        approval: {
          mode: "required-before-apply",
          evidenceRequired: true,
        },
      }),
    },
    input: {
      summary: "Propose managed invocation write authority changes",
    },
  });
}

function makeDecision(status: "admitted" | "denied"): ManagedAgentAdmissionDecision {
  const request = makeRequest();
  if (status === "denied") {
    return {
      status: "denied",
      invocationId: "invocation-1",
      profile: "foundation-readonly-plan",
      reason: "foundation-readonly-plan denied: timeout.supported",
      missingCapabilities: ["timeout.supported"],
    };
  }
  return makeAdmittedDecision(request);
}

function makeAdmittedDecision(request: ManagedAgentInvocationRequest): ManagedAgentAdmissionDecision {
  return {
    status: "admitted",
    invocationId: request.invocationId,
    profile: request.profile,
    adapterDescriptorId: "adapter:opencode:harness",
    authorityProfileId: request.authority.authorityProfileId,
    credentialRouteId: "credential-route:opencode:primary",
    memoryScope: request.authority.memoryScope.scope,
    capabilitySnapshot: makeCapabilitySnapshot(request),
  };
}

function makeWriteDecision(status: "admitted" | "denied", request = makeWriteRequest()): ManagedAgentAdmissionDecision {
  if (status === "denied") {
    return {
      status: "denied",
      invocationId: request.invocationId,
      profile: request.profile,
      reason: "foundation-propose-writes denied: writeAuthority.proposalSupported",
      missingCapabilities: ["writeAuthority.proposalSupported"],
    };
  }
  return {
    status: "admitted",
    invocationId: request.invocationId,
    profile: request.profile,
    adapterDescriptorId: "adapter:opencode:harness",
    authorityProfileId: request.authority.authorityProfileId,
    credentialRouteId: "credential-route:opencode:primary",
    memoryScope: request.authority.memoryScope.scope,
    writeAuthority: request.authority.writeAuthority,
    capabilitySnapshot: makeCapabilitySnapshot(request),
  };
}

function makeRecord(lifecycleState: ManagedAgentInvocationRecord["lifecycleState"]): ManagedAgentInvocationRecord {
  const request = makeRequest();
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState,
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot: makeCapabilitySnapshot(request),
    childSessionId: "child-session-1",
    childTurnId: "child-session-1:turn:3",
    transcript: {
      uri: "kiln://artifacts/invocation-1/transcript",
      redacted: "unknown",
      truncated: false,
      persisted: true,
      retention: "session",
    },
    diagnostics: lifecycleState === "timed_out"
      ? [{ uri: "kiln://artifacts/invocation-1/timeout", kind: "timeout" }]
      : lifecycleState === "failed"
        ? [{ uri: "kiln://artifacts/invocation-1/failure", kind: "failure" }]
        : undefined,
    usage: {
      source: "adapter",
      tokenClasses: [
        { name: "input_tokens", value: "unknown" },
        { name: "output_tokens", value: "unknown" },
      ],
      cost: { currency: "unknown", amount: "unknown" },
    },
    resultHandoff: {
      summary: lifecycleState === "cancelled" ? "Operator cancelled managed invocation." : "Inspection completed.",
      resourceUris: ["kiln://artifacts/invocation-1/result"],
      memoryWriteProposalUris: ["kiln://memory/write-proposals/1"],
    },
  });
}

function makeWriteRecord(request = makeWriteRequest()): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState: "completed",
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot: makeCapabilitySnapshot(request),
    childSessionId: "child-session-write-1",
    transcript: {
      uri: "kiln://artifacts/invocation-write-1/transcript",
      redacted: "unknown",
      truncated: false,
      persisted: true,
      retention: "session",
    },
    resultHandoff: {
      summary: "Write proposal returned.",
      resourceUris: ["kiln://artifacts/invocation-write-1/result"],
      memoryWriteProposalUris: ["kiln://memory/write-proposals/write-proposal-1"],
    },
    writeEvidence: [
      defineManagedAgentWriteEvidence({
        evidenceId: "write-evidence-1",
        invocationId: request.invocationId,
        kind: "write-proposal-created",
        proposalId: "write-proposal-1",
        summary: "Child produced a bounded write proposal.",
        resourceUris: ["kiln://artifacts/invocation-write-1/proposal"],
        recordedAt: "2026-05-04T19:40:00.000Z",
      }),
      defineManagedAgentWriteEvidence({
        evidenceId: "write-evidence-2",
        invocationId: request.invocationId,
        kind: "write-cleanup-pending",
        proposalId: "write-proposal-1",
        summary: "No apply attempt ran; cleanup remains pending until approval.",
        resourceUris: ["kiln://artifacts/invocation-write-1/cleanup"],
        recordedAt: "2026-05-04T19:41:00.000Z",
      }),
    ],
  });
}

describe("appendManagedInvocationSessionEvents", () => {
  it("maps requested and denied admission to canonical events with stable lineage", () => {
    const session = makeSession();
    const request = makeRequest(session.id, `${session.id}:turn:1`);
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision: makeDecision("denied"),
      timestamp: new Date("2026-05-03T10:00:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_failed",
    ]);
    expect(events[0]).toMatchObject({
      sequence: 1,
      invocationId: request.invocationId,
      parentSessionId: request.parentSessionId,
      requestedBy: request.requestedBy,
      requestSource: request.requestSource,
      profile: request.profile,
      providerRoute: request.providerRoute,
      adapterKind: request.adapterKind,
      executionMode: request.executionMode,
      authorityProfileId: request.authority.authorityProfileId,
      inputSummary: request.input.summary,
    });
    expect(events[1]).toMatchObject({
      sequence: 2,
      invocationId: request.invocationId,
      parentSessionId: request.parentSessionId,
      profile: request.profile,
      providerRoute: request.providerRoute,
      adapterKind: request.adapterKind,
      executionMode: request.executionMode,
      authorityProfileId: request.authority.authorityProfileId,
      errorCode: "ADMISSION_DENIED",
      retriable: false,
    });
    expect(events[1]?.parentEventId).toBe(events[0]?.eventId);
    expect((events[1] as { errorMessage: string }).errorMessage).toContain("timeout.supported");
  });

  it("projects admitted start capability resources before replay events", () => {
    const session = makeSession();
    const rawResourceUri = "kiln://managed-invocations/sibling-start/context";
    const canonicalResourceUri = "kiln://managed-agents/invocations/sibling-start/resources/context";
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(session.id, `${session.id}:turn:1`),
      input: {
        summary: "Inspect invocation contract",
        resourceUris: [rawResourceUri],
        context: { mode: "resources" },
      },
    });

    const events = appendManagedInvocationStartSessionEvents({
      session,
      request,
      decision: makeAdmittedDecision(request),
      timestamp: new Date("2026-05-03T10:00:00.000Z"),
    });
    const serializedEvents = JSON.stringify(events);

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
    ]);
    expect(serializedEvents).toContain(canonicalResourceUri);
    expect(serializedEvents).not.toContain("kiln://managed-invocations/");
  });

  it("records requested and resolved work classification in replayable invocation context", () => {
    const session = makeSession();
    const requestedWorkClassification = {
      intents: ["write"],
      artifacts: ["document"],
      domains: ["business"],
      effects: ["write-artifact"],
      modes: ["coauthor"],
    } as const;
    const resolvedWorkClassification = {
      intents: ["write", "review"],
      artifacts: ["document"],
      domains: ["business"],
      effects: ["write-artifact"],
      modes: ["coauthor"],
    } as const;
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(session.id, `${session.id}:turn:1`),
      input: {
        summary: "Write a governed report",
        context: {
          mode: "isolated",
          workClassification: requestedWorkClassification,
          resolvedWorkClassification,
          workRecommendedSkills: ["clear-writing"],
        },
      },
    });

    const events = appendManagedInvocationStartSessionEvents({
      session,
      request,
      decision: makeAdmittedDecision(request),
      timestamp: new Date("2026-05-03T10:00:00.000Z"),
    });

    expect(events).toEqual([
      expect.objectContaining({
        kind: "agent_invocation_requested",
        invocationContext: {
          mode: "isolated",
          workClassification: requestedWorkClassification,
          resolvedWorkClassification,
          workRecommendedSkills: ["clear-writing"],
        },
      }),
      expect.objectContaining({
        kind: "agent_invocation_started",
        invocationContext: {
          mode: "isolated",
          workClassification: requestedWorkClassification,
          resolvedWorkClassification,
          workRecommendedSkills: ["clear-writing"],
        },
      }),
    ]);
  });

  it("maps requested/started/completed with transcript, usage unknowns, handoff evidence and child lineage", () => {
    const session = makeSession();
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(session.id, `${session.id}:turn:1`),
      input: {
        summary: "Inspect invocation contract",
        context: { mode: "resources" },
        resourceUris: ["kiln://session/work-items/work-source"],
      },
    });
    const record = defineManagedAgentInvocationRecord({
      ...makeRecord("completed"),
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      capabilitySnapshot: makeCapabilitySnapshot(request),
      replayResources: [{
        uri: "kiln://artifacts/invocation-1/result-full",
        title: "Managed invocation final result",
        mimeType: "text/markdown",
        text: "FULL_REPLAY_TAIL_SHOULD_NOT_INLINE",
      }],
    });
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision: makeDecision("admitted"),
      record,
      timestamp: new Date("2026-05-03T10:00:05.000Z"),
      durationMs: 950,
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(events[1]?.parentEventId).toBe(events[0]?.eventId);
    expect(events[2]?.parentEventId).toBe(events[1]?.eventId);
    expect(events[1]).toMatchObject({
      invocationId: request.invocationId,
      lifecycleState: "running",
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      profile: record.profile,
      providerRoute: record.providerRoute,
      adapterKind: record.adapterKind,
      executionMode: record.executionMode,
      authorityProfileId: record.authority.authorityProfileId,
      attempt: 1,
    });
    expect(events[2]).toMatchObject({
      invocationId: request.invocationId,
      lifecycleState: "completed",
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      profile: record.profile,
      providerRoute: record.providerRoute,
      adapterKind: record.adapterKind,
      executionMode: record.executionMode,
      authorityProfileId: record.authority.authorityProfileId,
      durationMs: 950,
      resultSummary: "Inspection completed.",
    });

    const evidence = (events[2] as { managedInvocationEvidence?: Record<string, unknown> }).managedInvocationEvidence;
    expect(evidence).toMatchObject({
      childSessionId: "child-session-1",
      childTurnId: "child-session-1:turn:3",
      transcript: {
        uri: "kiln://artifacts/invocation-1/transcript",
        redacted: "unknown",
        truncated: false,
        persisted: true,
        retention: "session",
      },
      usage: {
        source: "adapter",
        tokenClasses: [
          { name: "input_tokens", value: "unknown" },
          { name: "output_tokens", value: "unknown" },
        ],
        cost: { currency: "unknown", amount: "unknown" },
      },
      resultHandoff: {
        summary: "Inspection completed.",
        resourceUris: ["kiln://artifacts/invocation-1/result"],
        memoryWriteProposalUris: ["kiln://memory/write-proposals/1"],
      },
      lifecycle: {
        lifecycleState: "completed",
        invocationId: request.invocationId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        routeId: "opencode-readonly",
        routeSource: "explicit-managed-route",
        providerId: "opencode",
        model: "sonic",
        contextMode: "resources",
        authorityProfileId: "foundation-readonly",
        sourceResourceUris: ["kiln://session/work-items/work-source"],
        resourceLease: {
          leaseId: "invocation-1:resource-lease",
          createdAt: "2026-05-07T08:00:00.000Z",
          healthStatus: "healthy",
          cleanupStatus: "not-required",
          workingDirectoryPath: "C:/workspace/kiln",
          workingDirectoryMode: "read-only",
          resourceUris: ["kiln://session/work-items/work-source"],
          diagnosticUris: [],
        },
        transcriptUri: "kiln://artifacts/invocation-1/transcript",
        resultSummary: "Inspection completed.",
        diagnosticUris: [],
        handoffResourceUris: ["kiln://artifacts/invocation-1/result"],
      },
    });
    expect((evidence?.lifecycle as { resourceLease?: unknown }).resourceLease)
      .toEqual(record.capabilitySnapshot.resourceLease);
    expect(JSON.stringify(events)).not.toContain("FULL_REPLAY_TAIL_SHOULD_NOT_INLINE");
  });

  it("maps terminal resource lease evidence without rewriting the admitted snapshot", () => {
    const session = makeSession();
    const request = makeRequest(session.id, `${session.id}:turn:1`);
    const terminalLease = {
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "released" as const,
      cleanupStatus: "completed" as const,
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/invocation-1",
      workingDirectoryMode: "isolated-worktree" as const,
      resourceUris: ["kiln://artifacts/invocation-1/worktree-lease"],
      diagnosticUris: ["kiln://artifacts/invocation-1/worktree-cleanup"],
    };
    const record = defineManagedAgentInvocationRecord({
      ...makeRecord("completed"),
      resourceLease: terminalLease,
    });
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision: makeDecision("admitted"),
      record,
      timestamp: new Date("2026-05-03T10:00:05.000Z"),
    });

    const evidence = (events[2] as { managedInvocationEvidence?: Record<string, unknown> }).managedInvocationEvidence;

    expect(record.capabilitySnapshot.resourceLease.cleanupStatus).toBe("not-required");
    expect((evidence?.lifecycle as { resourceLease?: unknown }).resourceLease).toEqual(terminalLease);
  });

  it("maps cancellation and timeout/failure terminals to canonical events", () => {
    const lifecycleCases: Array<{
      lifecycleState: ManagedAgentInvocationRecord["lifecycleState"];
      terminalKind: "agent_invocation_cancelled" | "agent_invocation_failed";
      errorCode?: string;
    }> = [
      { lifecycleState: "cancelled", terminalKind: "agent_invocation_cancelled" },
      { lifecycleState: "timed_out", terminalKind: "agent_invocation_failed", errorCode: "ENGINE_TIMEOUT" },
      { lifecycleState: "failed", terminalKind: "agent_invocation_failed", errorCode: "ENGINE_FAILURE" },
      { lifecycleState: "stale", terminalKind: "agent_invocation_failed", errorCode: "ENGINE_STALE" },
      { lifecycleState: "recovered", terminalKind: "agent_invocation_failed", errorCode: "ENGINE_RECOVERED" },
    ];

    for (const testCase of lifecycleCases) {
      const session = makeSession(`session-parent-${testCase.lifecycleState}`);
      const request = makeRequest(session.id, `${session.id}:turn:1`);
      const record = makeRecord(testCase.lifecycleState);
      const events = appendManagedInvocationSessionEvents({
        session,
        request,
        decision: makeDecision("admitted"),
        record,
        timestamp: new Date("2026-05-03T10:01:00.000Z"),
      });

      expect(events.map((event) => event.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        testCase.terminalKind,
      ]);
      expect(events[2]?.parentEventId).toBe(events[1]?.eventId);
      if (testCase.terminalKind === "agent_invocation_failed") {
        expect(events[2]).toMatchObject({ errorCode: testCase.errorCode });
      } else {
        expect(events[2]).toMatchObject({ reason: expect.stringContaining("cancelled") });
      }
    }
  });

  it("keeps nonterminal managed child records visible without inventing a terminal event", () => {
    const session = makeSession("session-parent-waiting");
    const request = makeRequest(session.id, `${session.id}:turn:1`);
    const record = makeRecord("waiting_for_approval");
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision: makeDecision("admitted"),
      record,
      timestamp: new Date("2026-05-03T10:02:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
    ]);
    expect(events[1]).toMatchObject({
      invocationId: request.invocationId,
      lifecycleState: "waiting_for_approval",
    });
  });

  it("projects admitted write authority and write evidence through canonical managed invocation events", () => {
    const session = makeSession();
    const request = makeWriteRequest(session.id, `${session.id}:turn:1`);
    const record = makeWriteRecord(request);
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision: makeWriteDecision("admitted", request),
      record,
      timestamp: new Date("2026-05-04T19:42:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    const evidence = (events[2] as { managedInvocationEvidence?: Record<string, unknown> }).managedInvocationEvidence;

    expect(evidence).toMatchObject({
      writeAuthority: {
        profile: "foundation-propose-writes",
        scope: {
          workspace: {
            mode: "propose",
            allowedPaths: ["C:/workspace/kiln/packages/core/src/agents/managed-invocation"],
          },
          memory: {
            mode: "propose",
            scope: { kind: "project", id: "kiln" },
          },
        },
        approval: {
          mode: "required-before-apply",
          evidenceRequired: true,
        },
      },
      writeEvidence: [
        {
          evidenceId: "write-evidence-1",
          kind: "write-proposal-created",
          proposalId: "write-proposal-1",
          resourceUris: ["kiln://artifacts/invocation-write-1/proposal"],
        },
        {
          evidenceId: "write-evidence-2",
          kind: "write-cleanup-pending",
          proposalId: "write-proposal-1",
          resourceUris: ["kiln://artifacts/invocation-write-1/cleanup"],
        },
      ],
    });
  });

  it("projects denied write authority as replayable failure evidence", () => {
    const session = makeSession();
    const request = makeWriteRequest(session.id, `${session.id}:turn:1`, [
      "kiln://managed-invocations/invocation-write-1/write",
      "kiln://managed-invocations/sibling-write-1/write",
    ]);
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision: makeWriteDecision("denied", request),
      timestamp: new Date("2026-05-04T19:43:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_failed",
    ]);
    const evidence = (events[1] as { managedInvocationEvidence?: Record<string, unknown> }).managedInvocationEvidence;

    expect(evidence).toMatchObject({
      writeAuthority: {
        profile: "foundation-propose-writes",
        scope: {
          artifacts: {
            resourceUris: [
              "kiln://managed-agents/invocations/invocation-write-1/resources/write",
              "kiln://managed-agents/invocations/sibling-write-1/resources/write",
            ],
          },
        },
      },
      writeEvidence: [{
        kind: "write-authority-denied",
        invocationId: request.invocationId,
        summary: expect.stringContaining("writeAuthority.proposalSupported"),
      }],
    });
    expect(JSON.stringify(evidence)).not.toContain("kiln://managed-invocations/");
  });

  it("projects denied worktree conflict as lifecycle resource lease evidence", () => {
    const session = makeSession();
    const request = makeWriteRequest(session.id, `${session.id}:turn:1`);
    const decision: ManagedAgentAdmissionDecision = {
      status: "denied",
      invocationId: request.invocationId,
      profile: request.profile,
      reason: "Managed agent same-checkout parallel write conflict: active-write already holds C:/workspace/kiln",
      missingCapabilities: ["resourceLease.worktreeConflict"],
      resourceLease: {
        leaseId: `${request.invocationId}:resource-lease`,
        createdAt: "2026-05-04T19:44:00.000Z",
        healthStatus: "stale",
        cleanupStatus: "not-required",
        workingDirectoryPath: request.authority.workingDirectory.path,
        workingDirectoryMode: request.authority.workingDirectory.mode,
        resourceUris: [],
        diagnosticUris: [`kiln://artifacts/${request.invocationId}/worktree-conflict`],
        worktreeConflict: {
          status: "blocked",
          reason: "same-checkout-write-conflict",
          requestedInvocationId: request.invocationId,
          conflictingInvocationId: "active-write",
          workingDirectoryPath: request.authority.workingDirectory.path,
          workingDirectoryMode: request.authority.workingDirectory.mode,
          policyId: "managed-agent.worktree.single-active-writer",
          retryAfterInvocationIds: ["active-write"],
          resourceUris: [],
          diagnosticUris: [`kiln://artifacts/${request.invocationId}/worktree-conflict`],
        },
      },
    };
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision,
      timestamp: new Date("2026-05-04T19:44:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_failed",
    ]);
    expect(events[1]).toMatchObject({
      errorCode: "ADMISSION_DENIED",
      errorMessage: expect.stringContaining("worktreeConflict"),
      managedInvocationEvidence: {
        lifecycle: {
          lifecycleState: "failed",
          invocationId: request.invocationId,
          resourceLease: {
            worktreeConflict: {
              status: "blocked",
              reason: "same-checkout-write-conflict",
              conflictingInvocationId: "active-write",
            },
          },
        },
      },
    });
  });
});
