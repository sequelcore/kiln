import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  type ManagedAgentCapabilitySnapshotInput,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core/agents";
import type { ExecutionSessionEvent } from "@kilnai/core/events";
import {
  ManagedCliHarnessAdapter,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";

function makeRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-claude-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "claude",
      surface: "cli-harness",
      model: "claude-fable-5",
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
        mode: "credentialless",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect the managed invocation contract.",
      prompt: "Read the relevant files and return a compact review.",
      handoff: {
        roleIntent: "managed reviewer",
        requiredResultFields: ["summary"],
      },
    },
  });
}

function snapshotInputFor(request: ManagedAgentInvocationRequest): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: "2026-08-01T08:00:00.000Z",
    routeId: `${request.providerRoute.providerId}:${request.profile}`,
    routeSource: "explicit-managed-route",
  };
}

function eventStream(events: readonly ExecutionSessionEvent[]): AsyncIterable<ExecutionSessionEvent> {
  return (async function* stream(): AsyncGenerator<ExecutionSessionEvent> {
    for (const event of events) {
      yield event;
    }
  })();
}

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const privatePlanCleanupEvidence = {
  capabilityId: "claude-code-private-plan-artifacts-v1",
  harness: "claude-code",
  artifactCount: 1,
  createdCount: 1,
  modifiedCount: 0,
  deletedCount: 0,
  artifactDigest: "d".repeat(64),
  cleanupStatus: "completed",
  unexpectedDelta: false,
} as const;

async function invokeWith(
  events: readonly ExecutionSessionEvent[],
  admittedProviderModelId?: string,
  privatePlanArtifacts = false,
  privatePlanOptions: {
    readonly capabilityVersion?: "2.1.220" | "2.1.226";
    readonly observedVersion?: string;
  } = {},
) {
  const run = vi.fn(() => eventStream(events));
  const dispose = vi.fn().mockResolvedValue(undefined);
  const privatePlanCapabilityVersion = privatePlanOptions.capabilityVersion ?? "2.1.220";
  const observedHarnessVersion = privatePlanArtifacts
    ? privatePlanOptions.observedVersion ?? privatePlanCapabilityVersion
    : undefined;
  const adapter = new ManagedCliHarnessAdapter({
    providerId: "claude",
    model: "claude-fable-5",
    ...(admittedProviderModelId ? { admittedProviderModelId } : {}),
    ...(privatePlanArtifacts ? {
      privatePlanArtifactCapability: {
        capabilityId: "claude-code-private-plan-artifacts-v1" as const,
        harness: "claude-code" as const,
        version: privatePlanCapabilityVersion,
        relativeDirectory: "plans" as const,
      },
    } : {}),
    factory: () => ({
      run,
      dispose,
      ...(observedHarnessVersion !== undefined ? { observedHarnessVersion } : {}),
    }),
  });
  const service = new RuntimeManagedAgentInvocationService();
  const request = makeRequest();
  return service.invoke(request, adapter, snapshotInputFor(request));
}

const structuredResult = {
  version: "structured-execution-result-v1",
  status: "completed",
  summary: "Managed Claude review completed.",
  limitations: [],
  operatorDecisions: [],
  evidence: [],
  citations: [],
  warnings: [],
  failures: [],
  approvalRequirements: [],
  residualRisks: [],
  verificationResults: [],
} as const;

