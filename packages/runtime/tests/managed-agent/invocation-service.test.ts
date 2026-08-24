import { describe, expect, it, vi } from "vitest";
import { defineManagedAgentInvocationRecord, defineManagedAgentInvocationRequest } from "@kilnai/core/agents";
import type { StructuredExecutionResult } from "@kilnai/core/efficiency";
import { ManagedAgentRuntimeAdmissionError, RuntimeManagedAgentInvocationService, createManagedAgentInvocationResourceProvider } from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";
import { makeSnapshotInput, makeRequest, makeDescriptor, makeRecord, makeReadonlyRecordForRequest, runtimeGeneratedProvenance } from "./invocation-service-test-fixture.js";

describe("RuntimeManagedAgentInvocationService admission", () => {
  it("admits through core policy before invoking the runtime adapter", async () => {
    const invoke = vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(makeRequest(), adapter, makeSnapshotInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed invocation");
    expect(result.record.coordinationUsage).toMatchObject({
      version: "managed-agent-coordination-usage-v1",
      workerId: "child-session-1",
      coverage: "partial",
      reconciliation: "mutually-exclusive",
    });
    expect(result.record.coordinationUsage?.components.map((component) => component.stage)).toEqual([
      "parent_prompt",
      "child_bootstrap",
      "duplicated_reads",
      "handoff",
      "review",
      "synthesis",
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0].admission).toMatchObject({
      status: "admitted",
      adapterDescriptorId: "adapter:opencode:harness",
      authorityProfileId: "foundation-readonly",
    });
  });

  const adapterCases = [
    {
      label: "direct-provider",
      providerId: "openai",
      surface: "direct-provider" as const,
      adapterKind: "direct" as const,
      executionMode: "direct-provider" as const,
      supportedExecutionModes: ["direct-provider"] as const,
    },
    {
      label: "cli-harness",
      providerId: "opencode",
      surface: "cli-harness" as const,
      adapterKind: "harness" as const,
      executionMode: "cli-harness" as const,
      supportedExecutionModes: ["cli-harness"] as const,
    },
    {
      label: "remote-harness",
      providerId: "codex-cloud",
      surface: "remote-harness" as const,
      adapterKind: "harness" as const,
      executionMode: "remote-harness" as const,
      supportedExecutionModes: ["remote-harness"] as const,
    },
  ] as const;
  const proofRequiredExecutionCases = [
    {
      executionLabel: "unattended-foreground",
      attendance: "unattended" as const,
      lifecycle: "foreground" as const,
    },
    {
      executionLabel: "attended-background",
      attendance: "attended" as const,
      lifecycle: "background" as const,
    },
  ] as const;

  it.each(
    adapterCases.flatMap((adapter) => proofRequiredExecutionCases.map((execution) => ({ ...adapter, ...execution }))),
  )("does not invoke an $label adapter for $executionLabel work without runtime observation", async ({
    label,
    providerId,
    surface,
    adapterKind,
    executionMode,
    supportedExecutionModes,
    executionLabel,
    attendance,
    lifecycle,
  }) => {
    const baseRequest = makeRequest();
    const request = defineManagedAgentInvocationRequest({
      ...baseRequest,
      invocationId: `${executionLabel}-${label}`,
      requestSource: "background-job",
      executionIntent: { attendance, lifecycle },
      requestedAuthority: "audited",
      providerRoute: {
        ...baseRequest.providerRoute,
        providerId,
        surface,
      },
      adapterKind,
      executionMode,
    });
    const invoke = vi.fn(async () => makeRecord());
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        adapterDescriptorId: `adapter:${label}`,
        providerId,
        adapterKind,
        supportedExecutionModes,
      }),
      invoke,
    };

    const result = await new RuntimeManagedAgentInvocationService().invoke(
      request,
      adapter,
      makeSnapshotInput({ routeId: `route:${label}` }),
    );

    expect(result).toMatchObject({
      status: "denied",
      decision: {
        status: "denied",
        missingCapabilities: ["authorityEvidence.effective-policy-unproven"],
      },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("enforces required handoff fields on the adapter-owned structured result", async () => {
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      input: {
        summary: "Inspect the contract",
        handoff: {
          requiredResultFields: ["summary", "evidence", "verificationResults", "uncertainty", "limitations"],
          residualRiskRequired: true,
          outputVerbosity: "concise",
        },
      },
    });
    const structuredResult: StructuredExecutionResult = {
      version: "structured-execution-result-v1",
      status: "completed",
      summary: "Inspection completed with deterministic evidence.",
      uncertainty: 0.2,
      limitations: ["No live provider call was required."],
      operatorDecisions: [],
      evidence: [{ uri: "kiln://artifacts/invocation-1/result", kind: "verification" }],
      citations: [],
      warnings: [],
      failures: [],
      approvalRequirements: [],
      residualRisks: ["No live provider call was required."],
      verificationResults: [{
        requirementId: "contract",
        method: "deterministic",
        status: "passed",
        summary: "The contract is valid.",
        evidenceUris: ["kiln://artifacts/invocation-1/result"],
      }],
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => {
        const baseRecord = makeReadonlyRecordForRequest(request, admission.capabilitySnapshot);
        return defineManagedAgentInvocationRecord({
          ...baseRecord,
          usage: {
            source: "adapter",
            tokenClasses: [
              { name: "input", value: 20 },
              { name: "output", value: 150 },
              { name: "cache_read", value: 0 },
            ],
            cost: { currency: "USD", amount: 0.012 },
          },
          resultHandoff: {
            ...baseRecord.resultHandoff!,
            summary: "H".repeat(400),
            structuredResult,
          },
          replayResources: [{
            uri: "kiln://artifacts/invocation-1/result",
            mimeType: "application/json",
            text: JSON.stringify(structuredResult),
          }],
        });
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(request, adapter, makeSnapshotInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed invocation");
    expect(result.record.resultHandoff?.structuredResult).toMatchObject({
      status: "completed",
      uncertainty: 0.2,
      residualRisks: ["No live provider call was required."],
      verificationResults: [{ requirementId: "contract", status: "passed" }],
    });
    expect(result.record.resultHandoff?.verificationUsage).toMatchObject({
      version: "verification-usage-v1",
      attempts: [{
        requirementId: "contract",
        method: "deterministic",
        status: "passed",
        tokens: { value: 0, source: "estimated" },
        costUsd: { value: 0, source: "estimated" },
        latencyMs: { value: "unknown", source: "unknown" },
      }],
      totals: { tokens: 0, costUsd: 0, latencyMs: "unknown" },
    });
    const resources = createManagedAgentInvocationResourceProvider({
      service,
      parentSessionId: request.parentSessionId,
    });
    const detail = await resources.read(`kiln://managed-agents/invocations/${request.invocationId}`);
    const resourceContent = detail?.contents[0];
    if (!resourceContent || !("text" in resourceContent)) {
      throw new Error("expected invocation resource text");
    }
    const invocation = JSON.parse(resourceContent.text).invocation;
    expect(invocation.lifecycleAttribution.ledger.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "coordination", workerId: "child-session-1" }),
    ]));
    expect(invocation.efficiencyEvidence.totals.providerTotalTokens).toBe(170);
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

  it("preserves a timed-out terminal record instead of misclassifying it as a handoff schema failure", async () => {
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      input: {
        summary: "Inspect the contract",
        handoff: {
          requiredResultFields: ["summary", "verificationResults", "residualRisks"],
          residualRiskRequired: true,
        },
      },
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => defineManagedAgentInvocationRecord({
        ...makeReadonlyRecordForRequest(request, admission.capabilitySnapshot),
        lifecycleState: "timed_out",
        diagnostics: [{
          uri: "kiln://artifacts/invocation-1/timeout",
          kind: "timeout",
        }],
        resultHandoff: {
          provenance: runtimeGeneratedProvenance(request.providerRoute.model),
          summary: "Managed invocation timed out before a completed handoff was produced.",
          resourceUris: ["kiln://artifacts/invocation-1/timeout"],
          memoryWriteProposalUris: [],
        },
      })),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(request, adapter, makeSnapshotInput());

    expect(result).toMatchObject({
      status: "completed",
      record: {
        lifecycleState: "timed_out",
        diagnostics: [{ kind: "timeout" }],
        resultHandoff: {
          summary: "Managed invocation timed out before a completed handoff was produced.",
        },
      },
    });
  });
  it("does not invoke the adapter when admission is denied", async () => {
    const invoke = vi.fn(async () => makeRecord());
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        timeout: { supported: false, diagnosticArtifactOnTimeout: false },
      }),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(makeRequest(), adapter, makeSnapshotInput());

    expect(result.status).toBe("denied");
    expect(result.decision).toMatchObject({
      status: "denied",
      missingCapabilities: expect.arrayContaining(["timeout.supported"]),
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not register denied starts as background invocations", async () => {
    const invoke = vi.fn(async () => makeRecord());
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        timeout: { supported: false, diagnosticArtifactOnTimeout: false },
      }),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

    expect(started.status).toBe("denied");
    expect(service.status("invocation-1")).toBeUndefined();
    expect(service.list()).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects direct runtime execution without an admitted decision for the same adapter descriptor", async () => {
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async () => makeRecord()),
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.invokeAdmitted({
      request: makeRequest(),
      adapter,
      admission: {
        status: "denied",
        invocationId: "invocation-1",
        profile: "foundation-readonly-plan",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
        reason: "foundation-readonly-plan denied: timeout.supported",
        missingCapabilities: ["timeout.supported"],
      },
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);
  });
});
