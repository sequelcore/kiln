import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  type ManagedAgentAdapterDescriptor,
  type ManagedAgentInvocationRequest,
  type ManagedAgentResultHandoff,
} from "@kilnai/core/agents";
import { type ActionEffectEnvelope, textParts } from "@kilnai/core/engine";
import { SandboxPolicy } from "@kilnai/core/sandbox";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import {
  createDefaultBuiltinToolSurface,
  createSessionBuiltinToolOptions,
  FORMAL_VERIFICATION_FINISH_TRANSPORT,
  OPERATOR_ADOPTION_DECISION_TRANSPORT,
  formalVerificationToolMetadata,
  type DevTool,
  type ToolInput,
  type ToolResult,
} from "@kilnai/core/tools";
import {
  adoptBoundedWorkContractRevision,
  GoalRunStore,
  WorkItemStore,
  type WorkItemExecutionAttempt,
} from "@kilnai/core/work-governance";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface as createRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";
import type { AttachedRuntimeManagedInvocationConfig } from "../../src/gateway/attached-runtime-tool-surface.js";
import { readRuntimeFormalVerificationFinishTransport } from "../../src/index.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";
import { collectRuntimeFormalVerificationObservations } from "../../src/work-governance/formal-verification-observations.js";
import { SqliteBoundedWorkAuthority } from "../../src/work-governance/index.js";
import type { RuntimeFormalVerificationObservation } from "../../src/work-governance/index.js";
import { buildManagedInvocationPhaseCompletion } from "../../src/agents/managed-invocation/phase-recovery.js";
import { projectToolPermissionAdmissionFromPerCallConfig } from "../../src/session/effective-authority-admission-bundle.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.js";
import type { EffectiveTurnAuthoritySnapshot } from "../../src/session/runtime-session-orchestrator.types.js";
import { withAdmittedRuntimeCalls } from "./attached-runtime-admission-fixture.js";

const TEST_HANDOFF_PROVENANCE = {
  delivery: "runtime-generated",
  configuredModelId: "test-model",
  observedModelIds: [],
} as const;

function isToolResult(value: unknown): value is ToolResult {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "output") === "string"
    && typeof Reflect.get(value, "isError") === "boolean";
}

function testExecutionAttempt(
  overrides: Partial<WorkItemExecutionAttempt> = {},
): WorkItemExecutionAttempt {
  return {
    id: "attempt-1",
    workItemId: "work-managed",
    goalRunId: "goal-managed",
    boundedWorkContractRevisionDigest: "sha256:test-bounded-work-revision",
    status: "started",
    executionMode: "managed_delegation",
    startedAt: "2026-08-12T00:00:00.000Z",
    providedEvidence: [],
    missingEvidence: [],
    missingResidualRisk: false,
    skippedVerificationGates: [],
    verificationGateResults: [],
    ...overrides,
  };
}

const ALWAYS_ON_CONTEXT_TOOLS = ["memory_search", "resource_list", "resource_template_list", "resource_read"];

const RUNTIME_LOCAL_MUTATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

const TEST_PARENT_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "read_only",
  admittedAuthority: "destructive",
  sourcePolicy: "runtime_surface_projection",
  reason: "attached runtime test parent turn authority is explicitly admitted",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} satisfies EffectiveTurnAuthoritySnapshot;

const TEST_WRITE_PARENT_AUTHORITY = {
  ...TEST_PARENT_AUTHORITY,
  requestedAuthority: "destructive",
} satisfies EffectiveTurnAuthoritySnapshot;

function testBoundedWorkRevision(goalRunId: string, objective: string, workItemIds: readonly string[]) {
  return adoptBoundedWorkContractRevision({
    accountingLineageId: goalRunId,
    adoptedAt: "2026-08-12T00:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "operator:test", decisionId: `decision:${goalRunId}` },
    contract: {
      schema: "kiln.bounded-work-contract/v2",
      intent: {
        objective,
        acceptanceCriteria: [{ id: "governed-evidence", statement: "Return governed evidence." }],
        nonGoals: ["Do unrelated work."],
      },
      assurance: {
        formalVerification: {
          semantics: "allOf",
          obligations: [{ id: "governed-evidence-obligation", symbol: "Runtime.Main", subjectPaths: ["src/Runtime.dfy"] }],
          mappings: [{ criterionId: "governed-evidence", obligationIds: ["governed-evidence-obligation"] }],
        },
      },
      scope: {
        allowedWorkItemIds: workItemIds,
        permittedEffects: ["inspect", "invoke_managed_agent", "run_verification"],
        permittedSurfaces: ["runtime-test"],
        allowedRoots: ["."],
        deniedRoots: [".git"],
        refactorAuthority: "none",
        migrationAuthority: "none",
        dependencyAuthority: "none",
      },
      limits: {
        maxExecutionAttempts: 8,
        maxManagedInvocations: 16,
        maxConcurrentManagedInvocations: 4,
        maxChildDepth: 1,
        maxReviewRounds: 4,
        maxRemediationRounds: 4,
      },
      tripwires: {},
      policy: {
        scopeExpansion: "approval_required",
        budgetExhaustion: "pause",
        minimumHarnessCapability: "authoritative",
      },
    },
  });
}

function createAttachedRuntimeBuiltinToolSurface(
  options: NonNullable<Parameters<typeof createRuntimeBuiltinToolSurface>[0]> & {
    readonly testEffectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot | null;
  } = {},
) {
  const { testEffectiveTurnAuthority, ...surfaceOptions } = options;
  const managed = surfaceOptions.managedInvocation;
  const attachment = managed
    ? "options" in managed && "callerIdentity" in managed
      ? managed
      : {
          options: managed,
          callerIdentity: {
            kind: "kiln-runtime" as const,
            surface: "runtime-test",
            attachmentId: "attachment:runtime-test",
          },
        }
    : undefined;
  const surface = createRuntimeBuiltinToolSurface({
    ...surfaceOptions,
    ...(attachment
      ? {
          managedInvocation: {
            ...attachment,
            boundedWorkAdmission: attachment.boundedWorkAdmission ?? (options.boundedWork ? undefined : () => ({
              admitted: true as const,
              workspaceAuthority: { allowedPaths: ["/workspace/kiln"], deniedPaths: [] },
              lifecycle: {
                markDispatched: () => undefined,
                releaseBeforeDispatch: () => undefined,
                settleTerminal: () => undefined,
                settleUnknown: () => undefined,
              },
            })),
          },
        }
      : {}),
  });
  const authority = testEffectiveTurnAuthority === null
    ? undefined
    : testEffectiveTurnAuthority ?? TEST_PARENT_AUTHORITY;
  return withAdmittedRuntimeCalls(surface, { effectiveTurnAuthority: authority });
}

function projectToolDefinitions(
  tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly outputSchema?: Record<string, unknown>;
  }[],
): readonly {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  }));
}

function countDeniedTools(
  toolAllowlist: ReadonlySet<string> | undefined,
  candidateToolNames: readonly string[],
): number {
  return candidateToolNames.filter((toolName) => !toolAllowlist?.has(toolName)).length;
}

function sliceOnePlanPayload(
  sourceSpecificationId: string | undefined,
  clarificationRecordIds: readonly string[] = [],
): Record<string, unknown> {
  return {
    objective: "Deliver canonical structured specification intake for operator planning.",
    nonGoals: ["Do not implement goal execution."],
    operatorDecisionsRequired: ["Approve execution only after specification intake is complete."],
    assumptions: ["Specification artifacts are session-scoped."],
    affectedSurfaces: ["runtime", "core"],
    riskClassification: "medium",
    workGovernanceRecommendation: {
      posture: "orchestrate",
      rationale: "Specification intake controls planning admission.",
      workflowProfile: "verification-heavy",
    },
    proposedWorkItems: [{
      id: "wi-1",
      summary: "Implement specification resources replay from session state for operator planning.",
      workflowProfile: "verification-heavy",
      risk: "medium",
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      dependencies: [],
    }],
    expectedEvidence: ["tests"],
    verificationGates: ["bun test"],
    managedAgentDelegationCandidates: [],
    approvalBoundaries: ["No execute transition before plan approval."],
    rollbackNotes: "Revert specification intake changes.",
    residualRisks: ["none"],
    sourceSpecificationId,
    clarificationRecordIds,
    constitutionSnapshot: {
      instructionProfileHash: "hash-slice-1",
      instructionProfileIds: ["sequel-engineering"],
    },
  };
}

function makeRuntimeSession(): RuntimeSession {
  const session = new RuntimeSession({
    sessionId: "session-parent",
    appName: "test-app",
    tenantId: "tenant-a",
    userId: "user-1",
    systemPrompt: "test",
  });
  session.addUserMessage(textParts("Start the governed managed work item."));
  return session;
}

function makeBrandedFormalVerificationObservation(
  executionScope: NonNullable<RuntimeBuiltinToolExecutionContext["executionScope"]>,
  toolCallScopeId: string,
  toolCallId: string,
  metadata: ReturnType<typeof formalVerificationToolMetadata>,
): RuntimeFormalVerificationObservation {
  const [observation] = collectRuntimeFormalVerificationObservations({
    currentScope: executionScope,
    currentTurnToolExecutions: [{
      toolCallScopeId,
      toolCallId,
      toolName: "formal_verify",
      success: true,
      metadata,
      executionScope,
    }],
  });
  if (!observation) throw new Error("expected a branded formal-verification observation");
  return observation;
}

function makeManagedDescriptor(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:opencode:harness",
    providerId: "opencode",
    adapterKind: "harness",
    supportedProfiles: ["foundation-readonly-plan"],
    supportedExecutionModes: ["cli-harness"],
    lifecycle: {
      exposesStart: true,
      exposesTerminal: true,
      exposesCleanup: true,
    },
    cancellation: { supported: true },
    timeout: { supported: true, diagnosticArtifactOnTimeout: true },
    transcript: {
      supported: true,
      redactionKnown: true,
      truncationKnown: true,
      persistenceKnown: true,
      retentionKnown: true,
    },
    usage: {
      supported: true,
      preservesProviderTokenClasses: true,
      supportsExplicitUnknowns: true,
      tokenClasses: ["input", "output", "cache_read"],
      semanticSourceGranularity: "unknown",
      evidenceBasis: "adapter",
    },
    resultHandoff: {
      boundedSummary: true,
      resourcePointers: true,
    },
    credentialRoute: { supported: true },
    memoryContext: { governedAdmission: true },
    unsupportedFieldPolicy: "reject",
    cleanup: { supported: true },
    ...overrides,
  });
}

function makeManagedAdapter(summary = "Managed child completed governed work."): ManagedAgentRuntimeAdapter {
  return {
    descriptor: makeManagedDescriptor(),
    invoke: vi.fn(async ({ request, admission }: {
      readonly request: ManagedAgentInvocationRequest;
      readonly admission: {
        readonly capabilitySnapshot: ReturnType<typeof buildManagedAgentCapabilitySnapshot>;
      };
    }) =>
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        profile: request.profile,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: admission.capabilitySnapshot,
        childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
        childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary,
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/handoff`],
          memoryWriteProposalUris: [],
          structuredResult: {
            version: "structured-execution-result-v1",
            status: "completed",
            summary,
            uncertainty: 0,
            limitations: [],
            operatorDecisions: [],
            evidence: [{
              uri: `kiln://managed-invocations/${request.invocationId}/handoff`,
              kind: "artifact",
            }],
            citations: [],
            warnings: [],
            failures: [],
            approvalRequirements: [],
            residualRisks: [],
            verificationResults: [
              ...(request.input.handoff?.expectedEvidence ?? ["governed-work-handoff"]).map((requirementId) => ({
                requirementId,
                method: "deterministic" as const,
                status: "passed" as const,
                summary: `Verified ${requirementId}.`,
                evidenceUris: [`kiln://managed-invocations/${request.invocationId}/handoff`],
              })),
              {
                requirementId: "later-phase-check",
                method: "deterministic",
                status: "skipped",
                summary: "Not part of this phase.",
                evidenceUris: [],
              },
            ],
          },
        },
      })),
  };
}

function managedRouteCapability(input: {
  readonly routeId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly toolNames: readonly string[];
  readonly profile?: "foundation-readonly-plan" | "foundation-apply-approved-writes";
  readonly write?: boolean;
  readonly externalRuntimeAttachment?: { readonly kind: "external-runtime"; readonly runtimeId: string; readonly attachmentId: string };
}) {
  return {
    identity: { routeId: input.routeId, revision: "test-v1" },
    target: { providerId: input.providerId, modelId: input.modelId },
    adapter: { kind: "cli-harness" as const, capabilityId: `${input.providerId}-harness`, capabilityVersion: "test-v1" },
    authorityCeiling: input.write ? "destructive" as const : "read_only" as const,
    toolNames: input.toolNames,
    supportsRecursion: true,
    supportsAttachments: input.externalRuntimeAttachment !== undefined,
    supportsWrite: input.write === true,
    ...(input.externalRuntimeAttachment ? { externalRuntimeAttachment: input.externalRuntimeAttachment } : {}),
    proof: { status: "configured" as const, source: "test-fixture", provenProfiles: [input.profile ?? "foundation-readonly-plan"] },
    capacity: { kind: "accountless" as const },
    settlement: { kind: "not-required" as const },
  };
}

function makeManagedExecutionStartTool(
  managedInvocationRequest: Record<string, unknown> = {
    profile: "foundation-readonly-plan",
    routeId: "opencode-readonly",
    requestedAuthority: "read_only",
    task: "Execute governed managed work.",
    summary: "Execute governed managed work.",
    workItemId: "work-managed",
    expectedEvidence: ["managed-agent-review"],
    requiredResultFields: ["summary", "evidence", "verificationResults"],
    doneCriteria: ["Return a bounded handoff."],
    residualRiskRequired: false,
  },
): DevTool & { readonly calls: ToolInput[] } {
  const calls: ToolInput[] = [];
  return {
    name: "work_item.execution.start",
    description: "Test work item execution start tool.",
    inputSchema: {
      type: "object",
      properties: {
        goalRunId: { type: "string" },
        managedInvocationId: { type: "string" },
      },
    },
    effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
    calls,
    async execute(input): Promise<ToolResult> {
      calls.push(input);
      const managedInvocationId = typeof input.input.managedInvocationId === "string"
        ? input.input.managedInvocationId
        : undefined;
      if (!managedInvocationId) {
        const goalRunId = typeof input.input.goalRunId === "string" ? input.input.goalRunId : "goal-managed";
        return {
          output: JSON.stringify({
            status: "paused",
            reason: "managedInvocationId is required before starting managed-delegation execution.",
            workItemId: "work-managed",
            nextTool: "managed_agent.invoke",
            managedInvocationRequest: { ...managedInvocationRequest, goalRunId },
          }, null, 2),
          metadata: {
            kind: "work_item",
            toolName: "work_item.execution.start",
            operation: "execution_started",
            executionScopeTransition: {
              action: "enter",
              scope: { kind: "work_item", goalRunId, workItemId: "work-managed" },
            },
          },
          isError: true,
        };
      }
      return {
        output: JSON.stringify({
          status: "started",
          attempt: {
            managedInvocationId,
          },
        }, null, 2),
        isError: false,
        metadata: {
          kind: "work_item",
          toolName: "work_item.execution.start",
          operation: "execution_started",
          id: "work-managed",
          status: "in_progress",
          attempt: testExecutionAttempt({ managedInvocationId }),
        },
      };
    },
  };
}

