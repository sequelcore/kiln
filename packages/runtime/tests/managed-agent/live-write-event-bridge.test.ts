import { describe, expect, it } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
} from "@kilnai/core";
import type { ManagedAgentInvocationRequest } from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "../../src/agents/managed-invocation/index.js";
import {
  collectManagedAgentLiveWriteEvidence,
  normalizeManagedAgentLiveWriteChanges,
} from "../../src/agents/managed-invocation/live-write-event-bridge.js";
import type { CliSessionEvent } from "../../src/execution/cli-session-contract.js";

function makeWriteRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-live-write-1",
    agentId: "agent-implementer",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
    profile: "foundation-apply-approved-writes",
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
      authorityProfileId: "foundation-apply-approved",
      permissionProfile: "apply-approved-writes",
      toolAuthority: {
        allowedToolNames: ["read", "rg", "apply-patch"],
        writeAllowed: true,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/Proyectos/Sequel/kiln",
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
        profile: "foundation-apply-approved-writes",
        scope: defineManagedAgentWriteScope({
          workspace: {
            mode: "apply-approved",
            allowedPaths: ["C:/Proyectos/Sequel/kiln/packages/runtime/tests/fixtures"],
            deniedPaths: ["C:/Proyectos/Sequel/kiln/.git"],
          },
          memory: {
            mode: "propose",
            scope: { kind: "project", id: "kiln" },
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
    profile: "foundation-readonly-plan",
    authority: {
      ...makeWriteRequest().authority,
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
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
      writeAuthority: undefined,
    },
  } as ManagedAgentInvocationRequest);
}

function fixtureFileChange(path = "C:/Proyectos/Sequel/kiln/packages/runtime/tests/fixtures/live-write-proof.txt"): Extract<CliSessionEvent, { readonly type: "file_changed" }> {
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
      path: "C:/Proyectos/Sequel/kiln/packages/runtime/tests/fixtures/live-write-proof.txt",
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
      path: "C:/Proyectos/Sequel/kiln/packages/runtime/tests/fixtures/live-write-proof.txt",
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

  it("normalizes Codex-style patch update changes without leaking provider vocabulary into evidence", () => {
    const fileChanges = normalizeManagedAgentLiveWriteChanges([{
      source: "patch-update",
      path: "C:/Proyectos/Sequel/kiln/packages/runtime/tests/fixtures/live-write-proof.txt",
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
      path: "C:/Proyectos/Sequel/kiln/packages/runtime/tests/fixtures/live-write-proof.txt",
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
      fileChanges: [fixtureFileChange("C:/Proyectos/Sequel/kiln/packages/core/src/escape.ts")],
      recordedAt: "2026-05-05T12:00:00.000Z",
    })).toThrow(ManagedAgentRuntimeAdmissionError);
  });
});
