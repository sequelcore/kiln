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
  ManagedAgentInvocationRequest,
} from "../../src/agents/managed-invocation/index.js";

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

function makeDescriptor(): ManagedAgentAdapterDescriptor {
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
      summary: "Prepare bounded managed-agent write authority",
    },
  });
}

describe("managed agent write admission policy", () => {
  it("admits provider-neutral write proposals only when request scope and descriptor capabilities are explicit", () => {
    const decision = evaluateManagedAgentAdmission(makeRequest(), makeDescriptor());

    expect(decision).toMatchObject({
      status: "admitted",
      invocationId: "invocation-write-1",
      profile: "foundation-propose-writes",
      adapterDescriptorId: "adapter:opencode:harness",
      authorityProfileId: "authority:foundation-propose-writes",
      writeAuthority: {
        profile: "foundation-propose-writes",
        scope: {
          workspace: {
            mode: "propose",
          },
        },
      },
    });
  });

  it("keeps foundation-readonly-plan fail-closed when any write authority is requested", () => {
    const request = {
      ...makeRequest(),
      profile: "foundation-readonly-plan",
      authority: {
        ...makeRequest().authority,
        authorityProfileId: "authority:readonly-with-write-request",
      },
    } as ManagedAgentInvocationRequest;

    const decision = evaluateManagedAgentAdmission(request, makeDescriptor());

    expect(decision.status).toBe("denied");
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

    const decision = evaluateManagedAgentAdmission(makeRequest("foundation-apply-approved-writes"), descriptor);

    expect(decision.status).toBe("denied");
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
      ...makeRequest("foundation-apply-approved-writes"),
      authority: {
        ...makeRequest("foundation-apply-approved-writes").authority,
        toolAuthority: {
          ...makeRequest("foundation-apply-approved-writes").authority.toolAuthority,
          writeAllowed: false,
        },
        workingDirectory: {
          ...makeRequest("foundation-apply-approved-writes").authority.workingDirectory,
          mode: "read-only",
        },
        writeAuthority: defineManagedAgentWriteAuthority({
          profile: "foundation-apply-approved-writes",
          scope: makeWriteScope("apply-approved"),
          approval: {
            mode: "none",
            evidenceRequired: false,
          },
        }),
      },
    } as ManagedAgentInvocationRequest;

    const decision = evaluateManagedAgentAdmission(request, makeDescriptor());

    expect(decision.status).toBe("denied");
    expect(decision.missingCapabilities).toEqual(expect.arrayContaining([
      "request.authority.toolAuthority.writeAllowed.true",
      "request.authority.workingDirectory.writable",
      "request.authority.writeAuthority.approval.requiredBeforeApply",
    ]));
  });
});