describe("attached runtime builtin tool surface", () => {
  it("rejects a managed call when the per-call parent authority snapshot is absent", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: { routes: [] },
      testEffectiveTurnAuthority: null,
    });
    const result = await runtimeSurface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      task: "Inspect without an admitted parent authority.",
    }, {
      session: makeRuntimeSession(),
      toolCall: { id: "tool-call-missing-parent-authority", name: "managed_agent.invoke", input: {} },
    }) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(result).toMatchObject({
      isError: true,
      metadata: { errorCode: "managed_parent_authority_unavailable" },
    });
  });

  it("carries an opaque frozen formal-verification envelope to the registered finish tool", async () => {
    let finishInput: ToolInput | undefined;
    let finishContext: unknown;
    let runtimeInvocationTransport: unknown;
    let otherContext: unknown;
    const finishTool: DevTool = {
      name: "work_item.execution.finish",
      description: "Finish a work item.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
      async execute(input, _sandbox, context) {
        finishInput = input;
        finishContext = context;
        runtimeInvocationTransport = readRuntimeFormalVerificationFinishTransport();
        return { output: "finished", isError: false };
      },
    };
    const otherTool: DevTool = {
      name: "transport.other",
      description: "Observe a non-finish execution context.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
      async execute(_input, _sandbox, context) {
        otherContext = context;
        return { output: "other", isError: false };
      },
    };
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        formalVerify: { executable: "dafny", verifierVersion: "4.11.0" },
        additionalTools: [finishTool, otherTool],
      }),
      boundedWork: {
        projectRuntimeId: "project:transport",
        authority: {} as SqliteBoundedWorkAuthority,
      },
    });
    const executionScope = {
      kind: "work_item",
      goalRunId: "goal-transport",
      workItemId: "work-transport",
      attemptId: "attempt-transport",
      managedInvocationId: "managed-transport",
    } as const;
    const observationMetadata = formalVerificationToolMetadata({
      verifier: { name: "dafny", version: "4.11.0" },
      artifact: { contentDigest: `sha256:${"a".repeat(64)}` },
      subjects: [{ path: "src/Test.dfy", contentDigest: `sha256:${"e".repeat(64)}` }],
      checks: [{ symbol: "Invariant", check: "correctness", outcome: "proved" }],
    });
    const observation = makeBrandedFormalVerificationObservation(
      executionScope,
      "scope-transport",
      "formal-transport",
      observationMetadata,
    );
    const abortController = new AbortController();
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "finish-transport", name: "work_item.execution.finish", input: {} },
      executionScope,
      formalVerificationObservations: Object.freeze([observation, observation]),
      abortSignal: abortController.signal,
      emitOutput: vi.fn(),
    };

    await expect(runtimeSurface.callBuiltinTools.get("work_item.execution.finish")?.({}, context)).resolves.toMatchObject({
      output: "finished",
      isError: false,
    });

    const finishTransport = (finishContext as Record<PropertyKey, unknown>)[FORMAL_VERIFICATION_FINISH_TRANSPORT] as {
      readonly observations: readonly unknown[];
      readonly executionScope: typeof executionScope;
      readonly recordedAt: string;
      readonly producer: { readonly kind: string; readonly toolName: string };
    } | undefined;
    expect(finishTransport).toBeDefined();
    expect(finishTransport?.observations).toEqual([observation]);
    expect(finishTransport?.observations[0]).not.toBe(observation);
    expect((finishTransport?.observations[0] as { readonly metadata?: unknown } | undefined)?.metadata)
      .not.toBe(observation.metadata);
    expect(finishTransport?.executionScope).toEqual(executionScope);
    expect(finishTransport?.recordedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(finishTransport?.producer).toEqual({ kind: "registered_tool", toolName: "formal_verify" });
    expect(runtimeInvocationTransport).toBe(finishTransport);
    expect(Object.isFrozen(finishTransport)).toBe(true);
    expect(Object.isFrozen(finishTransport?.observations)).toBe(true);
    expect(Object.isFrozen(finishTransport?.observations[0])).toBe(true);
    expect(Object.keys(finishInput?.input ?? {})).not.toContain("formalVerificationObservations");
    expect(JSON.stringify(finishInput)).not.toContain("formalVerification");
    expect((finishContext as { readonly abortSignal?: AbortSignal }).abortSignal).toBe(abortController.signal);
    expect((finishContext as { readonly onOutput?: unknown }).onOutput).toBe(context.emitOutput);
    expect(Object.keys(finishContext as object)).not.toContain("formalVerification");
    expect(JSON.stringify(finishContext)).not.toContain("formalVerification");
    expect(Object.getOwnPropertyDescriptor(finishContext, FORMAL_VERIFICATION_FINISH_TRANSPORT)?.enumerable).toBe(false);
    await expect(runtimeSurface.callBuiltinTools.get("transport.other")?.({}, context)).resolves.toMatchObject({
      output: "other",
      isError: false,
    });
    expect(otherContext).toBeDefined();
    expect(Object.getOwnPropertySymbols(otherContext as object)).not.toContain(FORMAL_VERIFICATION_FINISH_TRANSPORT);
  });

  it("does not attach the transport for direct finish calls or an exact-scope mismatch", async () => {
    let directContext: unknown;
    let finishContext: unknown;
    const finishTool: DevTool = {
      name: "work_item.execution.finish",
      description: "Finish a work item.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
      async execute(_input, _sandbox, context) {
        directContext = context;
        finishContext = context;
        return { output: "finished", isError: false };
      },
    };
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        formalVerify: { executable: "dafny", verifierVersion: "4.11.0" },
        additionalTools: [finishTool],
      }),
    });
    const executionScope = {
      kind: "work_item",
      goalRunId: "goal-transport-mismatch",
      workItemId: "work-transport-mismatch",
      attemptId: "attempt-transport-mismatch",
    } as const;
    const observation = makeBrandedFormalVerificationObservation(
      executionScope,
      "scope-transport-mismatch",
      "formal-transport-mismatch",
      formalVerificationToolMetadata({
        verifier: { name: "dafny", version: "4.11.0" },
        artifact: { contentDigest: `sha256:${"b".repeat(64)}` },
        subjects: [{ path: "src/Test.dfy", contentDigest: `sha256:${"e".repeat(64)}` }],
        checks: [{ symbol: "Invariant", check: "correctness", outcome: "proved" }],
      }),
    );
    await finishTool.execute({ name: finishTool.name, input: {} }, undefined, {
      abortSignal: new AbortController().signal,
    });
    expect((directContext as Record<PropertyKey, unknown>)[FORMAL_VERIFICATION_FINISH_TRANSPORT]).toBeUndefined();

    const mismatchedContext: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "finish-transport-mismatch", name: finishTool.name, input: {} },
      executionScope: { ...executionScope, attemptId: "another-attempt" },
      formalVerificationObservations: Object.freeze([observation]),
      abortSignal: new AbortController().signal,
    };
    await expect(runtimeSurface.callBuiltinTools.get(finishTool.name)?.({}, mismatchedContext)).resolves.toMatchObject({
      output: "finished",
      isError: false,
    });
    expect((finishContext as Record<PropertyKey, unknown>)[FORMAL_VERIFICATION_FINISH_TRANSPORT]).toBeUndefined();

    const unbrandedFrozenObservation = Object.freeze({
      metadata: observation.metadata,
      toolCallScopeId: observation.toolCallScopeId,
      toolCallId: observation.toolCallId,
      executionScope: observation.executionScope,
    }) as unknown as RuntimeFormalVerificationObservation;
    const unbrandedFrozenContext: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "finish-transport-unbranded", name: finishTool.name, input: {} },
      executionScope,
      formalVerificationObservations: Object.freeze([unbrandedFrozenObservation]),
      abortSignal: new AbortController().signal,
    };
    await expect(runtimeSurface.callBuiltinTools.get(finishTool.name)?.({}, unbrandedFrozenContext)).resolves.toMatchObject({
      output: "finished",
      isError: false,
    });
    expect((finishContext as Record<PropertyKey, unknown>)[FORMAL_VERIFICATION_FINISH_TRANSPORT]).toBeUndefined();

    const forgedFrozenObservation = Object.freeze({
      ...observation,
      metadata: Object.freeze({
        ...observation.metadata,
        establishes: ["criterion-forged"],
      }),
    }) as unknown as RuntimeFormalVerificationObservation;
    const forgedFrozenContext: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "finish-transport-forged", name: finishTool.name, input: {} },
      executionScope,
      formalVerificationObservations: Object.freeze([forgedFrozenObservation]),
      abortSignal: new AbortController().signal,
    };
    await expect(runtimeSurface.callBuiltinTools.get(finishTool.name)?.({}, forgedFrozenContext)).resolves.toMatchObject({
      output: "finished",
      isError: false,
    });
    expect((finishContext as Record<PropertyKey, unknown>)[FORMAL_VERIFICATION_FINISH_TRANSPORT]).toBeUndefined();

    const conflictingObservation = Object.freeze({
      ...observation,
      metadata: formalVerificationToolMetadata({
        verifier: { name: "dafny", version: "4.12.0" },
        artifact: { contentDigest: `sha256:${"c".repeat(64)}` },
        subjects: [{ path: "src/Test.dfy", contentDigest: `sha256:${"e".repeat(64)}` }],
        checks: [{ symbol: "Invariant", check: "correctness", outcome: "proved" }],
      }),
    });
    const conflictingContext: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "finish-transport-conflict", name: finishTool.name, input: {} },
      executionScope,
      formalVerificationObservations: Object.freeze([observation, conflictingObservation]),
      abortSignal: new AbortController().signal,
    };
    await expect(runtimeSurface.callBuiltinTools.get(finishTool.name)?.({}, conflictingContext)).resolves.toMatchObject({
      output: "finished",
      isError: false,
    });
    expect((finishContext as Record<PropertyKey, unknown>)[FORMAL_VERIFICATION_FINISH_TRANSPORT]).toBeUndefined();

    const missingScopeContext: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "finish-transport-missing", name: finishTool.name, input: {} },
      formalVerificationObservations: Object.freeze([observation]),
      abortSignal: new AbortController().signal,
    };
    await expect(runtimeSurface.callBuiltinTools.get(finishTool.name)?.({}, missingScopeContext)).resolves.toMatchObject({
      output: "finished",
      isError: false,
    });
    expect((finishContext as Record<PropertyKey, unknown>)[FORMAL_VERIFICATION_FINISH_TRANSPORT]).toBeUndefined();

    const unregisteredProducerSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({ additionalTools: [finishTool] }),
    });
    const exactContextWithoutRegisteredProducer: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "finish-transport-unregistered", name: finishTool.name, input: {} },
      executionScope,
      formalVerificationObservations: Object.freeze([observation]),
      abortSignal: new AbortController().signal,
    };
    await expect(unregisteredProducerSurface.callBuiltinTools.get(finishTool.name)?.({}, exactContextWithoutRegisteredProducer)).resolves.toMatchObject({
      output: "finished",
      isError: false,
    });
    expect((finishContext as Record<PropertyKey, unknown>)[FORMAL_VERIFICATION_FINISH_TRANSPORT]).toBeUndefined();
  });

  it("records expected skipped evidence as a skip while ignoring unrelated phase results", () => {
    const handoff: ManagedAgentResultHandoff = {
      provenance: TEST_HANDOFF_PROVENANCE,
      summary: "Verification could not run in the read-only environment.",
      resourceUris: ["kiln://managed-invocations/invocation-1/handoff"],
      memoryWriteProposalUris: [],
      structuredResult: {
        version: "structured-execution-result-v1",
        status: "completed",
        summary: "Verification could not run in the read-only environment.",
        limitations: [],
        operatorDecisions: [],
        evidence: [],
        citations: [],
        warnings: [],
        failures: [],
        approvalRequirements: [],
        residualRisks: ["Tests remain unexecuted."],
        verificationResults: [{
          requirementId: "tests",
          method: "deterministic",
          status: "skipped",
          summary: "The read-only child could not execute tests.",
          evidenceUris: [],
        }, {
          requirementId: "surface-map",
          method: "deterministic",
          status: "passed",
          summary: "A prior phase already produced the surface map.",
          evidenceUris: [],
        }],
      },
    };

    const completion = buildManagedInvocationPhaseCompletion({
      goalRunId: "goal-1",
      workItemId: "work-1",
      summary: "Run verification.",
      executionPhase: {
        expectedEvidence: ["tests"],
        completionTool: "work_item.update",
      },
    }, handoff, "invocation-1");

    expect(completion?.workItemUpdateInputTemplate).toMatchObject({
      providedEvidence: [],
      skippedVerificationGates: ["tests"],
      verificationGateResults: [{ gate: "tests", status: "skipped" }],
      residualRisk: "Tests remain unexecuted.",
    });
  });

  it("rejects managed invocation scopes that do not exist in the session governance stores", async () => {
    const authorityDirectory = await mkdtemp(join(tmpdir(), "kiln-bounded-work-attached-"));
    const boundedWorkAuthority = new SqliteBoundedWorkAuthority({
      path: join(authorityDirectory, "authority.sqlite"),
      formalVerificationCapability: { metric: "formal_verification", status: "available" },
    });
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    workItemStore.upsert({
      id: "work-real",
      summary: "Inspect the repository.",
      workflowProfile: "verification-heavy",
      triggers: ["repository inspection"],
      expectedEvidence: ["surface-map"],
      verificationGates: [],
      goalRunId: "goal-real",
    });
    goalRunStore.create({
      id: "goal-real",
      objective: "Inspect the repository without writes.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-real", "Inspect the repository without writes.", ["work-real"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct", turnId: "session-parent:turn:1" },
      workItemIds: ["work-real"],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "Read-only inspection.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const adapter = makeManagedAdapter();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { workItemStore, goalRunStore },
      boundedWork: { projectRuntimeId: "project:test", authority: boundedWorkAuthority },
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: managedRouteCapability({ routeId: "opencode-readonly", providerId: "opencode", modelId: "opencode-default-model", toolNames: ["read"] }),
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:opencode:readonly",
              admissionProfile: "foundation-readonly-plan",
              permissionProfile: "read-only",
              allowedToolNames: ["read"],
              workingDirectory: { path: "/workspace/kiln", mode: "read-only" },
              timeoutMs: 120000,
              credentialRoute: { mode: "runtime-selected", routeId: "credential-route:opencode:primary" },
              memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
          }],
        }],
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "tool-call-scope", name: "managed_agent.invoke", input: {} },
    };
    const invoke = runtimeSurface.callBuiltinTools.get("managed_agent.invoke");

    const missing = await invoke?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode" },
      task: "Inspect the repository.",
      goalRunId: "goal-missing",
      workItemId: "work-missing",
    }, context) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(missing).toMatchObject({
      isError: true,
      metadata: {
        errorCode: "goal_not_found",
        suggestedNextTool: "goal.create",
      },
    });
    expect(adapter.invoke).not.toHaveBeenCalled();

    const admitted = await invoke?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode" },
      task: "Inspect the repository.",
      goalRunId: "goal-real",
      workItemId: "work-real",
    }, context) as { readonly isError: boolean };

    expect(admitted.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect(boundedWorkAuthority.inspect({
      projectRuntimeId: "project:test",
      accountingLineageId: "goal-real",
    })).toMatchObject({ managedInvocations: 1, activeManagedInvocations: 0 });

    const excessiveAuthority = await invoke?.({
      profile: "foundation-apply-approved-writes",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode" },
      requestedAuthority: "audited",
      task: "Modify the repository.",
      goalRunId: "goal-real",
      workItemId: "work-real",
    }, context) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(excessiveAuthority).toMatchObject({
      isError: true,
      metadata: {
        errorCode: "goal_authority_exceeded",
        status: "denied",
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    await runtimeSurface.dispose();
    boundedWorkAuthority.close();
    await rm(authorityDirectory, { recursive: true, force: true });
  });

  it("denies governed child writes unless their declared effects are inside the bounded contract", async () => {
    const authorityDirectory = await mkdtemp(join(tmpdir(), "kiln-bounded-effects-"));
    const authority = new SqliteBoundedWorkAuthority({
      path: join(authorityDirectory, "authority.sqlite"),
      formalVerificationCapability: { metric: "formal_verification", status: "available" },
    });
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    workItemStore.upsert({
      id: "work-effects",
      summary: "Delegate inspection only.",
      workflowProfile: "verification-heavy",
      triggers: ["managed-agents"],
      expectedEvidence: [],
      verificationGates: [],
      goalRunId: "goal-effects",
    });
    goalRunStore.create({
      id: "goal-effects",
      objective: "Delegate inspection only.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-effects", "Delegate inspection only.", ["work-effects"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct", turnId: "turn-effects" },
      workItemIds: ["work-effects"],
      authorityEnvelope: { maximumAuthority: "audited", escalationPolicy: "approval_required", reason: "Test." },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const baseAdapter = makeManagedAdapter();
    const adapter: ManagedAgentRuntimeAdapter = {
      ...baseAdapter,
      descriptor: makeManagedDescriptor({
        supportedProfiles: ["foundation-apply-approved-writes"],
        writeAuthority: {
          proposalSupported: true,
          approvedApplySupported: true,
          memoryProposalSupported: false,
          rollbackEvidence: true,
          cleanupEvidence: true,
          scopeReduction: true,
        },
      }),
    };
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { workItemStore, goalRunStore },
      boundedWork: { projectRuntimeId: "project:effects", authority },
      testEffectiveTurnAuthority: TEST_WRITE_PARENT_AUTHORITY,
      managedInvocation: {
        routes: [{
          routeId: "write-route",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "test-model",
          capability: managedRouteCapability({ routeId: "write-route", providerId: "opencode", modelId: "test-model", toolNames: ["read", "apply-patch"], profile: "foundation-apply-approved-writes", write: true }),
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:test:write",
              admissionProfile: "foundation-apply-approved-writes",
              permissionProfile: "apply-approved-writes",
              allowedToolNames: ["read", "apply-patch"],
              writeAllowed: true,
              workingDirectory: { path: "/workspace/kiln", mode: "workspace-write" },
              timeoutMs: 120000,
              credentialRoute: { mode: "credentialless" },
              memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
              writeAuthority: defineManagedAgentWriteAuthority({
                profile: "foundation-apply-approved-writes",
                scope: {
                  workspace: { mode: "apply-approved", allowedPaths: ["/workspace/kiln"], deniedPaths: [] },
                  memory: { mode: "none", operations: [] },
                  artifacts: { mode: "none", resourceUris: [], retention: "none" },
                  tools: { allowedToolNames: ["apply-patch"], deniedToolNames: [] },
                },
                approval: { mode: "required-before-apply", evidenceRequired: true },
              }),
          }],
        }],
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "tool-call-effects", name: "managed_agent.invoke", input: {} },
      requestApproval: vi.fn(async () => ({ approved: true })),
    };
    const denied = await runtimeSurface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-apply-approved-writes",
      routeId: "write-route",
      providerRoute: { providerId: "opencode", model: "test-model" },
      requestedAuthority: "audited",
      task: "Modify source despite an inspection-only contract.",
      goalRunId: "goal-effects",
      workItemId: "work-effects",
      boundedWorkEffects: ["modify_source"],
    }, context) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(denied).toMatchObject({ isError: true, metadata: { errorCode: "bounded_work_effect_authority_denied" } });
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(authority.inspect({ projectRuntimeId: "project:effects", accountingLineageId: "goal-effects" })).toBeUndefined();
    const currentRevision = goalRunStore.get("goal-effects")!.boundedWorkContractRevision;
    goalRunStore.supersedeBoundedWorkContract({
      id: "goal-effects",
      expectedRevisionDigest: currentRevision.revisionDigest,
      contract: {
        ...currentRevision.contract,
        scope: {
          ...currentRevision.contract.scope,
          permittedEffects: [...currentRevision.contract.scope.permittedEffects, "modify_source"],
          allowedRoots: ["packages/runtime/src"],
        },
      },
      adoptedAt: "2026-08-12T00:01:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator:test", decisionId: "decision:effects-write" },
    });
    const admitted = await runtimeSurface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-apply-approved-writes",
      routeId: "write-route",
      providerRoute: { providerId: "opencode", model: "test-model" },
      requestedAuthority: "audited",
      task: "Modify the admitted runtime source root.",
      goalRunId: "goal-effects",
      workItemId: "work-effects",
      boundedWorkEffects: ["modify_source"],
    }, { ...context, toolCall: { id: "tool-call-effects-admitted", name: "managed_agent.invoke", input: {} } }) as { readonly isError: boolean };
    expect(admitted.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        authority: expect.objectContaining({
          writeAuthority: expect.objectContaining({
            scope: expect.objectContaining({
              workspace: expect.objectContaining({
                allowedPaths: [expect.stringMatching(/packages[\\/]runtime[\\/]src$/u)],
              }),
            }),
          }),
        }),
      }),
    }));
    const nested = await runtimeSurface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-apply-approved-writes",
      routeId: "write-route",
      providerRoute: { providerId: "opencode", model: "test-model" },
      requestedAuthority: "audited",
      task: "Try to omit inherited bounded attribution.",
    }, {
      ...context,
      toolCall: { id: "tool-call-nested", name: "managed_agent.invoke", input: {} },
      executionScope: {
        kind: "work_item",
        goalRunId: "goal-effects",
        workItemId: "work-effects",
        managedInvocationId: "parent-managed-invocation",
      },
    }) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };
    expect(nested).toMatchObject({ isError: true, metadata: { errorCode: "bounded_work_nested_delegation_unavailable" } });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    await runtimeSurface.dispose();
    authority.close();
    await rm(authorityDirectory, { recursive: true, force: true });
  });

  it("rejects recovery scoped to the wrong work item, stale attempt, or different external-runtime attachment before mutation", async () => {
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    workItemStore.upsert({
      id: "work-scoped",
      summary: "Execute governed managed work.",
      workflowProfile: "verification-heavy",
      triggers: ["repository inspection"],
      expectedEvidence: ["surface-map"],
      verificationGates: [],
      goalRunId: "goal-scoped",
    });
    workItemStore.upsert({
      id: "work-other",
      summary: "A different governed work item on the same session.",
      workflowProfile: "verification-heavy",
      triggers: ["repository inspection"],
      expectedEvidence: ["surface-map"],
      verificationGates: [],
    });
    goalRunStore.create({
      id: "goal-scoped",
      objective: "Inspect the repository without writes.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-scoped", "Inspect the repository without writes.", ["work-scoped"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct", turnId: "session-parent:turn:1" },
      workItemIds: ["work-scoped"],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "Read-only inspection.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const activeAttempt = workItemStore.startExecutionAttempt({
      id: "work-scoped",
      goalRunId: "goal-scoped",
      executionMode: "managed_delegation",
      summary: "Recover the failed managed invocation.",
      boundedWorkContractRevisionDigest: goalRunStore.get("goal-scoped")!.boundedWorkContractRevision.revisionDigest,
    });
    expect(activeAttempt).toBeDefined();
    const workItemBeforeRejection = workItemStore.get("work-scoped");
    const adapter = makeManagedAdapter();
    const routeAttachment = {
      kind: "external-runtime" as const,
      runtimeId: "mcp:studio",
      attachmentId: "instance-a",
    };
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { workItemStore, goalRunStore },
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
           providerId: "opencode",
           model: "opencode-default-model",
           capability: managedRouteCapability({ routeId: "opencode-readonly", providerId: "opencode", modelId: "opencode-default-model", toolNames: ["read"], externalRuntimeAttachment: routeAttachment }),
           createAdapter: async () => adapter,
           externalRuntimeAttachment: routeAttachment,
          profiles: [{
              authorityProfileId: "authority:opencode:readonly",
              admissionProfile: "foundation-readonly-plan",
              permissionProfile: "read-only",
              allowedToolNames: ["read"],
              workingDirectory: { path: "/workspace/kiln", mode: "read-only" },
              timeoutMs: 120000,
              credentialRoute: { mode: "runtime-selected", routeId: "credential-route:opencode:primary" },
              memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
          }],
        }],
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "tool-call-recovery-scope", name: "managed_agent.invoke", input: {} },
    };
    const invoke = runtimeSurface.callBuiltinTools.get("managed_agent.invoke");

    // A recovery request naming a work item that is not governed by this goal
    // must be rejected before any mutation - never retargeted onto it.
    const wrongWorkItem = await invoke?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode" },
      task: "Retry the failed managed invocation.",
      goalRunId: "goal-scoped",
      workItemId: "work-other",
    }, context) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(wrongWorkItem).toMatchObject({
      isError: true,
      metadata: { errorCode: "governed_scope_mismatch" },
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(workItemStore.get("work-scoped")).toEqual(workItemBeforeRejection);
    expect(workItemStore.get("work-other")).toMatchObject({ id: "work-other" });

    // A recovery request naming a stale/non-active execution attempt on the
    // correct work item must also be rejected before any mutation.
    const staleAttempt = await invoke?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode" },
      task: "Retry the failed managed invocation.",
      goalRunId: "goal-scoped",
      workItemId: "work-scoped",
      attemptId: "goal-scoped:work-scoped:attempt:stale",
    }, context) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(staleAttempt).toMatchObject({
      isError: true,
      metadata: { errorCode: "execution_attempt_not_found" },
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(workItemStore.get("work-scoped")).toEqual(workItemBeforeRejection);

    // The governed scope and active attempt are valid here. Only the physical
    // external-runtime attachment differs, so canonical admission must reject
    // the recovery rather than retargeting it.
    const wrongAttachment = await invoke?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode" },
      task: "Retry the failed managed invocation.",
      goalRunId: "goal-scoped",
      workItemId: "work-scoped",
      attemptId: activeAttempt!.attempt.id,
      externalRuntimeAttachment: {
        runtimeId: routeAttachment.runtimeId,
        attachmentId: "instance-b",
      },
    }, context) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(wrongAttachment).toMatchObject({
      isError: true,
      metadata: {
        status: "denied",
        admissionReasons: [{ code: "external-runtime-attachment-mismatch" }],
      },
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(workItemStore.get("work-scoped")).toEqual(workItemBeforeRejection);
  });

  it("projects default runtime tools from the canonical core builtin surface", () => {
    const coreSurface = createDefaultBuiltinToolSurface();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(coreSurface.toolNames);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(coreSurface.toolNames);
    expect(Array.from(runtimeSurface.capabilities.keys())).toEqual(Array.from(coreSurface.capabilities.keys()));
    expect(projectToolDefinitions(runtimeSurface.toolDefinitions)).toEqual(projectToolDefinitions(coreSurface.toolDefinitions));
    expect(runtimeSurface.capabilities).toEqual(coreSurface.capabilities);
    expect(runtimeSurface.listResources()).toEqual(coreSurface.resources.list().map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      title: resource.title,
      mimeType: resource.mimeType,
    })));
    expect(runtimeSurface.listResourceTemplates().map((template) => template.uriTemplate)).toEqual(
      coreSurface.resources.listTemplates().map((template) => template.uriTemplate),
    );
  });

  it("builds executable per-call config from the same runtime surface projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
    });

    const projectedToolNames = runtimeSurface.toolDefinitions.map((tool) => tool.name);
    const admittedToolNames = Array.from(config.toolAllowlist ?? []);
    expect(admittedToolNames).toContain("read");
    expect(admittedToolNames).toContain("grep");
