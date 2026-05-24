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
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentWorktreeLeaseManager } from "../../src/agents/managed-invocation/index.js";
import {
  attachManagedInvocationSessionEventSink,
  type ManagedInvocationSessionEventSink,
  type ManagedInvocationToolOptions,
} from "../../src/agents/managed-invocation/runtime-tool.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.js";

function makeSession(sessionId = "session-parent"): RuntimeSession {
  const session = new RuntimeSession({
    sessionId,
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
        lifecycleState: "timed_out",
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

function deferred<T>(): {
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

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

function expectPublicResourceLeaseMetadata(lease: unknown): void {
  expect(lease).toEqual(expect.objectContaining({
    leaseId: expect.any(String),
    createdAt: expect.any(String),
    workingDirectoryPath: expect.any(String),
    workingDirectoryMode: expect.any(String),
    healthStatus: expect.any(String),
    cleanupStatus: expect.any(String),
    resourceUris: expect.any(Array),
    diagnosticUris: expect.any(Array),
  }));
  expectResourceLeaseMetadataKeysPublic(lease);
}

const SENSITIVE_RESOURCE_LEASE_KEY_PATTERN = /secret|token|password|api[_-]?key|authorization|auth[_-]?token|credential[_-]?value/iu;
const SENSITIVE_RESOURCE_LEASE_VALUE_PATTERN = /(?:secret|token|password|api[_-]?key|authorization|auth[_-]?token|credential[_-]?value)\s*[:=]|bearer\s+[A-Za-z0-9._~+/-]+=*/iu;
const PUBLIC_RESOURCE_LEASE_URI_PATTERN = /^kiln:\/\/artifacts\//iu;

function expectResourceLeaseMetadataKeysPublic(value: unknown): void {
  if (typeof value === "string") {
    if (!PUBLIC_RESOURCE_LEASE_URI_PATTERN.test(value)) {
      expect(value).not.toMatch(SENSITIVE_RESOURCE_LEASE_VALUE_PATTERN);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    expect(key).not.toMatch(SENSITIVE_RESOURCE_LEASE_KEY_PATTERN);
    expectResourceLeaseMetadataKeysPublic(nestedValue);
  }
}

function makeDeferredAdapter(): {
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly terminal: ReturnType<typeof deferred<ReturnType<typeof defineManagedAgentInvocationRecord>>>;
} {
  const terminal = deferred<ReturnType<typeof defineManagedAgentInvocationRecord>>();
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: makeDescriptor(),
    invoke: vi.fn(async ({ admission }) => {
      const record = await terminal.promise;
      return defineManagedAgentInvocationRecord({
        ...record,
        capabilitySnapshot: admission.capabilitySnapshot,
      });
    }),
  };
  return { adapter, terminal };
}

function makeRejectingDeferredAdapter(): {
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly terminal: ReturnType<typeof deferred<void>>;
} {
  const terminal = deferred<void>();
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: makeDescriptor(),
    invoke: vi.fn(async () => {
      await terminal.promise;
      throw new Error("child runtime crashed");
    }),
  };
  return { adapter, terminal };
}

function makeAbortableDeferredAdapter(): {
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly terminal: ReturnType<typeof deferred<ReturnType<typeof defineManagedAgentInvocationRecord>>>;
  readonly signal: () => AbortSignal | undefined;
} {
  const terminal = deferred<ReturnType<typeof defineManagedAgentInvocationRecord>>();
  let signal: AbortSignal | undefined;
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: makeDescriptor(),
    invoke: vi.fn(async ({ admission, abortSignal }) => {
      signal = abortSignal;
      const record = await terminal.promise;
      return defineManagedAgentInvocationRecord({
        ...record,
        capabilitySnapshot: admission.capabilitySnapshot,
      });
    }),
  };
  return { adapter, terminal, signal: () => signal };
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
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.start")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.status")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.list")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.join")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.cancel")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.invoke")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.start")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.status")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.list")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.join")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.cancel")).toBe(false);
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
    expect(executeConfig.toolAllowlist?.has("managed_agent.start")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.status")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.list")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.join")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.cancel")).toBe(true);
    expect(executeConfig.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
    expect(planConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.start")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.status")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.list")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.join")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.cancel")).toBe(false);
  });

  it("exposes nonblocking managed child lifecycle tools backed by one runtime registry", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-bg",
        name: "managed_agent.start",
        input: {},
      },
    };

    const toolNames = surface.toolDefinitions.map((tool) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      "managed_agent.invoke",
      "managed_agent.start",
      "managed_agent.status",
      "managed_agent.list",
      "managed_agent.join",
      "managed_agent.cancel",
    ]));

    const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly status: string;
        readonly lifecycleState: string;
        readonly routeId: string;
        readonly sessionEventIds?: readonly string[];
      };
    };

    expect(started).toMatchObject({
      isError: false,
      metadata: {
        status: "started",
        lifecycleState: "running",
        routeId: "opencode-readonly",
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
    ]);
    expect(started.metadata.sessionEventIds).toEqual(session.sessionEvents.map((event) => event.eventId));
    expect(sessionEventSink.publish).toHaveBeenCalledWith(session.sessionEvents, context);

    const status = await surface.callBuiltinTools.get("managed_agent.status")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-status", name: "managed_agent.status", input: {} },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
      };
    };
    expect(status).toMatchObject({
      isError: false,
      metadata: {
        status: "running",
        lifecycleState: "running",
      },
    });

    const listed = await surface.callBuiltinTools.get("managed_agent.list")?.({}, {
      ...context,
      toolCall: { id: "tool-call-list", name: "managed_agent.list", input: {} },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocations?: readonly { readonly invocationId?: string; readonly lifecycleState?: string }[];
      };
    };
    expect(listed).toMatchObject({
      isError: false,
      metadata: {
        invocations: [
          {
            invocationId: started.metadata.invocationId,
            lifecycleState: "running",
          },
        ],
      },
    });

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    terminal.resolve(defineManagedAgentInvocationRecord({
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
      capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
        routeId: "opencode-readonly",
      }),
      childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
      resultHandoff: {
        summary: "Child review completed.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
        memoryWriteProposalUris: [],
      },
    }));
    await flushMicrotasks();

    const completedStatusBeforeJoin = await surface.callBuiltinTools.get("managed_agent.status")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-status-complete", name: "managed_agent.status", input: {} },
    }) as {
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly resultHandoff?: unknown;
        readonly transcript?: unknown;
        readonly terminalEvidenceAvailable?: boolean;
      };
    };
    expect(completedStatusBeforeJoin.metadata).toMatchObject({
      lifecycleState: "completed",
      terminalEvidenceAvailable: true,
    });
    expect(completedStatusBeforeJoin.metadata.resultHandoff).toBeUndefined();
    expect(completedStatusBeforeJoin.metadata.transcript).toBeUndefined();

    const completedListBeforeJoin = await surface.callBuiltinTools.get("managed_agent.list")?.({}, {
      ...context,
      toolCall: { id: "tool-call-list-complete", name: "managed_agent.list", input: {} },
    }) as {
      readonly metadata: {
        readonly invocations?: readonly {
          readonly lifecycleState?: string;
          readonly resultHandoff?: unknown;
          readonly transcript?: unknown;
          readonly terminalEvidenceAvailable?: boolean;
        }[];
      };
    };
    expect(completedListBeforeJoin.metadata.invocations?.[0]).toMatchObject({
      lifecycleState: "completed",
      terminalEvidenceAvailable: true,
    });
    expect(completedListBeforeJoin.metadata.invocations?.[0]?.resultHandoff).toBeUndefined();
    expect(completedListBeforeJoin.metadata.invocations?.[0]?.transcript).toBeUndefined();

    const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-join", name: "managed_agent.join", input: {} },
    }) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly resultHandoff?: { readonly summary?: string };
      };
    };

    expect(joined).toMatchObject({
      output: expect.stringContaining("Child review completed."),
      isError: false,
      metadata: {
        status: "completed",
        lifecycleState: "completed",
        resultHandoff: {
          summary: "Child review completed.",
        },
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: "agent_invocation_completed" }),
    ], expect.objectContaining({
      toolCall: expect.objectContaining({ name: "managed_agent.join" }),
    }));

    await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-join-2", name: "managed_agent.join", input: {} },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
  });

  it("normalizes direct runtime tool credential route ids before admission", async () => {
    const adapter = makeAdapter();
    const route = makeManagedRoute("opencode-readonly", "opencode-default-model", adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          ...route,
          profiles: {
            "foundation-readonly-plan": {
              ...route.profiles["foundation-readonly-plan"],
              credentialRoute: {
                mode: "runtime-selected",
                routeId: " credential-route:opencode:token-primary ",
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
      task: "Inspect the managed invocation tool contract and report risks.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly resourceLease?: {
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
        };
      };
    };

    expect(result.isError).toBe(false);
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    expect(request.authority.credentialRoute).toEqual({
      mode: "runtime-selected",
      routeId: "credential-route:opencode:token-primary",
    });
    expectPublicResourceLeaseMetadata(result.metadata.resourceLease);
    expect(result.metadata.resourceLease?.resourceUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-1/credential-route/credential-route%3Aopencode%3Atoken-primary",
    );
    expect(result.metadata.resourceLease?.diagnosticUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-1/credential-route-release/credential-route%3Aopencode%3Atoken-primary",
    );
  });

  it("backs fallback runtime tool services with sandbox lease evidence", async () => {
    const adapter = makeAdapter();
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          ...route,
          profiles: {
            "foundation-readonly-plan": {
              ...route.profiles["foundation-readonly-plan"],
              workingDirectory: {
                path: "C:/workspace/kiln",
                mode: "sandbox",
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
        id: "tool-call-sandbox",
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
      task: "Inspect the managed invocation tool contract from a sandbox route.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly resourceLease?: {
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    expect(request.authority.workingDirectory).toEqual({
      path: "C:/workspace/kiln",
      mode: "sandbox",
    });
    expectPublicResourceLeaseMetadata(result.metadata.resourceLease);
    expect(result.metadata.resourceLease?.resourceUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox/sandbox-policy",
    );
    expect(result.metadata.resourceLease?.diagnosticUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox/sandbox-policy-release",
    );
  });

  it("shares fallback sandbox services across nonblocking lifecycle tools", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          ...route,
          profiles: {
            "foundation-readonly-plan": {
              ...route.profiles["foundation-readonly-plan"],
              workingDirectory: {
                path: "C:/workspace/kiln",
                mode: "sandbox",
              },
            },
          },
        }],
      },
    });
    const session = makeSession();
    const startContext: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-sandbox-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract from a sandbox route.",
      requestedAuthority: "read_only",
    }, startContext) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly lifecycleState?: string;
      };
    };

    expect(started).toMatchObject({
      isError: false,
      metadata: {
        lifecycleState: "running",
      },
    });

    const status = await surface.callBuiltinTools.get("managed_agent.status")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...startContext,
      toolCall: { id: "tool-call-sandbox-status", name: "managed_agent.status", input: {} },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
      };
    };
    expect(status).toMatchObject({
      isError: false,
      metadata: {
        lifecycleState: "running",
      },
    });

    const listed = await surface.callBuiltinTools.get("managed_agent.list")?.({}, {
      ...startContext,
      toolCall: { id: "tool-call-sandbox-list", name: "managed_agent.list", input: {} },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly count?: number;
        readonly invocations?: readonly { readonly invocationId?: string }[];
      };
    };
    expect(listed).toMatchObject({
      isError: false,
      metadata: {
        count: 1,
        invocations: [{ invocationId: started.metadata.invocationId }],
      },
    });

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    terminal.resolve(defineManagedAgentInvocationRecord({
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
      capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
        routeId: "opencode-sandbox",
      }),
      resultHandoff: {
        summary: "Child review completed.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
        memoryWriteProposalUris: [],
      },
    }));
    await flushMicrotasks();

    const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...startContext,
      toolCall: { id: "tool-call-sandbox-join", name: "managed_agent.join", input: {} },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly resourceLease?: {
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
        };
      };
    };
    expect(joined).toMatchObject({
      isError: false,
      metadata: {
        lifecycleState: "completed",
      },
    });
    expectPublicResourceLeaseMetadata(joined.metadata.resourceLease);
    expect(joined.metadata.resourceLease?.resourceUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox-start/sandbox-policy",
    );
    expect(joined.metadata.resourceLease?.diagnosticUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox-start/sandbox-policy-release",
    );
  });

  it("cancels fallback sandbox lifecycle invocations with lease cleanup evidence", async () => {
    const { adapter, terminal } = makeAbortableDeferredAdapter();
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          ...route,
          profiles: {
            "foundation-readonly-plan": {
              ...route.profiles["foundation-readonly-plan"],
              workingDirectory: {
                path: "C:/workspace/kiln",
                mode: "sandbox",
              },
            },
          },
        }],
      },
    });
    const session = makeSession();
    const startContext: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-sandbox-cancel-start",
        name: "managed_agent.start",
        input: {},
      },
    };
    const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract from a cancellable sandbox route.",
      requestedAuthority: "read_only",
    }, startContext) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    const cancelPromise = surface.callBuiltinTools.get("managed_agent.cancel")?.({
      invocationId: started.metadata.invocationId,
      reason: "Operator cancelled fallback sandbox invocation.",
    }, {
      ...startContext,
      toolCall: { id: "tool-call-sandbox-cancel", name: "managed_agent.cancel", input: {} },
    }) as Promise<{
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly resourceLease?: {
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
        };
      };
    }>;

    await flushMicrotasks();
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    terminal.resolve(defineManagedAgentInvocationRecord({
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
      capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
        routeId: "opencode-sandbox",
      }),
      resultHandoff: {
        summary: "Late sandbox output must be suppressed.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/late`],
        memoryWriteProposalUris: [],
      },
    }));

    const cancelled = await cancelPromise;

    expect(cancelled).toMatchObject({
      isError: true,
      metadata: {
        lifecycleState: "cancelled",
      },
    });
    expectPublicResourceLeaseMetadata(cancelled.metadata.resourceLease);
    expect(cancelled.metadata.resourceLease?.resourceUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox-cancel-start/sandbox-policy",
    );
    expect(cancelled.metadata.resourceLease?.diagnosticUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox-cancel-start/sandbox-policy-release",
    );
  });

  it("materializes invocation-scoped isolated worktree paths before adapter execution", async () => {
    const worktreeLeaseManager: ManagedAgentWorktreeLeaseManager = {
      acquire: vi.fn(async ({ request, lease }) => ({
        ...lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: [...lease.resourceUris, `kiln://artifacts/${request.invocationId}/worktree-lease`],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released",
        cleanupStatus: "completed",
      })),
    };
    const adapter = makeAdapterWithHandoff("Approved write completed.", {
      supportedProfiles: ["foundation-readonly-plan", "foundation-apply-approved-writes"],
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: false,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: new RuntimeManagedAgentInvocationService({
          worktreeLeaseManager,
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode:primary"],
          }),
        }),
        routes: [{
          routeId: "opencode-approved-write",
          providerId: "opencode",
          model: "opencode-default-model",
          adapter,
          profiles: {
            "foundation-apply-approved-writes": {
              authorityProfileId: "authority:opencode:approved-write",
              permissionProfile: "apply-approved-writes",
              allowedToolNames: ["read", "grep", "apply-patch"],
              writeAllowed: true,
              networkAllowed: false,
              workingDirectory: {
                path: "C:/workspace/kiln/.kiln/managed-worktrees",
                mode: "isolated-worktree",
              },
              workingDirectoryLease: {
                mode: "git-worktree",
                sourcePath: "C:/workspace/kiln",
                rootPath: "C:/workspace/kiln/.kiln/managed-worktrees",
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
                profile: "foundation-apply-approved-writes",
                scope: {
                  workspace: {
                    mode: "apply-approved",
                    allowedPaths: ["C:/workspace/kiln/packages/runtime/src"],
                    deniedPaths: ["C:/workspace/kiln/.git"],
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
                    allowedToolNames: ["apply-patch"],
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
        id: "tool-call-write",
        name: "managed_agent.invoke",
        input: {},
      },
      requestApproval: vi.fn(async () => ({
        approved: true,
        reason: "operator approved managed write",
      })),
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-apply-approved-writes",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "destructive",
      task: "Apply the approved runtime edit.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    expect(result.isError).toBe(false);
    const expectedPath = "C:\\workspace\\kiln\\.kiln\\managed-worktrees\\managed-session-parent-1-tool-call-write";
    expect(worktreeLeaseManager.acquire).toHaveBeenCalledWith(expect.objectContaining({
      lease: expect.objectContaining({
        workingDirectoryPath: expectedPath,
        workingDirectoryMode: "isolated-worktree",
      }),
    }));
    expect(adapter.invoke).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        authority: expect.objectContaining({
          workingDirectory: {
            path: expectedPath,
            mode: "isolated-worktree",
          },
          writeAuthority: expect.objectContaining({
            scope: expect.objectContaining({
              workspace: expect.objectContaining({
                allowedPaths: [
                  "C:/workspace/kiln/.kiln/managed-worktrees/managed-session-parent-1-tool-call-write/packages/runtime/src",
                ],
                deniedPaths: [
                  "C:/workspace/kiln/.kiln/managed-worktrees/managed-session-parent-1-tool-call-write/.git",
                ],
              }),
            }),
          }),
        }),
      }),
    }));
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
  });

  it("scopes nonblocking managed child lifecycle observation to the owning runtime session", async () => {
    const { adapter } = makeDeferredAdapter();
    const surface = makeSurface(adapter);
    const ownerSession = makeSession("session-owner");
    const otherSession = makeSession("session-other");
    const ownerContext: RuntimeBuiltinToolExecutionContext = {
      session: ownerSession,
      toolCall: {
        id: "tool-call-owner",
        name: "managed_agent.start",
        input: {},
      },
    };
    const otherContext: RuntimeBuiltinToolExecutionContext = {
      session: otherSession,
      toolCall: {
        id: "tool-call-other",
        name: "managed_agent.status",
        input: {},
      },
    };

    const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
      requestedAuthority: "read_only",
    }, ownerContext) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    const crossSessionStatus = await surface.callBuiltinTools.get("managed_agent.status")?.({
      invocationId: started.metadata.invocationId,
    }, otherContext) as {
      readonly isError: boolean;
      readonly output: string;
      readonly metadata: {
        readonly status?: string;
      };
    };
    expect(crossSessionStatus).toMatchObject({
      isError: true,
      output: expect.stringContaining("not registered for this runtime session"),
      metadata: {
        status: "not_found",
      },
    });

    const crossSessionList = await surface.callBuiltinTools.get("managed_agent.list")?.({}, {
      ...otherContext,
      toolCall: { id: "tool-call-other-list", name: "managed_agent.list", input: {} },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly count?: number;
        readonly invocations?: readonly unknown[];
      };
    };
    expect(crossSessionList).toMatchObject({
      isError: false,
      metadata: {
        count: 0,
        invocations: [],
      },
    });

    const crossSessionJoin = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...otherContext,
      toolCall: { id: "tool-call-other-join", name: "managed_agent.join", input: {} },
    }) as {
      readonly isError: boolean;
      readonly output: string;
      readonly metadata: {
        readonly status?: string;
      };
    };
    expect(crossSessionJoin).toMatchObject({
      isError: true,
      output: expect.stringContaining("not registered for this runtime session"),
      metadata: {
        status: "not_found",
      },
    });
    expect(otherSession.sessionEvents).toEqual([]);
  });

  it("publishes terminal failure evidence when a background managed child rejects before join", async () => {
    const { adapter, terminal } = makeRejectingDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-rejecting",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    terminal.resolve();
    await flushMicrotasks();

    const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-rejecting-join", name: "managed_agent.join", input: {} },
    }) as {
      readonly isError: boolean;
      readonly output: string;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly sessionEventIds?: readonly string[];
      };
    };

    expect(joined).toMatchObject({
      isError: true,
      output: expect.stringContaining("child runtime crashed"),
      metadata: {
        status: "failed",
        lifecycleState: "failed",
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_failed",
    ]);
    expect(joined.metadata.sessionEventIds).toEqual([
      session.sessionEvents[2]?.eventId,
    ]);
    expect(sessionEventSink.publish).toHaveBeenLastCalledWith([
      expect.objectContaining({
        kind: "agent_invocation_failed",
        errorCode: "ENGINE_FAILURE",
        errorMessage: "child runtime crashed",
      }),
    ], expect.objectContaining({
      toolCall: expect.objectContaining({ name: "managed_agent.join" }),
    }));
  });

  it("records nonblocking terminal duration from child runtime time instead of join wait time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-21T00:00:00.000Z"));
      const { adapter, terminal } = makeDeferredAdapter();
      const surface = makeSurface(adapter);
      const session = makeSession();
      const context: RuntimeBuiltinToolExecutionContext = {
        session,
        toolCall: {
          id: "tool-call-duration",
          name: "managed_agent.start",
          input: {},
        },
      };

      const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      }, context) as {
        readonly metadata: {
          readonly invocationId: string;
        };
      };
      const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;

      vi.setSystemTime(new Date("2026-05-21T00:00:01.234Z"));
      terminal.resolve(defineManagedAgentInvocationRecord({
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
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
        }),
        resultHandoff: {
          summary: "Child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
          memoryWriteProposalUris: [],
        },
      }));
      await flushMicrotasks();

      vi.setSystemTime(new Date("2026-05-21T00:00:06.234Z"));
      await surface.callBuiltinTools.get("managed_agent.join")?.({
        invocationId: started.metadata.invocationId,
      }, {
        ...context,
        toolCall: { id: "tool-call-duration-join", name: "managed_agent.join", input: {} },
      });

      expect(session.sessionEvents[2]).toMatchObject({
        kind: "agent_invocation_completed",
        durationMs: 1234,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a nonblocking managed child with terminal evidence and late-output suppression", async () => {
    const { adapter, terminal, signal } = makeAbortableDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-cancel-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    expect(signal()).toBeInstanceOf(AbortSignal);
    expect(signal()?.aborted).toBe(false);

    const cancelledPromise = surface.callBuiltinTools.get("managed_agent.cancel")?.({
      invocationId: started.metadata.invocationId,
      reason: "Operator cancelled the managed child.",
    }, {
      ...context,
      toolCall: { id: "tool-call-cancel", name: "managed_agent.cancel", input: {} },
    }) as Promise<{
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly sessionEventIds?: readonly string[];
      };
    }>;

    await flushMicrotasks();
    expect(signal()?.aborted).toBe(true);

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    terminal.resolve(defineManagedAgentInvocationRecord({
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
      capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
        routeId: "opencode-readonly",
      }),
      resultHandoff: {
        summary: "Late child output must be ignored.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/late`],
        memoryWriteProposalUris: [],
      },
    }));
    const cancelled = await cancelledPromise;

    expect(cancelled).toMatchObject({
      output: expect.stringContaining("Operator cancelled the managed child."),
      isError: true,
      metadata: {
        status: "cancelled",
        lifecycleState: "cancelled",
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_cancelled",
    ]);
    expect(session.sessionEvents[2]).toMatchObject({
      kind: "agent_invocation_cancelled",
      reason: "Operator cancelled the managed child.",
    });
    expect(cancelled.metadata.sessionEventIds).toEqual([
      session.sessionEvents[2]?.eventId,
    ]);

    const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-cancel-join", name: "managed_agent.join", input: {} },
    }) as {
      readonly output: string;
      readonly metadata: {
        readonly lifecycleState?: string;
      };
    };
    expect(joined.output).toContain("Operator cancelled the managed child.");
    expect(joined.output).not.toContain("Late child output must be ignored.");
    expect(joined.metadata.lifecycleState).toBe("cancelled");
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_cancelled",
    ]);
  });

  it("publishes adapter cancellation evidence from the cancel terminal event", async () => {
    const { adapter, terminal, signal } = makeAbortableDeferredAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-cancel-evidence-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect cancellation evidence propagation.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const cancelPromise = surface.callBuiltinTools.get("managed_agent.cancel")?.({
      invocationId: started.metadata.invocationId,
      reason: "Operator cancelled with cleanup evidence.",
    }, {
      ...context,
      toolCall: { id: "tool-call-cancel-evidence", name: "managed_agent.cancel", input: {} },
    }) as Promise<{
      readonly metadata: {
        readonly lifecycleState?: string;
      };
    }>;

    await flushMicrotasks();
    expect(signal()?.aborted).toBe(true);

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    terminal.resolve(defineManagedAgentInvocationRecord({
      invocationId: request.invocationId,
      agentId: request.agentId,
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      profile: request.profile,
      lifecycleState: "cancelled",
      providerRoute: request.providerRoute,
      adapterKind: request.adapterKind,
      executionMode: request.executionMode,
      authority: request.authority,
      capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
        routeId: "opencode-readonly",
      }),
      transcript: {
        uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
        redacted: "unknown",
        truncated: false,
        persisted: true,
        retention: "session",
      },
      resultHandoff: {
        summary: "Adapter cleanup completed.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/cancel-cleanup`],
        memoryWriteProposalUris: [],
      },
    }));

    const cancelled = await cancelPromise;

    expect(cancelled.metadata.lifecycleState).toBe("cancelled");
    expect(session.sessionEvents[2]).toMatchObject({
      kind: "agent_invocation_cancelled",
      reason: "Operator cancelled with cleanup evidence.",
      managedInvocationEvidence: {
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
        },
        resultHandoff: {
          summary: "Operator cancelled with cleanup evidence.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/cancel-cleanup`],
        },
      },
    });
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
    expect(executeConfig.toolAllowlist?.has("managed_agent.start")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.status")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.list")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.join")).toBe(true);
    expect(executeConfig.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
    expect(planConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.start")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.status")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.list")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.join")).toBe(false);

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
    expect(result.metadata.status).toBe("timed_out");
    expect(result.metadata.managedInvocationRecovery).toMatchObject({
      nextTool: "work_item.update",
      workItemId: "work-ui",
      evidenceToRecord: ["visual-reference-research"],
      thenTool: "work_item.execution.start",
    });
    expect(output).toMatchObject({
      status: "timed_out",
      recovery: {
        nextTool: "work_item.update",
        workItemId: "work-ui",
        evidenceToRecord: ["visual-reference-research"],
        thenTool: "work_item.execution.start",
      },
    });
  });

  it("returns failure closeout recovery when an explicit final managed child times out", async () => {
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
      attemptId: "goal-final:work-final:attempt:1",
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
        readonly workItemExecutionFailInputTemplate?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("timed_out");
    expect(result.metadata.managedInvocationRecovery).toMatchObject({
      nextTool: "work_item.execution.fail",
      goalRunId: "goal-final",
      workItemId: "work-final",
      evidenceToRecord: ["managed-orchestration:result-handoff"],
        workItemExecutionFailInputTemplate: {
          goalRunId: "goal-final",
          workItemId: "work-final",
          attemptId: "goal-final:work-final:attempt:1",
          failureReason: "timed_out",
          summary: "Managed child failed before recording an intermediate execution phase. If the parent completes this evidence locally, it must record the phase before replying or starting the next phase.",
        },
    });
    expect(output).toMatchObject({
      status: "timed_out",
      recovery: {
        nextTool: "work_item.execution.fail",
        goalRunId: "goal-final",
        workItemId: "work-final",
        evidenceToRecord: ["managed-orchestration:result-handoff"],
        workItemExecutionFailInputTemplate: {
          goalRunId: "goal-final",
          workItemId: "work-final",
          attemptId: "goal-final:work-final:attempt:1",
          failureReason: "timed_out",
        },
      },
    });
    expect(output.recovery?.workItemExecutionFailInputTemplate).not.toHaveProperty("providedEvidence");
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

  it("returns a final phase finish template with raw managed invocation handoff", async () => {
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
      attemptId: "goal-final:work-final:attempt:1",
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
        readonly workItemExecutionFinishInputTemplate?: {
          readonly goalRunId?: string;
          readonly workItemId?: string;
          readonly attemptId?: string;
          readonly providedEvidence?: readonly string[];
          readonly managedInvocationResultHandoff?: {
            readonly summary?: string;
            readonly resourceUris?: readonly string[];
            readonly orchestrationId?: string;
            readonly childId?: string;
            readonly completedAt?: string;
          };
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(output.phaseCompletion).toMatchObject({
        nextTool: "work_item.execution.finish",
        goalRunId: "goal-final",
        workItemId: "work-final",
        evidenceToRecord: ["managed-orchestration:result-handoff"],
        requiredToolNames: ["read"],
        workItemExecutionFinishInputTemplate: {
        goalRunId: "goal-final",
        workItemId: "work-final",
        attemptId: "goal-final:work-final:attempt:1",
        providedEvidence: ["managed-orchestration:result-handoff"],
        managedInvocationResultHandoff: {
          summary: phaseSummary,
          resourceUris: [expect.stringContaining("kiln://managed-invocations/")],
        },
      },
    });
    expect(
      output.phaseCompletion?.workItemExecutionFinishInputTemplate?.managedInvocationResultHandoff?.orchestrationId,
    ).toBeUndefined();
    expect(
      output.phaseCompletion?.workItemExecutionFinishInputTemplate?.managedInvocationResultHandoff?.childId,
    ).toBeUndefined();
    expect(
      output.phaseCompletion?.workItemExecutionFinishInputTemplate?.managedInvocationResultHandoff?.completedAt,
    ).toBeUndefined();
    expect(result.metadata.managedInvocationPhaseCompletion).toMatchObject({
      status: "phase_completed_by_child",
      nextTool: "work_item.execution.finish",
      workItemId: "work-final",
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

  it("projects unavailable managed route status for failure-reason recovery mapping", async () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [],
        unavailableRoutes: [{
          routeId: "openrouter-readonly",
          providerId: "openrouter",
          model: "openrouter/free",
          profiles: ["foundation-readonly-plan"],
          reason: "Direct provider route is not eligible.",
        }],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-unavailable-status",
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
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("unavailable");
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
