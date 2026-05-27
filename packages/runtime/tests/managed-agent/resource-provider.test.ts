import { describe, expect, it } from "vitest";
import { MemoryArtifactResourceStore } from "@kilnai/core";
import {
  createManagedAgentInvocationResourceProvider,
  type ManagedAgentRuntimeInvocationSnapshot,
} from "../../src/agents/managed-invocation/index.js";

describe("createManagedAgentInvocationResourceProvider", () => {
  it("projects adapter transcript pointers as readable managed-agent resource URIs", async () => {
    const snapshot = managedInvocationSnapshot();
    const rawTranscriptUri = "kiln://managed-invocations/child-1/transcript";
    const rawContextUri = "kiln://managed-invocations/child-1/context/input";
    const rawAdmissionLeaseUri = "kiln://managed-invocations/child-1/admission/lease";
    const rawSiblingHandoffUri = "kiln://managed-invocations/sibling-1/handoff";
    const canonicalTranscriptUri = "kiln://managed-agents/invocations/child-1/transcript";
    const canonicalContextUri = "kiln://managed-agents/invocations/child-1/resources/context/input";
    const canonicalAdmissionLeaseUri = "kiln://managed-agents/invocations/child-1/resources/admission/lease";
    const canonicalSiblingHandoffUri = "kiln://managed-agents/invocations/sibling-1/handoff";
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [{
          ...snapshot,
          request: {
            ...snapshot.request,
            input: {
              ...snapshot.request.input,
              resourceUris: [rawContextUri, rawSiblingHandoffUri],
            },
          },
          decision: {
            ...snapshot.decision,
            capabilitySnapshot: {
              ...snapshot.decision.capabilitySnapshot,
              resourceLease: {
                ...snapshot.decision.capabilitySnapshot.resourceLease,
                resourceUris: [rawAdmissionLeaseUri],
              },
            },
          },
          record: {
            ...snapshot.record!,
            transcript: {
              ...snapshot.record!.transcript!,
              uri: rawTranscriptUri,
            },
            resultHandoff: {
              ...snapshot.record!.resultHandoff!,
              resourceUris: [rawTranscriptUri, rawSiblingHandoffUri],
            },
          },
        }],
      },
    });

    const aggregate = await provider.read("kiln://managed-agents/invocations");
    const aggregatePayload = JSON.parse(aggregate!.contents[0]!.text);
    expect(aggregatePayload.invocations[0]).toMatchObject({
      transcriptUri: canonicalTranscriptUri,
      handoffResourceUris: [canonicalTranscriptUri, canonicalSiblingHandoffUri],
      resourceUris: expect.arrayContaining([
        canonicalTranscriptUri,
        canonicalSiblingHandoffUri,
        canonicalAdmissionLeaseUri,
      ]),
    });
    expect(JSON.stringify(aggregatePayload)).not.toContain("kiln://managed-invocations/");

    const detail = await provider.read("kiln://managed-agents/invocations/child-1");
    const detailPayload = JSON.parse(detail!.contents[0]!.text);
    expect(detailPayload.invocation).toMatchObject({
      request: {
        resourceUris: [canonicalContextUri, canonicalSiblingHandoffUri],
      },
      admission: {
        resourceLease: {
          resourceUris: [canonicalAdmissionLeaseUri],
        },
      },
      resourceUris: expect.arrayContaining([canonicalAdmissionLeaseUri]),
    });
    expect(JSON.stringify(detailPayload)).not.toContain("kiln://managed-invocations/");

    const resources = await provider.read("kiln://managed-agents/invocations/child-1/resources");
    const resourcePayload = JSON.parse(resources!.contents[0]!.text);
    expect(resourcePayload.resourceUris).toContain(canonicalTranscriptUri);
    expect(JSON.stringify(resourcePayload)).not.toContain("kiln://managed-invocations/");

    const transcript = await provider.read(canonicalTranscriptUri);
    expect(transcript!.contents[0]).toMatchObject({
      uri: canonicalTranscriptUri,
      mimeType: "text/markdown",
    });
    expect(transcript!.contents[0]!.text).toContain("# Managed Invocation Transcript");
    expect(transcript!.contents[0]!.text).toContain("Invocation ID: child-1");
    expect(transcript!.contents[0]!.text).not.toContain("kiln://managed-invocations/");
  });

  it("serves full child result resources through public managed-agent resource URIs", async () => {
    const rawResultUri = "kiln://managed-invocations/child-1/result/final";
    const canonicalResultUri = "kiln://managed-agents/invocations/child-1/resources/result/final";
    const fullResult = "complete child review result\n\nfinding-tail: preserve actionable evidence.";
    const snapshot = managedInvocationSnapshot();
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [{
          ...snapshot,
          record: {
            ...snapshot.record!,
            resultHandoff: {
              ...snapshot.record!.resultHandoff!,
              resourceUris: [rawResultUri],
            },
            replayResources: [{
              uri: rawResultUri,
              title: "Managed invocation final result",
              mimeType: "text/markdown",
              text: fullResult,
            }],
          },
        }],
      },
    });

    const resources = await provider.read("kiln://managed-agents/invocations/child-1/resources");
    expect(JSON.parse(resources!.contents[0]!.text).resourceUris).toContain(canonicalResultUri);

    const resultResource = await provider.read(canonicalResultUri);
    expect(resultResource!.contents[0]).toMatchObject({
      uri: canonicalResultUri,
      mimeType: "text/markdown",
      text: fullResult,
    });
  });

  it("persists full child result resources as session artifacts when an artifact store is attached", async () => {
    const rawResultUri = "kiln://managed-invocations/child-1/result/final";
    const fullResult = "complete child review result\n\nfinding-tail: artifact-backed evidence.";
    const snapshot = managedInvocationSnapshot();
    const artifactStore = new MemoryArtifactResourceStore();
    const provider = createManagedAgentInvocationResourceProvider({
      artifactStore,
      service: {
        list: () => [{
          ...snapshot,
          record: {
            ...snapshot.record!,
            resultHandoff: {
              ...snapshot.record!.resultHandoff!,
              resourceUris: [rawResultUri],
            },
            replayResources: [{
              uri: rawResultUri,
              title: "Managed invocation final result",
              mimeType: "text/markdown",
              text: fullResult,
            }],
          },
        }],
      },
    });

    const aggregate = await provider.read("kiln://managed-agents/invocations");
    const aggregatePayload = JSON.parse(aggregate!.contents[0]!.text);
    const resultArtifactUri = aggregatePayload.invocations[0].handoffResourceUris.find((uri: string) =>
      uri.startsWith("kiln://artifacts/managed-invocations/")
    );
    expect(resultArtifactUri).toBeDefined();
    const artifactId = /^kiln:\/\/artifacts\/managed-invocations\/([^/]+)\/content$/u.exec(resultArtifactUri)?.[1];
    expect(artifactId).toBeDefined();
    const artifact = artifactStore.get("managed-invocations", artifactId!);
    expect(artifact?.content).toEqual({
      type: "text",
      text: fullResult,
    });
  });

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
    expect(provider.listTemplates().find((template) =>
      template.uriTemplate === "kiln://managed-agents/invocations/{invocationId}/transcript"
    )).toMatchObject({
      description: "Read one managed child invocation transcript body.",
      mimeType: "text/markdown",
    });

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
    expect(transcript!.contents[0]).toMatchObject({
      uri: "kiln://managed-agents/invocations/child-1/transcript",
      mimeType: "text/markdown",
    });
    expect(transcript!.contents[0]!.text).toContain("# Managed Invocation Transcript");
    expect(transcript!.contents[0]!.text).toContain("Invocation ID: child-1");
    expect(transcript!.contents[0]!.text).toContain("Child completed.");

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
    const timeoutUri = "kiln://managed-agents/invocations/child-timeout/resources/timeout";
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
        diagnosticResourceUris: [timeoutUri],
        resourceUris: expect.arrayContaining([
          timeoutUri,
        ]),
      }],
    });

    const invocation = await provider.read("kiln://managed-agents/invocations/child-timeout");
    expect(JSON.parse(invocation!.contents[0]!.text)).toMatchObject({
      invocation: {
        invocationId: "child-timeout",
        lifecycleState: "timed_out",
        diagnostics: [{
          uri: timeoutUri,
          kind: "timeout",
        }],
      },
    });

    const resources = await provider.read("kiln://managed-agents/invocations/child-timeout/resources");
    expect(JSON.parse(resources!.contents[0]!.text)).toMatchObject({
      invocationId: "child-timeout",
      resourceUris: expect.arrayContaining([
        timeoutUri,
      ]),
    });

    const diagnostic = await provider.read(timeoutUri);
    const diagnosticPayload = JSON.parse(diagnostic!.contents[0]!.text);
    expect(diagnosticPayload).toMatchObject({
      invocationId: "child-timeout",
      resource: {
        invocationId: "child-timeout",
        resourceUri: timeoutUri,
        resourcePath: "timeout",
        lifecycleState: "timed_out",
        resultSummary: "Managed child timed out before handoff.",
        diagnostics: [{
          uri: timeoutUri,
          kind: "timeout",
        }],
      },
    });
    expect(JSON.stringify(diagnosticPayload)).not.toContain("kiln://managed-invocations/");
  });

  it("replays partial write evidence resource pointers without duplicating handoff resources", async () => {
    const diffUri = "kiln://managed-agents/invocations/child-partial-write/resources/diffs/1";
    const attemptUri = "kiln://managed-agents/invocations/child-partial-write/resources/write-attempts/1";
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [managedInvocationWithPartialWriteEvidence()],
      },
    });

    const aggregate = await provider.read("kiln://managed-agents/invocations");
    expect(JSON.parse(aggregate!.contents[0]!.text)).toMatchObject({
      total: 1,
      invocations: [{
        invocationId: "child-partial-write",
        lifecycleState: "timed_out",
        handoffResourceUris: [diffUri],
        writeEvidenceResourceUris: [
          attemptUri,
          diffUri,
        ],
        resourceUris: expect.arrayContaining([
          attemptUri,
          diffUri,
        ]),
      }],
    });

    const resources = await provider.read("kiln://managed-agents/invocations/child-partial-write/resources");
    const resourceUris = JSON.parse(resources!.contents[0]!.text).resourceUris as readonly string[];
    expect(resourceUris).toEqual(expect.arrayContaining([
      attemptUri,
      diffUri,
    ]));
    expect(resourceUris.filter((uri) => uri === diffUri)).toHaveLength(1);

    const nestedResource = await provider.read(diffUri);
    expect(JSON.parse(nestedResource!.contents[0]!.text)).toMatchObject({
      invocationId: "child-partial-write",
      resource: {
        invocationId: "child-partial-write",
        resourceUri: diffUri,
        resourcePath: "diffs/1",
        lifecycleState: "timed_out",
        resultSummary: "Managed child timed out after partial write evidence.",
        resultHandoff: {
          resourceUris: [diffUri],
        },
        writeEvidence: [{
          resourceUris: [attemptUri, diffUri],
        }],
      },
    });

    const invocation = await provider.read("kiln://managed-agents/invocations/child-partial-write");
    expect(JSON.parse(invocation!.contents[0]!.text)).toMatchObject({
      invocation: {
        invocationId: "child-partial-write",
        writeEvidenceResourceUris: [
          attemptUri,
          diffUri,
        ],
        resourceUris: expect.arrayContaining([
          attemptUri,
          diffUri,
        ]),
      },
    });
  });

  it("keeps canonical nested resource reads informative when artifact persistence is attached", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const diffUri = "kiln://managed-agents/invocations/child-partial-write/resources/diffs/1";
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [managedInvocationWithPartialWriteEvidence()],
      },
      artifactStore,
    });

    const aggregate = await provider.read("kiln://managed-agents/invocations");
    const aggregatePayload = JSON.parse(aggregate!.contents[0]!.text);
    expect(JSON.stringify(aggregatePayload)).not.toContain("kiln://managed-invocations/");
    expect(JSON.stringify(aggregatePayload)).toContain("kiln://artifacts/managed-invocations/");

    const nestedResource = await provider.read(diffUri);
    const nestedPayload = JSON.parse(nestedResource!.contents[0]!.text);
    expect(nestedPayload).toMatchObject({
      invocationId: "child-partial-write",
      resource: {
        invocationId: "child-partial-write",
        resourceUri: diffUri,
        resourcePath: "diffs/1",
        lifecycleState: "timed_out",
        resultSummary: "Managed child timed out after partial write evidence.",
        resultHandoff: {
          resourceUris: [expect.stringMatching(/^kiln:\/\/artifacts\/managed-invocations\/artifact_\d+\/content$/u)],
        },
        writeEvidence: [{
          resourceUris: expect.arrayContaining([
            expect.stringMatching(/^kiln:\/\/artifacts\/managed-invocations\/artifact_\d+\/content$/u),
          ]),
        }],
      },
    });
    expect(JSON.stringify(nestedPayload)).not.toContain("kiln://managed-invocations/");
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
        snapshotId: "child-1:snapshot",
        capturedAt: "2026-05-22T00:00:00.000Z",
        routeId: "route:codex:gpt-5.5",
        routeHealth: {
          status: "healthy",
          reason: "test fixture route",
        },
        providerModelProof: {
          status: "verified",
          source: "test-fixture",
        },
        contextMode: "resources",
        resourcePlane: {
          available: true,
          resourceUris: ["kiln://session/work-items/work-1"],
        },
        childIdentity: {
          agentId: "agent-reviewer",
          admittedAgentProfile: "foundation-apply-approved-writes",
          displayName: "Agent Reviewer",
        },
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
        snapshotId: "child-1:snapshot",
        capturedAt: "2026-05-22T00:00:00.000Z",
        routeId: "route:codex:gpt-5.5",
        routeHealth: {
          status: "healthy",
          reason: "test fixture route",
        },
        providerModelProof: {
          status: "verified",
          source: "test-fixture",
        },
        contextMode: "resources",
        resourcePlane: {
          available: true,
          resourceUris: ["kiln://session/work-items/work-1"],
        },
        childIdentity: {
          agentId: "agent-reviewer",
          admittedAgentProfile: "foundation-apply-approved-writes",
          displayName: "Agent Reviewer",
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

function managedInvocationWithPartialWriteEvidence(): ManagedAgentRuntimeInvocationSnapshot {
  const snapshot = managedInvocationSnapshot();
  return {
    ...snapshot,
    invocationId: "child-partial-write",
    lifecycleState: "timed_out",
    record: {
      ...snapshot.record!,
      invocationId: "child-partial-write",
      lifecycleState: "timed_out",
      resultHandoff: {
        summary: "Managed child timed out after partial write evidence.",
        resourceUris: ["kiln://managed-invocations/child-partial-write/diffs/1"],
        memoryWriteProposalUris: [],
      },
      writeEvidence: [{
        evidenceId: "child-partial-write:write-attempt-1",
        invocationId: "child-partial-write",
        kind: "write-attempt-timed-out",
        attemptId: "child-partial-write:attempt-1",
        summary: "Partial workspace write was detected before timeout.",
        resourceUris: [
          "kiln://managed-invocations/child-partial-write/write-attempts/1",
          "kiln://managed-invocations/child-partial-write/diffs/1",
        ],
        recordedAt: "2026-05-22T00:00:04.000Z",
      }],
    },
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