describe("ManagedCliHarnessAdapter surfaces Claude terminal causes", () => {
  it("reports schema-retry exhaustion instead of an unexplained missing handoff", async () => {
    const result = await invokeWith([
      {
        type: "error",
        code: "error_max_structured_output_retries",
        message: "Claude Code exhausted its structured-output retries without producing a schema-valid result.",
        isRetryable: false,
      },
      { type: "completed", totalUsd: 0.01, durationMs: 1200, outcome: "failed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.summary).toContain("error_max_structured_output_retries");
    expect(result.record.resultHandoff.summary).not.toContain("without a result handoff");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/invocation-claude-1/resources/diagnostics",
      kind: "failure",
      classification: "native_session_error",
    }]);
  });

  it.each([
    ["SDK_ERROR", "Claude Code returned an error result: weekly limit reached"],
    ["SDK_ERROR", "Claude Code returned an error result: monthly limit exceeded"],
    ["402", "Payment required"],
  ])("classifies a Claude subscription limit without persisting the provider message (%s)", async (code, message) => {
    const result = await invokeWith([
      {
        type: "error",
        code,
        message,
        isRetryable: false,
      },
      { type: "completed", totalUsd: 0, durationMs: 100, outcome: "failed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.diagnostics?.[0]).toMatchObject({
      kind: "failure",
      classification: "provider_quota_exhausted",
    });
    expect(JSON.stringify(result.record.diagnostics)).not.toContain(message);
  });

  it("does not classify advisory quota text as provider exhaustion", async () => {
    const result = await invokeWith([
      {
        type: "error",
        code: "SDK_ERROR",
        message: "Quota metadata could not be parsed",
        isRetryable: false,
      },
      { type: "completed", totalUsd: 0, durationMs: 100, outcome: "failed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.diagnostics?.[0]?.classification).toBe("native_session_error");
  });

  it("reports the required native handoff when the provider gave no terminal cause", async () => {
    const result = await invokeWith([
      { type: "completed", totalUsd: 0, durationMs: 800, outcome: "completed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.summary).toContain("native structured-output handoff was missing");
    expect(result.record.diagnostics?.[0]?.classification).toBe("structured_handoff_rejected");
  });

  it("retains native Claude handoff, concrete model, and portable executable provenance", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: structuredResult,
        primaryProviderModelId: "claude-fable-5-20260715[1m]",
        providerModelIds: ["claude-haiku-4-5-20251001", "claude-fable-5-20260715[1m]"],
        harness: {
          id: "claude-code",
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      } as ExecutionSessionEvent,
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.resultHandoff.provenance).toEqual({
      delivery: "native-structured-output",
      configuredModelId: "claude-fable-5",
      primaryObservedModelId: "claude-fable-5-20260715[1m]",
      observedModelIds: ["claude-haiku-4-5-20251001", "claude-fable-5-20260715[1m]"],
      harness: {
        id: "claude-code",
        executable: "<operator-harness>/claude.exe",
        version: "2.1.220",
      },
    });
  });

  it("redacts the invocation workspace root from a native structured handoff", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: {
          ...structuredResult,
          summary: "Inspected C:\\workspace\\kiln\\proof.txt without changing it.",
        },
        primaryProviderModelId: "claude-fable-5",
        providerModelIds: ["claude-fable-5"],
        harness: {
          id: "claude-code",
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      } as ExecutionSessionEvent,
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], "claude-fable-5");

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.resultHandoff.summary).toBe("Inspected <workspace>\\proof.txt without changing it.");
    expect(JSON.stringify(result.record.resultHandoff.structuredResult)).not.toContain("workspace\\kiln");
  });

  it("preserves a sibling path whose name only starts with the workspace root", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: {
          ...structuredResult,
          summary: "Compared C:\\workspace\\kilnette\\proof.txt without changing it.",
        },
        primaryProviderModelId: "claude-fable-5",
        providerModelIds: ["claude-fable-5"],
        harness: {
          id: "claude-code",
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      } as ExecutionSessionEvent,
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], "claude-fable-5");

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.resultHandoff.summary).toBe(
      "Compared C:\\workspace\\kilnette\\proof.txt without changing it.",
    );
  });

  it("redacts a workspace root followed by prose delimiters", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: {
          ...structuredResult,
          summary: "Root: C:\\workspace\\kiln. Compared it, then stopped.",
        },
        primaryProviderModelId: "claude-fable-5",
        providerModelIds: ["claude-fable-5"],
        harness: {
          id: "claude-code",
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      } as ExecutionSessionEvent,
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], "claude-fable-5");

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.resultHandoff.summary).toBe(
      "Root: <workspace>. Compared it, then stopped.",
    );
  });

  it("rejects prose JSON as a Claude native result handoff", async () => {
    const result = await invokeWith([
      { type: "text_delta", content: JSON.stringify(structuredResult) },
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.provenance.delivery).toBe("assistant-text");
    expect(result.record.resultHandoff.summary).toContain("native structured-output");
  });

  it("rejects substantive Claude prose when the native structured handoff is missing", async () => {
    const result = await invokeWith([
      { type: "text_delta", content: "The fixture contains before." },
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.summary).toContain("native structured-output");
  });

  it("fails closed when the executed Claude model differs from the admitted identity", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: structuredResult,
        primaryProviderModelId: "claude-fable-5-20260715[1m]",
        providerModelIds: ["claude-fable-5-20260715[1m]"],
        harness: {
          id: "claude-code",
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      } as ExecutionSessionEvent,
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], "claude-fable-5-20260801[1m]");

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.summary).toContain("does not match the admitted model identity");
    expect(result.record.diagnostics?.[0]?.classification).toBe("model_identity_mismatch");
  });

  it("admits the exact primary Claude model while retaining auxiliary model usage", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: structuredResult,
        primaryProviderModelId: "claude-fable-5",
        providerModelIds: ["claude-haiku-4-5-20251001", "claude-fable-5"],
        harness: {
          id: "claude-code",
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      } as ExecutionSessionEvent,
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], "claude-fable-5");

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.resultHandoff.provenance).toMatchObject({
      primaryObservedModelId: "claude-fable-5",
      observedModelIds: ["claude-haiku-4-5-20251001", "claude-fable-5"],
    });
  });

  it("keeps private plan cleanup as allowed ephemeral harness evidence, not workspace write evidence", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: structuredResult,
        primaryProviderModelId: "claude-fable-5",
        providerModelIds: ["claude-fable-5"],
        harness: { id: "claude-code", executable: "<operator-harness>/claude.exe", version: "2.1.220" },
      },
      {
        type: "ephemeral_harness_state",
        evidence: {
          capabilityId: "claude-code-private-plan-artifacts-v1",
          harness: "claude-code",
          artifactCount: 2,
          createdCount: 1,
          modifiedCount: 1,
          deletedCount: 0,
          artifactDigest: "b".repeat(64),
          cleanupStatus: "completed",
          unexpectedDelta: false,
        },
      },
      {
        type: "file_changed",
        path: "C:/workspace/kiln/attempted-write.txt",
        changeType: "created",
        linesAdded: 1,
        linesRemoved: 0,
      },
      { type: "text_delta", content: "Child plan summary." },
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], "claude-fable-5", true);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.resultHandoff.summaryAuthority).toBe("child-untrusted");
    expect(result.record.resultHandoff.ephemeralHarnessState).toMatchObject([{
      capabilityId: "claude-code-private-plan-artifacts-v1",
      cleanupStatus: "completed",
    }]);
    expect(result.record.writeEvidence?.map((evidence) => evidence.kind)).toEqual(["write-authority-denied"]);
    expect(JSON.stringify(result.record.resultHandoff)).not.toContain("C:/synthetic/harness-home");
    expect(JSON.stringify(result.record.resultHandoff)).not.toContain("attempted-write.txt");
  });

  it("accepts private plan evidence only when the session reports the exact admitted version", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: structuredResult,
        primaryProviderModelId: "claude-fable-5",
        providerModelIds: ["claude-fable-5"],
        harness: { id: "claude-code", executable: "<operator-harness>/claude.exe", version: "2.1.226" },
      },
      { type: "ephemeral_harness_state", evidence: { ...privatePlanCleanupEvidence } },
      { type: "text_delta", content: "Child plan summary." },
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], undefined, true, { capabilityVersion: "2.1.226", observedVersion: "2.1.226" });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.resultHandoff.ephemeralHarnessState).toEqual([privatePlanCleanupEvidence]);
    expect(result.record.resultHandoff.structuredResult).toEqual(structuredResult);
  });

  it("fails closed when the session reports a different version than the admitted private plan capability", async () => {
    const result = await invokeWith([
      {
        type: "structured_output",
        value: structuredResult,
        primaryProviderModelId: "claude-fable-5",
        providerModelIds: ["claude-fable-5"],
        harness: { id: "claude-code", executable: "<operator-harness>/claude.exe", version: "2.1.226" },
      },
      { type: "ephemeral_harness_state", evidence: { ...privatePlanCleanupEvidence } },
      { type: "text_delta", content: "Untrusted child summary." },
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], undefined, true, { capabilityVersion: "2.1.226", observedVersion: "2.1.227" });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.summary).toContain("exact admitted Claude private plan capability version");
    expect(result.record.resultHandoff.ephemeralHarnessState).toBeUndefined();
    expect(result.record.resultHandoff.structuredResult).toBeUndefined();
    expect(result.record.resultHandoff.summaryAuthority).toBe("runtime-derived");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/invocation-claude-1/resources/diagnostics",
      kind: "failure",
      classification: "harness_version_mismatch",
    }]);
  });

  it("fails terminal cleanup when private evidence reports an unexpected delta or cleanup failure", async () => {
    const result = await invokeWith([
      { type: "text_delta", content: "Child plan summary." },
      {
        type: "ephemeral_harness_state",
        evidence: {
          capabilityId: "claude-code-private-plan-artifacts-v1",
          harness: "claude-code",
          artifactCount: 1,
          createdCount: 1,
          modifiedCount: 0,
          deletedCount: 0,
          artifactDigest: "c".repeat(64),
          cleanupStatus: "failed",
          unexpectedDelta: true,
        },
      },
      { type: "completed", totalUsd: 0.01, durationMs: 900, outcome: "completed", isPreflightCrash: false },
    ], undefined, true);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/invocation-claude-1/resources/private-plan-artifacts-cleanup",
      kind: "cleanup",
      classification: "private_artifact_cleanup_failed",
    }]);
    expect(result.record.writeEvidence).toBeUndefined();
    expect(result.record.resultHandoff.ephemeralHarnessState?.[0]).toMatchObject({
      cleanupStatus: "failed",
      unexpectedDelta: true,
    });
  });

  it("keeps typed private cleanup evidence on timeout", async () => {
    vi.useFakeTimers();
    const runStarted = deferred();
    const run = vi.fn(() => (async function* neverFinishes(): AsyncGenerator<ExecutionSessionEvent> {
      runStarted.resolve();
      yield { type: "ephemeral_harness_state", evidence: privatePlanCleanupEvidence };
      await new Promise(() => undefined);
    })());
    const dispose = vi.fn().mockResolvedValue(undefined);
    try {
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "claude",
        model: "claude-fable-5",
        privatePlanArtifactCapability: {
          capabilityId: "claude-code-private-plan-artifacts-v1",
          harness: "claude-code",
          version: "2.1.220",
          relativeDirectory: "plans",
        },
        factory: () => ({ run, dispose, observedHarnessVersion: "2.1.220" }),
      });
      const service = new RuntimeManagedAgentInvocationService();
      const request = makeRequest();
      const resultPromise = service.invoke(request, adapter, snapshotInputFor(request));
      await runStarted.promise;
      await vi.advanceTimersByTimeAsync(request.authority.timeoutMs);
      const result = await resultPromise;

      expect(result.status).toBe("completed");
      if (result.status !== "completed") return;
      expect(result.record.lifecycleState).toBe("timed_out");
      expect(result.record.resultHandoff.ephemeralHarnessState).toEqual([privatePlanCleanupEvidence]);
      expect(result.record.diagnostics).toEqual([{
        uri: "kiln://managed-agents/invocations/invocation-claude-1/resources/timeout",
        kind: "timeout",
      }]);
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps typed private cleanup evidence on cancellation", async () => {
    const runStarted = deferred();
    const run = vi.fn(() => (async function* neverFinishes(): AsyncGenerator<ExecutionSessionEvent> {
      runStarted.resolve();
      yield { type: "ephemeral_harness_state", evidence: privatePlanCleanupEvidence };
      await new Promise(() => undefined);
    })());
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "claude",
      model: "claude-fable-5",
      privatePlanArtifactCapability: {
        capabilityId: "claude-code-private-plan-artifacts-v1",
        harness: "claude-code",
        version: "2.1.220",
        relativeDirectory: "plans",
      },
      factory: () => ({ run, dispose, observedHarnessVersion: "2.1.220" }),
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeRequest();
    const abortController = new AbortController();
    const resultPromise = service.invoke(
      request,
      adapter,
      snapshotInputFor(request),
      { abortSignal: abortController.signal },
    );
    await runStarted.promise;
    abortController.abort("operator cancelled plan");
    const result = await resultPromise;
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("cancelled");
    await vi.waitFor(() => expect(
      service.status(request.invocationId)?.record?.resultHandoff?.ephemeralHarnessState,
    ).toEqual([privatePlanCleanupEvidence]));
  });
});
