import { describe, expect, it } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core/agents";
import type { ExecutionSessionEvent } from "@kilnai/core/events";
import { ManagedAgentRuntimeAdmissionError } from "../../src/agents/managed-invocation/index.js";
import {
  collectManagedAgentLiveWriteEvidence,
  collectManagedAgentLiveWriteDecisionEvidence,
  normalizeManagedAgentLiveWriteChanges,
} from "../../src/agents/managed-invocation/live-write-event-bridge.js";

function makeWriteRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-live-write-1",
    agentId: "agent-implementer",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
    access: "approved-write",
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
      authorityProfileId: "approved-write",
      toolAuthority: {
        allowedToolNames: ["read", "rg", "apply-patch"],
        writeAllowed: true,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "workspace-write",
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
        scope: defineManagedAgentWriteScope({
          workspace: {
            mode: "apply-approved",
            allowedPaths: ["C:/workspace/kiln/packages/runtime/tests/fixtures"],
            deniedPaths: ["C:/workspace/kiln/.git"],
          },
          memory: {
            operations: ["create", "update"],
          },
          artifacts: {
            mode: "propose",
            resourceUris: ["kiln://managed-invocations/invocation-live-write-1/write"],
            retention: "session",
          },
          tools: {
            allowedToolNames: ["read", "rg", "apply-patch"],
            deniedToolNames: ["git-commit"],
          },
        }),
        approval: {
          mode: "policy-approved",
          evidenceRequired: true,
          approver: "operator",
          evidenceUris: ["kiln://managed-invocations/invocation-live-write-1/approval"],
        },
      }),
    },
    input: {
      summary: "Apply an approved live fixture update.",
      prompt: "Apply only the approved fixture update and report evidence.",
    },
  });
}

function makeReadOnlyRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    ...makeWriteRequest(),
    access: "read-only",
    authority: {
      ...makeWriteRequest().authority,
      authorityProfileId: "read-only",
      toolAuthority: {
        allowedToolNames: ["read", "rg"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "read-only",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
      writeAuthority: undefined,
    },
  } as ManagedAgentInvocationRequest);
}

function fixtureFileChange(path = "C:/workspace/kiln/packages/runtime/tests/fixtures/live-write-proof.txt"): Extract<ExecutionSessionEvent, { readonly type: "file_changed" }> {
  return {
    type: "file_changed",
    path,
    changeType: "modified",
    linesAdded: 1,
    linesRemoved: 0,
    diffPreview: "diff --git a/live-write-proof.txt b/live-write-proof.txt",
    diffTruncated: true,
  };
}

