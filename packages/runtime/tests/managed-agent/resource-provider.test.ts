import { describe, expect, it } from "vitest";
import {
  createManagedAgentInvocationResourceProvider,
  type ManagedAgentRuntimeInvocationSnapshot,
} from "../../src/agents/managed-invocation/index.js";

describe("createManagedAgentInvocationResourceProvider", () => {
  it("lists managed child invocation transcript and handoff resources", async () => {
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [managedInvocationSnapshot()],
      },
    });

    expect(provider.listResources().map((resource) => resource.uri)).toEqual([
      "kiln://managed-agents/invocations",
      "kiln://managed-agents/invocations/child-1",
      "kiln://managed-agents/invocations/child-1/transcript",
      "kiln://managed-agents/invocations/child-1/handoff",
      "kiln://managed-agents/invocations/child-1/resources",
    ]);
    expect(provider.listTemplates().map((template) => template.uriTemplate)).toContain(
      "kiln://managed-agents/invocations/{invocationId}/transcript",
    );

    const aggregate = await provider.read("kiln://managed-agents/invocations");
    expect(JSON.parse(aggregate!.contents[0]!.text)).toMatchObject({
      total: 1,
      invocations: [{
        invocationId: "child-1",
        lifecycleState: "completed",
        transcriptUri: "kiln://artifacts/child-1/transcript",
        handoffResourceUris: ["kiln://artifacts/child-1/handoff"],
        resourceUris: expect.arrayContaining([
          "kiln://artifacts/child-1/record-worktree-review",
          "kiln://artifacts/child-1/record-worktree-review-required",
          "kiln://artifacts/child-1/shared-worktree-review",
          "kiln://artifacts/child-1/record-capability-worktree-review-required",
          "kiln://artifacts/child-1/decision-worktree-review-required",
        ]),
      }],
    });

    const transcript = await provider.read("kiln://managed-agents/invocations/child-1/transcript");
    expect(JSON.parse(transcript!.contents[0]!.text)).toEqual({
      invocationId: "child-1",
      transcript: {
        uri: "kiln://artifacts/child-1/transcript",
        format: "jsonl",
        redaction: "redacted",
        truncated: false,
      },
    });

    const resources = await provider.read("kiln://managed-agents/invocations/child-1/resources");
    expect(JSON.parse(resources!.contents[0]!.text)).toEqual({
      invocationId: "child-1",
      resourceUris: [
        "kiln://artifacts/child-1/transcript",
        "kiln://artifacts/child-1/handoff",
        "kiln://artifacts/child-1/worktree",
        "kiln://artifacts/child-1/diagnostics",
        "kiln://artifacts/child-1/record-worktree-review",
        "kiln://artifacts/child-1/record-worktree-review-required",
        "kiln://artifacts/child-1/shared-worktree-review",
        "kiln://artifacts/child-1/record-capability-worktree-review-required",
        "kiln://artifacts/child-1/decision-worktree-review-required",
      ],
    });
    const resourceUris = JSON.parse(resources!.contents[0]!.text).resourceUris as readonly string[];
    expect(resourceUris.filter((uri) => uri === "kiln://artifacts/child-1/shared-worktree-review")).toHaveLength(1);

    const invocation = await provider.read("kiln://managed-agents/invocations/child-1");
    const invocationPayload = JSON.parse(invocation!.contents[0]!.text);
    expect(invocationPayload).toMatchObject({
      invocation: {
        invocationId: "child-1",
        lifecycleState: "completed",
        request: {
          summary: "Review Slice 5A.",
          profile: "foundation-apply-approved-writes",
          requestedBy: "operator",
          requestSource: "test",
        },
        admission: {
          status: "admitted",
        },
        resourceUris: expect.arrayContaining([
          "kiln://artifacts/child-1/record-worktree-review",
          "kiln://artifacts/child-1/record-worktree-review-required",
          "kiln://artifacts/child-1/shared-worktree-review",
          "kiln://artifacts/child-1/record-capability-worktree-review-required",
          "kiln://artifacts/child-1/decision-worktree-review-required",
        ]),
      },
    });
    expect(invocationPayload.invocation.record).toBeUndefined();
    expect(invocationPayload.invocation.decision).toBeUndefined();
  });

  it("replays terminal diagnostic pointers even when handoff and lease omit them", async () => {
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [managedInvocationWithTerminalDiagnostic()],
      },
    });

    const aggregate = await provider.read("kiln://managed-agents/invocations");
    expect(JSON.parse(aggregate!.contents[0]!.text)).toMatchObject({
      total: 1,
      invocations: [{
        invocationId: "child-timeout",
        lifecycleState: "timed_out",
        diagnosticResourceUris: ["kiln://managed-invocations/child-timeout/timeout"],
        resourceUris: expect.arrayContaining([
          "kiln://managed-invocations/child-timeout/timeout",
        ]),
      }],
    });

    const invocation = await provider.read("kiln://managed-agents/invocations/child-timeout");
    expect(JSON.parse(invocation!.contents[0]!.text)).toMatchObject({
      invocation: {
        invocationId: "child-timeout",
        lifecycleState: "timed_out",
        diagnostics: [{
          uri: "kiln://managed-invocations/child-timeout/timeout",
          kind: "timeout",
        }],
      },
    });

    const resources = await provider.read("kiln://managed-agents/invocations/child-timeout/resources");
    expect(JSON.parse(resources!.contents[0]!.text)).toMatchObject({
      invocationId: "child-timeout",
      resourceUris: expect.arrayContaining([
        "kiln://managed-invocations/child-timeout/timeout",
      ]),
    });
  });

  it("returns undefined for unknown managed child resource URIs", async () => {
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [],
      },
    });

    await expect(provider.read("kiln://managed-agents/invocations/missing")).resolves.toBeUndefined();
    await expect(provider.read("kiln://managed-agents/invocations/%E0%A4%A")).resolves.toBeUndefined();
    await expect(provider.read("kiln://session/work-items")).resolves.toBeUndefined();
  });
});

