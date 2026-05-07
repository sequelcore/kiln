import { describe, expect, it, vi } from "vitest";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
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

function makeAdapter(): ManagedAgentRuntimeAdapter {
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
          summary: "Child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
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
              path: "C:/Proyectos/Sequel/kiln",
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
    profiles: {
      "foundation-readonly-plan": {
        authorityProfileId: `authority:${routeId}:foundation-readonly-plan`,
        permissionProfile: "read-only",
        allowedToolNames: ["read", "grep", "glob"],
        workingDirectory: {
          path: "C:/Proyectos/Sequel/kiln",
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
          },
          {
            name: "tdd",
            displayName: "Malcolm",
            nicknameCandidates: ["tdd-guide"],
            role: "TDD guide",
            goal: "Write tests first",
            tier: "reasoning",
            skills: ["test-generator"],
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
    expect(tool?.description).toContain("Configured unavailable managed invocation routes");
    expect(tool?.description).toContain("openrouter-readonly");
    expect(tool?.description).toContain("Configured admitted agent profiles");
    expect(tool?.description).toContain("Configured admitted skills: test-generator");
    expect(tool?.description).toContain("scout (Dewey)");
    expect(tool?.description).toContain("tdd (Malcolm/tdd-guide)");
    expect(tool?.description).toContain("Selection policy");
    expect(tool?.description).toContain("Do not invent agentProfile names");
    expect(tool?.description).toContain("Do not invent skill names");
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
    expect(schema.properties?.skills?.items?.enum).toEqual(["test-generator"]);
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
        readonly authorityProfileId?: string;
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
        authorityProfileId: "authority:opencode:readonly",
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
          path: "C:/Proyectos/Sequel/kiln",
          mode: "read-only",
        },
      },
      input: {
        summary: "Inspect the managed invocation tool contract and report risks.",
        prompt: "Inspect the managed invocation tool contract and report risks.",
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(sessionEventSink.publish).toHaveBeenCalledWith(session.sessionEvents, context);
    expect(session.sessionEvents[2]).toMatchObject({
      resultSummary: "Child review completed.",
      managedInvocationEvidence: {
        childSessionId: result.metadata.childSessionId,
      },
    });
  });

  it("admits requested agent profile and skills through the configured context resolver", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", adapter)],
        contextResolver: vi.fn(async () => ({
          promptPrefix: "## Child Agent Profile\nname: architecture-reviewer\n\nSkill\nname: ddd-review",
          admittedAgentProfile: "architecture-reviewer",
          admittedSkills: ["ddd-review"],
        })),
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
