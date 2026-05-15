import { describe, expect, it } from "vitest";
import type {
  ContextAuditEntry,
  ManagedAgentInvocationRequest,
  ManagedAgentMemoryScope,
} from "@kilnai/core";
import { defineManagedAgentInvocationRequest } from "@kilnai/core";
import {
  ManagedAgentRuntimeAdmissionError,
  admitManagedChildContextAndCredentials,
} from "../../src/agents/managed-invocation/index.js";

function makeRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-ctx-1",
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
      summary: "Inspect managed invocation contract",
      prompt: "Only read and report findings.",
    },
  });
}

function makeAudit(): ContextAuditEntry {
  return {
    governor: "DefaultContextGovernor",
    selectedBlockIds: ["memory:block-1"],
    deferredBlockIds: ["memory:block-2"],
    requiredBlockIds: [],
    preservedRequiredBlockIds: [],
    selectedTokens: 38,
    requiredTokens: 0,
    tokenBudget: 256,
    overflow: false,
    blocks: [
      {
        id: "memory:block-1",
        kind: "memory",
        source: "memory-repository",
        required: false,
        estimatedTokens: 38,
        baseScore: 80,
        effectiveScore: 80,
        decision: "admitted",
        reason: "within-budget",
        order: 0,
      },
    ],
  };
}

function makeMemoryScope(access: ManagedAgentMemoryScope["access"]): ManagedAgentMemoryScope {
  return {
    scope: { kind: "project", id: "child-kiln" },
    access,
  };
}

describe("admitManagedChildContextAndCredentials", () => {
  it("uses DefaultContextGovernor audit evidence and emits credential route ids", () => {
    const result = admitManagedChildContextAndCredentials({
      request: makeRequest(),
      governedContext: {
        content: "Governed context for child invocation",
        audit: makeAudit(),
      },
      explicitAuthority: {
        memoryScope: makeMemoryScope("read-only"),
        writeAllowed: false,
      },
      credentialRoute: {
        routeId: "credential-route:opencode:primary",
      },
    });

    expect(result.evidence.context.governor).toBe("DefaultContextGovernor");
    expect(result.evidence.context.selectedBlockIds).toEqual(["memory:block-1"]);
    expect(result.evidence.credentialRouteId).toBe("credential-route:opencode:primary");
    expect(result.childRequest.input.prompt).toContain("--- Governed Context ---");
    expect(result.childRequest.input.prompt).toContain("Governed context for child invocation");
  });

  it("rejects context that does not include a DefaultContextGovernor audit", () => {
    expect(() => admitManagedChildContextAndCredentials({
      request: makeRequest(),
      governedContext: {
        content: "raw context without governor evidence",
      },
      explicitAuthority: {
        memoryScope: makeMemoryScope("read-only"),
        writeAllowed: false,
      },
      credentialRoute: {
        routeId: "credential-route:opencode:primary",
      },
    })).toThrowError(ManagedAgentRuntimeAdmissionError);
  });

  it("does not copy secret values into the child request or admission evidence", () => {
    const secret = "openai_api_key_secret_value";
    const result = admitManagedChildContextAndCredentials({
      request: makeRequest(),
      governedContext: {
        content: "Child context body",
        audit: makeAudit(),
      },
      explicitAuthority: {
        memoryScope: makeMemoryScope("read-only"),
        writeAllowed: false,
      },
      credentialRoute: {
        routeId: "credential-route:opencode:primary",
        secretValues: [secret],
      },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(result.evidence.credentialRouteId).toBe("credential-route:opencode:primary");
  });

  it("requires explicit child memory/write authority and never infers parent scope", () => {
    expect(() => admitManagedChildContextAndCredentials({
      request: makeRequest(),
      governedContext: {
        content: "Child context body",
        audit: makeAudit(),
      },
      explicitAuthority: {
        writeAllowed: false,
      },
      parentAuthoritySnapshot: {
        memoryScope: makeMemoryScope("write-proposals"),
        writeAllowed: true,
      },
      credentialRoute: {
        routeId: "credential-route:opencode:primary",
      },
    })).toThrowError(ManagedAgentRuntimeAdmissionError);
  });
});