function managedInvocationSnapshot(): ManagedAgentRuntimeInvocationSnapshot {
  return {
    invocationId: "child-1",
    agentId: "agent-reviewer",
    parentSessionId: "parent-session",
    parentTurnId: "parent-turn",
    profile: "foundation-apply-approved-writes",
    providerRoute: {
      providerId: "codex",
      model: "gpt-5.5",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authorityProfileId: "authority:test",
    lifecycleState: "completed",
    startedAt: "2026-05-22T00:00:00.000Z",
    finishedAt: "2026-05-22T00:00:05.000Z",
    durationMs: 5000,
    request: {
      invocationId: "child-1",
      agentId: "agent-reviewer",
      parentSessionId: "parent-session",
      parentTurnId: "parent-turn",
      profile: "foundation-apply-approved-writes",
      requestedBy: "operator",
      requestSource: "test",
      requestedAuthority: "audited",
      providerRoute: {
        providerId: "codex",
        model: "gpt-5.5",
      },
      adapterKind: "harness",
      executionMode: "cli-harness",
      authority: {
        workingDirectory: {
          mode: "isolated-worktree",
          path: "C:/repo/.kiln/worktrees/child-1",
        },
      },
      input: {
        summary: "Review Slice 5A.",
        context: {
          mode: "resources",
        },
        resourceUris: ["kiln://session/work-items/work-1"],
        handoff: {
          expectedEvidence: ["tests"],
        },
      },
    } as ManagedAgentRuntimeInvocationSnapshot["request"],
    decision: {
      status: "admitted",
      reason: "admitted",
      capabilitySnapshot: {
        resourceLease: {
          leaseId: "child-1:lease",
          createdAt: "2026-05-22T00:00:00.000Z",
          healthStatus: "healthy",
          cleanupStatus: "not-required",
          workingDirectoryPath: "C:/repo/.kiln/worktrees/child-1",
          workingDirectoryMode: "isolated-worktree",
          resourceUris: ["kiln://artifacts/child-1/worktree"],
          diagnosticUris: [],
          worktreeReview: {
            status: "required",
            reason: "dirty-worktree-preserved",
            resourceUris: ["kiln://artifacts/child-1/shared-worktree-review"],
            diagnosticUris: ["kiln://artifacts/child-1/decision-worktree-review-required"],
          },
        },
      },
    } as ManagedAgentRuntimeInvocationSnapshot["decision"],
    record: {
      invocationId: "child-1",
      agentId: "agent-reviewer",
      parentSessionId: "parent-session",
      parentTurnId: "parent-turn",
      profile: "foundation-apply-approved-writes",
      lifecycleState: "completed",
      providerRoute: {
        providerId: "codex",
        model: "gpt-5.5",
      },
      adapterKind: "harness",
      executionMode: "cli-harness",
      authority: {} as ManagedAgentRuntimeInvocationSnapshot["record"]["authority"],
      capabilitySnapshot: {
        resourceLease: {
          leaseId: "child-1:lease",
          createdAt: "2026-05-22T00:00:00.000Z",
          healthStatus: "released",
          cleanupStatus: "completed",
          workingDirectoryPath: "C:/repo/.kiln/worktrees/child-1",
          workingDirectoryMode: "isolated-worktree",
          resourceUris: ["kiln://artifacts/child-1/worktree"],
          diagnosticUris: ["kiln://artifacts/child-1/diagnostics"],
          worktreeReview: {
            status: "required",
            reason: "dirty-worktree-preserved",
            resourceUris: ["kiln://artifacts/child-1/shared-worktree-review"],
            diagnosticUris: ["kiln://artifacts/child-1/record-capability-worktree-review-required"],
          },
        },
      },
      transcript: {
        uri: "kiln://artifacts/child-1/transcript",
        format: "jsonl",
        redaction: "redacted",
        truncated: false,
      },
      resultHandoff: {
        summary: "Child completed.",
        resourceUris: ["kiln://artifacts/child-1/handoff"],
        memoryWriteProposalUris: [],
      },
      resourceLease: {
        leaseId: "child-1:lease",
        createdAt: "2026-05-22T00:00:00.000Z",
        healthStatus: "released",
        cleanupStatus: "completed",
        workingDirectoryPath: "C:/repo/.kiln/worktrees/child-1",
        workingDirectoryMode: "isolated-worktree",
        resourceUris: ["kiln://artifacts/child-1/worktree"],
        diagnosticUris: ["kiln://artifacts/child-1/diagnostics"],
        worktreeReview: {
          status: "required",
          reason: "dirty-worktree-preserved",
          resourceUris: ["kiln://artifacts/child-1/record-worktree-review"],
          diagnosticUris: ["kiln://artifacts/child-1/record-worktree-review-required"],
        },
      },
    } as ManagedAgentRuntimeInvocationSnapshot["record"],
  };
}

function managedInvocationWithTerminalDiagnostic(): ManagedAgentRuntimeInvocationSnapshot {
  const snapshot = managedInvocationSnapshot();
  return {
    ...snapshot,
    invocationId: "child-timeout",
    lifecycleState: "timed_out",
    record: {
      ...snapshot.record!,
      invocationId: "child-timeout",
      lifecycleState: "timed_out",
      diagnostics: [{
        uri: "kiln://managed-invocations/child-timeout/timeout",
        kind: "timeout",
      }],
      resultHandoff: {
        summary: "Managed child timed out before handoff.",
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
    },
  };
}
