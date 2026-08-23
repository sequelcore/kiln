import { describe, expect, it } from "vitest";
import type { StructuredExecutionResult } from "@kilnai/core/efficiency";
import { WorkItemStore } from "@kilnai/core/work-governance";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.js";
import { assertManagedToolResult, createAttachedRuntimeBuiltinToolSurface, makeSession, makeAdapterWithHandoff, makeTimedOutAdapter, makeSurface, makeSurfaceOptions, makeManagedRoute } from "./managed-invocation-tool-test-fixture.js";

describe("managed invocation runtime tool — recovery and governed handoff", () => {
  it("returns phase recovery instructions when an explicit intermediate managed child times out", async () => {
    const surface = makeSurface(makeTimedOutAdapter());
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-timeout",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-ui",
      goalRunId: "goal-run-test",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read"],
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read"],
        completionTool: "work_item.update",
        finalPhase: false,
        autoStartAllowed: false,
        instruction: "Record only this phase evidence before requesting the next phase.",
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly childSessionId?: string;
        readonly childTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly managedInvocationRecovery?: Record<string, unknown>;
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly childSessionId?: string;
      readonly childTurnId?: string;
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
      readonly recovery?: {
        readonly nextTool?: string;
        readonly workItemId?: string;
        readonly evidenceToRecord?: readonly string[];
        readonly thenTool?: string;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("timed_out");
    expect(result.metadata).toMatchObject({
      childSessionId: expect.stringContaining(`${session.id}:managed:`),
      childTurnId: expect.stringContaining(`${session.id}:managed:`),
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
    });
    expect(result.metadata.managedInvocationRecovery).toMatchObject({
      nextTool: "work_item.update",
      workItemId: "work-ui",
      evidenceToRecord: ["visual-reference-research"],
      thenTool: "work_item.execution.start",
    });
    expect(output).toMatchObject({
      status: "timed_out",
      childSessionId: expect.stringContaining(`${session.id}:managed:`),
      childTurnId: expect.stringContaining(`${session.id}:managed:`),
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      recovery: {
        nextTool: "work_item.update",
        workItemId: "work-ui",
        evidenceToRecord: ["visual-reference-research"],
        thenTool: "work_item.execution.start",
      },
    });
  });

  it("blocks the work item without inventing an attempt when a final managed child times out", async () => {
    const surface = makeSurface(makeTimedOutAdapter());
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-final-timeout",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Execute the final managed child phase.",
      summary: "Execute the final managed child phase.",
      goalRunId: "goal-final",
      workItemId: "work-final",
      expectedEvidence: ["managed-orchestration:result-handoff"],
      executionPhase: {
        id: "managed-review-closeout",
        expectedEvidence: ["managed-orchestration:result-handoff"],
        requiredToolNames: ["read"],
        completionTool: "work_item.execution.finish",
        finalPhase: true,
        autoStartAllowed: true,
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly managedInvocationRecovery?: Record<string, unknown>;
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly recovery?: {
        readonly nextTool?: string;
        readonly goalRunId?: string;
        readonly workItemId?: string;
        readonly evidenceToRecord?: readonly string[];
        readonly blockedWorkItemUpdateInputTemplate?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("timed_out");
    expect(result.metadata.managedInvocationRecovery).toMatchObject({
      nextTool: "work_item.update",
      workItemId: "work-final",
      evidenceToRecord: ["managed-orchestration:result-handoff"],
      blockedWorkItemUpdateInputTemplate: {
        id: "work-final",
        status: "blocked",
        pauseRequirements: [{ kind: "capability", status: "pending" }],
      },
    });
    expect(output).toMatchObject({
      status: "timed_out",
      recovery: {
        nextTool: "work_item.update",
        workItemId: "work-final",
        evidenceToRecord: ["managed-orchestration:result-handoff"],
        blockedWorkItemUpdateInputTemplate: {
          id: "work-final",
          status: "blocked",
        },
      },
    });
  });

  it("retains and supersedes two successive direct managed failures on the canonical work item", async () => {
    const workItemStore = new WorkItemStore();
    workItemStore.upsert({
      id: "work-recovery-chain",
      summary: "Recover successive managed failures.",
      workflowProfile: "verification-heavy",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-orchestration:result-handoff"],
      verificationGates: [],
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { workItemStore },
      managedInvocation: makeSurfaceOptions(makeTimedOutAdapter()),
    });
    const invoke = surface.callBuiltinTools.get("managed_agent.invoke")!;
    const input = {
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      requestedAuthority: "read_only",
      task: "Execute the final managed child phase.",
      summary: "Execute the final managed child phase.",
      goalRunId: "goal-recovery-chain",
      workItemId: "work-recovery-chain",
      expectedEvidence: ["managed-orchestration:result-handoff"],
      executionPhase: {
        id: "managed-review-closeout",
        expectedEvidence: ["managed-orchestration:result-handoff"],
        requiredToolNames: ["read"],
        completionTool: "work_item.execution.finish",
        finalPhase: true,
        autoStartAllowed: true,
      },
    } as const;

    const invokeFailure = async (toolCallId: string) => {
      const result = assertManagedToolResult(await invoke(input, {
        session: makeSession(),
        toolCall: { id: toolCallId, name: "managed_agent.invoke", input: {} },
      }));
      const output = JSON.parse(result.output) as {
        readonly recovery: {
          readonly blockedWorkItemUpdateInputTemplate: {
            readonly summary: string;
            readonly status: "blocked";
            readonly pauseRequirements: NonNullable<ReturnType<WorkItemStore["get"]>>["pauseRequirements"];
          };
        };
      };
      const current = workItemStore.get("work-recovery-chain")!;
      workItemStore.upsert({
        ...current,
        ...output.recovery.blockedWorkItemUpdateInputTemplate,
      });
      const updated = workItemStore.get("work-recovery-chain")!;
      if (!updated.pauseRequirements) {
        throw new Error("Expected managed recovery pause requirements.");
      }
      return updated.pauseRequirements;
    };

    const firstRequirements = await invokeFailure("tool-call-recovery-chain-1");
    expect(firstRequirements).toHaveLength(1);
    const firstRequirement = firstRequirements[0]!;
    expect(firstRequirement).toMatchObject({
      status: "pending",
      id: expect.stringContaining("managed-invocation-capability:work-recovery-chain:"),
    });

    const secondRequirements = await invokeFailure("tool-call-recovery-chain-2");
    expect(secondRequirements).toHaveLength(2);
    const supersededRequirement = secondRequirements[0]!;
    const replacementRequirement = secondRequirements[1]!;
    expect(supersededRequirement).toMatchObject({
      id: firstRequirement.id,
      status: "superseded",
      supersededByRequirementId: secondRequirements[1]!.id,
    });
    expect(replacementRequirement).toMatchObject({
      status: "pending",
      id: expect.stringContaining("managed-invocation-capability:work-recovery-chain:"),
    });
    expect(replacementRequirement.id).not.toBe(firstRequirement.id);
  });

  it("returns a phase completion handoff when an explicit intermediate managed child succeeds", async () => {
    const phaseSummary = "Captured product UI screenshot from https://example.com/vllm-studio-demo with artifact kiln://artifacts/screenshots/vllm-studio-ui.";
    const surface = makeSurface(makeAdapterWithHandoff(phaseSummary));
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-phase-complete",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-ui",
      goalRunId: "goal-run-test",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read"],
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read"],
        completionTool: "work_item.update",
        finalPhase: false,
        autoStartAllowed: false,
        instruction: "Record only this phase evidence before requesting the next phase.",
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly managedInvocationPhaseCompletion?: Record<string, unknown>;
        readonly presentationIntent?: {
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly resultHandoff?: {
        readonly summary?: string;
        readonly resourceUris?: readonly string[];
      };
      readonly phaseCompletion?: {
        readonly nextTool?: string;
        readonly workItemId?: string;
        readonly evidenceToRecord?: readonly string[];
        readonly sourceResourceUris?: readonly string[];
        readonly workItemUpdateInputTemplate?: Record<string, unknown>;
        readonly thenTool?: string;
      };
    };

    expect(result.isError).toBe(false);
    expect(output).toMatchObject({
      status: "completed",
      resultHandoff: {
        summary: phaseSummary,
      },
      phaseCompletion: {
        nextTool: "work_item.update",
        workItemId: "work-ui",
        evidenceToRecord: ["visual-reference-research"],
        sourceResourceUris: [expect.stringContaining("kiln://managed-agents/invocations/")],
        workItemUpdateInputTemplate: {
          id: "work-ui",
          summary: "Collect visual reference research before UI implementation.",
          providedEvidence: ["visual-reference-research"],
        },
        thenTool: "work_item.execution.start",
      },
    });
    expect(result.metadata.managedInvocationPhaseCompletion).toMatchObject({
      status: "phase_completed_by_child",
      nextTool: "work_item.update",
      workItemId: "work-ui",
      evidenceToRecord: ["visual-reference-research"],
      sourceResourceUris: [expect.stringContaining("kiln://managed-agents/invocations/")],
    });
  });

  it("returns a final phase start template with the verified managed invocation handoff", async () => {
    const phaseSummary = "Managed implementation completed with tests and reviewable handoff evidence.";
    const surface = makeSurface(makeAdapterWithHandoff(phaseSummary));
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-final-phase-complete",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Execute the final managed child phase.",
      summary: "Execute the final managed child phase.",
      goalRunId: "goal-final",
      workItemId: "work-final",
      expectedEvidence: ["managed-orchestration:result-handoff"],
      executionPhase: {
        id: "managed-review-closeout",
        expectedEvidence: ["managed-orchestration:result-handoff"],
        requiredToolNames: ["read"],
        completionTool: "work_item.execution.finish",
        finalPhase: true,
        autoStartAllowed: true,
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly managedInvocationPhaseCompletion?: Record<string, unknown>;
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly phaseCompletion?: {
        readonly nextTool?: string;
        readonly goalRunId?: string;
        readonly workItemId?: string;
        readonly evidenceToRecord?: readonly string[];
        readonly workItemExecutionStartInputTemplate?: {
          readonly goalRunId?: string;
          readonly workItemId?: string;
          readonly managedInvocationId?: string;
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(output.phaseCompletion).toMatchObject({
        nextTool: "work_item.execution.start",
        goalRunId: "goal-final",
        workItemId: "work-final",
        evidenceToRecord: ["managed-orchestration:result-handoff"],
        requiredToolNames: ["read"],
        workItemExecutionStartInputTemplate: {
          goalRunId: "goal-final",
          workItemId: "work-final",
          managedInvocationId: expect.any(String),
        },
    });
    expect(result.metadata.managedInvocationPhaseCompletion).toMatchObject({
      status: "phase_completed_by_child",
      nextTool: "work_item.execution.start",
      workItemId: "work-final",
    });
  });

  it("validates final closeout gates even when no phase evidence remains", async () => {
    const surface = makeSurface(makeAdapterWithHandoff(
      "Managed review completed with a structured closeout result.",
      {},
      {
        verificationResults: [{
          requirementId: "review child handoff",
          method: "deterministic",
          status: "passed",
          summary: "The child handoff was reviewed.",
          evidenceUris: ["kiln://managed-invocations/test/transcript"],
        }],
      },
    ));
    const session = makeSession();

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Validate the final closeout gate.",
      summary: "Validate the final closeout gate.",
      goalRunId: "goal-final-gate",
      workItemId: "work-final-gate",
      executionPhase: {
        id: "managed-review-closeout",
        expectedEvidence: [],
        verificationRequirementIds: ["review child handoff"],
        completionTool: "work_item.execution.finish",
        finalPhase: true,
        autoStartAllowed: true,
      },
    }, {
      session,
      toolCall: {
        id: "tool-call-final-closeout-gate",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly output: string;
      readonly isError: boolean;
    };
    const output = JSON.parse(result.output) as {
      readonly phaseCompletion?: {
        readonly workItemExecutionFinishInputTemplate?: {
          readonly providedEvidence?: readonly string[];
          readonly verificationGateResults?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(output.phaseCompletion?.workItemExecutionFinishInputTemplate).toEqual({
      goalRunId: "goal-final-gate",
      workItemId: "work-final-gate",
      providedEvidence: [],
      skippedVerificationGates: [],
      verificationGateResults: [{
        gate: "review child handoff",
        status: "passed",
        summary: "The child handoff was reviewed.",
        evidence: ["kiln://managed-agents/invocations/test/transcript"],
      }],
      residualRisk: "Live deployment was not exercised.",
      summary: "Managed review completed with a structured closeout result.",
    });
  });

  it.each([
    ["failed structured status", { status: "failed" }],
    ["blocked structured status", { status: "blocked" }],
    ["cancelled structured status", { status: "cancelled" }],
    ["pending approval", {
      status: "blocked",
      approvalRequirements: [{ id: "approval-1", status: "pending", summary: "Operator approval required." }],
    }],
    ["failed verification", {
      status: "failed",
      verificationResults: [{
        requirementId: "review",
        method: "deterministic",
        status: "failed",
        summary: "Review failed.",
        evidenceUris: ["kiln://managed-invocations/test/transcript"],
      }],
    }],
    ["inconclusive verification", {
      verificationResults: [{
        requirementId: "review",
        method: "deterministic",
        status: "inconclusive",
        summary: "Review was inconclusive.",
        evidenceUris: ["kiln://managed-invocations/test/transcript"],
      }],
    }],
  ] as const)("does not promote a child phase with %s", async (_label, structuredResultOverrides) => {
    const surface = makeSurface(makeAdapterWithHandoff(
      "Managed child returned control-state evidence.",
      {},
      structuredResultOverrides as Partial<StructuredExecutionResult>,
    ));
    const session = makeSession();
    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      requestedAuthority: "read_only",
      task: "Execute the final managed child phase.",
      summary: "Execute the final managed child phase.",
      goalRunId: "goal-final",
      workItemId: "work-final",
      expectedEvidence: ["managed-orchestration:result-handoff"],
      executionPhase: {
        id: "managed-review-closeout",
        expectedEvidence: ["managed-orchestration:result-handoff"],
        completionTool: "work_item.execution.finish",
        finalPhase: true,
        autoStartAllowed: true,
      },
    }, {
      session,
      toolCall: { id: "tool-call-final-phase-invalid", name: "managed_agent.invoke", input: {} },
    }) as { readonly output: string; readonly isError: boolean };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly recovery?: { readonly status?: string; readonly nextTool?: string };
      readonly phaseCompletion?: unknown;
    };

    expect(result.isError).toBe(true);
    expect(output.status).toBe("handoff_not_substantive");
    expect(output.recovery).toMatchObject({
      status: "phase_evidence_required",
      nextTool: "work_item.update",
    });
    expect(output.phaseCompletion).toBeUndefined();
  });

  it("accepts code-backed frontend implementation evidence when public screenshots are unavailable", async () => {
    const phaseSummary = [
      "No public screenshots were found.",
      "Code-backed frontend implementation evidence from https://github.com/sybil-solutions/vllm-studio maps frontend/src/app and frontend/src/components .tsx component structure, layout pattern, navigation model, panels, typography, spacing, density, and product ergonomics.",
    ].join(" ");
    const surface = makeSurface(makeAdapterWithHandoff(phaseSummary));
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-phase-code-backed-complete",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Collect frontend reference research before UI implementation.",
      summary: "Collect frontend reference research before UI implementation.",
      workItemId: "work-ui",
      goalRunId: "goal-run-test",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read"],
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read"],
        completionTool: "work_item.update",
        finalPhase: false,
        autoStartAllowed: false,
        instruction: "Record only this phase evidence before requesting the next phase.",
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly managedInvocationPhaseCompletion?: Record<string, unknown>;
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly phaseCompletion?: {
        readonly evidenceToRecord?: readonly string[];
      };
    };

    expect(result.isError).toBe(false);
    expect(output.status).toBe("completed");
    expect(output.phaseCompletion?.evidenceToRecord).toEqual(["visual-reference-research"]);
    expect(result.metadata.managedInvocationPhaseCompletion).toMatchObject({
      status: "phase_completed_by_child",
      workItemId: "work-ui",
    });
  });

  it("accepts local code-backed frontend implementation evidence for visual-reference phases", async () => {
    const phaseSummary = [
      "No public product screenshots were available.",
      "Code-backed frontend implementation evidence from local source /workspace/references/vllm-studio identifies frontend/src app shell component structure, layout pattern, navigation model, panel density, typography, spacing, and product ergonomics.",
      "Local source /workspace/references/t1code/src/app/layout.tsx and /workspace/references/vllm-studio/frontend/src/components/AppShell.tsx show status area, composer-like panels, typography, spacing, and density.",
    ].join(" ");
    const surface = makeSurface(makeAdapterWithHandoff(phaseSummary));
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-phase-local-code-backed-complete",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Collect frontend reference research before UI implementation.",
      summary: "Collect frontend reference research before UI implementation.",
      workItemId: "work-ui",
      goalRunId: "goal-run-test",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read", "glob", "grep"],
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read", "glob", "grep"],
        completionTool: "work_item.update",
        finalPhase: false,
        autoStartAllowed: false,
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly managedInvocationPhaseCompletion?: Record<string, unknown>;
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly phaseCompletion?: {
        readonly evidenceToRecord?: readonly string[];
        readonly requiredToolNames?: readonly string[];
      };
    };

    expect(result.isError).toBe(false);
    expect(output.status).toBe("completed");
    expect(output.phaseCompletion).toMatchObject({
      evidenceToRecord: ["visual-reference-research"],
      requiredToolNames: ["read", "glob", "grep"],
    });
    expect(result.metadata.managedInvocationPhaseCompletion).toMatchObject({
      status: "phase_completed_by_child",
      workItemId: "work-ui",
      requiredToolNames: ["read", "glob", "grep"],
    });
  });

  it.each([
    "Direct provider managed invocation completed.",
    "Direct provider managed invocation finished without final handoff text. Inspect the transcript resource before recording governed evidence.",
  ])("fails a visual phase child completion when the handoff is not substantive evidence: %s", async (summary) => {
    const adapter = makeAdapterWithHandoff(summary);
    const route = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          ...route,
          profiles: [{
              ...route.profiles[0]!,
              readAuthority: {
                workspace: {
                  allowedPaths: ["/workspace/references/cloned"],
                  deniedPaths: [],
                },
              },
          }],
        }],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-phase-no-handoff",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-ui",
      goalRunId: "goal-run-test",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read"],
      requiredReadPaths: ["/workspace/references/cloned/t1code", "/workspace/references/cloned/openclaw"],
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read"],
        completionTool: "work_item.update",
        finalPhase: false,
        autoStartAllowed: false,
        instruction: "Record only this phase evidence before requesting the next phase.",
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly managedInvocationRecovery?: Record<string, unknown>;
        readonly managedInvocationPhaseCompletion?: Record<string, unknown>;
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly recovery?: {
        readonly status?: string;
        readonly reason?: string;
        readonly nextTool?: string;
        readonly workItemId?: string;
        readonly requiredReadPaths?: readonly string[];
        readonly localRecoveryInstructions?: readonly string[];
        readonly workItemUpdateInputTemplate?: {
          readonly verificationGateResults?: readonly Record<string, unknown>[];
        };
      };
      readonly phaseCompletion?: Record<string, unknown>;
    };

    expect(result.isError).toBe(true);
    expect(output.status).toBe("handoff_not_substantive");
    expect(output.phaseCompletion).toBeUndefined();
    expect(output.recovery).toMatchObject({
      status: "phase_evidence_required",
      nextTool: "work_item.update",
      workItemId: "work-ui",
      requiredReadPaths: ["/workspace/references/cloned/t1code", "/workspace/references/cloned/openclaw"],
      blockedWorkItemUpdateInputTemplate: {
        id: "work-ui",
        status: "blocked",
        pauseRequirements: [{
          id: expect.stringContaining("managed-invocation-handoff-recovery:work-ui:"),
          kind: "operator_input",
          status: "pending",
        }],
      },
    });
    expect(output.recovery?.localRecoveryInstructions).toContain(
      "Inspect each required read path before recording evidence: /workspace/references/cloned/t1code; /workspace/references/cloned/openclaw.",
    );
    expect(output.recovery?.localRecoveryInstructions).toContain(
      "A raw file listing or analysis of only the current project does not satisfy a reference-root visual phase.",
    );
    expect(output.recovery?.localRecoveryInstructions?.join("\n")).not.toContain("vLLM Studio");
    expect(output.recovery?.workItemUpdateInputTemplate?.verificationGateResults).toEqual([]);
    expect(JSON.stringify(output.recovery)).not.toContain("\"status\":\"passed\"");
    expect(output.recovery?.reason).toContain("no-handoff");
    expect(result.metadata.status).toBe("handoff_not_substantive");
    expect(result.metadata.managedInvocationPhaseCompletion).toBeUndefined();
    expect(result.metadata.managedInvocationRecovery).toMatchObject({
      status: "phase_evidence_required",
      workItemId: "work-ui",
      requiredReadPaths: ["/workspace/references/cloned/t1code", "/workspace/references/cloned/openclaw"],
      blockedWorkItemUpdateInputTemplate: {
        id: "work-ui",
        status: "blocked",
      },
    });
  });

  it("accepts code-backed visual reference handoffs with concrete local source paths and UI principles", async () => {
    const summary = [
      "# Visual Reference Research - Phase Evidence",
      "",
      "### C:\\workspace\\references\\opencode - Qualifying Frontend Found",
      "Key source paths:",
      "- packages/app/src/pages/layout.tsx - Main layout with sidebar rail, expandable panel, session list, project avatar",
      "- packages/app/src/pages/session.tsx - Session view with virtualized message timeline and inline composer dock",
      "- packages/app/src/components/prompt-input.tsx - Full composer with slash popover and context items",
      "Extracted UI principles: sidebar rail, virtualized timelines, dock surfaces, sticky activity headers, session tabs, typography, spacing, and density.",
      "",
      "### C:\\workspace\\references\\t1code - Qualifying Frontend Found",
      "Key source paths:",
      "- apps/web/src/components/ChatView.tsx - chat workbench structure",
      "- apps/web/src/components/Sidebar.tsx - status-rich thread list",
      "Extracted UI principles: project/thread grouping, composer-integrated provider controls, plan/chat split, terminal/activity drawers.",
    ].join("\n");
    const surface = makeSurface(makeAdapterWithHandoff(summary));
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-phase-code-backed-evidence",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-ui",
      goalRunId: "goal-run-test",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read", "glob", "grep"],
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read", "glob", "grep"],
        completionTool: "work_item.update",
        finalPhase: false,
        autoStartAllowed: false,
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly managedInvocationPhaseCompletion?: Record<string, unknown>;
        readonly managedInvocationRecovery?: Record<string, unknown>;
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly phaseCompletion?: Record<string, unknown>;
      readonly recovery?: Record<string, unknown>;
    };

    expect(result.isError).toBe(false);
    expect(output.status).toBe("completed");
    expect(output.recovery).toBeUndefined();
    expect(output.phaseCompletion).toMatchObject({
      status: "phase_completed_by_child",
      nextTool: "work_item.update",
      workItemId: "work-ui",
      evidenceToRecord: ["visual-reference-research"],
    });
    expect(result.metadata.status).toBe("completed");
    expect(result.metadata.managedInvocationRecovery).toBeUndefined();
    expect(result.metadata.managedInvocationPhaseCompletion).toMatchObject({
      status: "phase_completed_by_child",
      workItemId: "work-ui",
    });
  });

});
