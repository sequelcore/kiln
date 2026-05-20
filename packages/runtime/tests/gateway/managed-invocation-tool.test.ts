import { describe, expect, it, vi } from "vitest";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentWriteAuthority,
  MemoryArtifactResourceStore,
  textParts,
} from "@kilnai/core";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";
import { buildTuiTurnPerCallConfig } from "../../src/gateway/tui-gateway.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";
import {
  attachManagedInvocationSessionEventSink,
  type ManagedInvocationSessionEventSink,
  type ManagedInvocationToolOptions,
} from "../../src/agents/managed-invocation/runtime-tool.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.js";

function makeSession(): RuntimeSession {
  const session = new RuntimeSession({
    sessionId: "session-parent",
    appName: "test-app",
    tenantId: "tenant-a",
    userId: "user-1",
    systemPrompt: "test",
  });
  session.addUserMessage(textParts("Delegate a read-only review."));
  return session;
}

function makeDescriptor(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentAdapterDescriptor {
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

function makeAdapter(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentRuntimeAdapter {
  return makeAdapterWithHandoff("Child review completed.", overrides);
}

function makeAdapterWithHandoff(
  summary: string,
  overrides: Partial<ManagedAgentAdapterDescriptor> = {},
): ManagedAgentRuntimeAdapter {
  return {
    descriptor: makeDescriptor(overrides),
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
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        resultHandoff: {
          summary,
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
        },
      })),
  };
}

function makeTimedOutAdapter(): ManagedAgentRuntimeAdapter {
  return {
    descriptor: makeDescriptor(),
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
        lifecycleState: "timed-out",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: admission.capabilitySnapshot,
        childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
        childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        diagnostics: [{
          uri: `kiln://managed-invocations/${request.invocationId}/timeout`,
          kind: "timeout",
        }],
        resultHandoff: {
          summary: "Direct child timed out before handoff.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/timeout`],
          memoryWriteProposalUris: [],
        },
      })),
  };
}

