import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  type ExecutionSessionEvent,
  type ManagedAgentCapabilitySnapshotInput,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core";
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

async function invokeWith(
  events: readonly ExecutionSessionEvent[],
  admittedProviderModelId?: string,
) {
  const run = vi.fn(() => eventStream(events));
  const dispose = vi.fn().mockResolvedValue(undefined);
  const adapter = new ManagedCliHarnessAdapter({
    providerId: "claude",
    model: "claude-fable-5",
    ...(admittedProviderModelId ? { admittedProviderModelId } : {}),
    factory: () => ({ run, dispose }),
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
    expect(result.record.diagnostics?.length ?? 0).toBeGreaterThan(0);
  });

  it("reports the required native handoff when the provider gave no terminal cause", async () => {
    const result = await invokeWith([
      { type: "completed", totalUsd: 0, durationMs: 800, outcome: "completed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.summary).toContain("native structured-output handoff was missing");
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
});
