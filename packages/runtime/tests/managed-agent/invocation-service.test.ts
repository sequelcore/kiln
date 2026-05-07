import { describe, expect, it, vi } from "vitest";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentInvocationRequest,
  ManagedAgentInvocationRecord,
} from "@kilnai/core";
import {
  defineManagedAgentAdapterDescriptor,
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentInvocationRequest,
  defineManagedAgentInvocationRecord,
} from "@kilnai/core";
import {
  ManagedAgentRuntimeAdmissionError,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";

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
        path: "C:/Proyectos/Sequel/kiln",
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

function makeDescriptor(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentAdapterDescriptor {
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
    },
    resultHandoff: {
      boundedSummary: true,
      resourcePointers: true,
    },
    credentialRoute: { supported: true },
    memoryContext: { governedAdmission: true },
    unsupportedFieldPolicy: "reject",
    cleanup: { supported: true },
    ...overrides,
  });
}

function makeRecord(
  capabilitySnapshot = buildManagedAgentCapabilitySnapshot(makeRequest(), makeDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: "opencode-readonly",
  }),
): ManagedAgentInvocationRecord {
  const request = makeRequest();
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
    capabilitySnapshot,
    childSessionId: "child-session-1",
    transcript: {
      uri: "kiln://artifacts/invocation-1/transcript",
      redacted: true,
      truncated: false,
      persisted: true,
      retention: "session",
    },
    usage: {
      source: "adapter",
      tokenClasses: [{ name: "input_tokens", value: "unknown" }],
      cost: { currency: "unknown", amount: "unknown" },
    },
    resultHandoff: {
      summary: "Inspection completed.",
      resourceUris: ["kiln://artifacts/invocation-1/result"],
      memoryWriteProposalUris: [],
    },
  });
}

describe("RuntimeManagedAgentInvocationService", () => {
  it("admits through core policy before invoking the runtime adapter", async () => {
    const invoke = vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(makeRequest(), adapter);

    expect(result.status).toBe("completed");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0].admission).toMatchObject({
      status: "admitted",
      adapterDescriptorId: "adapter:opencode:harness",
      authorityProfileId: "foundation-readonly",
    });
  });

  it("does not invoke the adapter when admission is denied", async () => {
    const invoke = vi.fn(async () => makeRecord());
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        timeout: { supported: false, diagnosticArtifactOnTimeout: false },
      }),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(makeRequest(), adapter);

    expect(result.status).toBe("denied");
    expect(result.decision).toMatchObject({
      status: "denied",
      missingCapabilities: expect.arrayContaining(["timeout.supported"]),
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects direct runtime execution without an admitted decision for the same adapter descriptor", async () => {
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async () => makeRecord()),
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.invokeAdmitted({
      request: makeRequest(),
      adapter,
      admission: {
        status: "denied",
        invocationId: "invocation-1",
        profile: "foundation-readonly-plan",
        reason: "foundation-readonly-plan denied: timeout.supported",
        missingCapabilities: ["timeout.supported"],
      },
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);
  });
});
