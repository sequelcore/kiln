import { describe, expect, it } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRequest,
  evaluateManagedAgentAdmission,
} from "../../src/agents/managed-invocation/index.js";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentInvocationRequest,
} from "../../src/agents/managed-invocation/index.js";

function makeDescriptor(): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:opencode:harness",
    providerId: "opencode",
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

function makeRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
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
      summary: "Inspect the contract",
    },
  });
}

function makeSnapshotInput(): ManagedAgentCapabilitySnapshotInput {
  return {
    routeId: "opencode-readonly",
    routeSource: "explicit-managed-route",
  };
}

describe("managed agent admission policy", () => {
  it("admits foundation-readonly-plan only when route, authority, credential, memory, timeout, lifecycle, and handoff evidence are explicit", () => {
    const decision = evaluateManagedAgentAdmission(makeRequest(), makeDescriptor(), makeSnapshotInput());

    expect(decision).toMatchObject({
      status: "admitted",
      invocationId: "invocation-1",
      profile: "foundation-readonly-plan",
      adapterDescriptorId: "adapter:opencode:harness",
      authorityProfileId: "foundation-readonly",
      credentialRouteId: "credential-route:opencode:primary",
      memoryScope: { kind: "project", id: "kiln" },
    });
  });

  it("admits destructive requested authority only with approval evidence", () => {
    const denied = evaluateManagedAgentAdmission(
      defineManagedAgentInvocationRequest({
        ...makeRequest(),
        requestedAuthority: "destructive",
      }),
      makeDescriptor(),
      makeSnapshotInput(),
    );
    const admitted = evaluateManagedAgentAdmission(
      defineManagedAgentInvocationRequest({
        ...makeRequest(),
        requestedAuthority: "destructive",
        authorityApproval: {
          approved: true,
          reason: "operator approved destructive child authority",
        },
      }),
      makeDescriptor(),
      makeSnapshotInput(),
    );

    expect(denied).toMatchObject({
      status: "denied",
      missingCapabilities: ["request.requestedAuthority.destructiveApprovalFlow"],
    });
    expect(admitted).toMatchObject({
      status: "admitted",
      invocationId: "invocation-1",
      profile: "foundation-readonly-plan",
    });
  });

  it.each([
    ["provider route", (request: ManagedAgentInvocationRequest) => ({ ...request, providerRoute: undefined })],
    ["adapter kind", (request: ManagedAgentInvocationRequest) => ({ ...request, adapterKind: undefined })],
    ["execution mode", (request: ManagedAgentInvocationRequest) => ({ ...request, executionMode: undefined })],
    ["permission profile", (request: ManagedAgentInvocationRequest) => ({
      ...request,
      authority: { ...request.authority, permissionProfile: undefined },
    })],
    ["tool authority", (request: ManagedAgentInvocationRequest) => ({
      ...request,
      authority: { ...request.authority, toolAuthority: undefined },
    })],
    ["working directory", (request: ManagedAgentInvocationRequest) => ({
      ...request,
      authority: { ...request.authority, workingDirectory: undefined },
    })],
    ["timeout", (request: ManagedAgentInvocationRequest) => ({
      ...request,
      authority: { ...request.authority, timeoutMs: undefined },
    })],
    ["credential route", (request: ManagedAgentInvocationRequest) => ({
      ...request,
      authority: { ...request.authority, credentialRoute: undefined },
    })],
    ["memory scope", (request: ManagedAgentInvocationRequest) => ({
      ...request,
      authority: { ...request.authority, memoryScope: undefined },
    })],
  ])("denies foundation-readonly-plan when %s is missing", (_label, mutate) => {
    const malformed = mutate(makeRequest()) as never;
    const decision = evaluateManagedAgentAdmission(malformed, makeDescriptor(), makeSnapshotInput());

    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") throw new Error("expected denied admission");
    expect(decision.reason).toContain("foundation-readonly-plan");
    expect(decision.missingCapabilities.length).toBeGreaterThan(0);
  });

  it("denies adapters that cannot preserve lifecycle, timeout, transcript, usage unknowns, credential route, governed memory, cleanup, or bounded handoff evidence", () => {
    const descriptor = {
      ...makeDescriptor(),
      timeout: { supported: false, diagnosticArtifactOnTimeout: false },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: false,
        retentionKnown: true,
      },
      resultHandoff: { boundedSummary: false, resourcePointers: true },
    };

    const decision = evaluateManagedAgentAdmission(makeRequest(), descriptor, makeSnapshotInput());

    expect(decision).toMatchObject({
      status: "denied",
      invocationId: "invocation-1",
      profile: "foundation-readonly-plan",
    });
    if (decision.status !== "denied") throw new Error("expected denied admission");
    expect(decision.missingCapabilities).toEqual(expect.arrayContaining([
      "timeout.supported",
      "transcript.persistenceKnown",
      "resultHandoff.boundedSummary",
    ]));
  });
});