describe("managed agent live write event bridge", () => {
  it("turns admitted live file changes into proposal, approval, and attempt evidence without inline raw diffs", () => {
    const result = collectManagedAgentLiveWriteEvidence({
      request: makeWriteRequest(),
      fileChanges: [fixtureFileChange()],
      recordedAt: "2026-05-05T12:00:00.000Z",
    });

    expect(result.evidence.map((evidence) => evidence.kind)).toEqual([
      "write-proposal-created",
      "write-proposal-approved",
      "write-attempt-completed",
    ]);
    expect(result.attemptResourceUris).toEqual([
      "kiln://managed-invocations/invocation-live-write-1/write-attempts/1",
    ]);
    expect(JSON.stringify(result.evidence)).not.toContain("diff --git");
  });

  it("normalizes OpenCode-style session diff changes before collecting write evidence", () => {
    const fileChanges = normalizeManagedAgentLiveWriteChanges([{
      source: "session-diff",
      path: "C:/workspace/kiln/packages/runtime/tests/fixtures/live-write-proof.txt",
      changeType: "modified",
      linesAdded: 2,
      linesRemoved: 1,
      diffPreview: "diff --git a/live-write-proof.txt b/live-write-proof.txt",
      diffTruncated: true,
    }]);

    const result = collectManagedAgentLiveWriteEvidence({
      request: makeWriteRequest(),
      fileChanges,
      recordedAt: "2026-05-05T12:00:00.000Z",
    });

    expect(fileChanges).toEqual([{
      type: "file_changed",
      path: "C:/workspace/kiln/packages/runtime/tests/fixtures/live-write-proof.txt",
      changeType: "modified",
      linesAdded: 2,
      linesRemoved: 1,
      diffPreview: "diff --git a/live-write-proof.txt b/live-write-proof.txt",
      diffTruncated: true,
    }]);
    expect(result.evidence.map((evidence) => evidence.kind)).toEqual([
      "write-proposal-created",
      "write-proposal-approved",
      "write-attempt-completed",
    ]);
  });

  it("collapses repeated live file events for the same canonical path into one write attempt", () => {
    const result = collectManagedAgentLiveWriteEvidence({
      request: makeWriteRequest(),
      fileChanges: [
        fixtureFileChange("C:/workspace/kiln/packages/runtime/tests/fixtures/live-write-proof.txt"),
        {
          ...fixtureFileChange("C:\\workspace\\kiln\\packages\\runtime\\tests\\fixtures\\live-write-proof.txt"),
          resourceUris: ["kiln://managed-invocations/invocation-live-write-1/diffs/opencode-1"],
        },
        {
          ...fixtureFileChange("C:/workspace/kiln/packages/runtime/tests/fixtures/./live-write-proof.txt"),
          resourceUris: ["kiln://managed-invocations/invocation-live-write-1/diffs/opencode-2"],
        },
      ],
      recordedAt: "2026-05-05T12:00:00.000Z",
    });

    expect(result.evidence.map((evidence) => evidence.kind)).toEqual([
      "write-proposal-created",
      "write-proposal-approved",
      "write-attempt-completed",
    ]);
    expect(result.attemptResourceUris).toEqual([
      "kiln://managed-invocations/invocation-live-write-1/write-attempts/1",
      "kiln://managed-invocations/invocation-live-write-1/diffs/opencode-1",
      "kiln://managed-invocations/invocation-live-write-1/diffs/opencode-2",
    ]);
  });

  it("normalizes Codex-style patch update changes without leaking provider vocabulary into evidence", () => {
    const fileChanges = normalizeManagedAgentLiveWriteChanges([{
      source: "patch-update",
      path: "C:/workspace/kiln/packages/runtime/tests/fixtures/live-write-proof.txt",
      changeType: "modified",
      linesAdded: 1,
      linesRemoved: 0,
      diffPreview: "*** Begin Patch\n*** Update File: live-write-proof.txt",
      diffTruncated: true,
    }]);

    const result = collectManagedAgentLiveWriteEvidence({
      request: makeWriteRequest(),
      fileChanges,
      recordedAt: "2026-05-05T12:00:00.000Z",
    });

    expect(fileChanges[0]).toMatchObject({
      type: "file_changed",
      path: "C:/workspace/kiln/packages/runtime/tests/fixtures/live-write-proof.txt",
      changeType: "modified",
    });
    expect(fileChanges[0]).not.toHaveProperty("source");
    expect(JSON.stringify(result.evidence)).not.toContain("Patch");
    expect(result.attemptResourceUris).toEqual([
      "kiln://managed-invocations/invocation-live-write-1/write-attempts/1",
    ]);
  });

  it("rejects live file changes for read-only managed invocations", () => {
    expect(() => collectManagedAgentLiveWriteEvidence({
      request: makeReadOnlyRequest(),
      fileChanges: [fixtureFileChange()],
      recordedAt: "2026-05-05T12:00:00.000Z",
    })).toThrow(ManagedAgentRuntimeAdmissionError);
  });

  it("rejects live file changes outside the admitted workspace scope", () => {
    expect(() => collectManagedAgentLiveWriteEvidence({
      request: makeWriteRequest(),
      fileChanges: [fixtureFileChange("C:/workspace/kiln/packages/core/src/escape.ts")],
      recordedAt: "2026-05-05T12:00:00.000Z",
    })).toThrow(ManagedAgentRuntimeAdmissionError);
  });

  it("normalizes approved live permission decisions into write approval evidence", () => {
    const evidence = collectManagedAgentLiveWriteDecisionEvidence({
      request: makeWriteRequest(),
      decisions: [{
        source: "patch-approval",
        status: "approved",
        providerRequestId: "codex-approval-1",
        actor: "operator",
        reason: "Approved bounded fixture update.",
      }],
      recordedAt: "2026-05-05T12:00:00.000Z",
    });

    expect(evidence).toEqual([{
      evidenceId: "invocation-live-write-1:write-decision:codex-approval-1:evidence",
      invocationId: "invocation-live-write-1",
      kind: "write-proposal-approved",
      proposalId: "invocation-live-write-1:write-proposal:codex-approval-1",
      decisionId: "invocation-live-write-1:write-decision:codex-approval-1",
      summary: "Live write decision approved by operator: Approved bounded fixture update.",
      resourceUris: ["kiln://managed-invocations/invocation-live-write-1/write-decisions/codex-approval-1"],
      recordedAt: "2026-05-05T12:00:00.000Z",
    }]);
    expect(JSON.stringify(evidence)).not.toContain("patch-approval");
  });

  it("normalizes denied live permission decisions into proposal denial evidence", () => {
    const evidence = collectManagedAgentLiveWriteDecisionEvidence({
      request: makeWriteRequest(),
      decisions: [{
        source: "permission-event",
        status: "denied",
        providerRequestId: "opencode-permission-1",
        actor: "operator",
        reason: "Denied edit outside the requested task.",
      }],
      recordedAt: "2026-05-05T12:00:00.000Z",
    });

    expect(evidence).toEqual([{
      evidenceId: "invocation-live-write-1:write-decision:opencode-permission-1:evidence",
      invocationId: "invocation-live-write-1",
      kind: "write-proposal-denied",
      proposalId: "invocation-live-write-1:write-proposal:opencode-permission-1",
      decisionId: "invocation-live-write-1:write-decision:opencode-permission-1",
      summary: "Live write decision denied by operator: Denied edit outside the requested task.",
      resourceUris: ["kiln://managed-invocations/invocation-live-write-1/write-decisions/opencode-permission-1"],
      recordedAt: "2026-05-05T12:00:00.000Z",
    }]);
    expect(JSON.stringify(evidence)).not.toContain("permission-event");
  });

  it("records read-only live write permission denials as write-authority denied evidence", () => {
    const evidence = collectManagedAgentLiveWriteDecisionEvidence({
      request: makeReadOnlyRequest(),
      decisions: [{
        source: "permission-event",
        status: "denied",
        providerRequestId: "readonly-permission-1",
        actor: "kiln-policy",
        reason: "Read-only managed invocation cannot write.",
      }],
      recordedAt: "2026-05-05T12:00:00.000Z",
    });

    expect(evidence).toEqual([{
      evidenceId: "invocation-live-write-1:write-authority-denied:readonly-permission-1",
      invocationId: "invocation-live-write-1",
      kind: "write-authority-denied",
      summary: "Live write authority denied by kiln-policy: Read-only managed invocation cannot write.",
      resourceUris: ["kiln://managed-invocations/invocation-live-write-1/write-denials/readonly-permission-1"],
      recordedAt: "2026-05-05T12:00:00.000Z",
    }]);
  });

  it("rejects approved live permission decisions without admitted write authority", () => {
    expect(() => collectManagedAgentLiveWriteDecisionEvidence({
      request: makeReadOnlyRequest(),
      decisions: [{
        source: "patch-approval",
        status: "approved",
        providerRequestId: "readonly-approval-1",
        actor: "operator",
        reason: "Provider attempted to approve a read-only write.",
      }],
      recordedAt: "2026-05-05T12:00:00.000Z",
    })).toThrow(ManagedAgentRuntimeAdmissionError);
  });
});
