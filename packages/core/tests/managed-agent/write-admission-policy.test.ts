import { describe, expect, it } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  evaluateManagedAgentAdmission,
} from "../../src/agents/managed-invocation/index.js";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentInvocationRequest,
} from "../../src/agents/managed-invocation/index.js";

function makeWriteScope(mode: "propose" | "apply-approved" = "propose") {
  return defineManagedAgentWriteScope({
    workspace: {
      mode,
      allowedPaths: ["C:/workspace/kiln/packages/core/src/agents/managed-invocation"],
      deniedPaths: ["C:/workspace/kiln/.git"],
    },
    memory: {
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

function makeDescriptor(): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:opencode:harness",
    providerId: "opencode",
    adapterKind: "harness",
    supportedAccess: ["read-only", "propose", "approved-write"],
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
    writeAuthority: {
      proposalSupported: true,
      approvedApplySupported: true,
      memoryProposalSupported: true,
      rollbackEvidence: true,
      cleanupEvidence: true,
      scopeReduction: true,
    },
  });
}

function makeRequest(access: "propose" | "approved-write" = "propose"): ManagedAgentInvocationRequest {
  const applyApproved = access === "approved-write";
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-write-1",
    agentId: "agent-implementer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    access,
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
      authorityProfileId: `authority:${access}`,
      toolAuthority: {
        allowedToolNames: applyApproved ? ["read", "rg", "apply-patch"] : ["read", "rg"],
        writeAllowed: applyApproved,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
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
        scope: makeWriteScope(applyApproved ? "apply-approved" : "propose"),
        approval: {
          mode: "required-before-apply",
          evidenceRequired: true,
        },
      }),
    },
    input: {
      summary: "Prepare bounded managed-agent write authority",
    },
  });
}

function makeSnapshotInput(): ManagedAgentCapabilitySnapshotInput {
  return {
    routeId: "opencode-write",
    routeSource: "explicit-managed-route",
  };
}

describe("managed agent write admission policy", () => {
  it("admits provider-neutral write proposals only when request scope and descriptor capabilities are explicit", () => {
    const decision = evaluateManagedAgentAdmission(makeRequest(), makeDescriptor(), makeSnapshotInput());

    expect(decision).toMatchObject({
      status: "admitted",
      invocationId: "invocation-write-1",
      access: "propose",
      adapterDescriptorId: "adapter:opencode:harness",
      authorityProfileId: "authority:propose",
      writeAuthority: {
        scope: {
          workspace: {
            mode: "propose",
          },
        },
      },
    });
  });

  it("denies network authority on write profiles unless a future combined authority profile is introduced", () => {
    const base = makeRequest("approved-write");
    const request = defineManagedAgentInvocationRequest({
      ...base,
      authority: {
        ...base.authority,
        toolAuthority: {
          ...base.authority.toolAuthority,
          allowedToolNames: [
            ...base.authority.toolAuthority.allowedToolNames,
            "web_search",
            "browser_session_start",
            "browser_observe",
          ],
          networkAllowed: true,
        },
      },
    });

    const decision = evaluateManagedAgentAdmission(request, makeDescriptor(), makeSnapshotInput());

    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") throw new Error("expected denied admission");
    expect(decision.missingCapabilities).toContain("request.authority.toolAuthority.networkAllowed.false");
  });

  it("keeps read-only access fail-closed when any write authority is requested", () => {
    const request = {
      ...makeRequest(),
      access: "read-only",
      authority: {
        ...makeRequest().authority,
        authorityProfileId: "authority:readonly-with-write-request",
      },
    } as ManagedAgentInvocationRequest;

    const decision = evaluateManagedAgentAdmission(request, makeDescriptor(), makeSnapshotInput());

    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") throw new Error("expected denied admission");
    expect(decision.missingCapabilities).toContain("request.authority.writeAuthority.none");
  });

  it("denies write profiles when adapter capabilities cannot propose, apply approved writes, reduce scope, or report cleanup evidence", () => {
    const descriptor = {
      ...makeDescriptor(),
      writeAuthority: {
        proposalSupported: false,
        approvedApplySupported: false,
        memoryProposalSupported: false,
        rollbackEvidence: false,
        cleanupEvidence: false,
        scopeReduction: false,
      },
    };

    const decision = evaluateManagedAgentAdmission(makeRequest("approved-write"), descriptor, makeSnapshotInput());

    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") throw new Error("expected denied admission");
    expect(decision.missingCapabilities).toEqual(expect.arrayContaining([
      "writeAuthority.proposalSupported",
      "writeAuthority.approvedApplySupported",
      "writeAuthority.memoryProposalSupported",
      "writeAuthority.cleanupEvidence",
      "writeAuthority.scopeReduction",
    ]));
  });

  it("denies approved-write requests without actual write tooling, writable workspace, and approval evidence requirements", () => {
    const request = {
      ...makeRequest("approved-write"),
      authority: {
        ...makeRequest("approved-write").authority,
        toolAuthority: {
          ...makeRequest("approved-write").authority.toolAuthority,
          writeAllowed: false,
        },
        workingDirectory: {
          ...makeRequest("approved-write").authority.workingDirectory,
          mode: "read-only",
        },
        writeAuthority: defineManagedAgentWriteAuthority({
          scope: makeWriteScope("apply-approved"),
          approval: {
            mode: "none",
            evidenceRequired: false,
          },
        }),
      },
    } as ManagedAgentInvocationRequest;

    const decision = evaluateManagedAgentAdmission(request, makeDescriptor(), makeSnapshotInput());

    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") throw new Error("expected denied admission");
    expect(decision.missingCapabilities).toEqual(expect.arrayContaining([
      "request.authority.toolAuthority.writeAllowed.true",
      "request.authority.workingDirectory.writable",
      "request.authority.writeAuthority.approval.requiredBeforeApply",
    ]));
  });
});
