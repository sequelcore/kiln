import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DevTool,
  ManagedAgentAdapterDescriptor,
  ManagedAgentInvocationRequest,
  ToolInput,
  ToolResult,
} from "@kilnai/core";
import {
  buildManagedAgentCapabilitySnapshot,
  createDefaultBuiltinToolSurface,
  createSessionBuiltinToolOptions,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  textParts,
} from "@kilnai/core";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.js";

const ALWAYS_ON_RESOURCE_TOOLS = ["resource_list", "resource_template_list", "resource_read"];

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

function makeManagedAdapter(): ManagedAgentRuntimeAdapter {
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
          summary: "Managed child completed governed work.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
      })),
  };
}

function makeFailedManagedAdapter(): ManagedAgentRuntimeAdapter {
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
        lifecycleState: "failed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: admission.capabilitySnapshot,
        resultHandoff: {
          summary: "Managed child failed before producing governed evidence.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
      })),
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
    requiredResultFields: ["summary", "evidence", "checks"],
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
    annotations: { readOnly: false },
    calls,
    async execute(input): Promise<ToolResult> {
      calls.push(input);
      const managedInvocationId = typeof input.input.managedInvocationId === "string"
        ? input.input.managedInvocationId
        : undefined;
      if (!managedInvocationId) {
        return {
          output: JSON.stringify({
            status: "paused",
            reason: "managedInvocationId is required before starting managed-delegation execution.",
            workItemId: "work-managed",
            nextTool: "managed_agent.invoke",
            managedInvocationRequest,
          }, null, 2),
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
          attempt: {
            managedInvocationId,
          },
        },
      };
    },
  };
}

