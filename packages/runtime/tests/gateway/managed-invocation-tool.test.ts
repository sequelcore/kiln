import { describe, expect, it, vi } from "vitest";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
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
    invoke: vi.fn(async ({ request }: { readonly request: ManagedAgentInvocationRequest }) =>
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
        model: "sonic",
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
          model: "sonic",
        },
        adapterKind: "harness",
        executionMode: "cli-harness",
        authorityProfileId: "authority:opencode:readonly",
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
        model: "sonic",
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
      text: expect.stringContaining("Model: opencode-default-model"),
    });
    expect(String("text" in transcript.contents[0]! ? transcript.contents[0]!.text : "")).toContain("Child review completed.");
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
