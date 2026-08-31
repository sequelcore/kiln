import { describe, expect, it } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAttempt,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteDecision,
  defineManagedAgentWriteEvidence,
  defineManagedAgentWriteProposal,
  defineManagedAgentWriteScope,
} from "../../src/agents/managed-invocation/index.js";
import type {
  ManagedAgentInvocationRequest,
  ManagedAgentWriteProposal,
} from "../../src/agents/managed-invocation/index.js";

function makeWriteScope() {
  return defineManagedAgentWriteScope({
    workspace: {
      mode: "propose",
      allowedPaths: ["C:/workspace/kiln/packages/core/src"],
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

describe("managed agent write authority contracts", () => {
  it("defines provider-neutral write scope and authority separate from read-only invocation authority", () => {
    const writeAuthority = defineManagedAgentWriteAuthority({
      scope: makeWriteScope(),
      approval: {
        mode: "required-before-apply",
        evidenceRequired: true,
      },
    });

    const request: ManagedAgentInvocationRequest = defineManagedAgentInvocationRequest({
      invocationId: "invocation-write-1",
      agentId: "agent-implementer",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      access: "propose",
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
        authorityProfileId: "authority:write-proposal",
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
          access: "write-proposals",
        },
        writeAuthority,
      },
      input: {
        summary: "Propose bounded write changes for Slice 2",
      },
    });

    expect(request.access).toBe("propose");
    expect(request.authority.toolAuthority.writeAllowed).toBe(false);
    expect(request.authority.writeAuthority).toMatchObject({
      scope: {
        workspace: {
          mode: "propose",
          allowedPaths: ["C:/workspace/kiln/packages/core/src"],
        },
        memory: {
          operations: ["create", "update"],
        },
      },
      approval: {
        mode: "required-before-apply",
        evidenceRequired: true,
      },
    });
  });

  it("records proposals, decisions, attempts, and replay evidence without provider-native vocabulary", () => {
    const proposal: ManagedAgentWriteProposal = defineManagedAgentWriteProposal({
      proposalId: "write-proposal-1",
      invocationId: "invocation-write-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      childSessionId: "child-session",
      target: {
        kind: "workspace-path",
        path: "C:/workspace/kiln/packages/core/src/agents/managed-invocation/index.ts",
      },
      summary: "Add write authority contracts",
      evidenceUris: ["kiln://artifacts/invocation-write-1/proposal"],
      risk: {
        level: "medium",
        reasons: ["core contract expansion"],
      },
      createdAt: "2026-05-04T00:00:00.000Z",
    });
    const decision = defineManagedAgentWriteDecision({
      decisionId: "write-decision-1",
      proposalId: proposal.proposalId,
      invocationId: proposal.invocationId,
      status: "approved",
      decidedBy: "operator",
      reason: "Scope is bounded to managed-invocation contracts",
      scope: makeWriteScope(),
      decidedAt: "2026-05-04T00:01:00.000Z",
    });
    const attempt = defineManagedAgentWriteAttempt({
      attemptId: "write-attempt-1",
      proposalId: proposal.proposalId,
      decisionId: decision.decisionId,
      invocationId: proposal.invocationId,
      status: "completed",
      target: proposal.target,
      evidenceUris: ["kiln://artifacts/invocation-write-1/write-attempt"],
      cleanupStatus: "not-required",
    });
    const evidence = defineManagedAgentWriteEvidence({
      evidenceId: "write-evidence-1",
      invocationId: proposal.invocationId,
      kind: "write-attempt-completed",
      proposalId: proposal.proposalId,
      decisionId: decision.decisionId,
      attemptId: attempt.attemptId,
      summary: "Write attempt completed under approved scope",
      resourceUris: ["kiln://artifacts/invocation-write-1/write-attempt"],
      recordedAt: "2026-05-04T00:02:00.000Z",
    });

    expect(proposal.target.kind).toBe("workspace-path");
    expect(decision.status).toBe("approved");
    expect(attempt.cleanupStatus).toBe("not-required");
    expect(evidence.kind).toBe("write-attempt-completed");
    expect(JSON.stringify({ proposal, decision, attempt, evidence })).not.toMatch(/\bsubagent\b|\bteam\b|\bfork\b/);
  });

  it("rejects ambiguous write scopes before admission can grant authority", () => {
    expect(() => defineManagedAgentWriteScope({
      workspace: {
        mode: "propose",
        allowedPaths: [" "],
        deniedPaths: [],
      },
      memory: { operations: [] },
      artifacts: { mode: "none", resourceUris: [], retention: "none" },
      tools: { allowedToolNames: [], deniedToolNames: [] },
    })).toThrow("Managed write workspace path is required");
  });
});