describe("attached runtime builtin tool surface", () => {
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
      deniedToolCount: 0,
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
      deniedToolCount: 0,
    });
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
    expect(config.perCallCapabilities?.get("submit_plan")?.annotations?.readOnly).toBe(true);
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
      expect(requestedReadOnly.perCallCapabilities?.get(toolName)?.annotations?.readOnly).toBe(true);
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
    expect(JSON.parse(snapshot.contents[0]!.text)).toMatchObject({
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
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(planResult?.isError).toBe(false);
    expect(planResult?.metadata).toMatchObject({
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
    });
    expect(planResult?.output).toContain("Ship typed plan submission contract.");
    expect(planResult?.output).toContain("- source specification: spec_1");
    expect(planResult?.output).toContain("- work item wi-1: Add structured plan schema and validation.");

    const plans = await runtimeSurface.readResource("kiln://session/plans") as {
      readonly contents: readonly { readonly text?: string }[];
    };
    const plansPayload = JSON.parse(plans.contents[0]?.text ?? "{}") as {
      readonly plans?: readonly { readonly id?: string; readonly proposedWorkItems?: readonly Record<string, unknown>[] }[];
    };
    expect(plansPayload.plans?.[0]?.proposedWorkItems).toEqual(planResult?.metadata?.proposedWorkItems);

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
          adapter,
          profiles: {
            "foundation-readonly-plan": {
              authorityProfileId: "authority:opencode:readonly",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob"],
              workingDirectory: {
                path: "C:/workspace/kiln",
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
            },
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
      readonly isError: boolean;
      readonly metadata?: Record<string, unknown>;
    };

    expect(result.isError).toBe(false);
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
          requiredResultFields: ["summary", "evidence", "checks"],
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

  it("keeps intermediate evidence phases paused as successful explicit parent handoffs", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      requestedAuthority: "read_only",
      task: "Collect visual reference research before UI implementation.",
      summary: "Collect visual reference research before UI implementation.",
      workItemId: "work-managed",
      expectedEvidence: ["visual-reference-research"],
      requiredResultFields: ["summary", "evidence", "checks"],
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
    const adapter = makeFailedManagedAdapter();
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
          adapter,
          profiles: {
            "foundation-readonly-plan": {
              authorityProfileId: "authority:opencode:readonly",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob", "web_search", "browser_session_start"],
              workingDirectory: {
                path: "C:/workspace/kiln",
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
            },
          },
        }],
        agentCatalog: [{
          name: "visual-researcher",
          displayName: "Kimi",
          role: "Visual research specialist",
          goal: "Collect real visual reference evidence before frontend implementation.",
          tier: "reasoning",
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
      readonly metadata?: Record<string, unknown>;
    };
    const output = JSON.parse(result.output) as Record<string, unknown>;

    expect(result.isError).toBe(false);
    expect(output).toMatchObject({
      status: "paused",
      nextTool: "managed_agent.invoke",
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
    expect(startTool.calls).toHaveLength(1);
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(result.metadata).toMatchObject({
      operation: "managed_invocation_paused",
      managedInvocationAutoStarted: false,
      managedInvocationAutoStart: {
        decision: "skipped",
        reason: "intermediate_phase_requires_explicit_parent_invocation",
      },
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
      requiredResultFields: ["summary", "evidence", "checks"],
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
    const adapter = makeFailedManagedAdapter();
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
          adapter,
          profiles: {
            "foundation-readonly-plan": {
              authorityProfileId: "authority:opencode:readonly",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob"],
              workingDirectory: {
                path: "C:/workspace/kiln",
                mode: "read-only",
              },
              timeoutMs: 120000,
            },
          },
        }],
        agentCatalog: [{
          name: "visual-researcher",
          displayName: "Kimi",
          role: "Visual research specialist",
          goal: "Collect real visual reference evidence before frontend implementation.",
          tier: "reasoning",
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
    expect(adapter.invoke).not.toHaveBeenCalled();
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
      requiredResultFields: ["summary", "evidence", "checks"],
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
    const adapter = makeFailedManagedAdapter();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions({
        additionalTools: [startTool],
      }),
      managedInvocation: {
        routes: [{
          routeId: "opencode-provider-default",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          adapter,
          profiles: {
            "foundation-readonly-plan": {
              authorityProfileId: "authority:opencode:readonly",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "grep", "glob"],
              workingDirectory: {
                path: "C:/workspace/kiln",
                mode: "read-only",
              },
              timeoutMs: 120000,
            },
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
        readonly providerRoute?: { readonly model?: string };
      };
    };

    expect(result.isError).toBe(false);
    expect(output.managedInvocationRequest?.providerRoute?.model).toBeUndefined();
    expect(adapter.invoke).not.toHaveBeenCalled();
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
      requiredResultFields: ["summary", "evidence", "checks"],
      doneCriteria: ["Return a bounded handoff."],
      residualRiskRequired: false,
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_session_start"],
        completionTool: "work_item.update",
      },
    });
    const adapter = makeFailedManagedAdapter();
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
            adapter,
            profiles: {
              "foundation-readonly-plan": {
                authorityProfileId: "authority:opencode:readonly-without-browser",
                permissionProfile: "read-only",
                allowedToolNames: ["read", "grep", "glob"],
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "read-only",
                },
                timeoutMs: 120000,
              },
            },
          },
          {
            routeId: "opencode-visual-browser-readonly",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "model-with-browser",
            adapter,
            profiles: {
              "foundation-readonly-plan": {
                authorityProfileId: "authority:opencode:readonly-browser",
                permissionProfile: "read-only",
                allowedToolNames: ["read", "grep", "glob", "web_search", "browser_session_start"],
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "read-only",
                },
                timeoutMs: 120000,
              },
            },
          },
        ],
        agentCatalog: [{
          name: "visual-researcher",
          role: "Visual research specialist",
          goal: "Collect real visual reference evidence.",
          tier: "reasoning",
          routeId: "opencode-visual-browser-readonly",
          providerRoute: {
            providerId: "opencode",
            model: "model-with-browser",
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
      operation: "managed_invocation_paused",
      managedInvocationRouteRepair: {
        fromRouteId: "opencode-visual-without-browser",
        toRouteId: "opencode-visual-browser-readonly",
        reason: "required_tools_missing",
      },
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
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
        output: "managed_agent.invoke requires providerRoute.providerId.",
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

  it("returns unavailable failure closeout recovery when managed-delegation auto-start route is unavailable", async () => {
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
      attemptId: "goal-managed:work-managed:attempt:1",
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
        readonly workItemExecutionFailInputTemplate?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(true);
    expect(output.recovery).toMatchObject({
      nextTool: "work_item.execution.fail",
      workItemExecutionFailInputTemplate: {
        goalRunId: "goal-managed",
        workItemId: "work-managed",
        attemptId: "goal-managed:work-managed:attempt:1",
        failureReason: "unavailable",
      },
    });
    expect(result.metadata).toMatchObject({
      operation: "managed_invocation_failed",
      managedInvocation: {
        status: "unavailable",
      },
      managedInvocationRecovery: {
        nextTool: "work_item.execution.fail",
        workItemExecutionFailInputTemplate: {
          failureReason: "unavailable",
        },
      },
    });
  });

  it("hydrates route-owned provider and authority when the paused request carries an incompatible profile hint", async () => {
    const startTool = makeManagedExecutionStartTool({
      profile: "foundation-readonly-plan",
      routeId: "opencode-go-frontend-approved-write",
      requestedAuthority: "read_only",
      task: "Execute governed frontend work.",
      summary: "Execute governed frontend work.",
      workItemId: "work-managed",
      expectedEvidence: ["managed-agent-review"],
      requiredResultFields: ["summary", "evidence", "checks"],
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
          adapter,
          profiles: {
            "foundation-apply-approved-writes": {
              authorityProfileId: "authority:opencode-go:frontend",
              permissionProfile: "apply-approved-writes",
              writeAllowed: true,
              allowedToolNames: ["read", "grep", "glob", "write"],
              workingDirectory: {
                path: "C:/workspace/kiln",
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
                    allowedPaths: ["C:/workspace/kiln"],
                    deniedPaths: ["C:/workspace/kiln/.git"],
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
            },
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
      readonly isError: boolean;
      readonly metadata?: Record<string, unknown>;
    };

    expect(result.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect((adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request).toMatchObject({
      profile: "foundation-apply-approved-writes",
      requestedAuthority: "audited",
      providerRoute: {
        providerId: "opencode-go",
        model: "kimi-k2.6",
      },
    });
    expect(startTool.calls[1]?.input).toMatchObject({
      managedInvocationId: expect.stringContaining("managed-session-parent-1-tool-call-start-managed-invocation"),
    });
  });

  it("injects the runtime session id into goal.create when the model omits ownerSessionId", async () => {
    const goalInputs: ToolInput[] = [];
    const goalTool: DevTool = {
      name: "goal.create",
      description: "Create a goal.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
      annotations: {
        readOnly: false,
        idempotent: false,
      },
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
      toolCall: {
        id: "tool-call-goal",
        name: "goal.create",
        input: {},
      },
    };

    const result = await runtimeSurface.callBuiltinTools.get("goal.create")?.({
      objective: "Governed UI refactor.",
      ownerSessionId: null,
    }, context) as ToolResult | undefined;

    expect(result?.isError).toBe(false);
    expect(goalInputs[0]?.input).toMatchObject({
      ownerSessionId: session.id,
    });
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

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
    expect(Array.from(runtimeSurface.capabilities.keys())).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
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

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "code_intelligence",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "code_intelligence",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
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

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "read_many",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "read_many",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
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

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
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

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
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

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "operator_elicit",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "operator_elicit",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
  });

  it("routes interactive browser and computer tools through runtime-injected providers", async () => {
    const browserRequests: Record<string, unknown>[] = [];
    const computerRequests: Record<string, unknown>[] = [];
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
      command: "generate-large-output",
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
});
