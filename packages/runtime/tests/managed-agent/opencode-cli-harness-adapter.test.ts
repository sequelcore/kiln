import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  type ManagedAgentCapabilitySnapshotInput,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core/agents";
import type { ExecutionSessionEvent, ExecutionSessionRunOptions } from "@kilnai/core/events";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { serializeSession, deserializeSession } from "../../src/session/persistence/session-serializer.js";
import { appendManagedInvocationSessionEvents } from "../../src/agents/managed-invocation/session-events.js";
import {
  ManagedCliHarnessAdapter,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import type {
  CliSession,
} from "../../src/execution/cli-session-contract.js";

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeRequest(timeoutMs = 120000): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-opencode-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
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
      timeoutMs,
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
    },
  });
}

function makeWriteRequest(timeoutMs = 120000): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-opencode-write-1",
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
        path: "C:/workspace/kiln",
        mode: "workspace-write",
      },
      timeoutMs,
      credentialRoute: {
        mode: "credentialless",
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
            allowedPaths: ["C:/workspace/kiln/packages/runtime/tests/fixtures"],
            deniedPaths: ["C:/workspace/kiln/.git"],
          },
          memory: {
            mode: "propose",
            scope: { kind: "project", id: "kiln" },
            operations: ["create", "update"],
          },
          artifacts: {
            mode: "propose",
            resourceUris: ["kiln://managed-invocations/invocation-opencode-write-1/write"],
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
          evidenceUris: ["kiln://managed-invocations/invocation-opencode-write-1/approval"],
        },
      }),
    },
    input: {
      summary: "Apply an approved fixture update.",
      prompt: "Apply only the approved fixture update and report evidence.",
    },
  });
}

function snapshotInputFor(
  request: ManagedAgentInvocationRequest,
): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: "2026-05-07T08:00:00.000Z",
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

