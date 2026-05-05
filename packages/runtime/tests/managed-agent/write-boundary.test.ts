import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
} from "@kilnai/core";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentAdmissionDecision,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  ManagedAgentRuntimeAdmissionError,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";

function makeWriteScope(mode: "propose" | "apply-approved" = "propose") {
  return defineManagedAgentWriteScope({
    workspace: {
      mode,
      allowedPaths: ["C:/Proyectos/Sequel/kiln/packages/core/src/agents/managed-invocation"],
      deniedPaths: ["C:/Proyectos/Sequel/kiln/.git"],
    },
    memory: {
      mode: "propose",
      scope: { kind: "project", id: "kiln" },
      operations: ["create", "update"],
    },
    artifacts: {
      mode: "propose",
      resourceUris: ["kiln://artifacts/managed-agent-write/proposal-1"],
      retention: "session",
    },
    tools: {
      allowedToolNames: ["read", "rg"],
      deniedToolNames: ["git-commit"],
    },
  });
}

function makeRequest(profile: "foundation-propose-writes" | "foundation-apply-approved-writes" = "foundation-propose-writes"): ManagedAgentInvocationRequest {
  const applyApproved = profile === "foundation-apply-approved-writes";
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-write-1",
    agentId: "agent-implementer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    profile,
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
      authorityProfileId: `authority:${profile}`,
      permissionProfile: applyApproved ? "apply-approved-writes" : "propose-writes",
      toolAuthority: {
        allowedToolNames: applyApproved ? ["read", "rg", "apply-patch"] : ["read", "rg"],
        writeAllowed: applyApproved,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/Proyectos/Sequel/kiln",
        mode: applyApproved ? "workspace-write" : "read-only",
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
        profile,
        scope: makeWriteScope(applyApproved ? "apply-approved" : "propose"),
        approval: {
          mode: "required-before-apply",
          evidenceRequired: true,
        },
      }),
    },
    input: {
      summary: "Prepare bounded write authority",
    },
  });
}

function makeDescriptor(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:opencode:harness",
    providerId: "opencode",
    adapterKind: "harness",
    supportedProfiles: ["foundation-readonly-plan", "foundation-propose-writes", "foundation-apply-approved-writes"],
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
    writeAuthority: {
      proposalSupported: true,
      approvedApplySupported: true,
      memoryProposalSupported: true,
      rollbackEvidence: true,
      cleanupEvidence: true,
      scopeReduction: true,
    },
    unsupportedFieldPolicy: "reject",
    cleanup: { supported: true },
    ...overrides,
  });
}

function admitted(request: ManagedAgentInvocationRequest): Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }> {
  return {
    status: "admitted",
    invocationId: request.invocationId,
    profile: request.profile,
    adapterDescriptorId: "adapter:opencode:harness",
    authorityProfileId: request.authority.authorityProfileId,
    credentialRouteId: "credential-route:opencode:primary",
    memoryScope: request.authority.memoryScope.scope,
    writeAuthority: request.authority.writeAuthority,
  };
}

function makeRecord(request: ManagedAgentInvocationRequest): ManagedAgentInvocationRecord {
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
    childSessionId: "child-session-1",
    transcript: {
      uri: "kiln://managed-invocations/invocation-write-1/transcript",
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
      summary: "Write proposal returned.",
      resourceUris: ["kiln://managed-invocations/invocation-write-1/transcript"],
      memoryWriteProposalUris: ["kiln://memory/proposals/write-proposal-1"],
    },
  });
}

describe("managed agent runtime write boundary", () => {
  it("rejects direct write execution when the admitted decision omits write authority", async () => {
    const request = makeRequest();
    const invoke = vi.fn(async () => makeRecord(request));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService();
    const forgedAdmission = {
      ...admitted(request),
      writeAuthority: undefined,
    } as Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;

    await expect(service.invokeAdmitted({
      request,
      adapter,
      admission: forgedAdmission,
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects direct approved-write execution when the runtime adapter descriptor cannot apply approved writes", async () => {
    const request = makeRequest("foundation-apply-approved-writes");
    const invoke = vi.fn(async () => makeRecord(request));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        writeAuthority: {
          proposalSupported: true,
          approvedApplySupported: false,
          memoryProposalSupported: true,
          rollbackEvidence: true,
          cleanupEvidence: true,
          scopeReduction: true,
        },
      }),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.invokeAdmitted({
      request,
      adapter,
      admission: admitted(request),
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects adapter records that broaden the admitted write authority after invocation", async () => {
    const request = makeRequest();
    const broadenedRequest = makeRequest("foundation-apply-approved-writes");
    const invoke = vi.fn(async () => makeRecord({
      ...request,
      authority: {
        ...request.authority,
        toolAuthority: broadenedRequest.authority.toolAuthority,
        workingDirectory: broadenedRequest.authority.workingDirectory,
        writeAuthority: broadenedRequest.authority.writeAuthority,
      },
    } as ManagedAgentInvocationRequest));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.invokeAdmitted({
      request,
      adapter,
      admission: admitted(request),
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
