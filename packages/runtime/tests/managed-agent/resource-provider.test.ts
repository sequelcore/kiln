import { describe, expect, it } from "vitest";
import { MemoryArtifactResourceStore, type ToolResourceContent } from "@kilnai/core/tools";
import {
  createManagedAgentInvocationResourceProvider as createScopedManagedAgentInvocationResourceProvider,
  type ManagedAgentRuntimeInvocationSnapshot,
} from "../../src/agents/managed-invocation/index.js";
import { buildManagedAgentCoordinationUsage } from "../../src/agents/managed-invocation/coordination-usage.js";

function isTextResourceContent(
  content: ToolResourceContent,
): content is Extract<ToolResourceContent, { readonly text: string }> {
  return "text" in content;
}

function textOf(content: ToolResourceContent): string {
  if (!isTextResourceContent(content)) {
    throw new Error("expected text resource content, got blob");
  }
  return content.text;
}

type ProviderInput = Parameters<typeof createScopedManagedAgentInvocationResourceProvider>[0];

function createManagedAgentInvocationResourceProvider(
  input: Omit<ProviderInput, "parentSessionId"> & { readonly parentSessionId?: string },
) {
  return createScopedManagedAgentInvocationResourceProvider({
    ...input,
    parentSessionId: input.parentSessionId ?? "parent-session",
  });
}