describe("ManagedCliHarnessAdapter configured for OpenCode", () => {
  it("treats a native structured result as a substantive handoff without prose", async () => {
    const structuredResult = {
      version: "structured-execution-result-v1",
      status: "completed",
      summary: "Repository surface mapped.",
      limitations: [],
      operatorDecisions: [],
      evidence: [{
        uri: "kiln://managed-invocations/invocation-opencode-1/transcript",
        kind: "artifact",
      }],
      citations: [],
      warnings: [],
      failures: [],
      approvalRequirements: [],
      residualRisks: ["Tests were not executed by the read-only harness."],
      verificationResults: [{
        requirementId: "surface-map",
        method: "deterministic",
        status: "passed",
        summary: "Repository paths were inspected.",
        evidenceUris: ["kiln://managed-invocations/invocation-opencode-1/transcript"],
      }],
    } as const;
    const baseRequest = makeRequest();
    const request = defineManagedAgentInvocationRequest({
      ...baseRequest,
      input: {
        ...baseRequest.input,
        handoff: {
          requiredResultFields: ["summary", "evidence", "verificationResults", "residualRisks"],
          residualRiskRequired: true,
        },
      },
    });
    const run = vi.fn(() => eventStream([
      { type: "structured_output", value: structuredResult },
      { type: "completed", exitCode: 0, totalUsd: 0 },
    ]));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose: vi.fn(async () => undefined) }),
    });

    const result = await new RuntimeManagedAgentInvocationService().invoke(
      request,
      adapter,
      snapshotInputFor(request),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed");
    expect(result.record.resultHandoff?.structuredResult).toMatchObject({
      ...structuredResult,
      evidence: [{
        uri: "kiln://managed-agents/invocations/invocation-opencode-1/transcript",
        kind: "artifact",
      }],
      verificationResults: [expect.objectContaining({
        requirementId: "surface-map",
        evidenceUris: ["kiln://managed-agents/invocations/invocation-opencode-1/transcript"],
      })],
    });
    expect(result.record.resultHandoff?.summary).toBe("Repository surface mapped.");
  });

  it("passes the canonical structured schema through the provider-neutral factory context", async () => {
    const baseRequest = makeRequest();
    const request = defineManagedAgentInvocationRequest({
      ...baseRequest,
      input: {
        ...baseRequest.input,
        handoff: { requiredResultFields: ["summary"] },
      },
    });
    const factory = vi.fn(() => ({
      run: () => eventStream([{ type: "completed", exitCode: 0, totalUsd: 0 }]),
      dispose: vi.fn(async () => undefined),
    }));
    const adapter = new ManagedCliHarnessAdapter({ providerId: "opencode", model: "sonic", factory });

    await new RuntimeManagedAgentInvocationService().invoke(request, adapter, snapshotInputFor(request));

    expect(factory.mock.calls[0]?.[2]?.structuredOutput?.schema).toMatchObject({
      type: "object",
      properties: { version: { const: "structured-execution-result-v1" } },
    });
  });

  it("reduces a Claude managed child to native plan authority", async () => {
    const baseRequest = makeRequest();
    const request = defineManagedAgentInvocationRequest({
      ...baseRequest,
      providerRoute: { ...baseRequest.providerRoute, providerId: "claude", model: "claude-sonnet-4-5-20250929" },
    });
    const factory = vi.fn(() => ({
      run: () => eventStream([{ type: "completed", exitCode: 0, totalUsd: 0 }]),
      dispose: vi.fn(async () => undefined),
    }));
    const adapter = new ManagedCliHarnessAdapter({ providerId: "claude", model: "claude-sonnet-4-5-20250929", factory });

    await new RuntimeManagedAgentInvocationService().invoke(request, adapter, snapshotInputFor(request));

    expect(factory.mock.calls[0]?.[2]?.permissionPolicy).toEqual({ approval: "untrusted", sandbox: "read-only" });
  });

  it("executes an admitted foundation-readonly-plan invocation and records replayable evidence", async () => {
    const run = vi.fn((options: ExecutionSessionRunOptions) => eventStream([
      { type: "text_delta", content: "Review complete." },
      {
        type: "cost_update",
        usd: 0.02,
        provider: "opencode",
        model: "sonic",
        inputTokens: 42,
        outputTokens: 7,
        cacheReadTokens: 3,
      },
      { type: "completed", totalUsd: 0.02, durationMs: 25, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const session: CliSession = { run, dispose };
    const factory = vi.fn(() => session);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory,
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeRequest();

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    expect(factory).toHaveBeenCalledWith(
      "Inspect the managed invocation contract.",
      "C:/workspace/kiln",
      {
        kilnSessionId: "session-parent:managed:invocation-opencode-1",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
        },
      },
    );
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kilnSessionId: "session-parent:managed:invocation-opencode-1",
      cwd: "C:/workspace/kiln",
      prompt: "Read the relevant files and return a compact review.",
      system: "Inspect the managed invocation contract.",
    });
    expect(dispose).toHaveBeenCalledTimes(1);

    if (result.status !== "completed") {
      throw new Error("Expected completed managed invocation result");
    }
    expect(result.record).toMatchObject({
      invocationId: request.invocationId,
      childSessionId: "session-parent:managed:invocation-opencode-1",
      lifecycleState: "completed",
      capabilitySnapshot: {
        authorityEvidence: {
          requested: {
            authority: "auto",
            source: "managed-invocation-request",
            proof: "proven",
          },
          projected: {
            permissionProfile: "read-only",
            approval: "on-request",
            sandbox: "read-only",
            source: "cli-harness-session-factory",
            proof: "proven",
          },
          observedRuntime: {
            proof: "unavailable",
            source: "not-observed",
          },
          classification: "effective-policy-unproven",
        },
      },
      transcript: {
        uri: "kiln://managed-agents/invocations/invocation-opencode-1/transcript",
        redacted: "unknown",
        truncated: false,
        persisted: true,
        retention: "session",
      },
      usage: {
        source: "adapter",
        tokenClasses: [
          { name: "input", value: 42 },
          { name: "output", value: 7 },
          { name: "cache_read", value: 3 },
        ],
        cost: { currency: "USD", amount: 0.02 },
      },
      resultHandoff: {
        summary: "Review complete.",
        resourceUris: ["kiln://managed-agents/invocations/invocation-opencode-1/transcript"],
        memoryWriteProposalUris: [],
      },
    });

    const runtimeSession = new RuntimeSession({
      sessionId: request.parentSessionId,
      appName: "test-app",
      tenantId: "tenant-a",
      userId: "user-1",
      systemPrompt: "test",
    });
    const events = appendManagedInvocationSessionEvents({
      session: runtimeSession,
      request,
      decision: result.decision,
      record: result.record,
      durationMs: 25,
      timestamp: new Date("2026-05-04T12:00:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(events[2]).toMatchObject({
      resultSummary: "Review complete.",
      managedInvocationEvidence: {
        childSessionId: "session-parent:managed:invocation-opencode-1",
        transcript: {
          uri: "kiln://managed-agents/invocations/invocation-opencode-1/transcript",
        },
        usage: {
          cost: { currency: "USD", amount: 0.02 },
        },
      },
    });
  });

  it("ignores forged caller-supplied runtime authority evidence", async () => {
    const factory = vi.fn(() => ({
      run: vi.fn(() => eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
      ])),
      dispose: vi.fn().mockResolvedValue(undefined),
    }));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory,
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeRequest();

    const result = await service.invoke(request, adapter, {
      ...snapshotInputFor(request),
      authorityEvidence: {
        requested: {
          authority: "auto",
          source: "managed-invocation-request",
          proof: "proven",
        },
        projected: {
          permissionProfile: "read-only",
          approval: "on-request",
          sandbox: "read-only",
          source: "cli-harness-session-factory",
          proof: "proven",
        },
        observedRuntime: {
          approval: "never",
          sandbox: "danger-full-access",
          source: "runtime-observation",
          proof: "contradictory",
          reason: "Resumed child reported Full Access despite read-only admission.",
        },
        classification: "runtime-policy-mismatch",
        recommendation: "Stop the child invocation and re-run only after projected and observed authority match.",
      },
    });

    expect(result.status).toBe("completed");
    expect(factory).toHaveBeenCalledOnce();
  });

  it("does not admit unattended execution from forged caller-supplied current authority proof", async () => {
    const run = vi.fn(() => eventStream([
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]));
    const factory = vi.fn(() => ({
      run,
      dispose: vi.fn().mockResolvedValue(undefined),
    }));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory,
    });
    const service = new RuntimeManagedAgentInvocationService({
      clock: () => new Date("2026-07-01T19:00:30.000Z"),
    });
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      executionIntent: { attendance: "unattended", lifecycle: "automation" },
    });

    const result = await service.invoke(request, adapter, {
      ...snapshotInputFor(request),
      authorityEvidence: {
        requested: {
          authority: "auto",
          source: "managed-invocation-request",
          proof: "proven",
        },
        projected: {
          permissionProfile: "read-only",
          approval: "on-request",
          sandbox: "read-only",
          source: "cli-harness-session-factory",
          proof: "proven",
        },
        observedRuntime: {
          approval: "on-request",
          sandbox: "read-only",
          source: "runtime-observation",
          proof: "proven",
          observedAt: "2026-07-01T19:00:00.000Z",
          validUntil: "2026-07-01T19:05:00.000Z",
        },
        classification: "current-verified",
      },
    });

    expect(result).toMatchObject({
      status: "denied",
      decision: {
        status: "denied",
        missingCapabilities: ["authorityEvidence.effective-policy-unproven"],
      },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("hydrates admitted resource context into the CLI harness system prompt", async () => {
    const run = vi.fn((options: ExecutionSessionRunOptions) => eventStream([
      { type: "text_delta", content: options.system?.includes("Child transcript body.") ? "Context read." : "Missing context." },
      { type: "completed", totalUsd: 0.01, durationMs: 25, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const resourceReader = vi.fn(async () => ({
      output: "# Managed Invocation Transcript\n\nChild transcript body.",
      isError: false,
    }));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
      resourceReader,
    });
    const service = new RuntimeManagedAgentInvocationService();
    const baseRequest = makeRequest();
    const request = defineManagedAgentInvocationRequest({
      ...baseRequest,
      input: {
        ...baseRequest.input,
        prompt: "Summarize the supplied managed resource.",
        resourceUris: ["kiln://managed-agents/invocations/child-1/transcript"],
        context: {
          mode: "resources",
        },
      },
    });

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    expect(resourceReader).toHaveBeenCalledWith(expect.objectContaining({
      uri: "kiln://managed-agents/invocations/child-1/transcript",
      toolCall: expect.objectContaining({
        id: "invocation-opencode-1:resource-context:1",
        name: "resource_read",
      }),
    }));
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      prompt: "Summarize the supplied managed resource.",
    });
    expect(run.mock.calls[0]?.[0].system).toContain("kiln://managed-agents/invocations/child-1/transcript");
    expect(run.mock.calls[0]?.[0].system).toContain("Child transcript body.");
  });

  it("fails a completed read-only harness run that returns no result handoff", async () => {
    const run = vi.fn(() => eventStream([
      { type: "completed", totalUsd: 0.01, durationMs: 25, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeRequest();

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("Expected completed service envelope with failed invocation record");
    }
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/invocation-opencode-1/resources/diagnostics",
      kind: "failure",
      classification: "result_handoff_missing",
    }]);
    expect(result.record.resultHandoff).toMatchObject({
      summary: "Managed CLI harness invocation failed: the child process completed without a result handoff.",
      resourceUris: ["kiln://managed-agents/invocations/invocation-opencode-1/transcript"],
      memoryWriteProposalUris: [],
    });
  });

  it("fails closed before starting an unattended harness child when runtime authority is unproven", async () => {
    const run = vi.fn(() => eventStream([
      { type: "text_delta", content: "Should not run." },
      { type: "completed", totalUsd: 0.01, durationMs: 25, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn(() => ({ run, dispose }));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory,
    });
    const service = new RuntimeManagedAgentInvocationService();
    const baseRequest = makeRequest();
    const request = defineManagedAgentInvocationRequest({
      ...baseRequest,
      requestSource: "background-job",
      executionIntent: { attendance: "unattended", lifecycle: "background" },
      requestedAuthority: "audited",
    });

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result).toMatchObject({
      status: "denied",
      decision: {
        status: "denied",
        missingCapabilities: ["authorityEvidence.effective-policy-unproven"],
      },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("admits proof-required execution only from a fresh runtime-owned observation", async () => {
    const factory = vi.fn(() => ({
      run: vi.fn(() => eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
      ])),
      dispose: vi.fn().mockResolvedValue(undefined),
    }));
    const adapter = new ManagedCliHarnessAdapter({ providerId: "opencode", model: "sonic", factory });
    const observe = vi.fn().mockResolvedValue({
      approval: "on-request",
      sandbox: "read-only",
      source: "runtime-observation",
      proof: "proven",
      observedAt: "2026-07-01T19:00:00.000Z",
      validUntil: "2026-07-01T19:05:00.000Z",
    });
    const service = new RuntimeManagedAgentInvocationService({
      authorityObserver: { observe },
      clock: () => new Date("2026-07-01T19:00:30.000Z"),
    });
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      executionIntent: { attendance: "unattended", lifecycle: "automation" },
    });

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    expect(observe.mock.calls.map(([input]) => input.phase)).toEqual(["pre-start", "post-start"]);
  });

  it("fails closed with authority evidence when pre-start runtime observation fails", async () => {
    const run = vi.fn(() => eventStream([
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]));
    const factory = vi.fn(() => ({
      run,
      dispose: vi.fn().mockResolvedValue(undefined),
    }));
    const adapter = new ManagedCliHarnessAdapter({ providerId: "opencode", model: "sonic", factory });
    const observe = vi.fn().mockRejectedValue(new Error("permission probe crashed"));
    const service = new RuntimeManagedAgentInvocationService({
      authorityObserver: { observe },
      clock: () => new Date("2026-07-01T19:00:30.000Z"),
    });
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      executionIntent: { attendance: "unattended", lifecycle: "automation" },
    });

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result).toMatchObject({
      status: "denied",
      decision: {
        status: "denied",
        missingCapabilities: ["authorityEvidence.failed-observation"],
      },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when post-start observation detects authority broadening", async () => {
    const run = vi.fn(() => eventStream([
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]));
    const factory = vi.fn(() => ({
      run,
      dispose: vi.fn().mockResolvedValue(undefined),
    }));
    const adapter = new ManagedCliHarnessAdapter({ providerId: "opencode", model: "sonic", factory });
    const observe = vi.fn()
      .mockResolvedValueOnce({
        approval: "on-request", sandbox: "read-only", source: "runtime-observation", proof: "proven",
        observedAt: "2026-07-01T19:00:00.000Z", validUntil: "2026-07-01T19:05:00.000Z",
      })
      .mockResolvedValueOnce({
        approval: "never", sandbox: "danger-full-access", source: "runtime-observation", proof: "proven",
        observedAt: "2026-07-01T19:00:10.000Z", validUntil: "2026-07-01T19:05:00.000Z",
      });
    const service = new RuntimeManagedAgentInvocationService({
      authorityObserver: { observe },
      clock: () => new Date("2026-07-01T19:00:30.000Z"),
    });

    const request = makeRequest();
    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result).toMatchObject({
      status: "completed",
      record: {
        lifecycleState: "failed",
        resultHandoff: { summary: "Managed child runtime authority changed after start: runtime-policy-mismatch" },
      },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("proves admitted write authority with replayable proposal, decision, attempt, and terminal evidence", async () => {
    const run = vi.fn((options: ExecutionSessionRunOptions) => eventStream([
      { type: "text_delta", content: "Approved fixture update applied." },
      {
        type: "file_changed",
        path: "C:/workspace/kiln/packages/runtime/tests/fixtures/managed-write-proof.txt",
        changeType: "modified",
        linesAdded: 1,
        linesRemoved: 0,
        diffPreview: "diff --git a/managed-write-proof.txt b/managed-write-proof.txt",
        diffTruncated: true,
      },
      { type: "completed", totalUsd: 0.01, durationMs: 20, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn(() => ({ run, dispose }));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory,
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: true,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeWriteRequest();

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    expect(factory).toHaveBeenCalledWith(
      "Apply an approved fixture update.",
      "C:/workspace/kiln",
      {
        kilnSessionId: "session-parent:managed:invocation-opencode-write-1",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "workspace-write",
        },
      },
    );
    if (result.status !== "completed") {
      throw new Error("Expected completed managed write invocation result");
    }
    expect(result.decision.writeAuthority).toEqual(request.authority.writeAuthority);
    expect(result.record.writeEvidence?.map((evidence) => evidence.kind)).toEqual([
      "write-proposal-created",
      "write-proposal-approved",
      "write-attempt-completed",
    ]);
    expect(result.record.writeEvidence?.flatMap((evidence) => evidence.resourceUris)).toEqual([
      "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/write-proposals/1",
      "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/write-decisions/1",
      "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/write-attempts/1",
    ]);
    expect(JSON.stringify(result.record.writeEvidence)).not.toContain("diff --git");
    expect(result.record.resultHandoff).toMatchObject({
      summary: "Approved fixture update applied.",
      resourceUris: [
        "kiln://managed-agents/invocations/invocation-opencode-write-1/transcript",
        "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/write-attempts/1",
      ],
      memoryWriteProposalUris: [],
    });

    const runtimeSession = new RuntimeSession({
      sessionId: request.parentSessionId,
      appName: "test-app",
      tenantId: "tenant-a",
      userId: "user-1",
      systemPrompt: "test",
    });
    const events = appendManagedInvocationSessionEvents({
      session: runtimeSession,
      request,
      decision: result.decision,
      record: result.record,
      durationMs: 20,
      timestamp: new Date("2026-05-04T12:00:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(events[2]).toMatchObject({
      managedInvocationEvidence: {
        writeAuthority: {
          ...request.authority.writeAuthority,
          scope: {
            ...request.authority.writeAuthority?.scope,
            workspace: {
              ...request.authority.writeAuthority?.scope.workspace,
              allowedPaths: ["packages/runtime/tests/fixtures"],
              deniedPaths: [".git"],
            },
            artifacts: {
              ...request.authority.writeAuthority?.scope.artifacts,
              resourceUris: [
                "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/write",
              ],
            },
          },
          approval: {
            ...request.authority.writeAuthority?.approval,
            evidenceUris: [
              "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/approval",
            ],
          },
        },
        writeEvidence: result.record.writeEvidence?.map((evidence) => ({
          ...evidence,
          summary: evidence.summary.replace(
            "C:/workspace/kiln/",
            "./",
          ),
        })),
      },
    });
  });

  it("fails apply-approved write invocations that complete without workspace write evidence", async () => {
    const run = vi.fn(() => eventStream([
      { type: "text_delta", content: "Approved fixture update applied." },
      { type: "completed", totalUsd: 0.01, durationMs: 20, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: true,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeWriteRequest();

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("Expected completed service envelope with failed write invocation record");
    }
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.writeEvidence).toBeUndefined();
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/diagnostics",
      kind: "failure",
    }]);
    expect(result.record.resultHandoff).toMatchObject({
      summary: "Managed CLI harness invocation failed: apply-approved workspace write authority completed without write-attempt evidence.",
      resourceUris: ["kiln://managed-agents/invocations/invocation-opencode-write-1/transcript"],
      memoryWriteProposalUris: [],
    });
  });

  it("records read-only OpenCode write denials as replayable authority-denied evidence", async () => {
    const run = vi.fn((options: ExecutionSessionRunOptions) => eventStream([
      { type: "text_delta", content: "Write denied by policy." },
      {
        type: "write_decision",
        status: "denied",
        providerRequestId: "opencode-denial-1",
        actor: "opencode-policy",
        reason: "OpenCode denied edit permission for proof.txt.",
      },
      { type: "completed", totalUsd: 0.01, durationMs: 20, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeRequest();

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("Expected completed managed read-only denial result");
    }
    expect(result.record.writeEvidence).toEqual([{
      evidenceId: "invocation-opencode-1:write-authority-denied:opencode-denial-1",
      invocationId: "invocation-opencode-1",
      kind: "write-authority-denied",
      summary: "Live write authority denied by opencode-policy: OpenCode denied edit permission for proof.txt.",
      resourceUris: ["kiln://managed-agents/invocations/invocation-opencode-1/resources/write-denials/opencode-denial-1"],
      recordedAt: expect.any(String),
    }]);
    expect(result.record.resultHandoff.resourceUris).toContain(
      "kiln://managed-agents/invocations/invocation-opencode-1/resources/write-denials/opencode-denial-1",
    );
  });

  it("detects and restores silent filesystem changes during read-only live harness runs", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "kiln-managed-cli-boundary-"));
    const proofPath = join(workspaceRoot, "proof.txt");
    await writeFile(proofPath, "before\n", "utf8");

    try {
      const run = vi.fn(() =>
        (async function* stream(): AsyncGenerator<ExecutionSessionEvent> {
          await writeFile(proofPath, "after", "utf8");
          yield { type: "text_delta", content: "Attempted fixture update." };
          yield { type: "completed", totalUsd: 0.01, durationMs: 20, outcome: "completed", isPreflightCrash: false };
        })(),
      );
      const dispose = vi.fn().mockResolvedValue(undefined);
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "opencode",
        model: "sonic",
        factory: () => ({ run, dispose }),
        filesystemBoundary: {
          enabled: true,
          trackedPaths: [proofPath],
          restoreReadOnlyViolations: true,
        },
      });
      const service = new RuntimeManagedAgentInvocationService();

      const request = makeRequest();
      const result = await service.invoke(request, adapter, snapshotInputFor(request));

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed managed read-only boundary result");
      }
      await expect(readFile(proofPath, "utf8")).resolves.toBe("before\n");
      expect(result.record.writeEvidence?.map((evidence) => evidence.kind)).toEqual([
        "write-authority-denied",
      ]);
      expect(result.record.writeEvidence?.[0]?.summary).toContain("Live harness modified files during read-only invocation");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns a timed-out record deterministically when fake time reaches the authority timeout", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-28T04:45:00.000Z") });
    const runStarted = deferred();
    const run = vi.fn(() =>
      (async function* neverFinishes(): AsyncGenerator<ExecutionSessionEvent> {
        runStarted.resolve();
        await new Promise(() => undefined);
      })(),
    );
    const dispose = vi.fn().mockResolvedValue(undefined);
    try {
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "opencode",
        model: "sonic",
        factory: () => ({ run, dispose }),
      });
      const service = new RuntimeManagedAgentInvocationService();

      const timeoutRequest = makeRequest(5000);
      const resultPromise = service.invoke(timeoutRequest, adapter, snapshotInputFor(timeoutRequest));
      await runStarted.promise;
      let settled = false;
      resultPromise.then(() => {
        settled = true;
      }, () => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(4999);
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const result = await resultPromise;

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed managed invocation result");
      }
      expect(result.record.lifecycleState).toBe("timed_out");
      expect(result.record.diagnostics).toEqual([{
        uri: "kiln://managed-agents/invocations/invocation-opencode-1/resources/timeout",
        kind: "timeout",
      }]);
      expect(result.record.resultHandoff?.summary).toContain("timed out after 5000ms");
      expect(result.record.resultHandoff?.summary).toContain("No completed child handoff was produced before timeout");
      expect(result.record.resultHandoff?.summary).toContain("Inspect the transcript and timeout diagnostic resources");
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves partial write evidence when a live harness times out after a bounded file change", async () => {
    const run = vi.fn(() =>
      (async function* partialWriteThenTimeout(): AsyncGenerator<ExecutionSessionEvent> {
        yield {
          type: "file_changed",
          path: "C:/workspace/kiln/packages/runtime/tests/fixtures/managed-write-proof.txt",
          changeType: "modified",
          linesAdded: 1,
          linesRemoved: 1,
          diffPreview: "diff --git a/managed-write-proof.txt b/managed-write-proof.txt",
          diffTruncated: true,
          resourceUris: ["kiln://managed-invocations/invocation-opencode-write-1/diffs/1"],
        } as ExecutionSessionEvent;
        await new Promise(() => undefined);
      })(),
    );
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: true,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const service = new RuntimeManagedAgentInvocationService();

    const timeoutWriteRequest = makeWriteRequest(1);
    const result = await service.invoke(timeoutWriteRequest, adapter, snapshotInputFor(timeoutWriteRequest));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("Expected completed managed timeout result");
    }
    expect(result.record.lifecycleState).toBe("timed_out");
    expect(result.record.writeEvidence?.map((evidence) => evidence.kind)).toEqual([
      "write-proposal-created",
      "write-proposal-approved",
      "write-attempt-completed",
    ]);
    expect(result.record.writeEvidence?.[2]?.resourceUris).toEqual([
      "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/write-attempts/1",
      "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/diffs/1",
    ]);
    expect(JSON.stringify(result.record.writeEvidence)).not.toContain("diff --git");
    expect(result.record.resultHandoff?.resourceUris).toContain(
      "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/diffs/1",
    );
  });

  it("records cancellation during a pending write decision without dropping denied write evidence", async () => {
    const run = vi.fn(() => eventStream([
      {
        type: "write_decision",
        status: "denied",
        providerRequestId: "opencode-cancelled-approval-1",
        actor: "operator",
        reason: "Operator cancelled the pending write approval.",
        resourceUris: ["kiln://managed-invocations/invocation-opencode-write-1/write-decisions/opencode-cancelled-approval-1"],
      },
      {
        type: "error",
        code: "USER_CANCELLED",
        message: "Operator cancelled the managed write.",
        isRetryable: false,
      },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: true,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeWriteRequest();

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("Expected completed managed cancellation result");
    }
    expect(result.record.lifecycleState).toBe("cancelled");
    expect(result.record.writeEvidence?.map((evidence) => evidence.kind)).toEqual([
      "write-proposal-denied",
    ]);

    const runtimeSession = new RuntimeSession({
      sessionId: request.parentSessionId,
      appName: "test-app",
      tenantId: "tenant-a",
      userId: "user-1",
      systemPrompt: "test",
    });
    const events = appendManagedInvocationSessionEvents({
      session: runtimeSession,
      request,
      decision: result.decision,
      record: result.record,
      durationMs: 20,
      timestamp: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_cancelled",
    ]);
    expect(events[2]).toMatchObject({
      managedInvocationEvidence: {
        writeEvidence: result.record.writeEvidence,
      },
    });
  });

  it("reconstructs artifact-linked live write evidence after session serialization reload", async () => {
    const run = vi.fn(() => eventStream([
      {
        type: "file_changed",
        path: "C:/workspace/kiln/packages/runtime/tests/fixtures/managed-write-proof.txt",
        changeType: "modified",
        linesAdded: 2,
        linesRemoved: 1,
        diffPreview: "diff --git a/managed-write-proof.txt b/managed-write-proof.txt",
        diffTruncated: true,
        resourceUris: ["kiln://managed-invocations/invocation-opencode-write-1/diffs/1"],
      } as ExecutionSessionEvent,
      { type: "completed", totalUsd: 0.01, durationMs: 20, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: true,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeWriteRequest();

    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("Expected completed managed write result");
    }

    const runtimeSession = new RuntimeSession({
      sessionId: request.parentSessionId,
      appName: "test-app",
      tenantId: "tenant-a",
      userId: "user-1",
      systemPrompt: "test",
    });
    appendManagedInvocationSessionEvents({
      session: runtimeSession,
      request,
      decision: result.decision,
      record: result.record,
      durationMs: 20,
      timestamp: new Date("2026-05-06T12:00:00.000Z"),
    });

    const restored = deserializeSession(serializeSession(runtimeSession));
    const terminalEvent = restored.sessionEvents[2];

    expect(terminalEvent).toMatchObject({
      kind: "agent_invocation_completed",
      managedInvocationEvidence: {
        writeEvidence: [{
          kind: "write-proposal-created",
        }, {
          kind: "write-proposal-approved",
        }, {
          kind: "write-attempt-completed",
          resourceUris: [
            "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/write-attempts/1",
            "kiln://managed-agents/invocations/invocation-opencode-write-1/resources/diffs/1",
          ],
        }],
      },
    });
    expect(JSON.stringify(restored.sessionEvents)).not.toContain("diff --git");
  });

  it("forwards managed environment bindings to the CLI harness session without recording values as lease evidence", async () => {
    const run = vi.fn((options: ExecutionSessionRunOptions) => eventStream([
      { type: "text_delta", content: `Port ${options.env?.KILN_DEV_SERVER_PORT ?? "missing"} received.` },
      { type: "completed", totalUsd: 0.01, durationMs: 20, outcome: "completed", isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
    });
    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-opencode-1/environment/KILN_DEV_SERVER_PORT",
          ],
        },
        environment: {
          KILN_DEV_SERVER_PORT: "49152",
        },
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-opencode-1/environment-release/KILN_DEV_SERVER_PORT",
        ],
      })),
    };
    const service = new RuntimeManagedAgentInvocationService({ environmentLeaseManager });

    const request = makeRequest();
    const result = await service.invoke(request, adapter, snapshotInputFor(request));

    expect(run.mock.calls[0]?.[0].env).toEqual({
      KILN_DEV_SERVER_PORT: "49152",
    });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("Expected completed managed invocation result");
    }
    expect(result.record.resultHandoff.summary).toBe("Port 49152 received.");
    expect(result.record.resourceLease?.resourceUris).toEqual([
      "kiln://artifacts/invocation-opencode-1/environment/KILN_DEV_SERVER_PORT",
    ]);
    expect(result.record.resourceLease?.diagnosticUris).toEqual([
      "kiln://artifacts/invocation-opencode-1/environment-release/KILN_DEV_SERVER_PORT",
    ]);
    expect(result.record.resourceLease?.resourceUris).not.toContain(
      "kiln://artifacts/invocation-opencode-1/environment/49152",
    );
  });
});
