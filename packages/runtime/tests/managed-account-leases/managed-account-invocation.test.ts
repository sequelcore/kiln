import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  ManagedAgentRuntimeAdmissionError,
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeAdapter,
} from "../../src/agents/managed-invocation/index.js";

describe("managed account invocation boundary", () => {
  it("fails closed before provider dispatch when no postcommit execution path exists", async () => {
    const invoke = vi.fn();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: defineManagedAgentAdapterDescriptor({
        adapterDescriptorId: "adapter:opencode:managed",
        providerId: "opencode",
        adapterKind: "direct",
        supportedProfiles: ["foundation-readonly-plan"],
        supportedExecutionModes: ["direct-provider"],
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
          tokenClasses: ["input", "output"],
          semanticSourceGranularity: "unknown",
          evidenceBasis: "adapter",
        },
        resultHandoff: { boundedSummary: true, resourcePointers: true },
        credentialRoute: { supported: true },
        memoryContext: { governedAdmission: true },
        unsupportedFieldPolicy: "reject",
        cleanup: { supported: true },
      }),
      invoke,
    };
    const request = defineManagedAgentInvocationRequest({
      invocationId: "agent-task-0001",
      agentId: "reviewer",
      parentSessionId: "parent-session",
      parentTurnId: "parent-turn",
      profile: "foundation-readonly-plan",
      requestedBy: "operator",
      requestSource: "agent-task",
      providerRoute: { providerId: "opencode", model: "sonic", surface: "direct-provider" },
      adapterKind: "direct",
      executionMode: "direct-provider",
      authority: {
        authorityProfileId: "foundation-readonly",
        permissionProfile: "read-only",
        toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false },
        workingDirectory: { path: "C:/workspace/kiln", mode: "read-only" },
        timeoutMs: 1000,
        credentialRoute: {
          mode: "account-leased",
          routeId: "credential-route:opencode:primary",
          accountPolicyId: "managed-opencode",
        },
        memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
      },
      input: { summary: "Inspect the project." },
    });

    await expect(new RuntimeManagedAgentInvocationService().start(request, adapter, {
      capturedAt: "2026-07-31T11:00:00.000Z",
      routeId: "opencode-managed",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow(ManagedAgentRuntimeAdmissionError);
    expect(invoke).not.toHaveBeenCalled();
  });
});