describe("createManagedAgentInvocationResourceProvider", () => {
  it("isolates aggregate, listing, and direct reads to the owning parent session", async () => {
    const owned = managedInvocationSnapshot();
    const foreign: ManagedAgentRuntimeInvocationSnapshot = {
      ...owned,
      invocationId: "child-foreign",
      parentSessionId: "foreign-session",
      request: {
        ...owned.request,
        invocationId: "child-foreign",
        parentSessionId: "foreign-session",
      },
      record: owned.record ? {
        ...owned.record,
        invocationId: "child-foreign",
        parentSessionId: "foreign-session",
      } : undefined,
    };
    const provider = createManagedAgentInvocationResourceProvider({
      parentSessionId: "parent-session",
      service: { list: () => [owned, foreign] },
    });

    const listedUris = provider.listResources().map((resource) => resource.uri);
    expect(listedUris).toContain("kiln://managed-agents/invocations/child-1");
    expect(listedUris.some((uri) => uri.includes("child-foreign"))).toBe(false);
    const aggregate = await provider.read("kiln://managed-agents/invocations");
    expect(JSON.parse(textOf(aggregate!.contents[0]!))).toMatchObject({
      total: 1,
      invocations: [{ invocationId: "child-1" }],
    });
    expect(await provider.read("kiln://managed-agents/invocations/child-foreign")).toBeUndefined();
    expect(await provider.read("kiln://managed-agents/invocations/child-foreign/transcript")).toBeUndefined();
    expect(await provider.read("kiln://managed-agents/invocations/child-foreign/resources")).toBeUndefined();
  });

  it("rejects an empty parent session boundary", () => {
    expect(() => createScopedManagedAgentInvocationResourceProvider({
      parentSessionId: "  ",
      service: { list: () => [] },
    })).toThrow("require a parent session id");
  });

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
            usage: {
              source: "provider",
              tokenClasses: [
                { name: "input", value: 100 },
                { name: "output", value: 20 },
                { name: "cache_read", value: 30 },
                { name: "cache_write", value: 10 },
              ],
              cost: { currency: "USD", amount: 0.012 },
            },
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
    expect(aggregate!.summary).toEqual({
      kind: "managed-agent-invocations",
      totalCount: 1,
      counts: {
        invocation: 1,
        completed: 1,
        failed: 0,
        timedOut: 0,
        cancelled: 0,
        stale: 0,
        recovered: 0,
        running: 0,
        transcript: 1,
        handoff: 1,
        sourceResource: 3,
        resource: 12,
        diagnostic: 0,
        writeEvidence: 0,
      },
      facets: {
        agentIds: ["agent-reviewer"],
        accessLevels: ["approved-write"],
        adapterKinds: ["harness"],
        providerIds: ["codex"],
      },
    });
    const aggregatePayload = JSON.parse(textOf(aggregate!.contents[0]!));
    expect(aggregatePayload.invocations[0]).toMatchObject({
      transcriptUri: canonicalTranscriptUri,
      handoffResourceUris: [canonicalTranscriptUri, canonicalSiblingHandoffUri],
      sourceResourceUris: expect.arrayContaining([canonicalContextUri, canonicalSiblingHandoffUri]),
      resourceUris: expect.arrayContaining([
        canonicalContextUri,
        canonicalTranscriptUri,
        canonicalSiblingHandoffUri,
        canonicalAdmissionLeaseUri,
      ]),
    });
    expect(JSON.stringify(aggregatePayload)).not.toContain("kiln://managed-invocations/");

    const detail = await provider.read("kiln://managed-agents/invocations/child-1");
    const detailPayload = JSON.parse(textOf(detail!.contents[0]!));
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
      usage: {
        source: "provider",
        cost: { currency: "USD", amount: 0.012 },
      },
      efficiencyEvidence: {
        schemaVersion: "verified-efficiency-evidence-v1",
        provider: { providerId: "codex", modelId: "gpt-5.5" },
        policy: { owner: "ManagedInvocationService", policyId: "managed-invocation-admission-v1" },
        totals: {
          providerTotalTokens: 160,
          measured: { tokens: 120 },
          cached: { tokens: 30 },
          cacheWritten: { tokens: 10 },
          avoided: { tokens: 0 },
        },
      },
      efficiencyEvidenceStatus: "available",
    });
    expect(JSON.stringify(detailPayload)).not.toContain("kiln://managed-invocations/");

    const resources = await provider.read("kiln://managed-agents/invocations/child-1/resources");
    const resourcePayload = JSON.parse(textOf(resources!.contents[0]!));
    expect(resourcePayload.sourceResourceUris).toContain(canonicalContextUri);
    expect(resourcePayload.resourceUris).toContain(canonicalContextUri);
    expect(resourcePayload.resourceUris).toContain(canonicalTranscriptUri);
    expect(JSON.stringify(resourcePayload)).not.toContain("kiln://managed-invocations/");

    const transcript = await provider.read(canonicalTranscriptUri);
    expect(transcript!.contents[0]).toMatchObject({
      uri: canonicalTranscriptUri,
      mimeType: "text/markdown",
    });
    expect(textOf(transcript!.contents[0]!)).toContain("# Managed Invocation Transcript");
    expect(textOf(transcript!.contents[0]!)).toContain("Invocation ID: child-1");
    expect(textOf(transcript!.contents[0]!)).not.toContain("kiln://managed-invocations/");
  });

  it("does not summarize cancelled stale or recovered invocations as running", async () => {
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [
          managedInvocationWithLifecycleState("cancelled"),
          managedInvocationWithLifecycleState("stale"),
          managedInvocationWithLifecycleState("recovered"),
        ],
      },
    });

    const aggregate = await provider.read("kiln://managed-agents/invocations");

    expect(aggregate!.summary?.counts).toMatchObject({
      invocation: 3,
      completed: 0,
      failed: 0,
      timedOut: 0,
      cancelled: 1,
      stale: 1,
      recovered: 1,
      running: 0,
    });
  });

  it("marks efficiency evidence unavailable when a required token class is absent", async () => {
    const snapshot = managedInvocationSnapshot();
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [{
          ...snapshot,
          record: {
            ...snapshot.record!,
            usage: {
              source: "provider",
              tokenClasses: [{ name: "input", value: 100 }],
              cost: { currency: "USD", amount: 0.01 },
            },
          },
        }],
      },
    });

    const detail = await provider.read("kiln://managed-agents/invocations/child-1");
    expect(JSON.parse(textOf(detail!.contents[0]!)).invocation).toMatchObject({
      efficiencyEvidenceStatus: "unavailable",
    });
    expect(JSON.parse(textOf(detail!.contents[0]!)).invocation).not.toHaveProperty("efficiencyEvidence");
  });

  it.each([
    ["duplicate", [
      { name: "input", value: 100 },
      { name: "input", value: 40 },
      { name: "output", value: 20 },
      { name: "cache_read", value: 0 },
    ]],
    ["negative", [
      { name: "input", value: -1 },
      { name: "output", value: 20 },
      { name: "cache_read", value: 0 },
    ]],
  ] as const)("marks efficiency evidence unavailable for %s token values", async (_label, tokenClasses) => {
    const snapshot = managedInvocationSnapshot();
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [{
          ...snapshot,
          record: {
            ...snapshot.record!,
            usage: {
              source: "provider",
              tokenClasses,
              cost: { currency: "USD", amount: 0.01 },
            },
          },
        } as ManagedAgentRuntimeInvocationSnapshot],
      },
    });

    const detail = await provider.read("kiln://managed-agents/invocations/child-1");
    expect(JSON.parse(textOf(detail!.contents[0]!)).invocation).toMatchObject({
      efficiencyEvidenceStatus: "unavailable",
    });
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
    expect(JSON.parse(textOf(resources!.contents[0]!)).resourceUris).toContain(canonicalResultUri);

    const resultResource = await provider.read(canonicalResultUri);
    expect(resultResource!.contents[0]).toMatchObject({
      uri: canonicalResultUri,
      mimeType: "text/markdown",
      text: fullResult,
    });
  });

  it("serves direct child execution evidence through public managed-agent resource URIs", async () => {
    const rawExecutionUri = "kiln://managed-invocations/child-1/child-execution";
    const canonicalExecutionUri = "kiln://managed-agents/invocations/child-1/resources/child-execution";
    const executionEvidence = [
      "# Direct Child Execution Evidence",
      "",
      "Final output: <empty>",
      "Stop reason: end_turn",
      "Tool executions: 0",
    ].join("\n");
    const snapshot = managedInvocationSnapshot();
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [{
          ...snapshot,
          record: {
            ...snapshot.record!,
            resultHandoff: {
              ...snapshot.record!.resultHandoff!,
              resourceUris: [rawExecutionUri],
            },
            replayResources: [{
              uri: rawExecutionUri,
              title: "Managed invocation child execution evidence",
              mimeType: "text/markdown",
              text: executionEvidence,
            }],
          },
        }],
      },
    });

    const resources = await provider.read("kiln://managed-agents/invocations/child-1/resources");
    expect(JSON.parse(textOf(resources!.contents[0]!)).resourceUris).toContain(canonicalExecutionUri);

    const childExecutionResource = await provider.read(canonicalExecutionUri);
    expect(childExecutionResource!.contents[0]).toMatchObject({
      uri: canonicalExecutionUri,
      mimeType: "text/markdown",
      text: executionEvidence,
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
    const aggregatePayload = JSON.parse(textOf(aggregate!.contents[0]!));
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
    expect(JSON.parse(textOf(aggregate!.contents[0]!))).toMatchObject({
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
    expect(textOf(transcript!.contents[0]!)).toContain("# Managed Invocation Transcript");
    expect(textOf(transcript!.contents[0]!)).toContain("Invocation ID: child-1");
    expect(textOf(transcript!.contents[0]!)).toContain("Child completed.");

    const resources = await provider.read("kiln://managed-agents/invocations/child-1/resources");
    expect(JSON.parse(textOf(resources!.contents[0]!))).toEqual({
      invocationId: "child-1",
      sourceResourceUris: ["kiln://session/work-items/work-1"],
      resourceUris: [
        "kiln://session/work-items/work-1",
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
    const resourceUris = JSON.parse(textOf(resources!.contents[0]!)).resourceUris as readonly string[];
    expect(resourceUris.filter((uri) => uri === "kiln://artifacts/child-1/shared-worktree-review")).toHaveLength(1);

    const invocation = await provider.read("kiln://managed-agents/invocations/child-1");
    const invocationPayload = JSON.parse(textOf(invocation!.contents[0]!));
    expect(invocationPayload).toMatchObject({
      invocation: {
        invocationId: "child-1",
        lifecycleState: "completed",
        request: {
          summary: "Review Slice 5A.",
          access: "approved-write",
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
    expect(JSON.parse(textOf(aggregate!.contents[0]!))).toMatchObject({
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
    expect(JSON.parse(textOf(invocation!.contents[0]!))).toMatchObject({
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
    expect(JSON.parse(textOf(resources!.contents[0]!))).toMatchObject({
      invocationId: "child-timeout",
      resourceUris: expect.arrayContaining([
        timeoutUri,
      ]),
    });

    const diagnostic = await provider.read(timeoutUri);
    const diagnosticPayload = JSON.parse(textOf(diagnostic!.contents[0]!));
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
    expect(JSON.parse(textOf(aggregate!.contents[0]!))).toMatchObject({
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
    const resourceUris = JSON.parse(textOf(resources!.contents[0]!)).resourceUris as readonly string[];
    expect(resourceUris).toEqual(expect.arrayContaining([
      attemptUri,
      diffUri,
    ]));
    expect(resourceUris.filter((uri) => uri === diffUri)).toHaveLength(1);

    const nestedResource = await provider.read(diffUri);
    expect(JSON.parse(textOf(nestedResource!.contents[0]!))).toMatchObject({
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
    expect(JSON.parse(textOf(invocation!.contents[0]!))).toMatchObject({
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
    const aggregatePayload = JSON.parse(textOf(aggregate!.contents[0]!));
    expect(JSON.stringify(aggregatePayload)).not.toContain("kiln://managed-invocations/");
    expect(JSON.stringify(aggregatePayload)).toContain("kiln://artifacts/managed-invocations/");

    const nestedResource = await provider.read(diffUri);
    const nestedPayload = JSON.parse(textOf(nestedResource!.contents[0]!));
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

  it("integrates mutually-exclusive coordination and verification usage into the reconciled worker ledger", async () => {
    const snapshot = managedInvocationWithVerifiedUsage(
      "kiln://managed-invocations/child-1/transcript",
      true,
    );
    const provider = createManagedAgentInvocationResourceProvider({
      parentSessionId: "parent-session",
      service: { list: () => [snapshot] },
    });

    const detail = await provider.read("kiln://managed-agents/invocations/child-1");
    const invocation = JSON.parse(textOf(detail!.contents[0]!)).invocation;

    expect(invocation.lifecycleAttribution.summary).toMatchObject({ totalTokens: 120 });
    expect(invocation.lifecycleAttribution.ledger.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "coordination",
        providerTokenClass: "input",
        tokens: 10,
        workerId: "worker-coordinator",
      }),
      expect.objectContaining({
        source: "verification",
        providerTokenClass: "input",
        tokens: 5,
        workerId: "child-1",
      }),
      expect.objectContaining({
        source: "unknown",
        providerTokenClass: "input",
        tokens: 85,
      }),
      expect.objectContaining({
        source: "final_output",
        providerTokenClass: "output",
        tokens: 20,
        workerId: "child-1",
      }),
    ]));
    expect(invocation.efficiencyEvidence).toMatchObject({
      totals: {
        providerTotalTokens: 120,
        measured: { tokens: 115 },
        estimated: { tokens: 5 },
        unknown: { tokens: 0 },
      },
      verification: {
        status: "passed",
        results: [{ verificationResultId: "trusted-check", status: "passed" }],
      },
    });
  });

  it("reconciles provider-reported output after attributed handoff output without double counting", async () => {
    const snapshot = managedInvocationWithVerifiedUsage(
      "kiln://managed-invocations/child-1/transcript",
    );
    const resultHandoff = {
      ...snapshot.record!.resultHandoff!,
      summary: "H".repeat(400),
    };
    const provider = createManagedAgentInvocationResourceProvider({
      service: {
        list: () => [{
          ...snapshot,
          record: {
            ...snapshot.record!,
            usage: {
              source: "provider",
              tokenClasses: [
                { name: "input", value: 20 },
                { name: "output", value: 150 },
                { name: "cache_read", value: 0 },
              ],
              cost: { currency: "USD", amount: 0.012 },
            },
            coordinationUsage: buildManagedAgentCoordinationUsage({
              invocationId: snapshot.invocationId,
              childSessionId: snapshot.record!.childSessionId,
              parentPrompt: "Inspect the contract",
              sourceResourceUris: snapshot.request.input.resourceUris ?? [],
              resultHandoff,
            }),
            resultHandoff,
          },
        }],
      },
    });

    const detail = await provider.read("kiln://managed-agents/invocations/child-1");
    const invocation = JSON.parse(textOf(detail!.contents[0]!)).invocation;

    expect(invocation.efficiencyEvidence.totals.providerTotalTokens).toBe(170);
    expect(invocation.lifecycleAttribution.summary.totalTokens).toBe(170);
    expect(invocation.lifecycleAttribution.ledger.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "coordination",
        providerTokenClass: "output",
        tokens: 100,
      }),
      expect.objectContaining({
        source: "final_output",
        providerTokenClass: "output",
        tokens: 50,
      }),
    ]));
  });

  it.each([
    ["nonexistent artifact", "kiln://artifacts/managed-invocations/missing/content", 0],
    ["foreign invocation", "kiln://managed-invocations/other-child/transcript", 0],
    ["admitted invocation artifact", "kiln://managed-invocations/child-1/transcript", 1],
  ] as const)("does not grant passed verification to %s evidence", async (_label, evidenceUri, expectedResults) => {
    const artifactStore = new MemoryArtifactResourceStore();
    const snapshot = managedInvocationWithVerifiedUsage(evidenceUri);
    const provider = createManagedAgentInvocationResourceProvider({
      parentSessionId: "parent-session",
      artifactStore,
      service: { list: () => [snapshot] },
    });

    const detail = await provider.read("kiln://managed-agents/invocations/child-1");
    const verification = JSON.parse(textOf(detail!.contents[0]!)).invocation.efficiencyEvidence.verification;

    expect(verification.results).toHaveLength(expectedResults);
    expect(verification.status).toBe(expectedResults === 1 ? "passed" : "not_run");
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
    access: "approved-write",
    providerRoute: {
      providerId: "codex",
      surface: "cli-harness",
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
      access: "approved-write",
      requestedBy: "operator",
      requestSource: "test",
      requestedAuthority: "audited",
      providerRoute: {
        providerId: "codex",
        surface: "cli-harness",
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
    } as unknown as ManagedAgentRuntimeInvocationSnapshot["request"],
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
          admittedAgentProfile: "approved-write",
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
    } as unknown as ManagedAgentRuntimeInvocationSnapshot["decision"],
    record: {
      invocationId: "child-1",
      agentId: "agent-reviewer",
      parentSessionId: "parent-session",
      parentTurnId: "parent-turn",
      access: "approved-write",
      lifecycleState: "completed",
      providerRoute: {
        providerId: "codex",
        surface: "cli-harness",
        model: "gpt-5.5",
      },
      adapterKind: "harness",
      executionMode: "cli-harness",
      authority: {} as NonNullable<ManagedAgentRuntimeInvocationSnapshot["record"]>["authority"],
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
          admittedAgentProfile: "approved-write",
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
    } as unknown as ManagedAgentRuntimeInvocationSnapshot["record"],
  };
}

function managedInvocationWithVerifiedUsage(
  verificationEvidenceUri: string,
  includeCoordination = false,
): ManagedAgentRuntimeInvocationSnapshot {
  const snapshot = managedInvocationSnapshot();
  const transcriptUri = "kiln://managed-invocations/child-1/transcript";
  return {
    ...snapshot,
    record: {
      ...snapshot.record!,
      transcript: {
        ...snapshot.record!.transcript!,
        uri: transcriptUri,
      },
      usage: {
        source: "provider",
        tokenClasses: [
          { name: "input", value: 100 },
          { name: "output", value: 20 },
          { name: "cache_read", value: 0 },
        ],
        cost: { currency: "USD", amount: 0.012 },
      },
      ...(includeCoordination
        ? {
            coordinationUsage: {
              version: "managed-agent-coordination-usage-v1",
              workerId: "worker-coordinator",
              coverage: "partial",
              reconciliation: "mutually-exclusive",
              components: [{
                stage: "parent_prompt",
                providerTokenClass: "input",
                tokens: { value: 10, source: "provider_reported" },
                costUsd: { value: "unknown", source: "unknown" },
                latencyMs: { value: "unknown", source: "unknown" },
                turns: { value: "unknown", source: "unknown" },
                evidenceUris: [transcriptUri],
              }],
            },
          }
        : {}),
      resultHandoff: {
        ...snapshot.record!.resultHandoff!,
        resourceUris: [transcriptUri],
        structuredResult: {
          version: "structured-execution-result-v1",
          status: "completed",
          summary: "Verified child result.",
          limitations: [],
          operatorDecisions: [],
          evidence: [{ uri: verificationEvidenceUri, kind: "verification" }],
          citations: [],
          warnings: [],
          failures: [],
          approvalRequirements: [],
          residualRisks: [],
          verificationResults: [{
            requirementId: "trusted-check",
            method: "deterministic",
            status: "passed",
            summary: "Trusted evidence resolved.",
            evidenceUris: [verificationEvidenceUri],
          }],
        },
        verificationUsage: {
          version: "verification-usage-v1",
          attempts: [{
            requirementId: "trusted-check",
            method: "deterministic",
            status: "passed",
            providerTokenClass: "input",
            tokens: { value: 5, source: "estimated" },
            costUsd: { value: 0, source: "estimated" },
            latencyMs: { value: 2, source: "estimated" },
            evidenceUris: [verificationEvidenceUri],
          }],
          totals: { tokens: 5, costUsd: 0, latencyMs: 2 },
        },
      },
    },
  } as ManagedAgentRuntimeInvocationSnapshot;
}

function managedInvocationWithLifecycleState(
  lifecycleState: "cancelled" | "stale" | "recovered",
): ManagedAgentRuntimeInvocationSnapshot {
  const snapshot = managedInvocationSnapshot();
  return {
    ...snapshot,
    invocationId: `child-${lifecycleState}`,
    lifecycleState,
    finishedAt: "2026-05-22T00:00:06.000Z",
    record: {
      ...snapshot.record!,
      invocationId: `child-${lifecycleState}`,
      lifecycleState,
      resultHandoff: {
        provenance: {
          delivery: "assistant-text",
          configuredModelId: "gpt-5.5",
          observedModelIds: ["gpt-5.5"],
        },
        summary: `Child ${lifecycleState}.`,
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
    },
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
        provenance: {
          delivery: "assistant-text",
          configuredModelId: "gpt-5.5",
          observedModelIds: ["gpt-5.5"],
        },
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
        provenance: {
          delivery: "assistant-text",
          configuredModelId: "gpt-5.5",
          observedModelIds: ["gpt-5.5"],
        },
        summary: "Managed child timed out before handoff.",
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
    },
  };
}