expect(admittedToolNames).not.toContain("write");
    expect(admittedToolNames).not.toContain("bash");
    expect(config.additionalTools?.map((tool) => tool.name)).toEqual(admittedToolNames);
    expect(new Set(config.perCallCapabilities?.keys())).toEqual(new Set(admittedToolNames));
    expect(new Set(config.toolAuthority?.keys())).toEqual(new Set(admittedToolNames));
    expect(config.effectiveTurnAuthority).toMatchObject({
      requestedAuthority: "auto",
      admittedAuthority: "audited",
      toolCount: admittedToolNames.length,
      deniedToolCount: projectedToolNames.length - admittedToolNames.length,
    });
  });

  it("projects configured invocation admission into the runtime pre-claim policy boundary", () => {
    const toolInvocationAdmission = {
      authorize: vi.fn().mockReturnValue({
        level: 1,
        allowed: true,
        requiresApproval: false,
        reason: "Configured policy allows invocation.",
      }),
    };
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { invocationAdmission: toolInvocationAdmission },
    });
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
    });

    expect(runtimeSurface.toolInvocationAdmission).toBe(toolInvocationAdmission);
    expect(config.toolInvocationAdmission).toBe(toolInvocationAdmission);
  });

  it("fails closed for non-executable provider profiles and exposes no tools", () => {
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "openai",
      activeModel: "gpt-4.1",
      activeModelCapabilities: { supportsFunctionTools: false, supportsRuntimeTools: false },
    });

    expect(config.toolAllowlist?.size ?? 0).toBe(0);
    expect(config.toolAuthority?.size ?? 0).toBe(0);
    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "auto",
      admittedAuthority: "fail_closed",
      sourcePolicy: "provider_profile_gate",
      completeness: "authoritative",
      toolCount: 0,
      deniedToolCount: expect.any(Number),
      sandboxProjection: "none",
    });

    const unresolvedConfig = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
    });
    expect(unresolvedConfig.toolAllowlist?.size ?? 0).toBe(0);
    expect(unresolvedConfig.toolAuthority?.size ?? 0).toBe(0);
    expect(unresolvedConfig.effectiveTurnAuthority).toMatchObject({
      admittedAuthority: "fail_closed",
      sourcePolicy: "provider_profile_gate",
      completeness: "authoritative",
      toolCount: 0,
      deniedToolCount: expect.any(Number),
    });
    expect(config.effectiveTurnAuthority?.deniedToolCount).toBeGreaterThan(0);
    expect(unresolvedConfig.effectiveTurnAuthority?.deniedToolCount).toBeGreaterThan(0);
    expect(unresolvedConfig.effectiveTurnAuthority?.reason).toContain("unresolved");
  });

  it("builds plan-mode per-call config from explicitly read-only tools and planning workflow tools", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "plan",
    });

    expect(config.toolAllowlist?.has("read")).toBe(true);
    expect(config.toolAllowlist?.has("tree")).toBe(true);
    expect(config.toolAllowlist?.has("submit_plan")).toBe(true);
    expect(config.toolAllowlist?.has("submit_specification")).toBe(true);
    expect(config.toolAllowlist?.has("record_clarification")).toBe(true);
    expect(config.toolAllowlist?.has("write")).toBe(false);
    expect(config.toolAllowlist?.has("edit")).toBe(false);
    expect(config.toolAllowlist?.has("patch")).toBe(false);
    expect(config.additionalTools?.map((tool) => tool.name)).toEqual(Array.from(config.toolAllowlist ?? []));
    expect(config.perCallCapabilities?.get("submit_plan")?.effectEnvelope).toMatchObject({
      operation: "observe",
      dataEgress: "metadata",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    });
    const allowlist = new Set(config.toolAllowlist ?? []);
    const perCallCapabilityNames = new Set(Array.from(config.perCallCapabilities?.keys() ?? []));
    expect(perCallCapabilityNames).toEqual(allowlist);
    expect(config.perCallCapabilities?.has("write")).toBe(false);
    expect(config.perCallCapabilities?.has("edit")).toBe(false);
    expect(config.perCallCapabilities?.has("patch")).toBe(false);
    expect(config.perCallCapabilities?.has("shell_command")).toBe(false);
    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "plan",
      requestedAuthority: "planning",
      admittedAuthority: "read_only",
      sourcePolicy: "plan_mode_projection",
      completeness: "authoritative",
      sandboxProjection: "read_only",
    });