function makeSurface(
  adapter = makeAdapter(),
  sessionEventSink?: ManagedInvocationSessionEventSink,
  artifactStore?: MemoryArtifactResourceStore,
) {
  return createAttachedRuntimeBuiltinToolSurface({
    ...(artifactStore ? { builtinToolOptions: { artifactResources: { store: artifactStore } } } : {}),
    managedInvocation: {
      ...(sessionEventSink ? { sessionEventSink } : {}),
      ...(artifactStore ? { artifactStore } : {}),
      routes: [{
        routeId: "opencode-readonly",
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
}

function makeManagedRoute(routeId: string, model: string, adapter = makeAdapter()) {
  return {
    routeId,
    providerId: "opencode",
    model,
    adapter,
    surface: "cli-harness",
    taskSuitability: [
      {
        task: "architecture-review" as const,
        level: "capable" as const,
        source: "static-profile" as const,
        reason: "Test suitability evidence.",
      },
    ],
    profiles: {
      "foundation-readonly-plan": {
        authorityProfileId: `authority:${routeId}:foundation-readonly-plan`,
        permissionProfile: "read-only",
        allowedToolNames: ["read", "grep", "glob"],
        workingDirectory: {
          path: "C:/workspace/kiln",
          mode: "read-only" as const,
        },
        timeoutMs: 120000,
        credentialRoute: {
          mode: "runtime-selected" as const,
          routeId: `credential-route:${routeId}`,
        },
        memoryScope: {
          scope: { kind: "project" as const, id: "kiln" },
          access: "read-only" as const,
        },
      },
    },
  };
}

describe("managed invocation runtime tool", () => {
  it("is not exposed unless managed invocation routes are configured", () => {
    const surface = createAttachedRuntimeBuiltinToolSurface();

    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.invoke")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.invoke")).toBe(false);
  });

  it("uses the same managed invocation surface contract for TUI turns", () => {
    const surface = makeSurface();
    const executeConfig = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      surface,
      { supportsFunctionTools: true },
      undefined,
      "execute",
    );
    const planConfig = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      surface,
      { supportsFunctionTools: true },
      undefined,
      "plan",
    );

    expect(executeConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(true);
    expect(executeConfig.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
    expect(planConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(false);
  });

  it("projects configured managed routes into the model-facing tool definition", () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly-a", "model-a"),
          makeManagedRoute("opencode-readonly-b", "model-b"),
        ],
        agentCatalog: [
          {
            name: "scout",
            displayName: "Dewey",
            role: "Read-only context scout",
            goal: "Map impacted files",
            tier: "fast",
            taskAffinity: ["research", "architecture-review"],
          },
          {
            name: "tdd",
            displayName: "Malcolm",
            nicknameCandidates: ["tdd-guide"],
            role: "TDD guide",
            goal: "Write tests first",
            tier: "reasoning",
            skills: ["test-generator"],
            taskAffinity: ["test-writing"],
          },
        ],
        skillCatalog: [
          {
            name: "test-generator",
            description: "Generate focused tests.",
            tags: ["test"],
          },
          {
            name: "repo-review",
            description: "Review repository evidence.",
            tags: ["review"],
          },
        ],
        unavailableRoutes: [{
          routeId: "openrouter-readonly",
          providerId: "openrouter",
          model: "openrouter/free",
          profiles: ["foundation-readonly-plan"],
          reason: "model is not tool-call-capable",
        }],
      },
    });

    const tool = surface.toolDefinitions.find((definition) => definition.name === "managed_agent.invoke");
    const schema = tool?.inputSchema as {
      readonly properties?: {
        readonly routeId?: { readonly enum?: readonly string[] };
        readonly workItemId?: { readonly type?: string };
        readonly requestedAuthority?: {
          readonly enum?: readonly string[];
        };
        readonly expectedEvidence?: {
          readonly items?: { readonly type?: string };
        };
        readonly agentProfile?: { readonly enum?: readonly string[] };
        readonly skills?: {
          readonly items?: { readonly enum?: readonly string[] };
          readonly maxItems?: number;
        };
        readonly providerRoute?: {
          readonly properties?: {
            readonly providerId?: { readonly enum?: readonly string[] };
          };
        };
      };
    };

    expect(tool?.description).toContain("Configured healthy managed invocation routes");
    expect(tool?.description).toContain("opencode-readonly-a");
    expect(tool?.description).toContain("taskSuitability=architecture-review:capable:static-profile");
    expect(tool?.description).toContain("Configured unavailable managed invocation routes");
    expect(tool?.description).toContain("openrouter-readonly");
    expect(tool?.description).toContain("Configured admitted agent profiles");
    expect(tool?.description).toContain("Configured admitted skills: test-generator");
    expect(tool?.description).toContain("Configured skill catalog");
    expect(tool?.description).toContain("repo-review: Review repository evidence");
    expect(tool?.description).toContain("Task-affinity hints");
    expect(tool?.description).toContain("Routes: opencode-readonly-a -> architecture-review:capable");
    expect(tool?.description).toContain("Agent profiles: scout -> research,architecture-review");
    expect(tool?.description).toContain("scout (Dewey)");
    expect(tool?.description).toContain("tdd (Malcolm/tdd-guide)");
    expect(tool?.description).toContain("Selection policy");
    expect(tool?.description).toContain("Do not invent agentProfile names");
    expect(tool?.description).toContain("Do not invent skill names");
    expect(tool?.description).toContain("pass workItemId, expectedEvidence");
    expect(tool?.description).toContain("Do not use contextMode=resources without resourceUris");
    expect(tool?.description).toContain("For comparison tasks");
    expect(schema.properties?.routeId?.enum).toEqual([
      "opencode-readonly-a",
      "opencode-readonly-b",
      "openrouter-readonly",
    ]);
    expect(schema.properties?.providerRoute?.properties?.providerId?.enum).toEqual([
      "opencode",
      "openrouter",
    ]);
    expect(schema.properties?.agentProfile?.enum).toEqual([
      "scout",
      "Dewey",
      "tdd",
      "Malcolm",
      "tdd-guide",
    ]);
    expect(schema.properties?.workItemId?.type).toBe("string");
    expect(schema.properties?.requestedAuthority?.enum).toEqual([
      "auto",
      "read_only",
      "audited",
      "destructive",
    ]);
    expect(schema.properties?.expectedEvidence?.items?.type).toBe("string");
    expect(schema.properties?.skills?.items?.enum).toEqual(["test-generator", "repo-review"]);
  });

  it("prevents invented managed child skills when the admitted catalog has none", () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a")],
        agentCatalog: [{
          name: "architect",
          displayName: "Piama",
          role: "Software architect",
          goal: "Review architecture",
          tier: "reasoning",
        }],
        skillCatalog: [],
      },
    });

    const tool = surface.toolDefinitions.find((definition) => definition.name === "managed_agent.invoke");
    const schema = tool?.inputSchema as {
      readonly properties?: {
        readonly skills?: {
          readonly description?: string;
          readonly maxItems?: number;
        };
      };
    };

    expect(tool?.description).toContain("Configured admitted skills: none");
    expect(schema.properties?.skills?.maxItems).toBe(0);
    expect(schema.properties?.skills?.description).toContain("Omit skills");
  });

  it("composes managed invocation session event sinks for operator surfaces", async () => {
    const originalSink = vi.fn();
    const surfaceSink = vi.fn();
    const options = attachManagedInvocationSessionEventSink({
      routes: [],
      sessionEventSink: { publish: originalSink },
    }, { publish: surfaceSink });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };
    const events = [];

    await options?.sessionEventSink?.publish(events, context);

    expect(originalSink).toHaveBeenCalledWith(events, context);
    expect(surfaceSink).toHaveBeenCalledWith(events, context);
  });

  it("maps managed_agent.invoke input and runtime context to an admitted managed invocation request", async () => {
    const adapter = makeAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const executeConfig = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-a",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: surface,
    });
    const planConfig = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-a",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: surface,
      executionMode: "plan",
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    expect(surface.toolDefinitions.map((tool) => tool.name)).toContain("managed_agent.invoke");
    expect(executeConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(true);
    expect(executeConfig.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
    expect(planConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(false);

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
      workItemId: "work-42",
      roleIntent: "Architecture review before implementation.",
      expectedEvidence: ["surface-map", "managed-agent-review", "residual-risk"],
      requiredResultFields: ["summary", "evidence", "residualRisk"],
      doneCriteria: ["Report the top contract risk and cite evidence."],
      residualRiskRequired: true,
      requestedAuthority: "read_only",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly childSessionId?: string;
        readonly profile?: string;
        readonly providerRoute?: Record<string, unknown>;
        readonly adapterKind?: string;
        readonly executionMode?: string;
        readonly requestedAuthority?: string;
        readonly authorityProfileId?: string;
        readonly handoffContract?: Record<string, unknown>;
        readonly presentationIntent?: Record<string, unknown>;
      };
    };

    expect(result).toMatchObject({
      output: expect.stringContaining("Child review completed."),
      isError: false,
      metadata: {
        childSessionId: expect.stringContaining("session-parent:managed:"),
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "opencode",
          surface: "cli-harness",
          model: "opencode-default-model",
        },
        adapterKind: "harness",
        executionMode: "cli-harness",
        requestedAuthority: "read_only",
        authorityProfileId: "authority:opencode:readonly",
        handoffContract: {
          workItemId: "work-42",
          roleIntent: "Architecture review before implementation.",
          expectedEvidence: ["surface-map", "managed-agent-review", "residual-risk"],
          requiredResultFields: ["summary", "evidence", "residualRisk"],
          doneCriteria: ["Report the top contract risk and cite evidence."],
          residualRiskRequired: true,
        },
        presentationIntent: {
          kind: "comparison_table",
          title: "Managed child invocation",
          rows: [
            expect.objectContaining({
              routeId: "opencode-readonly",
              provider: "opencode",
              model: "opencode-default-model",
              status: "completed",
              substantiveEvidence: true,
            }),
          ],
        },
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect((adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request).toMatchObject({
      parentSessionId: "session-parent",
      parentTurnId: "session-parent:turn:1",
      profile: "foundation-readonly-plan",
      requestedAuthority: "read_only",
      requestedBy: "assistant",
      requestSource: "runtime-tool",
      providerRoute: {
        providerId: "opencode",
        surface: "cli-harness",
        model: "opencode-default-model",
      },
      authority: {
        authorityProfileId: "authority:opencode:readonly",
        permissionProfile: "read-only",
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
        workingDirectory: {
          path: "C:/workspace/kiln",
          mode: "read-only",
        },
      },
      input: {
        summary: "Inspect the managed invocation tool contract and report risks.",
        prompt: "Inspect the managed invocation tool contract and report risks.",
        handoff: {
          workItemId: "work-42",
          expectedEvidence: ["surface-map", "managed-agent-review", "residual-risk"],
          residualRiskRequired: true,
        },
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(session.sessionEvents[0]).toMatchObject({
      requestedAuthority: "read_only",
    });
    expect(sessionEventSink.publish).toHaveBeenCalledWith(session.sessionEvents, context);
    expect(session.sessionEvents[2]).toMatchObject({
      requestedAuthority: "read_only",
      handoffContract: {
        workItemId: "work-42",
        residualRiskRequired: true,
      },
      resultSummary: "Child review completed.",
      managedInvocationEvidence: {
        childSessionId: result.metadata.childSessionId,
      },
    });
  });

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
        readonly managedInvocationRecovery?: Record<string, unknown>;
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly recovery?: {
        readonly nextTool?: string;
        readonly workItemId?: string;
        readonly evidenceToRecord?: readonly string[];
        readonly thenTool?: string;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("timed-out");
    expect(result.metadata.managedInvocationRecovery).toMatchObject({
      nextTool: "work_item.update",
      workItemId: "work-ui",
      evidenceToRecord: ["visual-reference-research"],
      thenTool: "work_item.execution.start",
    });
    expect(output).toMatchObject({
      status: "timed-out",
      recovery: {
        nextTool: "work_item.update",
        workItemId: "work-ui",
        evidenceToRecord: ["visual-reference-research"],
        thenTool: "work_item.execution.start",
      },
    });
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
        sourceResourceUris: [expect.stringContaining("kiln://managed-invocations/")],
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
      sourceResourceUris: [expect.stringContaining("kiln://managed-invocations/")],
    });
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

  it("fails a visual phase child completion when the handoff is not substantive evidence", async () => {
    const surface = makeSurface(makeAdapterWithHandoff("Direct provider managed invocation completed."));
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
    });
    expect(output.recovery?.reason).toContain("no-handoff");
    expect(result.metadata.status).toBe("handoff_not_substantive");
    expect(result.metadata.managedInvocationPhaseCompletion).toBeUndefined();
    expect(result.metadata.managedInvocationRecovery).toMatchObject({
      status: "phase_evidence_required",
      workItemId: "work-ui",
    });
  });

  it("fails closed before approval when destructive authority selects a read-only profile", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const requestApproval = vi.fn(async () => ({
      approved: true,
      reason: "operator approved destructive child authority",
    }));
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
      requestApproval,
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "destructive",
      task: "Apply a destructive managed change.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly requestedAuthority?: string;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("destructive requested authority cannot select read-only managed profile");
    expect(requestApproval).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed before invocation when the selected route lacks required phase tools", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
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
      task: "Collect visual-reference-research.",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["web_search", "browser_observe"],
      requestedAuthority: "read_only",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly missingRequiredTools?: readonly string[];
        readonly presentationIntent?: {
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("lacks required tools: web_search, browser_observe");
    expect(result.metadata.missingRequiredTools).toEqual(["web_search", "browser_observe"]);
    expect(result.metadata.presentationIntent?.rows?.[0]).toMatchObject({
      status: "unavailable",
      substantiveEvidence: false,
      failureReason: "Missing required route tools: web_search, browser_observe",
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed before invocation when visual phase tools are present without network authority", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly-visual-without-network",
          providerId: "opencode",
          model: "opencode-default-model",
          adapter,
          profiles: {
            "foundation-readonly-plan": {
              authorityProfileId: "authority:opencode:readonly-visual-without-network",
              permissionProfile: "read-only",
              allowedToolNames: ["read", "web_search", "browser_observe"],
              networkAllowed: false,
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
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
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
      task: "Collect visual-reference-research.",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["web_search", "browser_observe"],
      requestedAuthority: "read_only",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly missingRequiredCapabilities?: readonly string[];
        readonly presentationIntent?: {
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("lacks required capabilities: network");
    expect(result.metadata.missingRequiredCapabilities).toEqual(["network"]);
    expect(result.metadata.presentationIntent?.rows?.[0]).toMatchObject({
      status: "unavailable",
      substantiveEvidence: false,
      failureReason: "Missing required route capabilities: network",
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed when a managed child requests destructive authority without an approval flow", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
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
      requestedAuthority: "destructive",
      task: "Apply a destructive managed change.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("destructive requested authority cannot select read-only managed profile");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });

  it("fails closed when inherited read-only authority selects a write-capable managed profile", async () => {
    const adapter = makeAdapter({
      supportedProfiles: ["foundation-readonly-plan", "foundation-propose-writes"],
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: false,
        memoryProposalSupported: false,
        rollbackEvidence: false,
        cleanupEvidence: false,
        scopeReduction: true,
      },
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          routeId: "opencode-propose-writes",
          providerId: "opencode",
          model: "opencode-default-model",
          adapter,
          profiles: {
            "foundation-propose-writes": {
              authorityProfileId: "authority:opencode:propose-writes",
              permissionProfile: "workspace-propose-writes",
              allowedToolNames: ["read", "grep", "edit"],
              writeAllowed: false,
              networkAllowed: false,
              workingDirectory: {
                path: "C:/workspace/kiln",
                mode: "workspace-write",
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
              writeAuthority: defineManagedAgentWriteAuthority({
                profile: "foundation-propose-writes",
                scope: {
                  workspace: {
                    mode: "propose",
                    allowedPaths: ["C:/workspace/kiln"],
                    deniedPaths: [],
                  },
                  memory: {
                    mode: "none",
                    operations: [],
                  },
                  artifacts: {
                    mode: "none",
                    resourceUris: [],
                    retention: "none",
                  },
                  tools: {
                    allowedToolNames: ["edit"],
                    deniedToolNames: [],
                  },
                },
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
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
      effectiveTurnAuthority: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection",
        reason: "parent turn admitted read-only authority",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-propose-writes",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Prepare a write proposal.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("read_only requested authority cannot select managed profile 'foundation-propose-writes'");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });

  it("admits requested agent profile and skills through the configured context resolver", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn(async () => ({
      promptPrefix: "## Child Agent Profile\nname: architecture-reviewer\n\nSkill\nname: ddd-review",
      admittedAgentProfile: "architecture-reviewer",
      admittedSkills: ["ddd-review"],
    }));
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", adapter)],
        contextResolver,
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "opencode-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "model-a",
      },
      agentProfile: "architecture-reviewer",
      skills: ["ddd-review"],
      contextMode: "isolated",
      task: "Inspect the managed invocation tool contract and report risks.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly context?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.context).toEqual({
      mode: "isolated",
      agentProfile: "architecture-reviewer",
      skills: ["ddd-review"],
      admittedAgentProfile: "architecture-reviewer",
      admittedSkills: ["ddd-review"],
    });
    expect(contextResolver).toHaveBeenCalledWith(expect.objectContaining({
      providerRoute: {
        providerId: "opencode",
        model: "model-a",
      },
    }));
    expect((adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request.input).toMatchObject({
      context: result.metadata.context,
      prompt: expect.stringContaining("## Child Agent Profile"),
    });
    expect(session.sessionEvents).toEqual([
      expect.objectContaining({
        kind: "agent_invocation_requested",
        invocationContext: result.metadata.context,
      }),
      expect.objectContaining({
        kind: "agent_invocation_started",
        invocationContext: result.metadata.context,
      }),
      expect.objectContaining({
        kind: "agent_invocation_completed",
        invocationContext: result.metadata.context,
      }),
    ]);
  });

  it("fails closed when profile or skill context is requested without a resolver", async () => {
    const surface = makeSurface();
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
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
      agentProfile: "architecture-reviewer",
      task: "Inspect the managed invocation tool contract and report risks.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("context resolver is not configured");
  });

  it("fails closed when resources context mode is requested without governed resource URIs", async () => {
    const surface = makeSurface();
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
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
      contextMode: "resources",
      task: "Inspect the managed invocation tool contract and report risks.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("contextMode resources requires at least one resourceUris entry");
    expect((surface.callBuiltinTools.get("managed_agent.invoke"))).toBeDefined();
  });

  it("rejects provider model overrides that do not match the configured managed route", async () => {
    const surface = makeSurface();
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "sonic",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("No managed invocation route is configured");
  });

  it("fails closed when provider/profile selection is ambiguous without routeId", async () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly-a", "model-a"),
          makeManagedRoute("opencode-readonly-b", "model-b"),
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("route selection is ambiguous");
    expect(result.output).toContain("opencode-readonly-a, opencode-readonly-b");
  });

  it("uses the selected agent profile route hint to disambiguate route selection", async () => {
    const fastAdapter = makeAdapter();
    const slowAdapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly", "model-heavy", slowAdapter),
          makeManagedRoute("opencode-scout-readonly", "model-fast", fastAdapter),
        ],
        agentCatalog: [{
          name: "scout",
          displayName: "Dewey",
          role: "Read-only context scout",
          goal: "Map impacted files quickly",
          tier: "fast",
          routeId: "opencode-scout-readonly",
          providerRoute: {
            providerId: "opencode",
            model: "model-fast",
          },
        }],
        contextResolver: async () => ({ admittedAgentProfile: "scout" }),
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
      },
      agentProfile: "scout",
      contextMode: "isolated",
      task: "Scout the GUI surface.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly routeId?: string;
        readonly providerRoute?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.routeId).toBe("opencode-scout-readonly");
    expect(result.metadata.providerRoute).toMatchObject({
      providerId: "opencode",
      model: "model-fast",
    });
    expect(fastAdapter.invoke).toHaveBeenCalledTimes(1);
    expect(slowAdapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed when an explicit route contradicts the selected agent profile route hint", async () => {
    const fastAdapter = makeAdapter();
    const slowAdapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly", "model-heavy", slowAdapter),
          makeManagedRoute("opencode-scout-readonly", "model-fast", fastAdapter),
        ],
        agentCatalog: [{
          name: "scout",
          displayName: "Dewey",
          role: "Read-only context scout",
          goal: "Map impacted files quickly",
          tier: "fast",
          routeId: "opencode-scout-readonly",
          providerRoute: {
            providerId: "opencode",
            model: "model-fast",
          },
        }],
        contextResolver: async () => ({ admittedAgentProfile: "scout" }),
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: {
        providerId: "opencode",
      },
      agentProfile: "scout",
      contextMode: "isolated",
      task: "Scout the GUI surface.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("contradicts configured agentProfile 'scout' route hint");
    expect(fastAdapter.invoke).not.toHaveBeenCalled();
    expect(slowAdapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });

  it("reports configured but unavailable managed routes with their health reason", async () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [],
        unavailableRoutes: [{
          routeId: "openrouter-readonly",
          providerId: "openrouter",
          model: "openrouter/free",
          profiles: ["foundation-readonly-plan"],
          reason: "Direct provider route 'openrouter-readonly' requires a tool-call-capable model; 'openrouter/openrouter/free' is not eligible.",
        }],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "openrouter",
        model: "openrouter/free",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Managed invocation route 'openrouter-readonly' is unavailable");
    expect(result.output).toContain("requires a tool-call-capable model");
  });

  it("records the effective route model and persists readable handoff resources", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const surface = makeSurface(makeAdapter(), undefined, artifactStore);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "opencode" },
      task: "Inspect the managed invocation tool contract and report risks.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly providerRoute?: Record<string, unknown>;
        readonly transcript?: { readonly uri?: string };
        readonly resultHandoff?: { readonly resourceUris?: readonly string[] };
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.providerRoute).toMatchObject({
      providerId: "opencode",
      surface: "cli-harness",
      model: "opencode-default-model",
    });
    expect(result.metadata.transcript?.uri).toMatch(/^kiln:\/\/artifacts\/managed-invocations\/artifact_\d+\/content$/u);
    expect(result.metadata.resultHandoff?.resourceUris?.[0]).toBe(result.metadata.transcript?.uri);

    const transcript = await surface.readResource(result.metadata.transcript?.uri ?? "");
    expect(transcript.contents[0]).toMatchObject({
      mimeType: "text/markdown",
    });
    const transcriptText = String("text" in transcript.contents[0]! ? transcript.contents[0]!.text : "");
    expect(transcriptText).toContain("Model: opencode-default-model");
    expect(transcriptText).toContain("## Capability Snapshot");
    expect(transcriptText).toContain("Route ID: opencode-readonly");
    expect(transcriptText).toContain("Provider proof: live-proven");
    expect(transcriptText).toContain("Child review completed.");
  });

  it("fails closed when invoked outside a runtime session context", async () => {
    const surface = makeSurface();

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "opencode" },
      task: "Inspect the managed invocation tool contract.",
    }) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result).toMatchObject({
      output: expect.stringContaining("requires runtime session context"),
      isError: true,
    });
  });

  it("fails closed without invoking an adapter for unconfigured routes", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "codex" },
      task: "Inspect the managed invocation tool contract.",
    }, {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result).toMatchObject({
      output: expect.stringContaining("No managed invocation route is configured"),
      isError: true,
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });
});