expect(config.effectiveTurnAuthority?.toolCount).toBe(config.toolAllowlist?.size ?? 0);
    expect(config.effectiveTurnAuthority?.deniedToolCount).toBeGreaterThanOrEqual(0);
  });

  it("narrows execute-mode tools for requested read_only authority", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const requestedReadOnly = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
      requestedAuthority: "read_only",
    });

    expect(requestedReadOnly.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "read_only",
      admittedAuthority: "read_only",
      sourcePolicy: "runtime_surface_projection",
      completeness: "authoritative",
    });

    const allowlist = requestedReadOnly.toolAllowlist ?? new Set<string>();
    expect(allowlist.size).toBeGreaterThan(0);
    expect(allowlist.has("write")).toBe(false);
    expect(allowlist.has("edit")).toBe(false);
    expect(allowlist.has("patch")).toBe(false);
    expect(allowlist.has("shell_command")).toBe(false);
    for (const toolName of allowlist) {
      expect(requestedReadOnly.perCallCapabilities?.get(toolName)?.effectEnvelope).toMatchObject({
        operation: "observe",
      });
      expect(requestedReadOnly.toolAuthority?.get(toolName)).toMatchObject({
        allowed: true,
        requiresApproval: false,
      });
    }

    expect(requestedReadOnly.additionalTools?.map((tool) => tool.name)).toEqual(Array.from(allowlist));
    expect(requestedReadOnly.effectiveTurnAuthority?.toolCount).toBe(allowlist.size);
    expect(requestedReadOnly.effectiveTurnAuthority?.deniedToolCount).toBe(runtimeSurface.toolDefinitions.length - allowlist.size);
  });

  it("records explicit min-policy inputs on admitted authority snapshots", () => {
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: createAttachedRuntimeBuiltinToolSurface(),
      executionMode: "execute",
      requestedAuthority: "read_only",
    });

    expect(config.effectiveTurnAuthority?.policyInputs).toEqual([
      expect.objectContaining({
        source: "requested_authority",
        status: "applied",
        requestedAuthority: "read_only",
      }),
      expect.objectContaining({
        source: "session_policy",
        status: "not_applicable",
      }),
      expect.objectContaining({
        source: "tenant_policy",
        status: "not_applicable",
        subjectId: "tenant-1",
      }),
      expect.objectContaining({
        source: "route_policy",
        status: "not_applicable",
        admittedAuthority: "read_only",
      }),
      expect.objectContaining({
        source: "parent_authority",
        status: "not_applicable",
      }),
      expect.objectContaining({
        source: "plan_approval",
        status: "not_applicable",
      }),
      expect.objectContaining({
        source: "goal_envelope",
        status: "not_applicable",
      }),
      expect.objectContaining({
        source: "work_item_authority",
        status: "not_applicable",
      }),
    ]);
  });

  it("rejects malformed requested authority in the shared per-call builder", () => {
    expect(() => buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      requestedAuthority: "invalid" as unknown as "auto",
    })).toThrow("Unknown requested authority 'invalid'.");
  });

  it("narrows execute-mode tools for requested audited authority to non-approval level <=2 tools", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const baseline = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
    });
    const requestedAudited = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
      requestedAuthority: "audited",
    });

    expect(requestedAudited.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "audited",
      sourcePolicy: "runtime_surface_projection",
      completeness: "authoritative",
    });

    const allowlist = requestedAudited.toolAllowlist ?? new Set<string>();
    expect(allowlist.size).toBeGreaterThan(0);
    expect(allowlist.has("read")).toBe(true);
    expect(allowlist.has("shell_command")).toBe(false);
    for (const toolName of allowlist) {
      expect(requestedAudited.toolAuthority?.get(toolName)).toMatchObject({
        allowed: true,
        requiresApproval: false,
      });
      expect((requestedAudited.toolAuthority?.get(toolName)?.level ?? 99)).toBeLessThanOrEqual(2);
    }

    expect(requestedAudited.additionalTools?.map((tool) => tool.name)).toEqual(Array.from(allowlist));
    expect(requestedAudited.effectiveTurnAuthority?.toolCount).toBe(allowlist.size);
    expect(requestedAudited.effectiveTurnAuthority?.deniedToolCount).toBe(runtimeSurface.toolDefinitions.length - allowlist.size);
    expect(allowlist.size).toBe(Array.from(baseline.toolAllowlist ?? []).length);
  });

  it("keeps plan-mode requestedAuthority as planning even when execute-mode audited authority is requested", () => {
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: createAttachedRuntimeBuiltinToolSurface(),
      executionMode: "plan",
      requestedAuthority: "audited",
    });

    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "plan",
      requestedAuthority: "planning",
      admittedAuthority: "read_only",
      sourcePolicy: "plan_mode_projection",
    });
  });

  it("derives execute-mode admitted authority from allowlist/toolAuthority and reports tool count", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
    });

    const candidateToolNames = runtimeSurface.toolDefinitions.map((tool) => tool.name);
    const expectedToolCount = config.toolAllowlist?.size ?? 0;
    const deniedToolCount = countDeniedTools(config.toolAllowlist, candidateToolNames);
    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "auto",
      sourcePolicy: "runtime_surface_projection",
      admittedAuthority: "audited",
      toolCount: expectedToolCount,
      deniedToolCount,
      sandboxProjection: "workspace_write",
    });
    expect(config.effectiveTurnAuthority?.completeness).toBe("authoritative");
  });

  it("admits workspace mutation tools for governed destructive execute authority", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
      requestedAuthority: "destructive",
      authorityContext: {
        sessionPolicy: {
          maximumAuthority: "destructive",
          reason: "Session permits governed destructive execution.",
        },
        tenantPolicy: {
          subjectId: "tenant-1",
          maximumAuthority: "destructive",
          reason: "Tenant permits governed destructive execution.",
        },
        routePolicy: {
          subjectId: "gui-runtime",
          maximumAuthority: "destructive",
          reason: "GUI runtime route permits governed destructive execution.",
        },
        goalEnvelope: {
          goalRunId: "goal-1",
          maximumAuthority: "destructive",
          reason: "Operator goal permits workspace mutation.",
        },
        workItemAuthority: {
          workItemId: "work-1",
          maximumAuthority: "destructive",
          reason: "Materialized work item permits workspace mutation.",
        },
      },
    });

    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "destructive",
      admittedAuthority: "destructive",
      sourcePolicy: "runtime_surface_projection",
      completeness: "authoritative",
      sandboxProjection: "workspace_write",
    });
    expect(config.toolAllowlist?.has("write")).toBe(true);
    expect(config.toolAllowlist?.has("edit")).toBe(true);
    expect(config.toolAllowlist?.has("patch")).toBe(true);
    expect(config.toolAllowlist?.has("bash")).toBe(true);
    expect(config.toolAuthority?.get("write")).toMatchObject({
      level: 4,
      allowed: true,
      requiresApproval: false,
      reason: "Governed destructive execution admitted by effective turn authority.",
    });

    const admission = projectToolPermissionAdmissionFromPerCallConfig({
      candidateToolNames: runtimeSurface.toolDefinitions.map((tool) => tool.name),
      config,
    });
    expect(
      admission.allowedToolPermissions.some((permission) => permission.toolName === "bash"),
    ).toBe(true);
  });

  it("keeps effectiveTurnAuthority in lockstep with returned allowlist and authority map", () => {
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: createAttachedRuntimeBuiltinToolSurface(),
    });

    const allowlist = Array.from(config.toolAllowlist ?? []);
    const additionalToolNames = config.additionalTools?.map((tool) => tool.name) ?? [];
    const candidateToolNames = createAttachedRuntimeBuiltinToolSurface().toolDefinitions.map((tool) => tool.name);
    const deniedToolCount = countDeniedTools(config.toolAllowlist, candidateToolNames);

    expect(new Set(additionalToolNames)).toEqual(new Set(allowlist));
    expect(config.effectiveTurnAuthority?.toolCount).toBe(allowlist.length);
    expect(config.effectiveTurnAuthority?.deniedToolCount).toBe(deniedToolCount);
  });

  it("records effective authority snapshots into attached runtime resources", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });

    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      requestedAuthority: "read_only",
    });

    expect(config.effectiveTurnAuthority).toMatchObject({
      requestedAuthority: "read_only",
      admittedAuthority: "read_only",
    });
    expect(runtimeSurface.listResources().map((resource) => resource.uri)).toContain("kiln://session/authority");

    const snapshot = await runtimeSurface.readResource("kiln://session/authority");
    const snapshotContent = snapshot.contents[0];
    expect(snapshotContent).toBeDefined();
    if (!snapshotContent || !("text" in snapshotContent)) {
      throw new Error("The authority resource must expose a text payload.");
    }
    expect(JSON.parse(snapshotContent.text)).toMatchObject({
      latest: {
        source: "runtime",
        authority: {
          requestedAuthority: "read_only",
          admittedAuthority: "read_only",
          sourcePolicy: "runtime_surface_projection",
        },
      },
      authorities: [
        {
          authority: {
            toolCount: config.effectiveTurnAuthority?.toolCount,
            deniedToolCount: config.effectiveTurnAuthority?.deniedToolCount,
          },
        },
      ],
    });
  });

  it("isolates default plan-mode state stores across runtime surface instances", async () => {
    const firstSurface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    const secondSurface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    const submitSpecification = firstSurface.callBuiltinTools.get("submit_specification");
    const submitPlan = secondSurface.callBuiltinTools.get("submit_plan");

    const firstSpec = await submitSpecification?.({
      title: "Isolated surface spec",
      objective: "Ensure no cross-session state leakage.",
      nonGoals: ["No shared mutable store across surfaces."],
      successCriteria: ["Independent plan/spec artifacts per surface."],
      actors: ["operator"],
      dataLifecycle: "Session scoped only.",
      uxEdgeCases: [],
      securityPrivacy: "No secrets.",
      externalDependencies: [],
      completionSignals: ["plan submission succeeds only with local specification."],
      constitutionSnapshot: {
        instructionProfileHash: "hash-isolation",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly metadata?: Record<string, unknown> } | undefined;
    const firstSpecificationId = typeof firstSpec?.metadata?.specificationId === "string"
      ? firstSpec.metadata.specificationId
      : undefined;
    expect(firstSpecificationId).toBeDefined();

    const result = await submitPlan?.({
      objective: "Attempt cross-surface submit.",
      nonGoals: ["No execution changes."],
      operatorDecisionsRequired: ["Approve isolation test."],
      assumptions: ["Stores are isolated."],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "State isolation check.",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Verify store isolation.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: firstSpecificationId,
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-isolation",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(result?.isError).toBe(true);
    expect(result?.metadata).toMatchObject({
      operation: "submit_plan",
      reason: "missing_specification",
      sourceSpecificationId: firstSpecificationId,
    });
  });

  it("fails closed when submit_plan required arrays or constitution ids are missing/invalid", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      executionMode: "plan",
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const submitPlan = runtimeSurface.callBuiltinTools.get("submit_plan");
    const submitSpecification = runtimeSurface.callBuiltinTools.get("submit_specification");

    await expect(submitPlan?.({
      objective: "Invalid payload missing assumptions.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload malformed affected surfaces.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: "runtime",
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload missing rollback notes.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      planId: 123,
      objective: "Invalid payload with malformed optional plan id.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload with empty constitution ids.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: [],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload with mixed constitution id types.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering", 123],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload with non-string assumptions entry.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [123],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload with malformed work-item dependencies.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: "wi-2",
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitSpecification?.({
      specificationId: 42,
      title: "Invalid optional specification id",
      objective: "Should fail closed on malformed optional id.",
      nonGoals: ["none"],
      successCriteria: ["criterion"],
      actors: ["operator"],
      dataLifecycle: "Session scoped.",
      uxEdgeCases: [],
      securityPrivacy: "No secrets.",
      externalDependencies: [],
      completionSignals: ["signal"],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_specification",
      },
    });
  });

  it("keeps planning closed until clarifications resolve required specification fields", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      executionMode: "plan",
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const submitSpecification = runtimeSurface.callBuiltinTools.get("submit_specification");
    const recordClarification = runtimeSurface.callBuiltinTools.get("record_clarification");
    const submitPlan = runtimeSurface.callBuiltinTools.get("submit_plan");

    const draftSpec = await submitSpecification?.({
      title: "Slice 1 intake",
      objective: "TBD",
      nonGoals: [],
      successCriteria: ["Maybe replay resources later."],
      actors: [],
      dataLifecycle: "TBD",
      uxEdgeCases: [],
      securityPrivacy: "TBD",
      externalDependencies: [],
      completionSignals: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-slice-1",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(draftSpec?.isError).toBe(false);
    expect(draftSpec?.metadata).toMatchObject({
      operation: "submit_specification",
      specificationStatus: "draft",
      blockingIssueCodes: [
        "ambiguity",
        "missing_non_goals",
        "vague_success_criteria",
        "undefined_actors",
        "unclear_data_lifecycle",
        "security_privacy_posture",
        "completion_signals",
      ],
    });
    const specificationId = typeof draftSpec?.metadata?.specificationId === "string"
      ? draftSpec.metadata.specificationId
      : undefined;

    await expect(submitPlan?.(sliceOnePlanPayload(specificationId))).resolves.toMatchObject({
      isError: true,
      metadata: {
        operation: "submit_plan",
        reason: "blocking_specification_issues",
        specificationId,
      },
    });

    const clarificationIds: string[] = [];
    for (const clarification of [
      ["What objective is in scope?", "Deliver canonical structured specification intake.", "objective"],
      ["What is out of scope?", "Do not implement goal execution.", "nonGoals"],
      ["What proves completion?", "Specification resources replay from session state.", "successCriteria"],
      ["Who uses this?", "operator", "actors"],
      ["How is data scoped?", "Session-scoped specification and clarification resources only.", "dataLifecycle"],
      ["What is the security posture?", "No secrets are stored in specification artifacts.", "securityPrivacy"],
      ["What external dependencies exist?", "none", "externalDependencies"],
      ["What is the closeout signal?", "Focused tests and docs confirm Slice 1 behavior.", "completionSignals"],
    ] as const) {
      const result = await recordClarification?.({
        specificationId,
        question: clarification[0],
        answer: clarification[1],
        affectedSection: clarification[2],
        rationale: "Resolve required Slice 1 specification intake before planning.",
      }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;
      expect(result?.isError).toBe(false);
      if (typeof result?.metadata?.clarificationId === "string") {
        clarificationIds.push(result.metadata.clarificationId);
      }
    }

    await expect(submitPlan?.(sliceOnePlanPayload(specificationId, clarificationIds))).resolves.toMatchObject({
      isError: false,
      metadata: {
        operation: "submit_plan",
        sourceSpecificationId: specificationId,
        sourceSpecificationStatus: "ready_for_plan",
        analysisStatus: "ready",
      },
    });
  });

  it("submits structured plans only when linked specification state is valid", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      executionMode: "plan",
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const submitSpecification = runtimeSurface.callBuiltinTools.get("submit_specification");
    const recordClarification = runtimeSurface.callBuiltinTools.get("record_clarification");
    const submitPlan = runtimeSurface.callBuiltinTools.get("submit_plan");

    const specResult = await submitSpecification?.({
      title: "Slice 2",
      objective: "Convert submit_plan to structured contract.",
      nonGoals: ["Do not execute implementation in plan mode."],
      successCriteria: ["Structured plan artifacts are validated and replayable."],
      actors: ["operator", "runtime"],
      dataLifecycle: "Plan artifacts remain session-scoped canonical resources.",
      uxEdgeCases: ["Missing approval boundaries for high-risk plans."],
      securityPrivacy: "No secrets stored in plan payload.",
      externalDependencies: ["none"],
      completionSignals: ["plan_submitted event contains structured fields."],
      constitutionSnapshot: {
        instructionProfileHash: "hash-2",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(specResult?.isError).toBe(false);
    const specificationId = typeof specResult?.metadata?.specificationId === "string"
      ? specResult.metadata.specificationId
      : undefined;
    expect(specificationId).toBeDefined();

    const clarificationResult = await recordClarification?.({
      specificationId,
      question: "Should high-risk plans require rollback notes?",
      answer: "Yes.",
      affectedSection: "verification",
      rationale: "High-risk slices must fail closed with explicit recovery guidance.",
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;
    expect(clarificationResult?.isError).toBe(false);
    const clarificationId = typeof clarificationResult?.metadata?.clarificationId === "string"
      ? clarificationResult.metadata.clarificationId
      : undefined;

    const planResult = await submitPlan?.({
      objective: "Ship typed plan submission contract.",
      nonGoals: ["Do not materialize work items automatically in Slice 2."],
      operatorDecisionsRequired: ["Approve plan hash before execute transition."],
      assumptions: ["Operator profile hash is stable during planning turn."],
      affectedSurfaces: ["runtime", "core", "gateway-contracts", "cli"],
      riskClassification: "high",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "Cross-surface behavior and replay semantics.",
        workflowProfile: "architecture-change",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Add structured plan schema and validation.",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests", "typecheck"],
        verificationGates: ["bun test", "bun run typecheck"],
        dependencies: [],
      }],
      expectedEvidence: ["tests", "typecheck", "review"],
      verificationGates: ["bun test", "bun run typecheck"],
      managedAgentDelegationCandidates: ["reviewer"],
      approvalBoundaries: ["Plan approval required before execute mode."],
      rollbackNotes: "Revert plan event payload and schema changes.",
      residualRisks: ["Presentation adapters may lag one schema revision."],
      sourceSpecificationId: specificationId,
      clarificationRecordIds: clarificationId ? [clarificationId] : [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-2",
        instructionProfileIds: ["sequel-engineering"],
      },
    });

    expect(planResult).toMatchObject({
      isError: false,
      metadata: {
        operation: "submit_plan",
        sourceSpecificationId: specificationId,
        riskClassification: "high",
        workflowProfile: "architecture-change",
        proposedWorkItems: [{
          id: "wi-1",
          summary: "Add structured plan schema and validation.",
          workflowProfile: "architecture-change",
          risk: "high",
        }],
      },
    });
    if (!isToolResult(planResult)) {
      throw new Error("submit_plan must return a complete tool result.");
    }
    expect(planResult.output).toContain("Ship typed plan submission contract.");
    expect(planResult.output).toContain("- source specification: spec_1");
    expect(planResult.output).toContain("- work item wi-1: Add structured plan schema and validation.");

    const plans = await runtimeSurface.readResource("kiln://session/plans");
    const plansContent = plans.contents[0];
    expect(plansContent).toBeDefined();
    if (!plansContent || !("text" in plansContent)) {
      throw new Error("The plans resource must expose a text payload.");
    }
    const plansPayload: unknown = JSON.parse(plansContent.text);
    const planEntries = typeof plansPayload === "object" && plansPayload !== null
      ? Reflect.get(plansPayload, "plans")
      : undefined;
    const firstPlan = Array.isArray(planEntries) && typeof planEntries[0] === "object" && planEntries[0] !== null
      ? planEntries[0]
      : undefined;
    const persistedProposedWorkItems = firstPlan
      ? Reflect.get(firstPlan, "proposedWorkItems")
      : undefined;
    const submittedProposedWorkItems = planResult.metadata
      ? Reflect.get(planResult.metadata, "proposedWorkItems")
      : undefined;
    expect(persistedProposedWorkItems).toEqual(
      submittedProposedWorkItems,
    );

    const invalidPlanResult = await submitPlan?.({
      objective: "Invalid high-risk plan.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "high",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "high risk",
        workflowProfile: "architecture-change",
      },
      proposedWorkItems: [{
        id: "wi-bad",
        summary: "Bad",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: specificationId,
      clarificationRecordIds: clarificationId ? [clarificationId] : [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-2",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(invalidPlanResult?.isError).toBe(true);
    expect(invalidPlanResult?.metadata).toMatchObject({
      operation: "submit_plan",
      planStatus: "draft",
    });
    expect(typeof invalidPlanResult?.metadata?.blockingIssueCount).toBe("number");

    const analysisBlockedResult = await submitPlan?.({
      objective: "Plan with critical dependency inconsistency.",
      nonGoals: ["Do not auto-approve invalid dependency graphs."],
      operatorDecisionsRequired: ["Approve dependency correction before execution."],
      assumptions: ["Work item dependency graph must be valid."],
      affectedSurfaces: ["runtime"],
      riskClassification: "high",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "Critical workflow control path.",
        workflowProfile: "architecture-change",
      },
      proposedWorkItems: [{
        id: "wi-analysis",
        summary: "Analyze dependency graph.",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: ["wi-missing"],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: ["reviewer"],
      approvalBoundaries: ["Block approval on critical analysis findings."],
      rollbackNotes: "Re-run analysis after fixing dependencies.",
      residualRisks: ["none"],
      sourceSpecificationId: specificationId,
      clarificationRecordIds: clarificationId ? [clarificationId] : [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-2",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(analysisBlockedResult?.isError).toBe(true);
    expect(analysisBlockedResult?.metadata).toMatchObject({
      operation: "submit_plan",
      analysisStatus: "blocked",
      analysisHighestSeverity: "critical",
      analysisBlockingFindingCount: 1,
    });
  });

  it("invokes and resumes managed-delegation work item execution exactly once", async () => {
    const startTool = makeManagedExecutionStartTool();
    const adapter = makeManagedAdapter();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: managedRouteCapability({ routeId: "opencode-readonly", providerId: "opencode", modelId: "opencode-default-model", toolNames: ["read", "grep", "glob"] }),
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:opencode:readonly",
              admissionProfile: "foundation-readonly-plan",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob"],
              workingDirectory: {
                path: "/workspace/kiln",
                mode: "read-only",
              },
              timeoutMs: 120000,
              credentialRoute: {
                mode: "runtime-selected",
                routeId: "credential-route:opencode:primary",
              },
              memoryScope: {
                scope: { kind: "project", id: "kiln" },
                access: "read-only",
              },
          }],
        }],
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context);

    expect(result).toMatchObject({ isError: false });
    if (!isToolResult(result)) {
      throw new Error("Managed execution start must return a complete tool result.");
    }
    expect(startTool.calls).toHaveLength(2);
    expect(startTool.calls[1]?.input).toMatchObject({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
      managedInvocationId: expect.stringContaining("managed-session-parent-1-tool-call-start-managed-invocation"),
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect((adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request).toMatchObject({
      profile: "foundation-readonly-plan",
      requestedAuthority: "read_only",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      input: {
        handoff: {
          workItemId: "work-managed",
          expectedEvidence: ["managed-agent-review"],
          requiredResultFields: ["summary", "evidence", "verificationResults"],
          doneCriteria: ["Return a bounded handoff."],
          residualRiskRequired: false,
        },
      },
    });
    expect(result.metadata).toMatchObject({
      operation: "execution_started",
      managedInvocationAutoStarted: true,
      managedInvocationId: expect.stringContaining("managed-session-parent-1-tool-call-start-managed-invocation"),
      managedInvocation: {
        toolName: "managed_agent.invoke",
        invocationId: expect.stringContaining("managed-session-parent-1-tool-call-start-managed-invocation"),
        status: "completed",
      },
    });
  });

  it("runs intermediate evidence phases in the governed child before handing control back to the parent", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-managed",
      expectedEvidence: ["visual-reference-research"],
      requiredResultFields: ["summary", "evidence", "verificationResults"],
      doneCriteria: ["Return a bounded handoff."],
      residualRiskRequired: false,
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_session_start"],
        completionTool: "work_item.update",
        instruction: "Record only this phase evidence before requesting the next phase.",
      },
    });
    const adapter = makeManagedAdapter(
      "Inspected the running product UI screenshot at https://example.test/reference.png and mapped reusable patterns to packages/gui/src.",
    );
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: managedRouteCapability({ routeId: "opencode-readonly", providerId: "opencode", modelId: "opencode-default-model", toolNames: ["read", "grep", "glob", "web_search", "browser_session_start"] }),
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:opencode:readonly",
              admissionProfile: "foundation-readonly-plan",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob", "web_search", "browser_session_start"],
              networkAllowed: true,
              workingDirectory: {
                path: "/workspace/kiln",
                mode: "read-only",
              },
              timeoutMs: 120000,
              credentialRoute: {
                mode: "runtime-selected",
                routeId: "credential-route:opencode:primary",
              },
              memoryScope: {
                scope: { kind: "project", id: "kiln" },
                access: "read-only",
              },
          }],
        }],
        agentCatalog: [{
          name: "visual-researcher",
          displayName: "Kimi",
          role: "Visual research specialist",
          goal: "Collect real visual reference evidence before frontend implementation.",
          tier: "reasoning",
          authorityProfileId: "authority:opencode:readonly",
          admissionProfile: "foundation-readonly-plan",
          routeId: "opencode-readonly",
          providerRoute: {
            providerId: "opencode",
            model: "opencode-default-model",
          },
        }],
        contextResolver: async () => ({ admittedAgentProfile: "visual-researcher" }),
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata?: Record<string, unknown>;
    };
    const output = JSON.parse(result.output) as Record<string, unknown>;

    expect(result, result.output).toMatchObject({ isError: false });
    expect(output).toMatchObject({
      status: "paused",
      nextTool: "work_item.update",
      managedInvocationId: expect.stringContaining("managed-session-parent-1-tool-call-start-managed-invocation"),
      managedInvocation: expect.objectContaining({
        status: "completed",
        resultHandoff: expect.objectContaining({
          summary: expect.stringContaining("Inspected the running product UI screenshot"),
        }),
      }),
      managedInvocationRequest: {
        routeId: "opencode-readonly",
        agentProfile: "visual-researcher",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        executionPhase: {
          id: "visual-reference-research",
          completionTool: "work_item.update",
        },
        workItemId: "work-managed",
      },
    });
    expect(result.output).not.toContain('"transcript"');
    expect(result.output).not.toContain('"capabilitySnapshot"');
    expect(startTool.calls).toHaveLength(1);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect(result.metadata).toMatchObject({
      operation: "managed_intermediate_phase_completed",
      managedInvocationAutoStarted: true,
      executionScopeTransition: {
        action: "enter",
        scope: {
          kind: "work_item",
          goalRunId: "goal-managed",
          workItemId: "work-managed",
        },
      },
    });
  });

  it("hydrates an unowned intermediate phase from the uniquely preferred compatible route", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      requestedAuthority: "read_only",
      task: "Run repository verification.",
      summary: "Run repository verification.",
      workItemId: "work-managed",
      requiredToolNames: ["bash"],
      expectedEvidence: ["tests", "typecheck"],
      requiredResultFields: ["summary", "evidence", "verificationResults"],
      doneCriteria: ["Return command evidence."],
      residualRiskRequired: false,
      executionPhase: {
        id: "implementation-verification",
        taskAffinity: ["test-writing"],
        expectedEvidence: ["tests", "typecheck"],
        requiredToolNames: ["bash"],
        completionTool: "work_item.update",
        autoStartAllowed: false,
      },
    });
    const adapter = makeManagedAdapter();
    const profile = (allowedToolNames: readonly string[]) => ({
      authorityProfileId: `authority:opencode:${allowedToolNames.join("-")}`,
      admissionProfile: "foundation-readonly-plan" as const,
      permissionProfile: "read-only",
      allowedToolNames,
      workingDirectory: { path: "/workspace/kiln", mode: "read-only" as const },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected" as const,
        routeId: "credential-route:opencode:primary",
      },
      memoryScope: {
        scope: { kind: "project" as const, id: "kiln" },
        access: "read-only" as const,
      },
    });
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({ additionalTools: [startTool] }),
      managedInvocation: {
        routes: [
          {
            routeId: "opencode-analysis-readonly",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "analysis-model",
            capability: managedRouteCapability({ routeId: "opencode-analysis-readonly", providerId: "opencode", modelId: "analysis-model", toolNames: ["read", "grep", "glob"] }),
            createAdapter: async () => adapter,
            profiles: [profile(["read", "grep", "glob"])],
          },
          {
            routeId: "opencode-general-readonly",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "general-model",
            capability: managedRouteCapability({ routeId: "opencode-general-readonly", providerId: "opencode", modelId: "general-model", toolNames: ["read", "grep", "glob", "bash"] }),
            createAdapter: async () => adapter,
            taskSuitability: [{
              task: "test-writing",
              level: "capable",
              source: "configured-route",
              reason: "General verification capability.",
            }],
            profiles: [profile(["read", "grep", "glob", "bash"])],
          },
          {
            routeId: "opencode-verification-readonly",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "verification-model",
            capability: managedRouteCapability({ routeId: "opencode-verification-readonly", providerId: "opencode", modelId: "verification-model", toolNames: ["read", "grep", "glob", "bash"] }),
            createAdapter: async () => adapter,
            taskSuitability: [{
              task: "test-writing",
              level: "preferred",
              source: "configured-route",
              reason: "Preferred verification route.",
            }],
            profiles: [profile(["read", "grep", "glob", "bash"])],
          },
        ],
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "tool-call-start", name: "work_item.execution.start", input: {} },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as { readonly output: string; readonly isError: boolean };
    const output = JSON.parse(result.output) as {
      readonly managedInvocationRequest?: {
        readonly routeId?: string;
        readonly providerRoute?: { readonly providerId?: string; readonly model?: string };
      };
    };

    expect(result.isError).toBe(false);
    expect(output.managedInvocationRequest).toMatchObject({
      routeId: "opencode-verification-readonly",
      providerRoute: { providerId: "opencode", model: "verification-model" },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("owns validated managed phase progression and attempt closeout inside the runtime", async () => {
    let phase: "diagnosis" | "closeout" = "diagnosis";
    const startCalls: ToolInput[] = [];
    const updateCalls: ToolInput[] = [];
    const finishCalls: ToolInput[] = [];
    const tool = (
      name: string,
      execute: DevTool["execute"],
    ): DevTool => ({
      name,
      description: `Test ${name}.`,
      inputSchema: { type: "object", properties: {} },
      effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
      execute,
    });
    const startTool = tool("work_item.execution.start", async (toolInput): Promise<ToolResult> => {
      startCalls.push(toolInput);
      const invocationId = typeof toolInput.input.managedInvocationId === "string"
        ? toolInput.input.managedInvocationId
        : undefined;
      if (invocationId) {
        return {
          output: JSON.stringify({ status: "started", attempt: { id: "attempt-1", managedInvocationId: invocationId } }),
          metadata: {
            kind: "work_item",
            toolName: "work_item.execution.start",
            operation: "execution_started",
            attempt: testExecutionAttempt({ managedInvocationId: invocationId }),
          },
          isError: false,
        };
      }
      const expectedEvidence = phase === "diagnosis" ? ["surface-map"] : ["managed-agent-review"];
      return {
        output: JSON.stringify({
          status: "paused",
          nextTool: "managed_agent.invoke",
          managedInvocationRequest: {
            profile: "foundation-readonly-plan",
            routeId: "opencode-readonly",
            requestedAuthority: "read_only",
            task: `Run ${phase}.`,
            summary: `Run ${phase}.`,
            goalRunId: "goal-managed",
            workItemId: "work-managed",
            expectedEvidence,
            requiredResultFields: ["summary", "evidence", "verificationResults"],
            doneCriteria: ["Return structured phase evidence."],
            residualRiskRequired: false,
            executionPhase: {
              id: phase,
              expectedEvidence,
              completionTool: phase === "diagnosis" ? "work_item.update" : "work_item.execution.finish",
            },
          },
        }),
        isError: true,
      };
    });
    const updateTool = tool("work_item.update", async (toolInput) => {
      updateCalls.push(toolInput);
      phase = "closeout";
      return { output: JSON.stringify({ status: "pending" }), isError: false };
    });
    const finishTool = tool("work_item.execution.finish", async (toolInput): Promise<ToolResult> => {
      finishCalls.push(toolInput);
      return {
        output: JSON.stringify({ status: "completed", attempt: { id: "attempt-1", status: "completed" } }),
        metadata: {
          kind: "work_item",
          toolName: "work_item.execution.finish",
          operation: "execution_finished",
          attempt: testExecutionAttempt({ status: "completed", completedAt: "2026-08-12T00:01:00.000Z" }),
        },
        isError: false,
      };
    });
    const adapter = makeManagedAdapter();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool, updateTool, finishTool],
      }),
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: managedRouteCapability({ routeId: "opencode-readonly", providerId: "opencode", modelId: "opencode-default-model", toolNames: ["read", "grep", "glob"] }),
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:opencode:readonly",
              admissionProfile: "foundation-readonly-plan",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob"],
              workingDirectory: { path: "/workspace/kiln", mode: "read-only" },
              timeoutMs: 120000,
              credentialRoute: { mode: "runtime-selected", routeId: "credential-route:opencode:primary" },
              memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
          }],
        }],
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "tool-call-lifecycle", name: "work_item.execution.start", input: {} },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
    }, context);

    expect(result).toMatchObject({ isError: false });
    if (!isToolResult(result)) {
      throw new Error("Managed execution lifecycle must return a complete tool result.");
    }
    expect(adapter.invoke).toHaveBeenCalledTimes(2);
    const invocationIds = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0].request.invocationId);
    expect(new Set(invocationIds).size).toBe(2);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.input).toMatchObject({ providedEvidence: ["surface-map"] });
    expect(startCalls.at(-1)?.input).toMatchObject({ managedInvocationId: invocationIds[1] });
    expect(finishCalls).toHaveLength(1);
    expect(finishCalls[0]?.input).toMatchObject({
      goalRunId: "goal-managed",
      workItemId: "work-managed",
      attemptId: "attempt-1",
      providedEvidence: ["managed-agent-review"],
    });
    expect(result.metadata).toMatchObject({
      operation: "execution_finished",
      managedInvocationAutoCompleted: true,
      managedInvocations: [
        { invocationId: invocationIds[0] },
        { invocationId: invocationIds[1] },
      ],
    });
  });

  it("does not attach an agent profile when a paused route-owned request forbids it", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: {
        providerId: "opencode",
        model: "stale-write-route-model",
      },
      forbiddenInputFields: ["agentProfile"],
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-managed",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read", "glob", "grep"],
      requiredResultFields: ["summary", "evidence", "verificationResults"],
      doneCriteria: ["Return a bounded handoff."],
      residualRiskRequired: false,
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read", "glob", "grep"],
        completionTool: "work_item.update",
        autoStartAllowed: false,
      },
    });
    const adapter = makeManagedAdapter(
      "Inspected the running product UI screenshot at https://example.test/reference.png and mapped reusable patterns to packages/gui/src.",
    );
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: managedRouteCapability({ routeId: "opencode-readonly", providerId: "opencode", modelId: "opencode-default-model", toolNames: ["read", "grep", "glob"] }),
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:opencode:readonly",
              admissionProfile: "foundation-readonly-plan",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob"],
              workingDirectory: {
                path: "/workspace/kiln",
                mode: "read-only",
              },
              timeoutMs: 120000,
              credentialRoute: {
                mode: "runtime-selected",
                routeId: "credential-route:opencode:primary",
              },
              memoryScope: {
                scope: { kind: "project", id: "kiln" },
                access: "read-only",
              },
          }],
        }],
        agentCatalog: [{
          name: "visual-researcher",
          displayName: "Kimi",
          role: "Visual research specialist",
          goal: "Collect real visual reference evidence before frontend implementation.",
          tier: "reasoning",
          authorityProfileId: "authority:opencode:readonly",
          admissionProfile: "foundation-readonly-plan",
          routeId: "opencode-readonly",
          providerRoute: {
            providerId: "opencode",
            model: "opencode-default-model",
          },
        }],
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };
    const output = JSON.parse(result.output) as {
      readonly managedInvocationRequest?: {
        readonly agentProfile?: string;
        readonly providerRoute?: { readonly model?: string };
      };
    };

    expect(result.isError).toBe(false);
    expect(output.managedInvocationRequest?.agentProfile).toBeUndefined();
    expect(output.managedInvocationRequest?.providerRoute?.model).toBe("opencode-default-model");
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("drops stale provider models for route-owned paused requests when the selected route has no model", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      routeId: "opencode-provider-default",
      providerRoute: {
        providerId: "opencode",
        model: "stale-write-route-model",
      },
      forbiddenInputFields: ["agentProfile"],
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-managed",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read", "glob", "grep"],
      requiredResultFields: ["summary", "evidence", "verificationResults"],
      doneCriteria: ["Return a bounded handoff."],
      residualRiskRequired: false,
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read", "glob", "grep"],
        completionTool: "work_item.update",
        autoStartAllowed: false,
      },
    });
    const adapter = makeManagedAdapter(
      "Inspected the running product UI screenshot at https://example.test/reference.png and mapped reusable patterns to packages/gui/src.",
    );
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [{
          routeId: "opencode-provider-default",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: managedRouteCapability({ routeId: "opencode-provider-default", providerId: "opencode", modelId: "opencode-default-model", toolNames: ["read", "grep", "glob"] }),
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:opencode:readonly",
              admissionProfile: "foundation-readonly-plan",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob"],
              workingDirectory: {
                path: "/workspace/kiln",
                mode: "read-only",
              },
              timeoutMs: 120000,
              credentialRoute: {
                mode: "runtime-selected",
                routeId: "credential-route:opencode:primary",
              },
              memoryScope: {
                scope: { kind: "project", id: "kiln" },
                access: "read-only",
              },
          }],
        }],
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };
    const output = JSON.parse(result.output) as {
      readonly managedInvocationRequest?: {
        readonly providerRoute?: { readonly model?: string };
      };
    };

    expect(result.isError).toBe(false);
    expect(output.managedInvocationRequest?.providerRoute?.model).toBe("opencode-default-model");
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("repairs intermediate phase routes to a compatible read-only route before pausing", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      routeId: "opencode-visual-without-browser",
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-managed",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["web_search", "browser_session_start"],
      requiredResultFields: ["summary", "evidence", "verificationResults"],
      doneCriteria: ["Return a bounded handoff."],
      residualRiskRequired: false,
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_session_start"],
        completionTool: "work_item.update",
      },
    });
    const adapter = makeManagedAdapter(
      "Inspected the running product UI screenshot at https://example.test/reference.png and mapped reusable patterns to packages/gui/src.",
    );
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [
          {
            routeId: "opencode-visual-without-browser",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "model-without-browser",
            capability: managedRouteCapability({ routeId: "opencode-visual-without-browser", providerId: "opencode", modelId: "model-without-browser", toolNames: ["read", "grep", "glob"] }),
            createAdapter: async () => adapter,
            profiles: [{
                authorityProfileId: "authority:opencode:readonly-without-browser",
                admissionProfile: "foundation-readonly-plan",
                permissionProfile: "read-only",
                allowedToolNames: ["read", "grep", "glob"],
                workingDirectory: {
                  path: "/workspace/kiln",
                  mode: "read-only",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:opencode:primary",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
            }],
          },
          {
            routeId: "opencode-visual-browser-readonly",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "model-with-browser",
            capability: managedRouteCapability({ routeId: "opencode-visual-browser-readonly", providerId: "opencode", modelId: "model-with-browser", toolNames: ["read", "grep", "glob", "web_search", "browser_session_start"] }),
            createAdapter: async () => adapter,
            profiles: [{
                authorityProfileId: "authority:opencode:readonly-browser",
                admissionProfile: "foundation-readonly-plan",
                permissionProfile: "read-only",
                allowedToolNames: ["read", "grep", "glob", "web_search", "browser_session_start"],
                networkAllowed: true,
                workingDirectory: {
                  path: "/workspace/kiln",
                  mode: "read-only",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:opencode:primary",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
            }],
          },
        ],
        agentCatalog: [{
          name: "visual-researcher",
          role: "Visual research specialist",
          goal: "Collect real visual reference evidence.",
          tier: "reasoning",
          authorityProfileId: "authority:opencode:readonly-browser",
          admissionProfile: "foundation-readonly-plan",
          routeId: "opencode-visual-browser-readonly",
          providerRoute: {
            providerId: "opencode",
            model: "model-with-browser",
          },
        }],
        contextResolver: async () => ({ admittedAgentProfile: "visual-researcher" }),
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata?: Record<string, unknown>;
    };
    const output = JSON.parse(result.output) as Record<string, unknown>;

    expect(result.isError).toBe(false);
    expect(output).toMatchObject({
      status: "paused",
      managedInvocationRequest: {
        routeId: "opencode-visual-browser-readonly",
        agentProfile: "visual-researcher",
        providerRoute: {
          providerId: "opencode",
          model: "model-with-browser",
        },
      },
    });
    expect(result.metadata).toMatchObject({
      operation: "managed_intermediate_phase_completed",
      managedInvocationRouteRepair: {
        fromRouteId: "opencode-visual-without-browser",
        toRouteId: "opencode-visual-browser-readonly",
        reason: "required_tools_missing",
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps managed-delegation work item execution paused when the managed route cannot be hydrated", async () => {
    const startTool = makeManagedExecutionStartTool();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [],
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata?: Record<string, unknown>;
    };
    const output = JSON.parse(result.output) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(output).toMatchObject({
      status: "paused",
      reason: "Managed child invocation failed before work item execution could start.",
      managedInvocation: expect.objectContaining({
        isError: true,
        output: "managed_agent.invoke requires providerRoute.providerId for a fixed-route invocation.",
      }),
    });
    expect(startTool.calls).toHaveLength(1);
    expect(result.metadata).toMatchObject({
      operation: "managed_invocation_failed",
      managedInvocationAutoStarted: false,
      managedInvocationFailureReason: "Managed child invocation failed before work item execution could start.",
      managedInvocation: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "failed",
      },
    });
  });

  it("supersedes a prior blocking managed-invocation recovery requirement on the same work item instead of colliding with it", async () => {
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    workItemStore.upsert({
      id: "work-managed",
      summary: "Execute governed managed work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: [],
      goalRunId: "goal-managed",
      pauseRequirements: [{
        id: "managed-invocation-capability:work-managed:phase-a",
        kind: "capability",
        summary: "Prior managed invocation attempt failed to hydrate a route.",
        status: "pending",
      }],
    });
    goalRunStore.create({
      id: "goal-managed",
      objective: "Execute governed managed work.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed", "Execute governed managed work.", ["work-managed"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct", turnId: "session-parent:turn:1" },
      workItemIds: ["work-managed"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    });
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      requestedAuthority: "read_only",
      providerRoute: {
        providerId: "openrouter",
        model: "openrouter/free",
      },
      task: "Execute governed managed work.",
      summary: "Execute governed managed work.",
      goalRunId: "goal-managed",
      workItemId: "work-managed",
      expectedEvidence: ["managed-agent-review"],
      executionPhase: {
        id: "phase-b",
        expectedEvidence: ["managed-agent-review"],
        completionTool: "work_item.execution.finish",
        finalPhase: true,
        autoStartAllowed: true,
      },
    });
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { workItemStore, goalRunStore, additionalTools: [startTool] },
      managedInvocation: {
        routes: [],
        unavailableRoutes: [{
          routeId: "openrouter-readonly",
          routeSource: "explicit-managed-route",
          providerId: "openrouter",
          model: "openrouter/free",
          profiles: ["foundation-readonly-plan"],
          reason: "Direct provider route is unavailable.",
        }],
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start-supersede",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata?: Record<string, unknown>;
    };
    const output = JSON.parse(result.output) as {
      readonly recovery?: {
        readonly blockedWorkItemUpdateInputTemplate?: {
          readonly pauseRequirements?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    const pauseRequirements = output.recovery?.blockedWorkItemUpdateInputTemplate?.pauseRequirements ?? [];
    // The new recovery's id is scoped by this call's own tool-call identity
    // AND the stable phase id (recoveryInvocationId), never the loop ordinal
    // or `request.attemptId` - the latter is never populated at this
    // failure-construction site, and the former is not replay-stable across
    // partial-progress replays (see phase-recovery.test.ts and the
    // same-phase-retry regression tests below for the collisions this
    // replaced).
    expect(pauseRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "managed-invocation-capability:work-managed:phase-a",
          status: "superseded",
          supersededByRequirementId: "managed-invocation-capability:work-managed:tool-call-start-supersede:managed-invocation:phase-b",
        }),
        expect.objectContaining({
          id: "managed-invocation-capability:work-managed:tool-call-start-supersede:managed-invocation:phase-b",
          status: "pending",
        }),
      ]),
    );
    expect(pauseRequirements).toHaveLength(2);
  });

  it("keeps two distinct, both-retained blockers for two successive real failures of the SAME work item and SAME phase (regression: request never carries attemptId)", async () => {
    const workItem = {
      id: "work-managed",
      summary: "Execute governed managed work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: [],
      goalRunId: "goal-managed",
    } as const;
    const goalRun = {
      id: "goal-managed",
      objective: "Execute governed managed work.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed", "Execute governed managed work.", ["work-managed"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct" as const, turnId: "session-parent:turn:1" },
      workItemIds: ["work-managed"],
      authorityEnvelope: {
        maximumAuthority: "audited" as const,
        escalationPolicy: "approval_required" as const,
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    };
    const executionPhase = {
      id: "phase-b",
      expectedEvidence: ["managed-agent-review"],
      completionTool: "work_item.execution.finish",
      finalPhase: true,
      autoStartAllowed: true,
    };
    const unavailableManagedInvocation = {
      routes: [],
      unavailableRoutes: [{
        routeId: "openrouter-readonly",
        routeSource: "explicit-managed-route" as const,
        providerId: "openrouter",
        model: "openrouter/free",
        profiles: ["foundation-readonly-plan"] as const,
        reason: "Direct provider route is unavailable.",
      }],
    };
    const triggerFailure = async (toolCallId: string, workItemStore: WorkItemStore, goalRunStore: GoalRunStore) => {
      const startTool = makeManagedExecutionStartTool({
        profile: "foundation-readonly-plan",
        requestedAuthority: "read_only",
        providerRoute: { providerId: "openrouter", model: "openrouter/free" },
        task: "Execute governed managed work.",
        summary: "Execute governed managed work.",
        goalRunId: "goal-managed",
        workItemId: "work-managed",
        expectedEvidence: ["managed-agent-review"],
        executionPhase,
      });
      const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
        builtinToolOptions: { workItemStore, goalRunStore, additionalTools: [startTool] },
        managedInvocation: unavailableManagedInvocation,
      });
      const context: RuntimeBuiltinToolExecutionContext = {
        session: makeRuntimeSession(),
        toolCall: { id: toolCallId, name: "work_item.execution.start", input: {} },
      };
      const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
        goalRunId: "goal-managed",
        governanceRecommendation: "orchestrate",
      }, context) as { readonly output: string; readonly isError: boolean };
      const output = JSON.parse(result.output) as {
        readonly recovery?: {
          readonly blockedWorkItemUpdateInputTemplate?: {
            readonly pauseRequirements?: readonly Record<string, unknown>[];
          };
        };
      };
      return output.recovery?.blockedWorkItemUpdateInputTemplate?.pauseRequirements ?? [];
    };

    // First real failure of work-managed/phase-b.
    const goalRunStoreOne = new GoalRunStore();
    goalRunStoreOne.create(goalRun);
    const workItemStoreOne = new WorkItemStore();
    workItemStoreOne.upsert(workItem);
    const firstPauseRequirements = await triggerFailure("tool-call-attempt-1", workItemStoreOne, goalRunStoreOne);
    expect(firstPauseRequirements).toHaveLength(1);
    const firstRequirement = firstPauseRequirements[0]!;
    expect(firstRequirement).toMatchObject({ status: "pending" });

    // The runtime persists that pending requirement onto the work item, then
    // the SAME work item and SAME phase fails again for a second real,
    // independent time.
    const goalRunStoreTwo = new GoalRunStore();
    goalRunStoreTwo.create(goalRun);
    const workItemStoreTwo = new WorkItemStore();
    workItemStoreTwo.upsert({ ...workItem, pauseRequirements: [firstRequirement as never] });
    const secondPauseRequirements = await triggerFailure("tool-call-attempt-2", workItemStoreTwo, goalRunStoreTwo);

    expect(secondPauseRequirements).toHaveLength(2);
    expect(secondPauseRequirements.find((requirement) => requirement.id === firstRequirement.id)).toMatchObject({
      status: "superseded",
    });
    const secondRequirement = secondPauseRequirements.find((requirement) => requirement.id !== firstRequirement.id)!;
    expect(secondRequirement).toMatchObject({ status: "pending" });
    expect(secondRequirement.id).not.toBe(firstRequirement.id);
  });

  it("still produces a live pending blocker for a genuinely new failure after a prior same-phase requirement was already resolved", async () => {
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    const resolvedPriorId = "managed-invocation-capability:work-managed:tool-call-attempt-1:managed-invocation:phase-b";
    workItemStore.upsert({
      id: "work-managed",
      summary: "Execute governed managed work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: [],
      goalRunId: "goal-managed",
      pauseRequirements: [{
        id: resolvedPriorId,
        kind: "capability",
        summary: "Prior managed invocation attempt failed; operator resolved it.",
        status: "resolved",
      } as never],
    });
    goalRunStore.create({
      id: "goal-managed",
      objective: "Execute governed managed work.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed", "Execute governed managed work.", ["work-managed"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct", turnId: "session-parent:turn:1" },
      workItemIds: ["work-managed"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    });
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      requestedAuthority: "read_only",
      providerRoute: { providerId: "openrouter", model: "openrouter/free" },
      task: "Execute governed managed work.",
      summary: "Execute governed managed work.",
      goalRunId: "goal-managed",
      workItemId: "work-managed",
      expectedEvidence: ["managed-agent-review"],
      executionPhase: {
        id: "phase-b",
        expectedEvidence: ["managed-agent-review"],
        completionTool: "work_item.execution.finish",
        finalPhase: true,
        autoStartAllowed: true,
      },
    });
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { workItemStore, goalRunStore, additionalTools: [startTool] },
      managedInvocation: {
        routes: [],
        unavailableRoutes: [{
          routeId: "openrouter-readonly",
          routeSource: "explicit-managed-route",
          providerId: "openrouter",
          model: "openrouter/free",
          profiles: ["foundation-readonly-plan"],
          reason: "Direct provider route is unavailable.",
        }],
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeRuntimeSession(),
      toolCall: { id: "tool-call-attempt-3", name: "work_item.execution.start", input: {} },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as { readonly output: string; readonly isError: boolean };
    const output = JSON.parse(result.output) as {
      readonly recovery?: {
        readonly blockedWorkItemUpdateInputTemplate?: {
          readonly pauseRequirements?: readonly Record<string, unknown>[];
        };
      };
    };
    const pauseRequirements = output.recovery?.blockedWorkItemUpdateInputTemplate?.pauseRequirements ?? [];

    // The already-resolved prior requirement is untouched, and the new,
    // genuinely distinct failure still produces a live pending blocker -
    // it must not silently stop blocking just because an unrelated earlier
    // requirement in this family happens to already be resolved.
    expect(pauseRequirements.find((requirement) => requirement.id === resolvedPriorId)).toMatchObject({
      status: "resolved",
    });
    const newRequirement = pauseRequirements.find((requirement) => requirement.id !== resolvedPriorId);
    expect(newRequirement).toMatchObject({ status: "pending" });
    expect(newRequirement?.id).not.toBe(resolvedPriorId);
  });

  it("replaying the identical recovery attempt is idempotent and does not duplicate", async () => {
    const goalRun = {
      id: "goal-managed",
      objective: "Execute governed managed work.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed", "Execute governed managed work.", ["work-managed"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct" as const, turnId: "session-parent:turn:1" },
      workItemIds: ["work-managed"],
      authorityEnvelope: {
        maximumAuthority: "audited" as const,
        escalationPolicy: "approval_required" as const,
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    };
    const workItem = {
      id: "work-managed",
      summary: "Execute governed managed work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: [],
      goalRunId: "goal-managed",
    } as const;
    const executionPhase = {
      id: "phase-b",
      expectedEvidence: ["managed-agent-review"],
      completionTool: "work_item.execution.finish",
      finalPhase: true,
      autoStartAllowed: true,
    };
    const unavailableManagedInvocation = {
      routes: [],
      unavailableRoutes: [{
        routeId: "openrouter-readonly",
        routeSource: "explicit-managed-route" as const,
        providerId: "openrouter",
        model: "openrouter/free",
        profiles: ["foundation-readonly-plan"] as const,
        reason: "Direct provider route is unavailable.",
      }],
    };
    const triggerFailure = async (workItemStore: WorkItemStore, goalRunStore: GoalRunStore) => {
      const startTool = makeManagedExecutionStartTool({
        profile: "foundation-readonly-plan",
        requestedAuthority: "read_only",
        providerRoute: { providerId: "openrouter", model: "openrouter/free" },
        task: "Execute governed managed work.",
        summary: "Execute governed managed work.",
        goalRunId: "goal-managed",
        workItemId: "work-managed",
        expectedEvidence: ["managed-agent-review"],
        executionPhase,
      });
      const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
        builtinToolOptions: { workItemStore, goalRunStore, additionalTools: [startTool] },
        managedInvocation: unavailableManagedInvocation,
      });
      // The identical outer tool call id both times: a true replay of the
      // same recovery attempt, not a new one.
      const context: RuntimeBuiltinToolExecutionContext = {
        session: makeRuntimeSession(),
        toolCall: { id: "tool-call-replay", name: "work_item.execution.start", input: {} },
      };
      const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
        goalRunId: "goal-managed",
        governanceRecommendation: "orchestrate",
      }, context) as { readonly output: string; readonly isError: boolean };
      const output = JSON.parse(result.output) as {
        readonly recovery?: {
          readonly blockedWorkItemUpdateInputTemplate?: {
            readonly pauseRequirements?: readonly Record<string, unknown>[];
          };
        };
      };
      return output.recovery?.blockedWorkItemUpdateInputTemplate?.pauseRequirements ?? [];
    };

    const goalRunStoreOne = new GoalRunStore();
    goalRunStoreOne.create(goalRun);
    const workItemStoreOne = new WorkItemStore();
    workItemStoreOne.upsert(workItem);
    const firstPauseRequirements = await triggerFailure(workItemStoreOne, goalRunStoreOne);
    expect(firstPauseRequirements).toHaveLength(1);
    const firstRequirement = firstPauseRequirements[0]!;
    expect(firstRequirement).toMatchObject({ status: "pending" });

    const goalRunStoreTwo = new GoalRunStore();
    goalRunStoreTwo.create(goalRun);
    const workItemStoreTwo = new WorkItemStore();
    workItemStoreTwo.upsert({ ...workItem, pauseRequirements: [firstRequirement as never] });
    const replayedPauseRequirements = await triggerFailure(workItemStoreTwo, goalRunStoreTwo);

    expect(replayedPauseRequirements).toHaveLength(1);
    expect(replayedPauseRequirements[0]).toEqual(firstRequirement);
  });

  it("fails closed when recovery is invoked with an empty tool call id", async () => {
    const goalRun = {
      id: "goal-managed",
      objective: "Execute governed managed work.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed", "Execute governed managed work.", ["work-managed"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct" as const, turnId: "session-parent:turn:1" },
      workItemIds: ["work-managed"],
      authorityEnvelope: {
        maximumAuthority: "audited" as const,
        escalationPolicy: "approval_required" as const,
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    };
    const workItem = {
      id: "work-managed",
      summary: "Execute governed managed work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: [],
      goalRunId: "goal-managed",
    } as const;
    const executionPhase = {
      id: "phase-b",
      expectedEvidence: ["managed-agent-review"],
      completionTool: "work_item.execution.finish",
      finalPhase: true,
      autoStartAllowed: true,
    };
    const unavailableManagedInvocation = {
      routes: [],
      unavailableRoutes: [{
        routeId: "openrouter-readonly",
        routeSource: "explicit-managed-route" as const,
        providerId: "openrouter",
        model: "openrouter/free",
        profiles: ["foundation-readonly-plan"] as const,
        reason: "Direct provider route is unavailable.",
      }],
    };
    const triggerFailure = async (workItemStore: WorkItemStore, goalRunStore: GoalRunStore) => {
      const startTool = makeManagedExecutionStartTool({
        profile: "foundation-readonly-plan",
        requestedAuthority: "read_only",
        providerRoute: { providerId: "openrouter", model: "openrouter/free" },
        task: "Execute governed managed work.",
        summary: "Execute governed managed work.",
        goalRunId: "goal-managed",
        workItemId: "work-managed",
        expectedEvidence: ["managed-agent-review"],
        executionPhase,
      });
      const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
        builtinToolOptions: { workItemStore, goalRunStore, additionalTools: [startTool] },
        managedInvocation: unavailableManagedInvocation,
      });
      const context: RuntimeBuiltinToolExecutionContext = {
        session: makeRuntimeSession(),
        toolCall: { id: "", name: "work_item.execution.start", input: {} },
      };
      return runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
        goalRunId: "goal-managed",
        governanceRecommendation: "orchestrate",
      }, context);
    };

    const goalRunStoreOne = new GoalRunStore();
    goalRunStoreOne.create(goalRun);
    const workItemStoreOne = new WorkItemStore();
    workItemStoreOne.upsert(workItem);
    await expect(triggerFailure(workItemStoreOne, goalRunStoreOne))
      .rejects.toThrow("Managed invocation recovery requires a non-empty tool call id.");
  });

  it("fails closed when an attached runtime tool is invoked without admission context", async () => {
    const goalRun = {
      id: "goal-managed",
      objective: "Execute governed managed work.",
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed", "Execute governed managed work.", ["work-managed"]),
      ownerSessionId: "session-parent",
      source: { kind: "operator_direct" as const, turnId: "session-parent:turn:1" },
      workItemIds: ["work-managed"],
      authorityEnvelope: {
        maximumAuthority: "audited" as const,
        escalationPolicy: "approval_required" as const,
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    };
    const workItem = {
      id: "work-managed",
      summary: "Execute governed managed work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: [],
      goalRunId: "goal-managed",
    } as const;
    const executionPhase = {
      id: "phase-b",
      expectedEvidence: ["managed-agent-review"],
      completionTool: "work_item.execution.finish",
      finalPhase: true,
      autoStartAllowed: true,
    };
    const unavailableManagedInvocation = {
      routes: [],
      unavailableRoutes: [{
        routeId: "openrouter-readonly",
        routeSource: "explicit-managed-route" as const,
        providerId: "openrouter",
        model: "openrouter/free",
        profiles: ["foundation-readonly-plan"] as const,
        reason: "Direct provider route is unavailable.",
      }],
    };
    const triggerFailure = async (workItemStore: WorkItemStore, goalRunStore: GoalRunStore) => {
      const startTool = makeManagedExecutionStartTool({
        profile: "foundation-readonly-plan",
        requestedAuthority: "read_only",
        providerRoute: { providerId: "openrouter", model: "openrouter/free" },
        task: "Execute governed managed work.",
        summary: "Execute governed managed work.",
        goalRunId: "goal-managed",
        workItemId: "work-managed",
        expectedEvidence: ["managed-agent-review"],
        executionPhase,
      });
      const runtimeSurface = createRuntimeBuiltinToolSurface({
        builtinToolOptions: { workItemStore, goalRunStore, additionalTools: [startTool] },
        managedInvocation: unavailableManagedInvocation,
      });
      return runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
        goalRunId: "goal-managed",
        governanceRecommendation: "orchestrate",
      }, undefined);
    };

    const goalRunStoreOne = new GoalRunStore();
    goalRunStoreOne.create(goalRun);
    const workItemStoreOne = new WorkItemStore();
    workItemStoreOne.upsert(workItem);
    await expect(triggerFailure(workItemStoreOne, goalRunStoreOne))
      .rejects.toThrow("requires admitted authority and resolved effect evidence");
  });

  it("scopes the recovery id by the stable phase identity, not the same-run loop position, so a replay after an earlier phase already persisted derives the identical id", async () => {
    const phaseA = {
      id: "phase-a",
      expectedEvidence: ["evidence-a"],
      completionTool: "work_item.update",
    };
    const phaseB = {
      id: "phase-b",
      expectedEvidence: ["managed-agent-review"],
      completionTool: "work_item.execution.finish",
      finalPhase: true,
      autoStartAllowed: true,
    };
    const managedInvocation = {
      routes: [{
        routeId: "opencode-readonly",
        routeSource: "explicit-managed-route" as const,
        providerId: "opencode",
        model: "opencode-default-model",
        capability: {
          identity: { routeId: "opencode-readonly", revision: "test-v1" },
          target: { providerId: "opencode", modelId: "opencode-default-model" },
          adapter: { kind: "cli-harness", capabilityId: "opencode-harness", capabilityVersion: "test-v1" },
          authorityCeiling: "read_only",
          toolNames: ["read", "grep", "glob"],
          supportsRecursion: true,
          supportsAttachments: false,
          supportsWrite: false,
          proof: { status: "configured", source: "test-fixture", provenProfiles: ["foundation-readonly-plan"] },
          capacity: { kind: "accountless" },
          settlement: { kind: "not-required" },
        },
        createAdapter: async () => makeManagedAdapter(),
        profiles: [{
            authorityProfileId: "authority:opencode:readonly",
            admissionProfile: "foundation-readonly-plan",
            permissionProfile: "read-only" as const,
            allowedToolNames: ["read", "grep", "glob"],
            workingDirectory: { path: "/workspace/kiln", mode: "read-only" as const },
            timeoutMs: 120000,
            credentialRoute: { mode: "runtime-selected" as const, routeId: "credential-route:opencode:primary" },
            memoryScope: { scope: { kind: "project" as const, id: "kiln" }, access: "read-only" as const },
        }],
      }],
      unavailableRoutes: [{
        routeId: "openrouter-readonly",
        routeSource: "explicit-managed-route" as const,
        providerId: "openrouter",
        model: "openrouter/free",
        profiles: ["foundation-readonly-plan"] as const,
        reason: "Direct provider route is unavailable.",
      }],
    } satisfies AttachedRuntimeManagedInvocationConfig;

    const makeSequencedStartTool = (
      phases: readonly Record<string, unknown>[],
    ): DevTool & { readonly calls: ToolInput[] } => {
      const calls: ToolInput[] = [];
      let index = 0;
      return {
        name: "work_item.execution.start",
        description: "Test sequenced multi-phase work item execution start tool.",
        inputSchema: { type: "object", properties: { goalRunId: { type: "string" } } },
        effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
        calls,
        async execute(input): Promise<ToolResult> {
          calls.push(input);
          const phase = phases[Math.min(index, phases.length - 1)]!;
          index += 1;
          const isFinal = phase.completionTool === "work_item.execution.finish";
          return {
            output: JSON.stringify({
              status: "paused",
              reason: "managedInvocationId is required before starting managed-delegation execution.",
              workItemId: "work-managed",
              nextTool: "managed_agent.invoke",
              managedInvocationRequest: {
                profile: "foundation-readonly-plan",
                ...(isFinal
                  ? { providerRoute: { providerId: "openrouter", model: "openrouter/free" } }
                  : { routeId: "opencode-readonly" }),
                requestedAuthority: "read_only",
                task: "Execute governed managed work.",
                summary: "Execute governed managed work.",
                goalRunId: "goal-managed",
                workItemId: "work-managed",
                expectedEvidence: phase.expectedEvidence,
                requiredResultFields: ["summary", "evidence", "verificationResults"],
                doneCriteria: ["Return a bounded handoff."],
                residualRiskRequired: false,
                executionPhase: phase,
              },
            }, null, 2),
            metadata: {
              kind: "work_item",
              toolName: "work_item.execution.start",
              operation: "execution_started",
              executionScopeTransition: {
                action: "enter",
                scope: { kind: "work_item", goalRunId: "goal-managed", workItemId: "work-managed" },
              },
            },
            isError: true,
          };
        },
      };
    };

    // A minimal fake `work_item.update`: the runtime-level test harness does
    // not wire the real work-governance `work_item.update` executor (that
    // lives in the CLI application layer), so this stands in for "the
    // intermediate phase's transition was persisted" without depending on
    // real work-item domain logic. It only needs to succeed so the wrapper
    // loop's `continue` advances to the next phase.
    const makeFakeUpdateTool = (): DevTool & { readonly calls: ToolInput[] } => {
      const calls: ToolInput[] = [];
      return {
        name: "work_item.update",
        description: "Test work item update tool.",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
        calls,
        async execute(input): Promise<ToolResult> {
          calls.push(input);
          return {
            output: JSON.stringify({ status: "updated", id: input.input.id }, null, 2),
            metadata: { kind: "work_item", toolName: "work_item.update", operation: "update" },
            isError: false,
          };
        },
      };
    };

    const runOnce = async (phases: readonly Record<string, unknown>[]) => {
      const workItemStore = new WorkItemStore();
      const goalRunStore = new GoalRunStore();
      workItemStore.upsert({
        id: "work-managed",
        summary: "Execute governed managed work.",
        workflowProfile: "managed-agent-change",
        triggers: ["managed-agents"],
        expectedEvidence: ["managed-agent-review"],
        verificationGates: [],
        goalRunId: "goal-managed",
      });
      goalRunStore.create({
        id: "goal-managed",
        objective: "Execute governed managed work.",
        boundedWorkContractRevision: testBoundedWorkRevision("goal-managed", "Execute governed managed work.", ["work-managed"]),
        ownerSessionId: "session-parent",
        source: { kind: "operator_direct", turnId: "session-parent:turn:1" },
        workItemIds: ["work-managed"],
        authorityEnvelope: {
          maximumAuthority: "audited",
          escalationPolicy: "approval_required",
          reason: "Approved plan.",
        },
        routePolicy: { workflowProfile: "managed-agent-change" },
        evidenceRequirements: [],
      });
      const startTool = makeSequencedStartTool(phases);
      const updateTool = makeFakeUpdateTool();
      const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
        builtinToolOptions: { workItemStore, goalRunStore, additionalTools: [startTool, updateTool] },
        managedInvocation,
      });
      const context: RuntimeBuiltinToolExecutionContext = {
        session: makeRuntimeSession(),
        toolCall: { id: "tool-call-multiphase", name: "work_item.execution.start", input: {} },
      };
      const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
        goalRunId: "goal-managed",
        governanceRecommendation: "orchestrate",
      }, context) as { readonly output: string; readonly isError: boolean };
      const output = JSON.parse(result.output) as {
        readonly recovery?: {
          readonly blockedWorkItemUpdateInputTemplate?: {
            readonly pauseRequirements?: readonly Record<string, unknown>[];
          };
        };
      };
      return output.recovery?.blockedWorkItemUpdateInputTemplate?.pauseRequirements ?? [];
    };

    // Run 1: phase A (intermediate, succeeds and is persisted via the real
    // work_item.update tool) then phase B fails - phase B is the SECOND loop
    // iteration in this run.
    const twoPhaseRunPauseRequirements = await runOnce([phaseA, phaseB]);
    // Run 2 ("replay after phase A already persisted"): phase A is skipped
    // entirely (as it would be on a real replay once it is already recorded
    // on the work item), so phase B is the FIRST loop iteration instead.
    const replayAfterPersistedPhaseAPauseRequirements = await runOnce([phaseB]);

    expect(twoPhaseRunPauseRequirements).toHaveLength(1);
    expect(replayAfterPersistedPhaseAPauseRequirements).toHaveLength(1);
    // The identical logical failure (same work item, same phase, same outer
    // tool call id) must derive the identical id regardless of how many
    // phases preceded it within that particular run.
    expect(twoPhaseRunPauseRequirements[0]?.id).toBe(replayAfterPersistedPhaseAPauseRequirements[0]?.id);
    expect(twoPhaseRunPauseRequirements[0]?.id).toBe(
      "managed-invocation-capability:work-managed:tool-call-multiphase:managed-invocation:phase-b",
    );
  });

  it("blocks the work item without inventing an attempt when managed-delegation auto-start is unavailable", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      requestedAuthority: "read_only",
      providerRoute: {
        providerId: "openrouter",
        model: "openrouter/free",
      },
      task: "Execute governed managed work.",
      summary: "Execute governed managed work.",
      goalRunId: "goal-managed",
      workItemId: "work-managed",
      expectedEvidence: ["managed-agent-review"],
      executionPhase: {
        id: "managed-review-closeout",
        expectedEvidence: ["managed-agent-review"],
        completionTool: "work_item.execution.finish",
        finalPhase: true,
        autoStartAllowed: true,
      },
    });
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [],
        unavailableRoutes: [{
          routeId: "openrouter-readonly",
          routeSource: "explicit-managed-route",
          providerId: "openrouter",
          model: "openrouter/free",
          profiles: ["foundation-readonly-plan"],
          reason: "Direct provider route is unavailable.",
        }],
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start-unavailable",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata?: Record<string, unknown>;
    };
    const output = JSON.parse(result.output) as {
      readonly recovery?: {
        readonly nextTool?: string;
        readonly blockedWorkItemUpdateInputTemplate?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(true);
    expect(output.recovery).toMatchObject({
      nextTool: "work_item.update",
      blockedWorkItemUpdateInputTemplate: {
        id: "work-managed",
        status: "blocked",
        pauseRequirements: [{
          kind: "capability",
          status: "pending",
        }],
      },
    });
    expect(result.metadata).toMatchObject({
      operation: "managed_invocation_failed",
      managedInvocation: {
        status: "unavailable",
      },
      managedInvocationRecovery: {
        nextTool: "work_item.update",
        blockedWorkItemUpdateInputTemplate: {
          id: "work-managed",
          status: "blocked",
        },
      },
    });
  });

  it("fails closed instead of upgrading authority when an exact route does not support the requested profile", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      routeId: "opencode-go-frontend-approved-write",
      requestedAuthority: "read_only",
      task: "Execute governed frontend work.",
      summary: "Execute governed frontend work.",
      workItemId: "work-managed",
      expectedEvidence: ["managed-agent-review"],
      requiredResultFields: ["summary", "evidence", "verificationResults"],
      doneCriteria: ["Return a bounded handoff."],
      residualRiskRequired: false,
    });
    const adapter = {
      ...makeManagedAdapter(),
      descriptor: makeManagedDescriptor({
        providerId: "opencode-go",
        supportedProfiles: ["foundation-apply-approved-writes"],
        writeAuthority: {
          proposalSupported: true,
          approvedApplySupported: true,
          memoryProposalSupported: true,
          rollbackEvidence: true,
          cleanupEvidence: true,
          scopeReduction: true,
        },
      }),
    };
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [{
          routeId: "opencode-go-frontend-approved-write",
          routeSource: "explicit-managed-route",
          providerId: "opencode-go",
          model: "kimi-k2.6",
          capability: managedRouteCapability({ routeId: "opencode-go-frontend-approved-write", providerId: "opencode-go", modelId: "kimi-k2.6", toolNames: ["read", "grep", "glob", "write"], profile: "foundation-apply-approved-writes", write: true }),
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:opencode-go:frontend",
              admissionProfile: "foundation-apply-approved-writes",
              permissionProfile: "apply-approved-writes",
              writeAllowed: true,
              allowedToolNames: ["read", "grep", "glob", "write"],
              workingDirectory: {
                path: "/workspace/kiln",
                mode: "workspace-write",
              },
              timeoutMs: 120000,
              credentialRoute: {
                mode: "runtime-selected",
                routeId: "credential-route:opencode-go:runtime-selected",
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
                    allowedPaths: ["/workspace/kiln"],
                    deniedPaths: ["/workspace/kiln/.git"],
                  },
                  memory: {
                    mode: "propose",
                    scope: { kind: "project", id: "kiln" },
                    operations: ["create", "update"],
                  },
                  artifacts: {
                    mode: "propose",
                    resourceUris: ["kiln://artifacts/managed-agent-write/proposal-1"],
                    retention: "session",
                  },
                  tools: {
                    allowedToolNames: ["read", "grep", "glob", "write"],
                    deniedToolNames: [],
                  },
                }),
                approval: {
                  mode: "required-before-apply",
                  evidenceRequired: true,
                },
              }),
          }],
        }],
      },
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start",
        name: "work_item.execution.start",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("work_item.execution.start")?.({
      goalRunId: "goal-managed",
      governanceRecommendation: "orchestrate",
    }, context) as {
      readonly isError: boolean;
      readonly metadata?: Record<string, unknown>;
    };

    expect(result.isError).toBe(true);
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(startTool.calls).toHaveLength(1);
    expect(result.metadata).toMatchObject({
      operation: "managed_invocation_failed",
      managedInvocation: {
        status: "failed",
      },
    });
  });

  it("injects canonical session and operator-turn provenance into goal.create", async () => {
    const goalInputs: ToolInput[] = [];
    const goalTool: DevTool = {
      name: "goal.create",
      description: "Create a goal.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
      effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
      async execute(input) {
        goalInputs.push(input);
        return {
          output: JSON.stringify({ ownerSessionId: input.input.ownerSessionId }),
          isError: false,
        };
      },
    };
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [goalTool],
      }),
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      turnId: canonicalTurnId(session.id, 1),
      operatorAdoptionDecision: createOperatorAdoptionDecisionAuthority({
        ownerSessionId: session.id,
        operatorTurnId: canonicalTurnId(session.id, 1),
        actorId: session.userId,
      }),
      toolCall: {
        id: "tool-call-goal",
        name: "goal.create",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("goal.create")?.({
      objective: "Governed UI refactor.",
      ownerSessionId: "forged-session",
      operatorTurnId: "forged-turn",
      contractAuthority: { kind: "operator", actorId: "forged", decisionId: "forged" },
    }, context) as ToolResult | undefined;

    expect(result?.isError).toBe(false);
    expect(goalInputs[0]?.input).toMatchObject({
      ownerSessionId: session.id,
      operatorTurnId: canonicalTurnId(session.id, 1),
      contractAuthority: context.operatorAdoptionDecision?.contractAuthority,
    });
  });

  it("does not lend root adoption transport to a managed child goal.create", async () => {
    const goalTool: DevTool = {
      name: "goal.create",
      description: "Create a goal.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
      effectEnvelope: RUNTIME_LOCAL_MUTATION_EFFECT,
      async execute(_input, _sandbox, executionContext) {
        const adoptionDecision = executionContext?.[OPERATOR_ADOPTION_DECISION_TRANSPORT];
        return adoptionDecision
          ? { output: JSON.stringify({ created: true }), isError: false }
          : {
            output: JSON.stringify({
              error: {
                code: "operator_adoption_decision_missing",
                message: "goal.create requires a canonical runtime operator adoption decision.",
              },
            }),
            isError: true,
          };
      },
    };
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [goalTool],
      }),
    });
    const session = makeRuntimeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      turnId: canonicalTurnId(session.id, 1),
      executionScope: {
        kind: "work_item",
        goalRunId: "goal-managed",
        workItemId: "work-item-managed",
        attemptId: "attempt-managed",
        managedInvocationId: "managed-child-1",
      },
      operatorAdoptionDecision: createOperatorAdoptionDecisionAuthority({
        ownerSessionId: session.id,
        operatorTurnId: canonicalTurnId(session.id, 1),
        actorId: session.userId,
      }),
      toolCall: {
        id: "tool-call-managed-goal",
        name: "goal.create",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("goal.create")?.({
      objective: "Managed child must not adopt a root goal.",
      ownerSessionId: "forged-session",
      operatorTurnId: "forged-turn",
      contractAuthority: { kind: "operator", actorId: "forged", decisionId: "forged" },
    }, context) as ToolResult | undefined;

    expect(result?.isError).toBe(true);
    expect(result?.output).toContain("operator_adoption_decision_missing");
  });

  it("propagates deferred core tool projection to runtime consumers", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read"],
        },
      },
    });

    expect(runtimeSurface.callBuiltinTools.has("browser_session_start")).toBe(true);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_CONTEXT_TOOLS]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).not.toContain("browser_session_start");
    expect(Array.from(runtimeSurface.capabilities.keys())).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_CONTEXT_TOOLS]);
  });

  it("separates the initial deferred projection from the canonical materializable catalog", () => {
    const canonicalSurface = createDefaultBuiltinToolSurface();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read"],
        },
      },
    });
    const canonicalBrowserSessionStart = canonicalSurface.toolDefinitions.find(
      (tool) => tool.name === "browser_session_start",
    );
    const canonicalBrowserSessionStartCapability = canonicalSurface.capabilities.get("browser_session_start");
    const canonicalCatalogSearchCapability = canonicalSurface.capabilities.get("tool_catalog_search");

    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toContain("tool_catalog_search");
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).not.toContain("browser_session_start");
    expect(runtimeSurface.materializableTools).toBeInstanceOf(Map);
    expect(runtimeSurface.materializableTools.get("browser_session_start")).toEqual(canonicalBrowserSessionStart);
    expect(runtimeSurface.materializableCapabilities).toBeInstanceOf(Map);
    expect(runtimeSurface.materializableCapabilities.get("browser_session_start")).toEqual(
      canonicalBrowserSessionStartCapability,
    );
    expect(runtimeSurface.materializableCapabilities.get("tool_catalog_search")).toEqual(
      canonicalCatalogSearchCapability,
    );
  });

  it("cannot materialize tools excluded by a strict core projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      operatorSurface: {
        theme: { setTheme: vi.fn() },
      },
      builtinToolOptions: {
        toolProjection: {
          mode: "strict",
          alwaysOnTools: ["read", "write", "edit", "patch"],
        },
      },
    });

    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(["read", "write", "edit", "patch"]);
    expect(Array.from(runtimeSurface.materializableTools.keys())).toEqual(["read", "write", "edit", "patch"]);
    expect(runtimeSurface.callBuiltinTools.has("bash")).toBe(false);
    expect(runtimeSurface.callBuiltinTools.has("operator_set_theme")).toBe(false);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).not.toContain("operator_set_theme");
    expect(runtimeSurface.materializableCapabilities.has("tool_catalog_search")).toBe(false);
  });

  it("enforces a strict write projection inside the exact sandbox root", async () => {
    const leaseRoot = await mkdtemp(join(tmpdir(), "kiln-write-lease-"));
    const siblingRoot = `${leaseRoot}-escape`;
    await writeFile(join(leaseRoot, "inside.txt"), "before", "utf8");
    await writeFile(siblingRoot, "outside", "utf8");
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "strict",
          alwaysOnTools: ["read", "edit", "patch"],
        },
      },
    });
    const sandbox = {
      cwd: leaseRoot,
      policy: new SandboxPolicy({
        projectPath: leaseRoot,
        config: {
          fsPolicy: "read-write",
          netPolicy: "none",
          allowedPaths: [leaseRoot],
          deniedPaths: [],
          allowedDomains: [],
        },
      }),
    };
    const authority = {
      level: 4 as const,
      allowed: true,
      requiresApproval: false,
      reason: "Disposable benchmark lease admitted by the parent runtime.",
    };

    try {
      await expect(runtimeSurface.callBuiltinTools.get("edit")?.({
        filePath: "inside.txt",
        oldString: "before",
        newString: "after",
      }, { sandbox, authority } as RuntimeBuiltinToolExecutionContext)).resolves.toMatchObject({ isError: false });
      await expect(runtimeSurface.callBuiltinTools.get("edit")?.({
        filePath: siblingRoot,
        oldString: "outside",
        newString: "escaped",
      }, { sandbox, authority } as RuntimeBuiltinToolExecutionContext)).resolves.toMatchObject({
        isError: true,
        output: expect.stringContaining("access denied"),
      });
    } finally {
      await rm(leaseRoot, { recursive: true, force: true });
      await rm(siblingRoot, { force: true });
    }
  });

  it("does not admit runtime-attached tools into the materializable catalog", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      operatorSurface: {
        theme: {
          setTheme: vi.fn(),
        },
      },
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read"],
        },
      },
    });

    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toContain("operator_set_theme");
    expect(runtimeSurface.materializableTools.has("operator_set_theme")).toBe(false);
    expect(runtimeSurface.materializableCapabilities.has("operator_set_theme")).toBe(false);
  });

  it("can explicitly expose code intelligence in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "code_intelligence"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(expect.arrayContaining([
      "read",
      "code_intelligence",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]));
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "code_intelligence",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]);
  });

  it("can explicitly expose read_many in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "read_many"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(expect.arrayContaining([
      "read",
      "read_many",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]));
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "read_many",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]);
  });

  it("can explicitly expose monitor lifecycle tools in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "monitor_start", "monitor_read", "monitor_stop", "monitor_list"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(expect.arrayContaining([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]));
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]);
  });

  it("can explicitly expose task state tools in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "task_list", "task_update"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(expect.arrayContaining([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]));
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]);
  });

  it("can explicitly expose operator elicitation in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "operator_elicit"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(expect.arrayContaining([
      "read",
      "operator_elicit",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]));
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "operator_elicit",
      "tool_catalog_search",
      ...ALWAYS_ON_CONTEXT_TOOLS,
    ]);
  });

  it("routes interactive browser and computer tools through runtime-injected providers", async () => {
    const browserRequests: unknown[] = [];
    const computerRequests: unknown[] = [];
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        browserUse: {
          provider: {
            async execute(request) {
              browserRequests.push(request);
              return {
                provider: "runtime-browser",
                sessionId: request.sessionId ?? "browser-1",
                output: "browser action routed",
                observation: {
                  url: request.url ?? "https://example.com",
                  title: "Example",
                  screenshotUri: "kiln://artifacts/interactive/browser-1/screenshot",
                },
              };
            },
          },
        },
        computerUse: {
          provider: {
            async execute(request) {
              computerRequests.push(request);
              return {
                provider: "runtime-computer",
                output: "computer action routed",
                observation: {
                  windowTitle: "Calculator",
                  screenshotUri: "kiln://artifacts/interactive/computer/screenshot",
                },
              };
            },
          },
        },
      },
    });

    await expect(runtimeSurface.callBuiltinTools.get("browser_navigate")?.({
      sessionId: "browser-1",
      url: "https://example.com",
    })).resolves.toMatchObject({
      output: "browser action routed",
      isError: false,
      metadata: {
        toolName: "browser_navigate",
        kind: "interactive",
        target: "browser",
        operation: "navigate",
        provider: "runtime-browser",
        sessionId: "browser-1",
      },
    });
    await expect(runtimeSurface.callBuiltinTools.get("computer_observe")?.({
      windowTitle: "Calculator",
    })).resolves.toMatchObject({
      output: "computer action routed",
      isError: false,
      metadata: {
        toolName: "computer_observe",
        kind: "interactive",
        target: "computer",
        operation: "observe",
        provider: "runtime-computer",
      },
    });

    expect(browserRequests).toHaveLength(1);
    expect(browserRequests[0]).toMatchObject({
      target: "browser",
      operation: "navigate",
      url: "https://example.com",
    });
    expect(computerRequests).toHaveLength(1);
    expect(computerRequests[0]).toMatchObject({
      target: "computer",
      operation: "observe",
      windowTitle: "Calculator",
    });
  });

  it("surfaces resource links from direct-provider builtin tool execution without injecting artifact content", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "kiln-runtime-resource-links-"));
    try {
      await writeFile(join(tempDir, "large.txt"), "runtime link\n".repeat(1_000), "utf8");
      const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();

      const result = await runtimeSurface.callBuiltinTools.get("read_many")?.({
        paths: [join(tempDir, "large.txt")],
        maxBytes: 20_000,
      }) as {
        output: string;
        resourceLinks?: readonly { uri: string; title?: string }[];
        content?: readonly { type: string; uri?: string }[];
      };

      expect(result.output).toContain("Full tool output is available as resource links");
      expect(result.output).toContain("kiln://artifacts/tool-results/");
      expect(result.resourceLinks).toEqual([expect.objectContaining({
        uri: expect.stringMatching(/^kiln:\/\/artifacts\/tool-results\/artifact_\d+\/content$/),
        title: "read_many full output",
      })]);
      expect(result.content).toEqual([expect.objectContaining({
        type: "resource_link",
        uri: result.resourceLinks?.[0]?.uri,
      })]);
      expect(JSON.stringify(result)).not.toContain("runtime link");
      expect(runtimeSurface.listResources()).toContainEqual(expect.objectContaining({
        uri: "kiln://artifacts/tool-results",
        title: "Artifacts: tool-results",
      }));
      await expect(runtimeSurface.readResource(result.resourceLinks![0]!.uri)).resolves.toMatchObject({
        contents: [{
          uri: result.resourceLinks![0]!.uri,
          mimeType: "text/plain",
          text: expect.stringContaining("runtime link"),
        }],
      });
      await expect(runtimeSurface.callBuiltinTools.get("resource_read")?.({
        uri: result.resourceLinks![0]!.uri,
      })).resolves.toMatchObject({
        output: expect.stringContaining("runtime link"),
        isError: false,
        metadata: expect.objectContaining({
          toolName: "resource_read",
          kind: "resource",
          operation: "read",
          uri: result.resourceLinks![0]!.uri,
        }),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps web source URLs visible when large web output is linked as an artifact", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        webSearch: {
          searchProvider: async () => ({
            provider: "test-search",
            sources: [{
              url: "https://docs.example.com/kiln",
              title: "Kiln docs",
              snippet: "large web snippet\n".repeat(1_000),
            }],
          }),
        },
      },
    });

    const result = await runtimeSurface.callBuiltinTools.get("web_search")?.({
      query: "kiln docs",
    }, {
      session: makeRuntimeSession(),
      toolCall: { id: "tool-call-web-search", name: "web_search", input: {} },
      sandbox: {
        cwd: "C:/workspace",
        policy: new SandboxPolicy({
          projectPath: "C:/workspace",
          config: {
            fsPolicy: "read-write",
            netPolicy: "documentation",
            allowedPaths: ["C:/workspace"],
            deniedPaths: [],
            allowedDomains: ["docs.example.com"],
          },
        }),
      },
    }) as {
      output: string;
      resourceLinks?: readonly { uri: string; title?: string }[];
    };

    expect(result.output).toContain("Source summary:");
    expect(result.output).toContain("https://docs.example.com/kiln");
    expect(result.output).toContain("Full tool output is available as resource links");
    expect(result.output).not.toContain("large web snippet");
    expect(result.resourceLinks).toEqual([expect.objectContaining({
      uri: expect.stringMatching(/^kiln:\/\/artifacts\/tool-results\/artifact_\d+\/content$/),
      title: "web_search full output",
    })]);
  });

  it("surfaces large bash output through resource links without inline stream metadata", async () => {
    const largeOutput = "runtime bash link\n".repeat(1_000);
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        bash: {
          commandRunner: async () => ({
            stdout: largeOutput,
            stderr: "",
          }),
        },
      },
    });

    const result = await runtimeSurface.callBuiltinTools.get("bash")?.({
      command: "pwd",
    }) as {
      output: string;
      resourceLinks?: readonly { uri: string; title?: string }[];
      metadata?: Record<string, unknown>;
    };

    expect(result.output).toContain("Full tool output is available as resource links");
    expect(result.output).not.toContain("runtime bash link");
    expect(result.resourceLinks).toEqual([expect.objectContaining({
      uri: expect.stringMatching(/^kiln:\/\/artifacts\/tool-results\/artifact_\d+\/content$/),
      title: "bash full output",
    })]);
    expect(result.metadata?.["stdoutBytes"]).toBe(Buffer.byteLength(largeOutput));
    expect(result.metadata?.["stdoutTruncated"]).toBe(true);
    expect(Buffer.byteLength(String(result.metadata?.["stdout"] ?? ""), "utf8")).toBeLessThanOrEqual(8 * 1024);
  });

  it("hands admitted invocation authority to the core tool bridge", async () => {
    const leaseRoot = await mkdtemp(join(tmpdir(), "kiln-authority-bridge-"));
    await writeFile(join(leaseRoot, "inside.txt"), "before", "utf8");
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: { mode: "strict", alwaysOnTools: ["edit"] },
      },
    });

    try {
      await expect(runtimeSurface.callBuiltinTools.get("edit")?.({
        filePath: join(leaseRoot, "inside.txt"),
        oldString: "before",
        newString: "blocked",
      }, {
        session: makeRuntimeSession(),
        toolCall: { id: "tool-call-edit-denied", name: "edit", input: {} },
        authority: {
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "Parent runtime denied this invocation",
        },
      })).rejects.toThrow("Parent runtime denied");

      const result = await runtimeSurface.callBuiltinTools.get("edit")?.({
        filePath: join(leaseRoot, "inside.txt"),
        oldString: "before",
        newString: "after",
      }, {
        session: makeRuntimeSession(),
        toolCall: { id: "tool-call-edit-allowed", name: "edit", input: {} },
        authority: {
          level: 4,
          allowed: true,
          requiresApproval: false,
          reason: "Destructive authority admitted by the runtime turn",
        },
      }) as { isError: boolean; output: string };

      expect(result).toMatchObject({ isError: false });
      expect(await readFile(join(leaseRoot, "inside.txt"), "utf8")).toBe("after");
    } finally {
      await rm(leaseRoot, { recursive: true, force: true });
    }
  });
});
