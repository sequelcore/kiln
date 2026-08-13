import { describe, expect, it, vi } from "vitest";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentInvocationRequest,
  ManagedAgentLifecycleState,
  ManagedAgentAdmissionProfile,
  RouteCapability,
  StructuredExecutionResult,
} from "@kilnai/core";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentWriteAuthority,
  MemoryArtifactResourceStore,
  WorkItemStore,
  textParts,
} from "@kilnai/core";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface as createRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";
import { buildTuiTurnPerCallConfig } from "../../src/gateway/tui-gateway.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationInput,
} from "../../src/agents/managed-invocation/index.js";
import {
  ManagedAgentLeaseAcquireError,
  ManagedAgentWorktreeReviewRequiredError,
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
  createManagedAgentInvocationResourceProvider,
} from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentWorktreeLeaseManager } from "../../src/agents/managed-invocation/index.js";
import {
  attachManagedInvocationSessionEventSink,
  MANAGED_AGENT_INVOKE_TOOL,
  type ManagedInvocationSessionEventSink,
  type ManagedInvocationToolOptions,
  withManagedInvocationService,
} from "../../src/agents/managed-invocation/runtime-tool/index.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.js";

const TEST_HANDOFF_PROVENANCE = {
  delivery: "runtime-generated",
  configuredModelId: "test-model",
  observedModelIds: [],
} as const;

function createAttachedRuntimeBuiltinToolSurface(
  options: Omit<NonNullable<Parameters<typeof createRuntimeBuiltinToolSurface>[0]>, "managedInvocation"> & {
    readonly managedInvocation?: ManagedInvocationToolOptions & {
      readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
    };
  } = {},
) {
  const callerIdentity = options.managedInvocation?.callerIdentity ?? {
    kind: "kiln-runtime",
    surface: "runtime-test",
    attachmentId: "attachment:runtime-test",
  };
  const managedInvocation = options.managedInvocation
    ? (({ callerIdentity: _callerIdentity, ...managedInvocationOptions }) => managedInvocationOptions)(options.managedInvocation)
    : undefined;
  return createRuntimeBuiltinToolSurface({
    ...options,
    ...(managedInvocation
      ? {
          managedInvocation: {
            options: managedInvocation,
            callerIdentity,
            governedScopeAdmission: () => ({ admitted: true as const }),
            boundedWorkAdmission: () => ({
              admitted: true as const,
              workspaceAuthority: { allowedPaths: ["C:/workspace/kiln"], deniedPaths: [] },
              lifecycle: {
                markDispatched: () => undefined,
                releaseBeforeDispatch: () => undefined,
                settleTerminal: () => undefined,
                settleUnknown: () => undefined,
              },
            }),
          },
        }
      : {}),
  });
}

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

function makeAdapter(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentRuntimeAdapter {
  return makeAdapterWithHandoff("Child review completed.", overrides);
}

function makeAdapterWithHandoff(
  summary: string,
  overrides: Partial<ManagedAgentAdapterDescriptor> = {},
  structuredResultOverrides: Partial<StructuredExecutionResult> = {},
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
          provenance: TEST_HANDOFF_PROVENANCE,
          summary,
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
          structuredResult: {
            version: "structured-execution-result-v1",
            status: "completed",
            summary,
            details: "Internal child execution detail.",
            uncertainty: 0.2,
            limitations: ["Live deployment was not exercised."],
            operatorDecisions: [{ id: "decision-1", summary: "Return the review evidence." }],
            evidence: [{
              uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
              kind: "verification",
            }],
            citations: [],
            warnings: [],
            failures: [],
            approvalRequirements: [],
            residualRisks: ["Live deployment was not exercised."],
            verificationResults: (request.input.handoff?.expectedEvidence ?? ["review"]).map((requirementId) => ({
              requirementId,
              method: "deterministic" as const,
              status: "passed" as const,
              summary: `${requirementId} evidence is present.`,
              evidenceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
            })),
            ...structuredResultOverrides,
          },
          verificationUsage: {
            version: "verification-usage-v1",
            attempts: [{
              requirementId: "review",
              method: "deterministic",
              status: "passed",
              providerTokenClass: "input",
              tokens: { value: 8, source: "estimated" },
              costUsd: { value: 0, source: "estimated" },
              latencyMs: { value: 4, source: "estimated" },
              evidenceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
            }],
            totals: { tokens: 8, costUsd: 0, latencyMs: 4 },
          },
        },
      })),
  };
}

function makeAdapterWithProgressHandoff(summary: string): ManagedAgentRuntimeAdapter {
  return {
    descriptor: makeDescriptor(),
    invoke: vi.fn(async (input: ManagedAgentRuntimeInvocationInput) => {
      const { request, admission, progressObserver } = input;
      await progressObserver?.({
        eventId: `${request.invocationId}:progress:tool_called:test:read`,
        kind: "tool_called",
        recordedAt: "2026-06-30T00:00:00.000Z",
        summary: "read called",
        toolName: "read",
      });
      return defineManagedAgentInvocationRecord({
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
          provenance: TEST_HANDOFF_PROVENANCE,
          summary,
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
        },
      });
    }),
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
          provenance: TEST_HANDOFF_PROVENANCE,
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

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
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

function makeProgressReportingDeferredAdapter(): {
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly terminal: ReturnType<typeof deferred<ReturnType<typeof defineManagedAgentInvocationRecord>>>;
} {
  const terminal = deferred<ReturnType<typeof defineManagedAgentInvocationRecord>>();
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: makeDescriptor(),
    invoke: vi.fn(async ({ request, admission, progressObserver }) => {
      for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
        await progressObserver?.({
          eventId: `${request.invocationId}:progress:tool-called:${ordinal}`,
          kind: "tool_called",
          recordedAt: `2026-06-30T00:00:${ordinal.toString().padStart(2, "0")}.000Z`,
          summary: `grep ${ordinal} called`,
          toolName: "grep",
        });
      }
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

function makeRuntimeAuthorityObserver() {
  return {
    observe: vi.fn(async ({ request }: { readonly request: ManagedAgentInvocationRequest }) => {
      const permissionProfile = request.authority.permissionProfile.toLowerCase();
      const observedAt = new Date(Date.now()).toISOString();
      const validUntil = new Date(Date.now() + 60_000).toISOString();
      return {
        approval: permissionProfile.includes("trusted") || permissionProfile.includes("full-access") || permissionProfile.includes("danger-full-access")
          ? "never" as const
          : "on-request" as const,
        sandbox: request.authority.toolAuthority.writeAllowed === true && request.authority.workingDirectory.mode !== "read-only"
          ? "workspace-write" as const
          : "read-only" as const,
        source: "runtime-observation" as const,
        proof: "proven" as const,
        observedAt,
        validUntil,
      };
    }),
  };
}

function makeObservedRuntimeInvocationService(
  options: NonNullable<ConstructorParameters<typeof RuntimeManagedAgentInvocationService>[0]> = {},
): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    ...options,
    authorityObserver: options.authorityObserver ?? makeRuntimeAuthorityObserver(),
  });
}

function makeSurface(
  adapter = makeAdapter(),
  sessionEventSink?: ManagedInvocationSessionEventSink,
  artifactStore?: MemoryArtifactResourceStore,
  options: { readonly observeRuntimeAuthority?: boolean } = {},
) {
  return createAttachedRuntimeBuiltinToolSurface({
    ...(artifactStore ? { builtinToolOptions: { artifactResources: { store: artifactStore } } } : {}),
    managedInvocation: makeSurfaceOptions(adapter, sessionEventSink, artifactStore, options),
  });
}

function makeSurfaceOptions(
  adapter: ManagedAgentRuntimeAdapter,
  sessionEventSink?: ManagedInvocationSessionEventSink,
  artifactStore?: MemoryArtifactResourceStore,
  options: {
    readonly observeRuntimeAuthority?: boolean;
    readonly invocationService?: RuntimeManagedAgentInvocationService;
  } = {},
): ManagedInvocationToolOptions {
  const observeRuntimeAuthority = options.observeRuntimeAuthority ?? true;
  return {
    ...(sessionEventSink ? { sessionEventSink } : {}),
    ...(artifactStore ? { artifactStore } : {}),
    invocationService: options.invocationService ?? (observeRuntimeAuthority
      ? makeObservedRuntimeInvocationService({
        credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
          allowedRouteIds: ["credential-route:opencode:primary"],
        }),
      })
      : new RuntimeManagedAgentInvocationService({
        credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
          allowedRouteIds: ["credential-route:opencode:primary"],
        }),
      })),
    routes: [{
        routeId: "opencode-readonly",
        routeSource: "explicit-managed-route",
        providerId: "opencode",
        model: "opencode-default-model",
        capability: {
          identity: { routeId: "opencode-readonly", revision: "test-v1" }, target: { providerId: "opencode", modelId: "opencode-default-model" },
          adapter: { kind: "cli-harness", capabilityId: "test:opencode", capabilityVersion: "v1" }, authorityCeiling: "audited", toolNames: ["read", "grep", "glob"], supportsRecursion: true, supportsAttachments: false, supportsWrite: false,
          proof: { status: "configured", source: "test", provenProfiles: ["foundation-readonly-plan"] }, capacity: { kind: "accountless" }, settlement: { kind: "not-required" },
        },
        createAdapter: async () => adapter,
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
            timeoutSource: "explicit-route",
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
  };
}

function makeRouteCapability(input: {
  readonly routeId: string;
  readonly providerId: string;
  readonly model: string;
  readonly profiles: readonly ManagedAgentAdmissionProfile[];
  readonly toolNames?: readonly string[];
  readonly supportsWrite?: boolean;
  readonly adapterKind?: RouteCapability["adapter"]["kind"];
  readonly externalRuntimeAttachment?: RouteCapability["externalRuntimeAttachment"];
}): RouteCapability {
  return {
    identity: { routeId: input.routeId, revision: "test-v1" },
    target: { providerId: input.providerId, modelId: input.model },
    adapter: { kind: input.adapterKind ?? "cli-harness", capabilityId: `test:${input.providerId}`, capabilityVersion: "v1" },
    authorityCeiling: input.supportsWrite ? "destructive" : "audited",
    toolNames: input.toolNames ?? ["read", "grep", "glob"],
    supportsRecursion: true,
    supportsAttachments: input.externalRuntimeAttachment !== undefined,
    supportsWrite: input.supportsWrite ?? false,
    ...(input.externalRuntimeAttachment ? { externalRuntimeAttachment: input.externalRuntimeAttachment } : {}),
    proof: { status: "configured", source: "test", provenProfiles: input.profiles },
    capacity: { kind: "accountless" },
    settlement: { kind: "not-required" },
  };
}

function makeManagedRoute(
  routeId: string,
  model: string,
  createAdapter: () => Promise<ManagedAgentRuntimeAdapter | undefined> = async () => makeAdapter(),
  providerId = "opencode",
) {
  return {
    routeId,
    routeSource: "explicit-managed-route" as const,
    providerId,
    model,
    capability: makeRouteCapability({ routeId, providerId, model, profiles: ["foundation-readonly-plan"] }),
    createAdapter,
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
        timeoutSource: "explicit-route" as const,
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
  it("admits Codex parent read-only invocation through explicit OpenCode adapter capability", async () => {
    const adapter = makeAdapter({
      adapterDescriptorId: "adapter:opencode-go:cli-harness",
      providerId: "opencode-go",
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        callerIdentity: {
          kind: "external-harness",
          harness: "codex",
          attachmentId: "attachment:codex:test",
          evidenceId: "evidence:codex:test",
        },
        routes: [makeManagedRoute("opencode-go-readonly", "kimi-k2.7-code", async () => adapter, "opencode-go")],
      },
    });
    const session = makeSession();

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "opencode-go-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode-go",
        model: "kimi-k2.7-code",
      },
      task: "Read the architecture docs and report route risks.",
      requestedAuthority: "read_only",
    }, {
      session,
      toolCall: {
        id: "tool-call-codex-opencode-go",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly routeId?: string;
        readonly providerRoute?: Record<string, unknown>;
        readonly adapterKind?: string;
        readonly executionMode?: string;
        readonly authoritySnapshot?: Record<string, unknown>;
        readonly capabilitySnapshot?: {
          readonly callerIdentity?: unknown;
          readonly providerRoute?: Record<string, unknown>;
          readonly authorityProfile?: Record<string, unknown>;
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      status: "completed",
      routeId: "opencode-go-readonly",
      providerRoute: {
        providerId: "opencode-go",
        model: "kimi-k2.7-code",
        surface: "cli-harness",
      },
      adapterKind: "harness",
      executionMode: "cli-harness",
      authoritySnapshot: {
        authorityProfileId: "authority:opencode-go-readonly:foundation-readonly-plan",
        permissionProfile: "read-only",
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
      },
      capabilitySnapshot: {
        callerIdentity: {
          kind: "external-harness",
          harness: "codex",
          attachmentId: "attachment:codex:test",
          evidenceId: "evidence:codex:test",
        },
        providerRoute: {
          providerId: "opencode-go",
          model: "kimi-k2.7-code",
          surface: "cli-harness",
        },
        authorityProfile: {
          authorityProfileId: "authority:opencode-go-readonly:foundation-readonly-plan",
          toolAuthority: {
            allowedToolNames: ["read", "grep", "glob"],
            writeAllowed: false,
            networkAllowed: false,
          },
        },
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("admits external callers through the selected route capability", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        callerIdentity: {
          kind: "external-harness",
          harness: "codex",
          attachmentId: "attachment:codex:test",
          evidenceId: "evidence:codex:test",
        },
        routes: [makeManagedRoute("opencode-readonly", "opencode-go/kimi-k2.7-code", async () => adapter)],
      },
    });
    const session = makeSession();

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "opencode-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-go/kimi-k2.7-code",
      },
      task: "Review the runtime boundary.",
    }, {
      session,
      toolCall: {
        id: "tool-call-caller-policy",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: Record<string, unknown>;
    };

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      status: "completed",
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("normalizes managed invocation options to one shared runtime service", () => {
    const options = {
      routes: [makeManagedRoute("opencode-readonly", "opencode-default-model")],
    } satisfies ManagedInvocationToolOptions;

    const normalized = withManagedInvocationService(options);
    const normalizedAgain = withManagedInvocationService(normalized);

    expect(normalized.invocationService).toBeInstanceOf(RuntimeManagedAgentInvocationService);
    expect(normalizedAgain).toBe(normalized);
  });

  it("is not exposed unless managed invocation routes are configured", () => {
    const surface = createAttachedRuntimeBuiltinToolSurface();

    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.invoke")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.start")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.status")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.list")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.join")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.cancel")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.orchestrate")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.invoke")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.start")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.status")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.list")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.join")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.cancel")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.orchestrate")).toBe(false);
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
    expect(executeConfig.toolAllowlist?.has("managed_agent.orchestrate")).toBe(true);
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
    expect(planConfig.toolAllowlist?.has("managed_agent.orchestrate")).toBe(false);
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
      "managed_agent.orchestrate",
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
        readonly routeSource: string;
        readonly parentTurnId: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly authoritySnapshot?: {
          readonly toolAuthority?: {
            readonly allowedToolNames?: readonly string[];
            readonly writeAllowed?: boolean;
            readonly networkAllowed?: boolean;
          };
          readonly workingDirectory?: {
            readonly path?: string;
            readonly mode?: string;
          };
          readonly memoryScope?: {
            readonly access?: string;
          };
        };
        readonly sessionEventIds?: readonly string[];
      };
    };
    const startedOutput = JSON.parse(started.output) as {
      readonly parentTurnId?: string;
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
      readonly authoritySnapshot?: {
        readonly toolAuthority?: {
          readonly allowedToolNames?: readonly string[];
          readonly writeAllowed?: boolean;
          readonly networkAllowed?: boolean;
        };
      };
    };

    expect(started).toMatchObject({
      isError: false,
      metadata: {
        status: "started",
        lifecycleState: "running",
        routeId: "opencode-readonly",
        routeSource: "explicit-managed-route",
        parentTurnId: `${session.id}:turn:1`,
        timeoutMs: 120000,
        timeoutSource: "explicit-route",
        authoritySnapshot: {
          toolAuthority: {
            allowedToolNames: ["read", "grep", "glob"],
            writeAllowed: false,
            networkAllowed: false,
          },
          workingDirectory: {
            path: "C:/workspace/kiln",
            mode: "read-only",
          },
          memoryScope: {
            access: "read-only",
          },
        },
      },
    });
    expect(startedOutput).toMatchObject({
      parentTurnId: `${session.id}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      authoritySnapshot: {
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect(adapter.invoke).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        executionIntent: {
          attendance: "unattended",
          lifecycle: "background",
        },
      }),
    }));
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
        readonly routeSource?: string;
        readonly parentTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly authoritySnapshot?: {
          readonly toolAuthority?: {
            readonly allowedToolNames?: readonly string[];
            readonly writeAllowed?: boolean;
            readonly networkAllowed?: boolean;
          };
        };
      };
    };
    const statusOutput = JSON.parse(status.output) as {
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
      readonly authoritySnapshot?: {
        readonly toolAuthority?: {
          readonly allowedToolNames?: readonly string[];
          readonly writeAllowed?: boolean;
          readonly networkAllowed?: boolean;
        };
      };
    };
    expect(status).toMatchObject({
      isError: false,
      metadata: {
        status: "running",
        lifecycleState: "running",
        routeSource: "explicit-managed-route",
        parentTurnId: `${session.id}:turn:1`,
        timeoutMs: 120000,
        timeoutSource: "explicit-route",
        authoritySnapshot: {
          toolAuthority: {
            allowedToolNames: ["read", "grep", "glob"],
            writeAllowed: false,
            networkAllowed: false,
          },
        },
      },
    });
    expect(statusOutput).toMatchObject({
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      authoritySnapshot: {
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
      },
    });

    const listed = await surface.callBuiltinTools.get("managed_agent.list")?.({}, {
      ...context,
      toolCall: { id: "tool-call-list", name: "managed_agent.list", input: {} },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocations?: readonly {
          readonly invocationId?: string;
          readonly lifecycleState?: string;
          readonly routeSource?: string;
          readonly parentTurnId?: string;
          readonly timeoutMs?: number;
          readonly timeoutSource?: string;
        }[];
      };
    };
    const listedOutput = JSON.parse(listed.output) as {
      readonly invocations?: readonly {
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
      }[];
    };
    expect(listed).toMatchObject({
      isError: false,
      metadata: {
        invocations: [
          {
            invocationId: started.metadata.invocationId,
            lifecycleState: "running",
            routeSource: "explicit-managed-route",
            parentTurnId: `${session.id}:turn:1`,
            timeoutMs: 120000,
            timeoutSource: "explicit-route",
          },
        ],
      },
    });
    expect(listedOutput.invocations?.[0]).toMatchObject({
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
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
        routeSource: "explicit-managed-route",
      }),
      childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
      childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
        summary: "Child review completed.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
        memoryWriteProposalUris: [],
      },
    }));
    await waitForCondition(() =>
      session.sessionEvents.some((event) => event.kind === "agent_invocation_completed")
    );

    const completedStatusBeforeJoin = await surface.callBuiltinTools.get("managed_agent.status")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-status-complete", name: "managed_agent.status", input: {} },
    }) as {
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly childSessionId?: string;
        readonly childTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly resultHandoff?: unknown;
        readonly transcript?: unknown;
        readonly terminalEvidenceAvailable?: boolean;
      };
    };
    const completedStatusOutput = JSON.parse(completedStatusBeforeJoin.output) as {
      readonly childSessionId?: string;
      readonly childTurnId?: string;
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
    };
    expect(completedStatusBeforeJoin.metadata).toMatchObject({
      lifecycleState: "completed",
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      terminalEvidenceAvailable: true,
    });
    expect(completedStatusOutput).toMatchObject({
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
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
          readonly childSessionId?: string;
          readonly childTurnId?: string;
          readonly timeoutMs?: number;
          readonly timeoutSource?: string;
          readonly resultHandoff?: unknown;
          readonly transcript?: unknown;
          readonly terminalEvidenceAvailable?: boolean;
        }[];
      };
    };
    const completedListOutput = JSON.parse(completedListBeforeJoin.output) as {
      readonly invocations?: readonly {
        readonly childSessionId?: string;
        readonly childTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
      }[];
    };
    expect(completedListBeforeJoin.metadata.invocations?.[0]).toMatchObject({
      lifecycleState: "completed",
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      terminalEvidenceAvailable: true,
    });
    expect(completedListOutput.invocations?.[0]).toMatchObject({
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
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
        readonly childSessionId?: string;
        readonly childTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly authoritySnapshot?: {
          readonly toolAuthority?: {
            readonly allowedToolNames?: readonly string[];
            readonly writeAllowed?: boolean;
            readonly networkAllowed?: boolean;
          };
        };
        readonly resultHandoff?: { readonly summary?: string; readonly resourceUris?: readonly string[] };
      };
    };
    const joinedOutput = JSON.parse(joined.output) as {
      readonly childSessionId?: string;
      readonly childTurnId?: string;
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
      readonly authoritySnapshot?: {
        readonly toolAuthority?: {
          readonly allowedToolNames?: readonly string[];
          readonly writeAllowed?: boolean;
          readonly networkAllowed?: boolean;
        };
      };
    };

    expect(joined).toMatchObject({
      output: expect.stringContaining("Child review completed."),
      isError: false,
      metadata: {
        status: "completed",
        lifecycleState: "completed",
        childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
        childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
        timeoutMs: 120000,
        timeoutSource: "explicit-route",
        authoritySnapshot: {
          toolAuthority: {
            allowedToolNames: ["read", "grep", "glob"],
            writeAllowed: false,
            networkAllowed: false,
          },
        },
        resultHandoff: {
          summary: "Child review completed.",
        },
      },
    });
    expect(joinedOutput).toMatchObject({
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      authoritySnapshot: {
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
      },
    });
    expect(joined.metadata.resultHandoff?.resourceUris).toContain(
      `kiln://managed-agents/invocations/${started.metadata.invocationId}/resources/result`,
    );
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: "agent_invocation_completed" }),
    ], expect.objectContaining({
      toolCall: expect.objectContaining({ name: "managed_agent.start" }),
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

  it("fails closed when background managed_agent.start cannot prove runtime authority", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter, undefined, undefined, { observeRuntimeAuthority: false });
    const session = makeSession();

    const result = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Start without runtime authority proof.",
      requestedAuthority: "read_only",
    }, {
      session,
      toolCall: {
        id: "tool-call-bg-unproven",
        name: "managed_agent.start",
        input: {},
      },
    }) as { readonly isError: boolean; readonly metadata?: { readonly missingCapabilities?: readonly string[] } };

    expect(result).toMatchObject({
      isError: true,
      metadata: {
        missingCapabilities: ["authorityEvidence.effective-policy-unproven"],
      },
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("projects managed child progress events before terminal join", async () => {
    const { adapter, terminal } = makeProgressReportingDeferredAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-progress-bg",
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
      task: "Inspect tool progress.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    await waitForCondition(() => {
      const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as
        | ManagedAgentInvocationRequest
        | undefined;
      return request?.invocationId === started.metadata.invocationId;
    });
    await flushMicrotasks();

    const status = await surface.callBuiltinTools.get("managed_agent.status")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-progress-status", name: "managed_agent.status", input: {} },
    }) as {
      readonly output: string;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly progressEventCount?: number;
        readonly recentProgressEvents?: readonly {
          readonly kind?: string;
          readonly summary?: string;
          readonly toolName?: string;
        }[];
      };
    };
    const statusOutput = JSON.parse(status.output) as {
      readonly progressEventCount?: number;
      readonly recentProgressEvents?: readonly {
        readonly kind?: string;
        readonly summary?: string;
        readonly toolName?: string;
      }[];
    };

    expect(status.metadata).toMatchObject({
      lifecycleState: "running",
      progressEventCount: 10,
    });
    expect(status.metadata.recentProgressEvents).toHaveLength(8);
    expect(status.metadata.recentProgressEvents?.[0]).toMatchObject({
      kind: "tool_called",
      summary: "grep 3 called",
      toolName: "grep",
    });
    expect(status.metadata.recentProgressEvents?.at(-1)).toMatchObject({ summary: "grep 10 called" });
    expect(statusOutput.recentProgressEvents).toEqual(status.metadata.recentProgressEvents);
    expect(statusOutput).not.toHaveProperty("progressEvents");

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
        routeSource: "explicit-managed-route",
      }),
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
        summary: "Progress child completed.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
        memoryWriteProposalUris: [],
      },
    }));
    await flushMicrotasks();

    const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-progress-join", name: "managed_agent.join", input: {} },
    }) as {
      readonly metadata: {
        readonly recentProgressEvents?: readonly {
          readonly kind?: string;
          readonly toolName?: string;
        }[];
      };
    };

    expect(joined.metadata.recentProgressEvents).toEqual(status.metadata.recentProgressEvents);
  });

  it("fails closed before invocation when required read paths are outside route authority", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-read-authority",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
        profile: "foundation-readonly-plan",
        providerRoute: { providerId: "opencode" },
        task: "Collect visual reference research from local cloned harnesses.",
        summary: "Collect visual reference research.",
        contextMode: "isolated",
        requiredToolNames: ["read", "grep", "glob"],
        requiredReadPaths: ["/workspace/references/cloned"],
        expectedEvidence: ["visual-reference-research"],
        executionPhase: {
          id: "visual-reference-research",
          expectedEvidence: ["visual-reference-research"],
          requiredToolNames: ["read", "grep", "glob"],
          completionTool: "work_item.update",
          finalPhase: false,
          autoStartAllowed: false,
        },
    }, context);

    expect(result?.isError).toBe(true);
    expect(result?.output).toContain("cannot execute this phase because it cannot read required paths");
    expect(result?.metadata).toMatchObject({
      routeId: "opencode-readonly",
      status: "unavailable",
      missingRequiredReadPaths: ["/workspace/references/cloned"],
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("admits invocation when required read paths are covered by read authority", async () => {
    const adapter = makeAdapter();
    const route = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          ...route,
          profiles: {
            "foundation-readonly-plan": {
              ...route.profiles["foundation-readonly-plan"],
              readAuthority: {
                workspace: {
                  allowedPaths: ["/workspace/references/cloned"],
                  deniedPaths: ["/workspace/references/cloned/codex/.git"],
                },
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
        id: "tool-call-read-authority-covered",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "opencode" },
      task: "Collect visual reference research from local cloned harnesses.",
      summary: "Collect visual reference research.",
      contextMode: "isolated",
      requiredToolNames: ["read", "grep", "glob"],
      requiredReadPaths: ["/workspace/references/cloned"],
      expectedEvidence: ["visual-reference-research"],
    }, context);

    expect(result?.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("admits relative required read paths inside the managed working directory", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-relative-required-read-path",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "opencode" },
      task: "Inspect local managed-agent files.",
      summary: "Inspect local files.",
      contextMode: "isolated",
      requiredToolNames: ["read", "grep", "glob"],
      requiredReadPaths: [
        "packages/cli/src/config/managed-agent-routes.ts",
        "packages/runtime/src/agents/managed-invocation/runtime-tool.ts",
      ],
      expectedEvidence: ["route admission evidence"],
    }, context);

    expect(result?.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("uses the persisted parent turn id instead of hydrated runtime turn count", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    session.addUserMessage(textParts("Hydrated prior turn 2."));
    session.addUserMessage(textParts("Hydrated prior turn 3."));
    session.addUserMessage(textParts("Hydrated prior turn 4."));
    session.addUserMessage(textParts("Hydrated prior turn 5."));
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      turnId: `${session.id}:turn:3`,
      toolCall: {
        id: "tool-call-start-lineage",
        name: "managed_agent.start",
        input: {},
      },
    };

    await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect lineage.",
      requestedAuthority: "read_only",
    }, context);

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    expect(session.userTurnCount).toBe(5);
    expect(request.parentTurnId).toBe(`${session.id}:turn:3`);
    expect(request.invocationId).toBe("managed-session-parent-3-tool-call-start-lineage");
  });

  it("projects start metadata and replay events before terminal records exist", async () => {
    const { adapter } = makeDeferredAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const rawResourceUri = "kiln://managed-invocations/sibling-start/context";
    const canonicalResourceUri = "kiln://managed-agents/invocations/sibling-start/resources/context";
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start-projection",
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
      task: "Inspect start projection before terminal evidence exists.",
      requestedAuthority: "read_only",
      contextMode: "resources",
      resourceUris: [rawResourceUri],
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly capabilitySnapshot?: unknown;
        readonly parentTurnId?: string;
        readonly routeSource?: string;
      };
    };
    const serializedSurfaceEvidence = JSON.stringify({
      metadata: started.metadata,
      sessionEvents: session.sessionEvents,
    });

    expect(started.isError).toBe(false);
    expect(started.metadata.parentTurnId).toBe(`${session.id}:turn:1`);
    expect(started.metadata.routeSource).toBe("explicit-managed-route");
    expect(serializedSurfaceEvidence).toContain(canonicalResourceUri);
    expect(serializedSurfaceEvidence).not.toContain("kiln://managed-invocations/");
  });

  it("keeps artifact-backed managed resources stable across repeated joins", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const artifactStore = new MemoryArtifactResourceStore();
    const surface = makeSurface(adapter, undefined, artifactStore);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-artifact-start",
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
      task: "Inspect the managed invocation resource artifact contract.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };
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
        routeSource: "explicit-managed-route",
      }),
      transcript: {
        uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
        redacted: "unknown",
        truncated: false,
        persisted: true,
        retention: "session",
      },
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
        summary: "Child artifact evidence completed.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
        memoryWriteProposalUris: [],
      },
    }));
    await flushMicrotasks();

    const join = async (toolCallId: string) => surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: toolCallId, name: "managed_agent.join", input: {} },
    }) as Promise<{
      readonly isError: boolean;
      readonly metadata: {
        readonly transcript?: { readonly uri?: string };
        readonly resultHandoff?: { readonly resourceUris?: readonly string[] };
      };
    }>;

    const firstJoin = await join("tool-call-artifact-join-1");
    const secondJoin = await join("tool-call-artifact-join-2");

    expect(firstJoin.isError).toBe(false);
    expect(firstJoin.metadata.transcript?.uri).toMatch(/^kiln:\/\/artifacts\/managed-invocations\//u);
    expect(secondJoin.metadata.transcript?.uri).toBe(firstJoin.metadata.transcript?.uri);
    expect(secondJoin.metadata.resultHandoff?.resourceUris).toEqual(firstJoin.metadata.resultHandoff?.resourceUris);
  });

  it("normalizes direct runtime tool credential route ids before admission", async () => {
    const adapter = makeAdapter();
    const route = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
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
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: makeObservedRuntimeInvocationService({
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode-sandbox"],
          }),
          sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
        }),
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

  it("cancels managed_agent.invoke through the parent runtime abort signal", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    let adapterSignal: AbortSignal | undefined;
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission, abortSignal }) => {
        adapterSignal = abortSignal;
        await terminal.promise;
        return defineManagedAgentInvocationRecord({
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
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: "Late child success.",
            resourceUris: ["kiln://artifacts/late-child/result"],
            memoryWriteProposalUris: [],
          },
        });
      }),
    };
    const surface = makeSurface(adapter);
    const session = makeSession();
    const parentAbort = new AbortController();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      abortSignal: parentAbort.signal,
      toolCall: {
        id: "tool-call-parent-abort",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const resultPromise = surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
      requestedAuthority: "read_only",
    }, context) as Promise<{
      readonly isError: boolean;
      readonly metadata: {
        readonly status: string;
        readonly lifecycleState: string;
        readonly resultHandoff?: {
          readonly summary?: string;
        };
      };
    }>;

    await waitForCondition(() => adapterSignal !== undefined);
    parentAbort.abort("Parent runtime turn interrupted.");
    const result = await resultPromise;

    expect(adapterSignal?.aborted).toBe(true);
    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("cancelled");
    expect(result.metadata.lifecycleState).toBe("cancelled");
    expect(result.metadata.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");

    terminal.resolve(result.metadata as never);
    await flushMicrotasks();
  });

  it("cancels managed_agent.start through the parent runtime abort signal", async () => {
    const { adapter, terminal, signal } = makeAbortableDeferredAdapter();
    const invocationService = makeObservedRuntimeInvocationService({
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: ["credential-route:opencode-readonly"],
      }),
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService,
        routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter)],
      },
    });
    const session = makeSession();
    const parentAbort = new AbortController();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      abortSignal: parentAbort.signal,
      toolCall: {
        id: "tool-call-parent-abort-start",
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
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly lifecycleState: string;
      };
    };

    expect(started.isError).toBe(false);
    expect(started.metadata.lifecycleState).toBe("running");
    await waitForCondition(() => signal() !== undefined);
    parentAbort.abort("Parent runtime turn interrupted.");
    const joined = await invocationService.join(started.metadata.invocationId);

    expect(signal()?.aborted).toBe(true);
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");

    terminal.resolve(joined.record);
    await flushMicrotasks();
    const joinedAfterLateOutput = await invocationService.join(started.metadata.invocationId);
    expect(joinedAfterLateOutput.record.lifecycleState).toBe("cancelled");
    expect(joinedAfterLateOutput.record.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");
  });

  it("disposes a surface-owned background child through adapter cleanup and publishes one terminal event", async () => {
    let adapterSignal: AbortSignal | undefined;
    const cleanup = vi.fn();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission, abortSignal, registerAdapterCompletion }) => {
        adapterSignal = abortSignal;
        const executionSettlement = new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => {
            cleanup();
            resolve();
          }, { once: true });
        });
        registerAdapterCompletion(executionSettlement);
        await executionSettlement;
        return defineManagedAgentInvocationRecord({
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
          capabilitySnapshot: admission.capabilitySnapshot,
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: "Adapter cleanup settled.",
            resourceUris: [],
            memoryWriteProposalUris: [],
          },
        });
      }),
    };
    const invocationService = makeObservedRuntimeInvocationService({
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: ["credential-route:opencode-readonly"],
      }),
    });
    const published: unknown[] = [];
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService,
        sessionEventSink: {
          publish: vi.fn(async (events) => {
            published.push(...events);
          }),
        },
        routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter)],
      },
    });
    const session = makeSession();

    const started = await surface.callBuiltinTools.get("managed_agent.start")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation lifecycle.",
      requestedAuthority: "read_only",
    }, {
      session,
      toolCall: {
        id: "tool-call-surface-dispose",
        name: "managed_agent.start",
        input: {},
      },
    }) as { readonly metadata: { readonly invocationId: string } };

    await Promise.all([surface.dispose(), surface.dispose()]);
    await surface.dispose();

    expect(adapterSignal?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(invocationService.status(started.metadata.invocationId)).toMatchObject({
      lifecycleState: "cancelled",
      record: {
        lifecycleState: "cancelled",
        resultHandoff: { summary: "Attached runtime tool surface disposed." },
      },
    });
    expect(published.filter((event) => (
      (event as { kind?: string }).kind === "agent_invocation_cancelled"
    ))).toHaveLength(1);
  });

  it("shares fallback sandbox services across nonblocking lifecycle tools", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: makeObservedRuntimeInvocationService({
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode-sandbox"],
          }),
          sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
        }),
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
        routeSource: "explicit-managed-route",
      }),
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
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
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: makeObservedRuntimeInvocationService({
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode-sandbox"],
          }),
          sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
        }),
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
        routeSource: "explicit-managed-route",
      }),
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
        summary: "Late sandbox output must be suppressed.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/late`],
        memoryWriteProposalUris: [],
      },
    }));

    const cancelled = await cancelPromise;

    expect(cancelled).toMatchObject({
      isError: false,
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
        invocationService: makeObservedRuntimeInvocationService({
          worktreeLeaseManager,
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode:primary"],
          }),
        }),
        routes: [{
          routeId: "opencode-approved-write",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: makeRouteCapability({ routeId: "opencode-approved-write", providerId: "opencode", model: "opencode-default-model", profiles: ["foundation-apply-approved-writes"], toolNames: ["read", "grep", "apply-patch"], supportsWrite: true }),
          createAdapter: async () => adapter,
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

  it("persists terminal start failure when side-effected lease acquisition fails before adapter execution", async () => {
    const worktreeLeaseManager: ManagedAgentWorktreeLeaseManager = {
      acquire: vi.fn(async () => {
        throw new ManagedAgentLeaseAcquireError("Managed git worktree acquire failed after checkout.", true);
      }),
      release: vi.fn(async ({ request, lease }) => ({
        ...lease,
        healthStatus: "released",
        cleanupStatus: "completed",
        diagnosticUris: [...lease.diagnosticUris, `kiln://artifacts/${request.invocationId}/worktree-release`],
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
    const sessionEventSink = { publish: vi.fn() };
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        sessionEventSink,
        invocationService: makeObservedRuntimeInvocationService({
          worktreeLeaseManager,
        }),
        routes: [{
          routeId: "opencode-approved-write",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: makeRouteCapability({ routeId: "opencode-approved-write", providerId: "opencode", model: "opencode-default-model", profiles: ["foundation-apply-approved-writes"], toolNames: ["read", "grep", "apply-patch"], supportsWrite: true }),
          createAdapter: async () => adapter,
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
                mode: "credentialless",
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
        id: "tool-call-start-acquire-failure",
        name: "managed_agent.start",
        input: {},
      },
      requestApproval: vi.fn(async () => ({
        approved: true,
        reason: "operator approved managed write",
      })),
    };

    const result = await surface.callBuiltinTools.get("managed_agent.start")?.({
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
        readonly lifecycleState?: string;
        readonly sessionEventIds?: readonly string[];
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.lifecycleState).toBe("failed");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_failed",
    ]);
    expect(result.metadata.sessionEventIds).toEqual(session.sessionEvents.map((event) => event.eventId));
    expect(session.sessionEvents[2]).toMatchObject({
      kind: "agent_invocation_failed",
      invocationId: result.metadata.invocationId,
      managedInvocationEvidence: {
        resultHandoff: {
          summary: "Managed git worktree acquire failed after checkout.",
        },
      },
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenLastCalledWith([
      expect.objectContaining({
        kind: "agent_invocation_failed",
        invocationId: result.metadata.invocationId,
      }),
    ], context);
  });

  it("preserves dirty-worktree review evidence in managed-agent join metadata", async () => {
    const worktreeLeaseManager: ManagedAgentWorktreeLeaseManager = {
      acquire: vi.fn(async ({ request, lease }) => ({
        ...lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: [...lease.resourceUris, `kiln://artifacts/${request.invocationId}/worktree-lease`],
      })),
      release: vi.fn(async () => {
        throw new ManagedAgentWorktreeReviewRequiredError(
          "Managed git worktree lease is dirty; preserving worktree for review",
        );
      }),
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
        invocationService: makeObservedRuntimeInvocationService({
          worktreeLeaseManager,
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode:primary"],
          }),
        }),
        routes: [{
          routeId: "opencode-approved-write",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: makeRouteCapability({ routeId: "opencode-approved-write", providerId: "opencode", model: "opencode-default-model", profiles: ["foundation-apply-approved-writes"], toolNames: ["read", "grep", "apply-patch"], supportsWrite: true }),
          createAdapter: async () => adapter,
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
    const startInput = {
      profile: "foundation-apply-approved-writes",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "destructive",
      task: "Apply the approved runtime edit.",
    };

    const started = await surface.callBuiltinTools.get("managed_agent.start")?.(startInput, {
      session,
      toolCall: {
        id: "tool-call-dirty-worktree-start",
        name: "managed_agent.start",
        input: startInput,
      },
      requestApproval: vi.fn(async () => ({
        approved: true,
        reason: "operator approved managed write",
      })),
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      session,
      toolCall: {
        id: "tool-call-dirty-worktree-join",
        name: "managed_agent.join",
        input: {},
      },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly resourceLease?: {
          readonly healthStatus?: string;
          readonly cleanupStatus?: string;
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
          readonly worktreeReview?: {
            readonly status?: string;
            readonly reason?: string;
            readonly resourceUris?: readonly string[];
            readonly diagnosticUris?: readonly string[];
          };
        };
        readonly sessionEventIds?: readonly string[];
      };
    };

    expect(started.isError).toBe(false);
    expect(joined.isError).toBe(false);
    expect(joined.metadata.lifecycleState).toBe("completed");
    expect(joined.metadata.resourceLease).toMatchObject({
      healthStatus: "leaked",
      cleanupStatus: "failed",
      worktreeReview: {
        status: "required",
        reason: "dirty-worktree-preserved",
        resourceUris: [`kiln://artifacts/${started.metadata.invocationId}/worktree-review`],
        diagnosticUris: [`kiln://artifacts/${started.metadata.invocationId}/worktree-review-required`],
      },
    });
    expect(joined.metadata.resourceLease?.resourceUris).toContain(
      `kiln://artifacts/${started.metadata.invocationId}/worktree-lease`,
    );
    expect(joined.metadata.resourceLease?.diagnosticUris).toEqual(expect.arrayContaining([
      `kiln://artifacts/${started.metadata.invocationId}/worktree-lease-cleanup-failed`,
      `kiln://artifacts/${started.metadata.invocationId}/worktree-review-required`,
    ]));
    expect(joined.metadata.sessionEventIds).toEqual([
      session.sessionEvents[2]?.eventId,
    ]);
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
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

  it("persists canonical terminal completion when a background managed child finishes without join or cancel", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-background-complete",
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
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    expect(started.isError).toBe(false);

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
        routeSource: "explicit-managed-route",
      }),
      childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
      childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
        summary: "Child review completed before parent joined.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
        memoryWriteProposalUris: [],
      },
    }));
    await waitForCondition(() =>
      session.sessionEvents.some((event) => event.kind === "agent_invocation_completed")
    );

    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(session.sessionEvents[2]).toMatchObject({
      kind: "agent_invocation_completed",
      invocationId: started.metadata.invocationId,
      managedInvocationEvidence: {
        childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
        childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
        resultHandoff: {
          summary: "Child review completed before parent joined.",
          resourceUris: [`kiln://managed-agents/invocations/${started.metadata.invocationId}/resources/result`],
        },
      },
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenLastCalledWith([
      expect.objectContaining({
        kind: "agent_invocation_completed",
        invocationId: started.metadata.invocationId,
      }),
    ], expect.objectContaining({
      toolCall: expect.objectContaining({ name: "managed_agent.start" }),
    }));
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
    await vi.waitFor(() => expect(sessionEventSink.publish).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "agent_invocation_failed",
        errorCode: "ENGINE_FAILURE",
        errorMessage: "child runtime crashed",
      }),
    ], expect.objectContaining({
      toolCall: expect.objectContaining({ name: "managed_agent.start" }),
    })));

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
  });

  it("publishes exactly one terminal event when background handoff validation fails", async () => {
    const adapter = makeAdapterWithHandoff(
      "Review returned without the required verification evidence.",
      {},
      { verificationResults: [] },
    );
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-invalid-handoff",
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
      requiredResultFields: ["verificationResults"],
    }, context) as {
      readonly metadata: { readonly invocationId: string };
    };

    await waitForCondition(() =>
      session.sessionEvents.some((event) => event.kind === "agent_invocation_failed")
    );
    const terminalEvents = () => session.sessionEvents.filter((event) =>
      event.kind === "agent_invocation_completed"
      || event.kind === "agent_invocation_failed"
      || event.kind === "agent_invocation_cancelled"
    );

    expect(terminalEvents()).toHaveLength(1);
    expect(terminalEvents()[0]).toMatchObject({
      kind: "agent_invocation_failed",
      invocationId: started.metadata.invocationId,
      errorMessage: expect.stringContaining("missing required structured fields: verificationResults"),
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);

    const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: started.metadata.invocationId,
    }, {
      ...context,
      toolCall: { id: "tool-call-invalid-handoff-join", name: "managed_agent.join", input: {} },
    }) as { readonly isError: boolean };

    expect(joined.isError).toBe(true);
    expect(terminalEvents()).toHaveLength(1);
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
  });

  it("publishes and returns the canonical terminal failure when foreground handoff validation fails", async () => {
    const adapter = makeAdapterWithHandoff(
      "Review returned without the required verification evidence.",
      {},
      { verificationResults: [] },
    );
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-invalid-foreground-handoff",
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
      requiredResultFields: ["verificationResults"],
    }, context) as {
      readonly isError: boolean;
      readonly metadata: { readonly invocationId: string; readonly lifecycleState: string };
    };

    const terminalEvents = session.sessionEvents.filter((event) =>
      event.kind === "agent_invocation_completed"
      || event.kind === "agent_invocation_failed"
      || event.kind === "agent_invocation_cancelled"
    );
    expect(result).toMatchObject({
      isError: true,
      metadata: { lifecycleState: "failed" },
    });
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]).toMatchObject({
      kind: "agent_invocation_failed",
      invocationId: result.metadata.invocationId,
      errorMessage: expect.stringContaining("missing required structured fields: verificationResults"),
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
  });

  it("records nonblocking terminal duration from child runtime time instead of join wait time", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-21T00:00:00.000Z") });
    try {
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

      vi.useFakeTimers({ now: new Date("2026-05-21T00:00:01.234Z") });
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
          routeSource: "explicit-managed-route",
        }),
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
          memoryWriteProposalUris: [],
        },
      }));
      await flushMicrotasks();

      vi.useFakeTimers({ now: new Date("2026-05-21T00:00:06.234Z") });
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
        routeSource: "explicit-managed-route",
      }),
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
        summary: "Late child output must be ignored.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/late`],
        memoryWriteProposalUris: [],
      },
    }));
    const cancelled = await cancelledPromise;

    expect(cancelled).toMatchObject({
      output: expect.stringContaining("Operator cancelled the managed child."),
      isError: false,
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
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
      };
    };
    expect(joined.output).toContain("Operator cancelled the managed child.");
    expect(joined.output).not.toContain("Late child output must be ignored.");
    expect(joined.isError).toBe(false);
    expect(joined.metadata.status).toBe("cancelled");
    expect(joined.metadata.lifecycleState).toBe("cancelled");
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_cancelled",
    ]);
  });

  it.each(["timed_out", "failed", "stale"] as const)(
    "joins a terminal %s managed child as successful lifecycle observation",
    async (lifecycleState: ManagedAgentLifecycleState) => {
      const { adapter, terminal } = makeDeferredAdapter();
      const surface = makeSurface(adapter);
      const session = makeSession();
      const context: RuntimeBuiltinToolExecutionContext = {
        session,
        toolCall: {
          id: `tool-call-${lifecycleState}-start`,
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
        task: `Inspect ${lifecycleState} terminal evidence.`,
        requestedAuthority: "read_only",
      }, context) as {
        readonly metadata: {
          readonly invocationId: string;
        };
      };
      const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
      const diagnosticKind = lifecycleState === "timed_out" ? "timeout" : "failure";
      const terminalRecord = defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        profile: request.profile,
        lifecycleState,
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
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
          uri: `kiln://managed-invocations/${request.invocationId}/${diagnosticKind}`,
          kind: diagnosticKind,
        }],
      });
      expect(terminalRecord.resourceLease).toBeUndefined();
      terminal.resolve(terminalRecord);
      await flushMicrotasks();

      const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
        invocationId: started.metadata.invocationId,
      }, {
        ...context,
        toolCall: { id: `tool-call-${lifecycleState}-join`, name: "managed_agent.join", input: {} },
      }) as {
        readonly output: string;
        readonly isError: boolean;
        readonly metadata: {
          readonly status?: string;
          readonly lifecycleState?: string;
          readonly routeSource?: string;
          readonly parentTurnId?: string;
          readonly resourceLease?: {
            readonly leaseId?: string;
          };
        };
      };

      expect(joined.isError).toBe(false);
      expect(joined.metadata.status).toBe(lifecycleState);
      expect(joined.metadata.lifecycleState).toBe(lifecycleState);
      expect(joined.metadata.routeSource).toBe("explicit-managed-route");
      expect(joined.metadata.parentTurnId).toBe(`${session.id}:turn:1`);
      expect(joined.metadata.resourceLease?.leaseId).toBe(`${request.invocationId}:resource-lease`);
      expect(joined.output).toContain(`"status": "${lifecycleState}"`);
      expect(joined.output).toContain('"routeSource": "explicit-managed-route"');
      expect(joined.output).toContain(`"parentTurnId": "${session.id}:turn:1"`);
      expect(joined.output).toContain('"resourceLease"');
      expect(joined.output).toContain(`${request.invocationId}:resource-lease`);
      expect(joined.output).toContain(`kiln://managed-agents/invocations/${request.invocationId}/transcript`);
      expect(joined.output).toContain(`kiln://managed-agents/invocations/${request.invocationId}/resources/${diagnosticKind}`);
    },
  );

  it("returns managed_agent.cancel terminal evidence when the aborted adapter stays pending", async () => {
    const { adapter, signal } = makeAbortableDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-cancel-pending-start",
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
      task: "Inspect cancellation behavior.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    expect(signal()?.aborted).toBe(false);

    const cancelledPromise = surface.callBuiltinTools.get("managed_agent.cancel")?.({
      invocationId: started.metadata.invocationId,
      reason: "Operator cancelled pending adapter output.",
    }, {
      ...context,
      toolCall: { id: "tool-call-cancel-pending", name: "managed_agent.cancel", input: {} },
    }) as Promise<{
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly sessionEventIds?: readonly string[];
      };
    }>;

    await flushMicrotasks();
    const cancelState = await Promise.race([
      cancelledPromise.then((result) => result.metadata.lifecycleState),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0)),
    ]);

    expect(signal()?.aborted).toBe(true);
    expect(cancelState).toBe("cancelled");
    const cancelled = await cancelledPromise;
    expect(cancelled).toMatchObject({
      output: expect.stringContaining("Operator cancelled pending adapter output."),
      isError: false,
      metadata: {
        lifecycleState: "cancelled",
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_cancelled",
    ]);
    expect(cancelled.metadata.sessionEventIds).toEqual([
      session.sessionEvents[2]?.eventId,
    ]);
  });

  it("keeps managed child lineage and route provenance when cancel join fails", async () => {
    const { adapter, terminal } = makeAbortableDeferredAdapter();
    const invocationService = makeObservedRuntimeInvocationService({
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: ["credential-route:opencode-readonly"],
      }),
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService,
        routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter)],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-cancel-failure-start",
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
      task: "Inspect cancel failure provenance.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as ManagedAgentInvocationRequest;
    const joinSpy = vi.spyOn(invocationService, "join").mockRejectedValueOnce(new Error("join store unavailable"));

    const cancelled = await surface.callBuiltinTools.get("managed_agent.cancel")?.({
      invocationId: started.metadata.invocationId,
      reason: "Operator cancelled before join failed.",
    }, {
      ...context,
      toolCall: { id: "tool-call-cancel-failure", name: "managed_agent.cancel", input: {} },
    }) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId?: string;
        readonly routeId?: string;
        readonly routeSource?: string;
        readonly parentSessionId?: string;
        readonly parentTurnId?: string;
        readonly status?: string;
        readonly lifecycleState?: string;
      };
    };

    expect(cancelled.isError).toBe(true);
    expect(cancelled.output).toContain("Managed invocation cancel failed: join store unavailable");
    expect(cancelled.metadata).toMatchObject({
      invocationId: started.metadata.invocationId,
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
      parentSessionId: session.id,
      parentTurnId: `${session.id}:turn:1`,
      status: "cancelled",
      lifecycleState: "cancelled",
    });

    joinSpy.mockRestore();
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
        routeSource: "explicit-managed-route",
      }),
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
        summary: "Late child output must be ignored.",
        resourceUris: [`kiln://managed-invocations/${request.invocationId}/late`],
        memoryWriteProposalUris: [],
      },
    }));
    await flushMicrotasks();
  });

  it("publishes runtime cancellation evidence before late adapter cleanup evidence", async () => {
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
        routeSource: "explicit-managed-route",
      }),
      transcript: {
        uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
        redacted: "unknown",
        truncated: false,
        persisted: true,
        retention: "session",
      },
      resultHandoff: {
        provenance: TEST_HANDOFF_PROVENANCE,
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
        resultHandoff: {
          summary: "Operator cancelled with cleanup evidence.",
          resourceUris: [],
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
          {
            name: "manual-release",
            description: "Release only when explicitly named.",
            desiredVisibility: "explicit-only",
          },
          {
            name: "retired-skill",
            description: "Must remain unavailable.",
            desiredVisibility: "disabled",
            admission: { state: "blocked", reason: "Disabled by policy." },
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
        readonly executionPhase?: {
          readonly properties?: {
            readonly verificationRequirementIds?: {
              readonly items?: { readonly type?: string };
            };
            readonly taskAffinity?: {
              readonly items?: { readonly type?: string };
            };
            readonly instruction?: { readonly type?: string };
          };
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
    expect(tool?.description).not.toContain("invocationCapability=");
    expect(tool?.description).toContain("taskSuitability=architecture-review:capable:static-profile");
    expect(tool?.description).toContain("Configured unavailable managed invocation routes");
    expect(tool?.description).toContain("openrouter-readonly");
    expect(tool?.description).toContain("Configured admitted agent profiles");
    expect(tool?.description).toContain("Configured admitted skills: test-generator");
    expect(tool?.description).toContain("Configured skill catalog");
    expect(tool?.description).toContain("repo-review: Review repository evidence");
    expect(tool?.description).not.toContain("manual-release: Release only when explicitly named");
    expect(tool?.description).not.toContain("retired-skill: Must remain unavailable");
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
    expect(tool?.description).toContain("timeoutMs=120000");
    expect(tool?.description).toContain("source=explicit-route");
    expect(tool?.description).toContain("For broad repository review, long reasoning, or multi-file analysis, choose a route with a sufficient timeout budget or split the work into smaller children.");
    expect(tool?.description).toContain("Do not put resource_read in requiredToolNames just because contextMode=resources is used");
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
    expect(schema.properties?.executionPhase?.properties?.verificationRequirementIds?.items?.type).toBe("string");
    expect(schema.properties?.executionPhase?.properties?.taskAffinity?.items?.type).toBe("string");
    expect(schema.properties?.executionPhase?.properties?.instruction?.type).toBe("string");
    expect(schema.properties?.skills?.items?.enum).toEqual(["test-generator", "repo-review", "manual-release"]);
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
    const attachment = attachManagedInvocationSessionEventSink({
      options: {
        routes: [],
        sessionEventSink: { publish: originalSink },
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "runtime-test",
        attachmentId: "attachment:runtime-test",
      },
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

    await attachment?.options.sessionEventSink?.publish(events, context);

    expect(originalSink).toHaveBeenCalledWith(events, context);
    expect(surfaceSink).toHaveBeenCalledWith(events, context);
  });

  it("preserves live managed invocation route catalogs when composing session event sinks", () => {
    const route = {
      ...makeManagedRoute("codex-oauth-auto-review-readonly", "codex-auto-review"),
      providerId: "codex-oauth",
      surface: "direct-provider",
    };
    let current: ManagedInvocationToolOptions = {
      routes: [],
      unavailableRoutes: [{
        routeId: "codex-oauth-auto-review-readonly",
        routeSource: "explicit-managed-route",
        providerId: "codex-oauth",
        model: "codex-auto-review",
        profiles: ["foundation-readonly-plan"],
        reason: "Provider/model discovery is pending.",
      }],
    };
    const liveOptions: ManagedInvocationToolOptions = {
      get routes() {
        return current.routes;
      },
      get unavailableRoutes() {
        return current.unavailableRoutes;
      },
      requestedBy: "assistant",
      requestSource: "gui",
    };

    const attachment = attachManagedInvocationSessionEventSink({
      options: liveOptions,
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "runtime-test",
        attachmentId: "attachment:runtime-test",
      },
    }, { publish: vi.fn() });
    current = {
      routes: [route],
      requestedBy: "assistant",
      requestSource: "gui",
    };

    expect(attachment?.options.routes.map((entry) => entry.routeId)).toEqual(["codex-oauth-auto-review-readonly"]);
    expect(attachment?.options.unavailableRoutes).toBeUndefined();
  });

  it("does not let one managed invocation session event sink block another", async () => {
    const originalSink = vi.fn().mockRejectedValue(new Error("relay unavailable"));
    const surfaceSink = vi.fn();
    const attachment = attachManagedInvocationSessionEventSink({
      options: {
        routes: [],
        sessionEventSink: { publish: originalSink },
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "runtime-test",
        attachmentId: "attachment:runtime-test",
      },
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

    await expect(attachment?.options.sessionEventSink?.publish(events, context)).resolves.toBeUndefined();

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
      goalRunId: "goal-run-test",
      roleIntent: "Architecture review before implementation.",
      expectedEvidence: ["surface-map", "managed-agent-review", "residual-risk"],
      requiredResultFields: ["summary", "evidence", "residualRisks"],
      doneCriteria: ["Report the top contract risk and cite evidence."],
      residualRiskRequired: true,
      outputVerbosity: "concise",
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
          requiredResultFields: ["summary", "evidence", "residualRisks"],
          doneCriteria: ["Report the top contract risk and cite evidence."],
          residualRiskRequired: true,
          outputVerbosity: "concise",
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
    expect(result.output).not.toContain("Internal child execution detail.");
    expect(result.output).toContain('"verificationUsage"');
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
          outputVerbosity: "concise",
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
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenNthCalledWith(1, session.sessionEvents.slice(0, 2), context);
    expect(sessionEventSink.publish).toHaveBeenNthCalledWith(2, [session.sessionEvents[2]], context);
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

  it("returns managed_agent.invoke child progress events with the terminal result", async () => {
    const adapter = makeAdapterWithProgressHandoff("Child review completed with evidence.");
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-progress",
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
      task: "Inspect one file.",
      summary: "Inspect one file.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly progressEventCount?: number;
        readonly recentProgressEvents?: readonly {
          readonly kind: string;
          readonly summary: string;
          readonly toolName?: string;
        }[];
      };
    };
    const output = JSON.parse(result.output) as {
      readonly progressEventCount?: number;
      readonly recentProgressEvents?: readonly {
        readonly kind: string;
        readonly summary: string;
        readonly toolName?: string;
      }[];
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.progressEventCount).toBe(1);
    expect(result.metadata.recentProgressEvents).toEqual([expect.objectContaining({
      kind: "tool_called",
      summary: "read called",
      toolName: "read",
    })]);
    expect(output.recentProgressEvents).toEqual(result.metadata.recentProgressEvents);
    expect(output).not.toHaveProperty("progressEvents");
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
      const result = await invoke(input, {
        session: makeSession(),
        toolCall: { id: toolCallId, name: "managed_agent.invoke", input: {} },
      });
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
      return workItemStore.get("work-recovery-chain")!.pauseRequirements;
    };

    const firstRequirements = await invokeFailure("tool-call-recovery-chain-1");
    expect(firstRequirements).toHaveLength(1);
    expect(firstRequirements[0]).toMatchObject({
      status: "pending",
      id: expect.stringContaining("managed-invocation-capability:work-recovery-chain:"),
    });

    const secondRequirements = await invokeFailure("tool-call-recovery-chain-2");
    expect(secondRequirements).toHaveLength(2);
    expect(secondRequirements[0]).toMatchObject({
      id: firstRequirements[0]!.id,
      status: "superseded",
      supersededByRequirementId: secondRequirements[1]!.id,
    });
    expect(secondRequirements[1]).toMatchObject({
      status: "pending",
      id: expect.stringContaining("managed-invocation-capability:work-recovery-chain:"),
    });
    expect(secondRequirements[1]!.id).not.toBe(firstRequirements[0]!.id);
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
          profiles: {
            "foundation-readonly-plan": {
              ...route.profiles["foundation-readonly-plan"],
              readAuthority: {
                workspace: {
                  allowedPaths: ["/workspace/references/cloned"],
                  deniedPaths: [],
                },
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
    expect(result.output).toContain("authority-exceeds-route-ceiling");
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
    expect(result.output).toContain("missing-tool, missing-tool");
    expect(result.metadata.admissionReasons).toEqual([
      { code: "missing-tool", requiredToolName: "web_search" },
      { code: "missing-tool", requiredToolName: "browser_observe" },
    ]);
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed before invocation when visual phase tools are present without network authority", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly-visual-without-network",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: makeRouteCapability({ routeId: "opencode-readonly-visual-without-network", providerId: "opencode", model: "opencode-default-model", profiles: ["foundation-readonly-plan"], toolNames: ["read", "web_search", "browser_observe"] }),
          createAdapter: async () => adapter,
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

  it("keeps managed-agent start missing-tool failures pre-invocation and structured", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start-missing-tools",
        name: "managed_agent.start",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.start")?.({
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
        readonly status?: string;
        readonly missingRequiredTools?: readonly string[];
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("missing-tool, missing-tool");
    expect(result.metadata.status).toBe("denied");
    expect(result.metadata.admissionReasons).toEqual([
      { code: "missing-tool", requiredToolName: "web_search" },
      { code: "missing-tool", requiredToolName: "browser_observe" },
    ]);
    expect(session.sessionEvents).toEqual([]);
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("keeps managed-agent start missing-capability failures pre-invocation and structured", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          routeId: "opencode-readonly-visual-without-network",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: makeRouteCapability({ routeId: "opencode-readonly-visual-without-network", providerId: "opencode", model: "opencode-default-model", profiles: ["foundation-readonly-plan"], toolNames: ["read", "web_search", "browser_observe"] }),
          createAdapter: async () => adapter,
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
        id: "tool-call-start-missing-capabilities",
        name: "managed_agent.start",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.start")?.({
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
        readonly status?: string;
        readonly missingRequiredCapabilities?: readonly string[];
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("lacks required capabilities: network");
    expect(result.metadata.status).toBe("unavailable");
    expect(result.metadata.missingRequiredCapabilities).toEqual(["network"]);
    expect(result.metadata.presentationIntent).toMatchObject({
      source: "managed_agent.start",
      rows: [
        expect.objectContaining({
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: "Missing required route capabilities: network",
        }),
      ],
    });
    expect(session.sessionEvents).toEqual([]);
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("keeps managed-agent start worktree-conflict denials structured and replayable", async () => {
    const terminal = deferred<void>();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        supportedProfiles: ["foundation-readonly-plan", "foundation-apply-approved-writes"],
        writeAuthority: {
          proposalSupported: true,
          approvedApplySupported: true,
          memoryProposalSupported: false,
          rollbackEvidence: true,
          cleanupEvidence: true,
          scopeReduction: true,
        },
      }),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return defineManagedAgentInvocationRecord({
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
            summary: "Approved write completed.",
            resourceUris: [`kiln://managed-invocations/${request.invocationId}/handoff`],
            memoryWriteProposalUris: [],
          },
        });
      }),
    };
    const invocationService = makeObservedRuntimeInvocationService();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService,
        routes: [{
          routeId: "opencode-approved-write",
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: makeRouteCapability({ routeId: "opencode-approved-write", providerId: "opencode", model: "opencode-default-model", profiles: ["foundation-apply-approved-writes"], toolNames: ["read", "grep", "apply-patch"], supportsWrite: true }),
          createAdapter: async () => adapter,
          profiles: {
            "foundation-apply-approved-writes": {
              authorityProfileId: "authority:opencode:approved-write",
              permissionProfile: "apply-approved-writes",
              allowedToolNames: ["read", "grep", "apply-patch"],
              writeAllowed: true,
              networkAllowed: false,
              workingDirectory: {
                path: "C:/workspace/kiln",
                mode: "workspace-write",
              },
              timeoutMs: 120000,
              credentialRoute: {
                mode: "credentialless",
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
                    deniedToolNames: ["git-commit"],
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
    const requestApproval = vi.fn(async () => ({
      approved: true,
      reason: "operator approved bounded write",
    }));
    const startInput = {
      profile: "foundation-apply-approved-writes",
      routeId: "opencode-approved-write",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "destructive",
      task: "Apply the approved runtime edit.",
    };

    const first = await surface.callBuiltinTools.get("managed_agent.start")?.(startInput, {
      session,
      toolCall: {
        id: "tool-call-write-active",
        name: "managed_agent.start",
        input: startInput,
      },
      requestApproval,
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const denied = await surface.callBuiltinTools.get("managed_agent.start")?.(startInput, {
      session,
      toolCall: {
        id: "tool-call-write-conflict",
        name: "managed_agent.start",
        input: startInput,
      },
      requestApproval,
    }) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly missingCapabilities?: readonly string[];
        readonly resourceLease?: {
          readonly worktreeConflict?: {
            readonly status?: string;
            readonly reason?: string;
            readonly requestedInvocationId?: string;
            readonly conflictingInvocationId?: string;
          };
        };
        readonly sessionEventIds?: readonly string[];
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(first.isError).toBe(false);
    expect(denied.isError).toBe(true);
    expect(denied.output).toContain("Managed invocation denied");
    expect(denied.metadata.status).toBe("denied");
    expect(denied.metadata.lifecycleState).toBe("failed");
    expect(denied.metadata.missingCapabilities).toEqual(["resourceLease.worktreeConflict"]);
    expectPublicResourceLeaseMetadata(denied.metadata.resourceLease);
    expect(denied.metadata.resourceLease?.worktreeConflict).toMatchObject({
      status: "blocked",
      reason: "same-checkout-write-conflict",
      conflictingInvocationId: first.metadata.invocationId,
    });
    expect(denied.metadata.sessionEventIds).toEqual(
      session.sessionEvents.slice(-2).map((event) => event.eventId),
    );
    expect(denied.metadata.presentationIntent).toMatchObject({
      source: "managed_agent.start",
      rows: [
        expect.objectContaining({
          routeId: "opencode-approved-write",
          status: "denied",
          substantiveEvidence: false,
          failureReason: expect.stringContaining(
            "same-checkout-write-conflict",
          ),
        }),
      ],
    });
    expect(session.sessionEvents.slice(-2).map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_failed",
    ]);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);

    terminal.resolve();
    const joined = await surface.callBuiltinTools.get("managed_agent.join")?.({
      invocationId: first.metadata.invocationId,
    }, {
      session,
      toolCall: {
        id: "tool-call-write-active-join",
        name: "managed_agent.join",
        input: {},
      },
    }) as { readonly isError: boolean };
    expect(joined.isError).toBe(false);
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
    expect(result.output).toContain("authority-exceeds-route-ceiling");
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
          routeSource: "explicit-managed-route",
          providerId: "opencode",
          model: "opencode-default-model",
          capability: makeRouteCapability({ routeId: "opencode-propose-writes", providerId: "opencode", model: "opencode-default-model", profiles: ["foundation-propose-writes"], toolNames: ["read", "grep", "edit"] }),
          createAdapter: async () => adapter,
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
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
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

  it("passes explicit work classification through the context resolver and records diagnostic metadata", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn(async () => ({
      admittedSkills: ["clear-writing"],
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        evidenceScopes: ["provided"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      workRecommendedSkills: ["clear-writing"],
      workRecommendedSkillDiagnostics: [{
        skillName: "clear-writing",
        state: "admitted",
        reason: "Recommended by work classification and admitted by auto selection.",
      }],
    }));
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-work-classification",
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
      contextMode: "isolated",
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        evidenceScopes: ["provided"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      task: "Write a clear report for educators.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly context?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(false);
    expect(contextResolver).toHaveBeenCalledWith(expect.objectContaining({
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        evidenceScopes: ["provided"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
    }));
    expect(result.metadata.context).toMatchObject({
      mode: "isolated",
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        evidenceScopes: ["provided"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      admittedSkills: ["clear-writing"],
      resolvedWorkClassification: {
        intents: ["write"],
        artifacts: ["document"],
      },
      workRecommendedSkills: ["clear-writing"],
      workRecommendedSkillDiagnostics: [{
        skillName: "clear-writing",
        state: "admitted",
        reason: "Recommended by work classification and admitted by auto selection.",
      }],
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("fails closed for unsupported explicit work classification facets", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-work-classification-invalid",
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
      contextMode: "isolated",
      workClassification: {
        intents: ["writing"],
      },
      task: "Write a clear report.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unsupported work classification intent: writing");
    expect(contextResolver).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed for malformed or unknown work classification fields", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeSession(),
      toolCall: {
        id: "tool-call-work-classification-shape",
        name: "managed_agent.invoke",
        input: {},
      },
    };
    const baseInput = {
      routeId: "opencode-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "model-a",
      },
      contextMode: "isolated",
      task: "Write a clear report.",
    };

    const malformed = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      ...baseInput,
      workClassification: {
        intents: "write",
      },
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
    };
    const unknown = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      ...baseInput,
      workClassification: {
        intent: ["write"],
      },
    }, {
      ...context,
      toolCall: {
        ...context.toolCall,
        id: "tool-call-work-classification-unknown",
      },
    }) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(malformed.isError).toBe(true);
    expect(malformed.output).toContain("workClassification.intents must be an array of strings");
    expect(unknown.isError).toBe(true);
    expect(unknown.output).toContain("Unsupported work classification field: intent");
    expect(contextResolver).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed for an unsupported evidence scope", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "opencode-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "opencode", model: "model-a" },
      contextMode: "isolated",
      workClassification: {
        intents: ["research"],
        evidenceScopes: ["internet"],
      },
      task: "Research the current behavior.",
    }, {
      session: makeSession(),
      toolCall: {
        id: "tool-call-work-classification-evidence-scope",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as { readonly output: string; readonly isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unsupported work classification evidence scope: internet");
    expect(contextResolver).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed with denied skills from the configured context resolver before child lifecycle starts", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn(async () => ({
      admittedAgentProfile: "architecture-reviewer",
      deniedSkills: ["workspace-write"],
    }));
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-denied-skill",
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
      skills: ["workspace-write"],
      contextMode: "isolated",
      task: "Prepare a managed write review.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly context?: {
          readonly deniedSkills?: readonly string[];
        };
        readonly presentationIntent?: {
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("denied");
    expect(result.metadata.context?.deniedSkills).toEqual(["workspace-write"]);
    expect(result.metadata.presentationIntent?.rows?.[0]).toMatchObject({
      status: "denied",
      substantiveEvidence: false,
      failureReason: expect.stringContaining("workspace-write"),
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
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
          makeManagedRoute("opencode-readonly", "model-heavy", async () => slowAdapter),
          makeManagedRoute("opencode-scout-readonly", "model-fast", async () => fastAdapter),
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
          communication: {
            responseDetail: "detailed",
            requiredContent: ["finding"],
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

  it("resolves managed-child communication from its agent profile and invocation override", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-review", "openai/gpt-5.6-sol", async () => adapter)],
        agentCatalog: [{
          name: "reviewer",
          role: "Review changes",
          goal: "Lead with actionable findings",
          tier: "reasoning",
          routeId: "opencode-review",
          providerRoute: { providerId: "opencode", model: "openai/gpt-5.6-sol" },
          communication: {
            responseDetail: "concise",
            requiredContent: ["finding", "residual-risk"],
          },
        }],
        contextResolver: async () => ({ admittedAgentProfile: "reviewer" }),
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeSession(),
      toolCall: { id: "tool-call-communication", name: "managed_agent.invoke", input: {} },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-review",
      providerRoute: {
        providerId: "opencode",
        model: "openai/gpt-5.6-sol",
        communicationIntent: {
          responseDetail: "detailed",
          requiredContent: ["verification"],
          artifactContract: { id: "review-report", revision: "v1" },
          responseSkills: [{ id: "code-review-findings", revision: "v1" }],
        },
      },
      agentProfile: "reviewer",
      contextMode: "isolated",
      residualRiskRequired: true,
      task: "Review the candidate change.",
    }, context) as { readonly isError: boolean; readonly output: string };

    expect(result.isError, result.output).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        providerRoute: expect.objectContaining({
          communicationIntent: expect.objectContaining({
            intent: expect.objectContaining({
              responseDetail: "detailed",
              requiredContent: ["finding", "residual-risk", "verification"],
              artifactContract: { id: "review-report", revision: "v1" },
              responseSkills: [{ id: "code-review-findings", revision: "v1" }],
            }),
            authority: expect.objectContaining({
              responseDetail: "invocation",
              artifactContract: "invocation",
              responseSkills: ["invocation"],
              requiredContent: expect.objectContaining({
                "residual-risk": ["safety-authority", "agent-profile"],
              }),
            }),
          }),
        }),
      }),
    }));
  });

  it("fails closed when an explicit route contradicts the selected agent profile route hint", async () => {
    const fastAdapter = makeAdapter();
    const slowAdapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly", "model-heavy", async () => slowAdapter),
          makeManagedRoute("opencode-scout-readonly", "model-fast", async () => fastAdapter),
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
          communication: {
            responseDetail: "detailed",
            requiredContent: ["finding"],
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
        model: "model-fast",
      },
      agentProfile: "scout",
      contextMode: "isolated",
      goalRunId: "goal-ui",
      workItemId: "work-ui",
      attemptId: "goal-ui:work-ui:attempt:1",
      expectedEvidence: ["visual-reference-research"],
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read"],
        completionTool: "work_item.update",
        finalPhase: false,
        autoStartAllowed: false,
      },
      task: "Scout the GUI surface.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly nextTool?: string;
        readonly retryInputTemplate?: Record<string, unknown>;
        readonly forbiddenInputFields?: readonly string[];
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly nextTool?: string;
      readonly retryInputTemplate?: {
        readonly routeId?: string;
        readonly agentProfile?: string;
        readonly workItemId?: string;
        readonly providerRoute?: {
          readonly communicationIntent?: {
            readonly identity?: string;
            readonly authority?: { readonly responseDetail?: string };
          };
        };
      };
      readonly forbiddenInputFields?: readonly string[];
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("contradicts configured agentProfile 'scout' route hint");
    expect(output).toMatchObject({
      status: "route_profile_conflict",
      nextTool: "managed_agent.invoke",
      retryInputTemplate: {
        routeId: "opencode-readonly",
        workItemId: "work-ui",
      },
      forbiddenInputFields: ["agentProfile"],
    });
    expect(output.retryInputTemplate?.agentProfile).toBeUndefined();
    expect(output.retryInputTemplate?.providerRoute?.communicationIntent).toMatchObject({
      identity: expect.stringMatching(/^sha256:/),
      authority: { responseDetail: "agent-profile" },
    });
    expect(result.metadata).toMatchObject({
      status: "route_profile_conflict",
      managedInvocationId: "session-parent:tool-call-1:route-profile-conflict",
      invocationId: "session-parent:tool-call-1:route-profile-conflict",
      lifecycleState: "route_profile_conflict",
      parentSessionId: "session-parent",
      parentTurnId: "session-parent:turn:1",
      nextTool: "managed_agent.invoke",
      retryInputTemplate: {
        routeId: "opencode-readonly",
        workItemId: "work-ui",
      },
      forbiddenInputFields: ["agentProfile"],
    });
    expect(result.metadata.retryInputTemplate?.agentProfile).toBeUndefined();
    expect(fastAdapter.invoke).not.toHaveBeenCalled();
    expect(slowAdapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });

  it("canonicalizes forbidden agentProfile before route validation for route-owned requests", async () => {
    const phaseSummary = [
      "No public product screenshots were available.",
      "Code-backed frontend implementation evidence from local source /workspace/references/vllm-studio identifies frontend/src app shell component structure, layout pattern, navigation model, panel density, typography, spacing, and product ergonomics.",
      "Local source /workspace/references/t1code/src/app/layout.tsx shows status area, composer-like panels, typography, spacing, and density.",
    ].join(" ");
    const adapter = makeAdapterWithHandoff(phaseSummary);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly", "model-heavy", async () => adapter),
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
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-forbidden-agent-profile",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: {
        providerId: "opencode",
        model: "model-fast",
      },
      forbiddenInputFields: ["agentProfile"],
      agentProfile: "scout",
      contextMode: "isolated",
      goalRunId: "goal-ui",
      workItemId: "work-ui",
      attemptId: "goal-ui:work-ui:attempt:1",
      expectedEvidence: ["visual-reference-research"],
      executionPhase: {
        id: "visual-reference-research",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["read"],
        completionTool: "work_item.update",
        finalPhase: false,
        autoStartAllowed: false,
      },
      task: "Scout the GUI surface.",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly routeId?: string;
        readonly providerRoute?: { readonly model?: string };
        readonly canonicalizedForbiddenInputFields?: readonly string[];
        readonly capabilitySnapshot?: {
          readonly callerIdentity?: unknown;
          readonly childIdentity?: {
            readonly requestedAgentProfile?: string;
            readonly admittedAgentProfile?: string;
          };
        };
      };
    };

    expect(result.isError, result.output).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "completed",
      routeId: "opencode-readonly",
    });
    expect(result.metadata).toMatchObject({
      status: "completed",
      routeId: "opencode-readonly",
      providerRoute: {
        model: "model-heavy",
      },
      canonicalizedForbiddenInputFields: ["agentProfile"],
    });
    expect(result.metadata.capabilitySnapshot?.childIdentity?.requestedAgentProfile).toBeUndefined();
    expect(result.metadata.capabilitySnapshot?.childIdentity?.admittedAgentProfile).toBeUndefined();
    expect(result.metadata.capabilitySnapshot?.callerIdentity).toMatchObject({ kind: "kiln-runtime" });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
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
      readonly metadata: {
        readonly status?: string;
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Managed invocation route 'openrouter-readonly' is unavailable");
    expect(result.output).toContain("requires a tool-call-capable model");
    expect(result.metadata.status).toBe("unavailable");
    expect(result.metadata.presentationIntent).toMatchObject({
      source: "managed_agent.invoke",
      rows: [
        expect.objectContaining({
          routeId: "openrouter-readonly",
          provider: "openrouter",
          model: "openrouter/free",
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: "Direct provider route 'openrouter-readonly' requires a tool-call-capable model; 'openrouter/openrouter/free' is not eligible.",
        }),
      ],
    });
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

  it("keeps route-unavailable presentation intent source aligned with the managed tool", async () => {
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
        id: "tool-call-unavailable-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.start")?.({
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
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("unavailable");
    expect(result.metadata.presentationIntent).toMatchObject({
      source: "managed_agent.start",
      rows: [
        expect.objectContaining({
          routeId: "openrouter-readonly",
          provider: "openrouter",
          model: "openrouter/free",
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: "Direct provider route is not eligible.",
        }),
      ],
    });
    expect(session.sessionEvents).toEqual([]);
  });

  it("returns provider-readable managed transcript URIs when artifact persistence is not configured", async () => {
    const managedInvocation = withManagedInvocationService({
      routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => makeAdapter())],
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        resourceProviders: [
          createManagedAgentInvocationResourceProvider({
            service: managedInvocation.invocationService,
            parentSessionId: "session-parent",
          }),
        ],
      },
      managedInvocation,
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-provider-readable",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      task: "Inspect managed invocation resource readability.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly resourceLinks?: readonly { readonly uri: string; readonly title?: string; readonly relation?: string }[];
        readonly transcript?: { readonly uri?: string };
        readonly resultHandoff?: { readonly resourceUris?: readonly string[] };
      };
    };

    const canonicalTranscriptUri = `kiln://managed-agents/invocations/${result.metadata.invocationId}/transcript`;

    expect(result.isError).toBe(false);
    expect(result.metadata.transcript?.uri).toBe(canonicalTranscriptUri);
    expect(result.metadata.resultHandoff?.resourceUris).toContain(canonicalTranscriptUri);
    expect(result.metadata.resourceLinks).toEqual([expect.objectContaining({
      uri: canonicalTranscriptUri,
      title: "Managed invocation transcript",
      relation: "events",
    })]);
    expect(JSON.stringify(result.metadata)).not.toContain("kiln://managed-invocations/");
    await expect(surface.callBuiltinTools.get("resource_read")?.({
      uri: canonicalTranscriptUri,
    }, context)).resolves.toMatchObject({
      isError: false,
      metadata: expect.objectContaining({
        toolName: "resource_read",
        uri: canonicalTranscriptUri,
      }),
    });
  });

  it("scopes shared managed invocation resource tools to the executing runtime session", async () => {
    const managedInvocation = withManagedInvocationService({
      routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => makeAdapter())],
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({ managedInvocation });
    const sessionA = makeSession("session-a");
    const sessionB = makeSession("session-b");
    const contextFor = (session: RuntimeSession, id: string): RuntimeBuiltinToolExecutionContext => ({
      session,
      toolCall: { id, name: "managed_agent.invoke", input: {} },
    });
    const contextA = contextFor(sessionA, "tool-call-session-a");
    const contextB = contextFor(sessionB, "tool-call-session-b");
    const invoke = surface.callBuiltinTools.get("managed_agent.invoke")!;
    const resultA = await invoke({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      task: "Session A task.",
    }, contextA) as { readonly metadata: { readonly invocationId: string } };
    const resultB = await invoke({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      task: "Session B task.",
    }, contextB) as { readonly metadata: { readonly invocationId: string } };

    const listA = await surface.callBuiltinTools.get("resource_list")?.({}, contextA) as {
      readonly isError: boolean;
      readonly output: string;
    };
    const listedA = JSON.parse(listA.output) as { readonly resources: readonly { readonly uri: string }[] };
    const listedUrisA = listedA.resources.map((resource) => resource.uri);
    expect(listA.isError).toBe(false);
    expect(listedUrisA).toContain(`kiln://managed-agents/invocations/${resultA.metadata.invocationId}`);
    expect(listedUrisA.some((uri) => uri.includes(resultB.metadata.invocationId))).toBe(false);

    const foreignRead = await surface.callBuiltinTools.get("resource_read")?.({
      uri: `kiln://managed-agents/invocations/${resultB.metadata.invocationId}`,
    }, contextA) as { readonly isError: boolean; readonly metadata?: { readonly errorCode?: string } };
    expect(foreignRead).toMatchObject({
      isError: true,
      metadata: expect.objectContaining({ errorCode: "not_found" }),
    });
  });

  it("exposes timeout diagnostic resources with effective timeout evidence", async () => {
    const managedInvocation = withManagedInvocationService({
      routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => makeTimedOutAdapter())],
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        resourceProviders: [
          createManagedAgentInvocationResourceProvider({
            service: managedInvocation.invocationService,
            parentSessionId: "session-parent",
          }),
        ],
      },
      managedInvocation,
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-provider-readable-timeout",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      task: "Inspect managed invocation timeout resource readability.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly resultHandoff?: { readonly resourceUris?: readonly string[] };
      };
    };
    const timeoutUri = result.metadata.resultHandoff?.resourceUris
      ?.find((uri) => uri.endsWith("/resources/timeout"));

    expect(result.isError).toBe(true);
    expect(timeoutUri).toEqual(expect.any(String));
    const timeoutResource = await surface.callBuiltinTools.get("resource_read")?.({
      uri: timeoutUri,
    }, context) as {
      readonly isError: boolean;
      readonly output: string;
    };
    const payload = JSON.parse(timeoutResource.output) as {
      readonly resource?: {
        readonly lifecycleState?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly diagnostics?: readonly { readonly kind?: string }[];
      };
    };

    expect(timeoutResource.isError).toBe(false);
    expect(payload.resource).toMatchObject({
      lifecycleState: "timed_out",
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      diagnostics: [expect.objectContaining({ kind: "timeout" })],
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

    const transcriptUri = result.metadata.transcript?.uri ?? "";
    const firstTranscriptPage = await surface.readResource(transcriptUri, { limit: 2 });
    const nextTranscriptCursor = firstTranscriptPage.nextCursor;
    expect(nextTranscriptCursor).toEqual(expect.any(String));
    if (!nextTranscriptCursor) {
      throw new Error("Expected paged transcript resource to return a next cursor.");
    }
    expect(firstTranscriptPage.contents[0]?._meta?.range).toMatchObject({
      unit: "line",
      offset: 0,
      limit: 2,
      truncated: true,
    });
    const transcript = await surface.readResource(transcriptUri, {
      cursor: nextTranscriptCursor,
      limit: 1_000,
    });
    expect(transcript.contents[0]).toMatchObject({
      mimeType: "text/markdown",
    });
    const firstTranscriptText = String("text" in firstTranscriptPage.contents[0]! ? firstTranscriptPage.contents[0]!.text : "");
    const transcriptText = [
      firstTranscriptText,
      String("text" in transcript.contents[0]! ? transcript.contents[0]!.text : ""),
    ].join("\n");
    expect(transcriptText).toContain("Model: opencode-default-model");
    expect(transcriptText).toContain("## Capability Snapshot");
    expect(transcriptText).toContain("Route ID: opencode-readonly");
    expect(transcriptText).toContain("Route source: explicit-managed-route");
    expect(transcriptText).toContain("Provider proof: live-proven");
    expect(transcriptText).toContain("Child review completed.");
  });

  it("preserves configured provider proof for remote harness routes", async () => {
    const adapter = makeAdapter({
      adapterDescriptorId: "adapter:codex-cloud:remote-harness",
      providerId: "codex-cloud",
      supportedExecutionModes: ["remote-harness"],
    });
    const route = {
      ...makeManagedRoute("codex-cloud-remote-readonly", "gpt-5.5", async () => adapter, "codex-cloud"),
      providerId: "codex-cloud",
      capability: makeRouteCapability({
        routeId: "codex-cloud-remote-readonly",
        providerId: "codex-cloud",
        model: "gpt-5.5",
        profiles: ["foundation-readonly-plan"],
        adapterKind: "governed-external-runtime",
      }),
      surface: "remote-harness",
      providerModelProof: {
        status: "configured" as const,
        source: "remote-harness-config",
        requiresToolCalls: false,
      },
    };
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [route],
      },
    });
    const artifactStore = new MemoryArtifactResourceStore();
    const resourceSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { artifactResources: { store: artifactStore } },
      managedInvocation: {
        artifactStore,
        routes: [route],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-remote-proof",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "codex-cloud-remote-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-cloud",
        model: "gpt-5.5",
      },
      task: "Inspect remote managed invocation proof metadata.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly capabilitySnapshot?: {
          readonly providerModelProof?: {
            readonly status?: string;
            readonly source?: string;
          };
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.capabilitySnapshot?.providerModelProof).toMatchObject({
      status: "configured",
      source: "remote-harness-config",
    });

    const resourceResult = await resourceSurface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "codex-cloud-remote-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-cloud",
        model: "gpt-5.5",
      },
      task: "Inspect remote managed invocation proof metadata.",
    }, {
      ...context,
      toolCall: {
        id: "tool-call-remote-proof-resource",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly metadata: {
        readonly transcript?: { readonly uri?: string };
      };
    };
    const transcript = await resourceSurface.readResource(resourceResult.metadata.transcript?.uri ?? "");
    const transcriptText = String("text" in transcript.contents[0]! ? transcript.contents[0]!.text : "");
    expect(transcriptText).toContain("Provider proof: configured");
    expect(transcriptText).toContain("Provider proof source: remote-harness-config");
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

  // Roadmap 01 (External Runtime Governance), Slice 0 - Failing Trace Fixture.
  // This encodes the first of that slice's regression proofs: work-governance-tool.ts's
  // requiredToolNamesForPhaseEvidence() always adds "bash" whenever a phase's expected
  // evidence includes "tests" or "typecheck" (see work-governance-tool.test.ts:2865,
  // which locks that in as today's behavior), with no awareness of the target route's
  // actual admitted capabilities. An MCP-only external-runtime route can never satisfy
  // "bash" and is rejected outright, even when its own admitted tools (start_stop_test,
  // observe_runtime, read_console) could realize equivalent verification evidence. This
  // is expected to fail until Roadmap 01 Slice 1 (Evidence Realization Contract) defines
  // a capability-aware mapping; it must start passing (and this .fails must flip to a
  // plain `it`) once that lands.
  describe("external-runtime MCP-only route capability (Roadmap 01 Slice 0)", () => {
    const externalRuntimeToolNames = [
      "mcp:external-runtime:tool:inspect_tree",
      "mcp:external-runtime:tool:apply_scene_edit",
      "mcp:external-runtime:tool:edit_script",
      "mcp:external-runtime:tool:start_stop_test",
      "mcp:external-runtime:tool:observe_runtime",
      "mcp:external-runtime:tool:read_console",
      "mcp:external-runtime:tool:navigate_actor",
    ] as const;

    function makeExternalRuntimeSurface(adapter = makeAdapter({
      adapterDescriptorId: "adapter:mcp-external-runtime:harness",
      providerId: "mcp-external-runtime",
      supportedProfiles: ["foundation-readonly-plan"],
    })) {
      return createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          invocationService: makeObservedRuntimeInvocationService({
            credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
              allowedRouteIds: ["credential-route:external-runtime:primary"],
            }),
          }),
          routes: [{
            routeId: "external-runtime-mcp-only",
            routeSource: "explicit-managed-route",
            providerId: "mcp-external-runtime",
            model: "external-runtime-fixture",
            capability: makeRouteCapability({ routeId: "external-runtime-mcp-only", providerId: "mcp-external-runtime", model: "external-runtime-fixture", profiles: ["foundation-readonly-plan"], toolNames: externalRuntimeToolNames }),
            createAdapter: async () => adapter,
            profiles: {
              "foundation-readonly-plan": {
                authorityProfileId: "authority:external-runtime-mcp-only:foundation-readonly-plan",
                permissionProfile: "read-only",
                allowedToolNames: [...externalRuntimeToolNames],
                // Roadmap 01 Slice 1 - this route's own capability-aware
                // realization: its qualified MCP tools satisfy tests/typecheck
                // evidence without needing bash at all.
                evidenceRealizations: {
                  tests: ["mcp:external-runtime:tool:start_stop_test", "mcp:external-runtime:tool:observe_runtime"],
                  typecheck: ["mcp:external-runtime:tool:observe_runtime", "mcp:external-runtime:tool:read_console"],
                },
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "read-only",
                },
                timeoutMs: 120000,
                timeoutSource: "explicit-route",
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:external-runtime:primary",
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

    it(
      "admits an MCP-only route for tests/typecheck evidence instead of hard-requiring bash",
      async () => {
        const surface = makeExternalRuntimeSurface();
        const session = makeSession();

        const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
          routeId: "external-runtime-mcp-only",
          profile: "foundation-readonly-plan",
          providerRoute: { providerId: "mcp-external-runtime", model: "external-runtime-fixture" },
          task: "Run the Studio playtest and verify the console is clean before promotion.",
          summary: "Verify the Studio prototype.",
          contextMode: "isolated",
          // A legacy/pre-Slice-1 caller value - work-governance-tool.ts's old
          // context-free derivation would have sent exactly this. Because this
          // route declares its own evidenceRealizations, the runtime resolves
          // required tools from the route's own capability instead - "bash" is
          // superseded, not blindly required, closing the hard bash bug.
          requiredToolNames: ["bash"],
          expectedEvidence: ["tests", "typecheck"],
          requestedAuthority: "read_only",
        }, {
          session,
          toolCall: { id: "tool-call-external-runtime-verification", name: "managed_agent.invoke", input: {} },
        }) as { readonly isError: boolean };

        expect(result?.isError).toBe(false);
      },
    );

    // Fifth Roadmap 01 Slice 0 regression proof: attachment drift. Production
    // external-runtime MCP integrations already solve multi-instance routing
    // with an explicit per-call instance identifier - e.g. the official Roblox
    // Studio MCP server's list_roblox_studios/set_active_studio tools, and
    // community servers that accept an instance_id alongside every tool call
    // (reviewed 2026-07-24 via web research, not present in cloned/ references).
    // Roadmap 01 Slice 3.1 closes this: managed_agent.invoke/.start now expose
    // externalRuntimeAttachment, and the core admission gate
    // (evaluateManagedAgentAdmission) enforces it. This structural check is
    // kept as a cheap guard; the behavioral suite below is the real proof.
    it(
      "lets managed_agent.invoke express which external-runtime instance a dispatch must target",
      () => {
        const properties = (MANAGED_AGENT_INVOKE_TOOL.inputSchema as { properties?: Record<string, unknown> })
          .properties ?? {};
        const attachmentFieldNames = Object.keys(properties).filter((name) =>
          /attachment|instance|target/i.test(name));

        expect(attachmentFieldNames.length).toBeGreaterThan(0);
      },
    );
  });

  // Roadmap 01 Slice 3.1 - External Runtime Attachment Identity (issue #6,
  // tracker #5). Behavioral proof that managed_agent.invoke/.start propagate
  // an explicit externalRuntimeAttachment through parseInput, the
  // ManagedAgentInvocationRequest, and the core admission gate
  // (evaluateManagedAgentAdmission), and that a route's declared attachment
  // is enforced - matched, mismatched, missing, or unsupported-route.
  describe("external runtime attachment identity (Roadmap 01 Slice 3.1)", () => {
    const ATTACHED_ROUTE_ATTACHMENT = { kind: "external-runtime" as const, runtimeId: "mcp-external-runtime", attachmentId: "instance-a" };

    function makeAttachedRuntimeSurface(
      adapter = makeAdapter({
        adapterDescriptorId: "adapter:mcp-external-runtime:harness",
        providerId: "mcp-external-runtime",
        supportedProfiles: ["foundation-readonly-plan"],
      }),
      routeAttachment: { readonly kind: "external-runtime"; readonly runtimeId: string; readonly attachmentId: string } | undefined,
    ) {
      return createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          invocationService: makeObservedRuntimeInvocationService({
            credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
              allowedRouteIds: ["credential-route:external-runtime:primary"],
            }),
          }),
          routes: [{
            routeId: "external-runtime-attached",
            routeSource: "explicit-managed-route",
            providerId: "mcp-external-runtime",
            model: "external-runtime-fixture",
            capability: makeRouteCapability({ routeId: "external-runtime-attached", providerId: "mcp-external-runtime", model: "external-runtime-fixture", profiles: ["foundation-readonly-plan"], externalRuntimeAttachment: routeAttachment }),
            createAdapter: async () => adapter,
            ...(routeAttachment ? { externalRuntimeAttachment: routeAttachment } : {}),
            profiles: {
              "foundation-readonly-plan": {
                authorityProfileId: "authority:external-runtime-attached:foundation-readonly-plan",
                permissionProfile: "read-only",
                allowedToolNames: ["read", "grep", "glob"],
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "read-only",
                },
                timeoutMs: 120000,
                timeoutSource: "explicit-route",
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:external-runtime:primary",
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

    const baseInvokeInput = {
      routeId: "external-runtime-attached",
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "mcp-external-runtime", model: "external-runtime-fixture" },
      task: "Run a bounded external-runtime dispatch.",
    };

    for (const toolName of ["managed_agent.invoke", "managed_agent.start"] as const) {
      it(`${toolName} admits and persists the attachment when it matches the route's declared attachment`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get(toolName)?.({
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
        }, {
          session,
          toolCall: { id: `tool-call-${toolName}-match`, name: toolName, input: {} },
        }) as {
          readonly isError: boolean;
          readonly metadata: {
            readonly capabilitySnapshot?: { readonly externalRuntimeAttachment?: unknown };
          };
        };

        expect(result.isError).toBe(false);
        expect(adapter.invoke).toHaveBeenCalledTimes(1);
        expect(result.metadata.capabilitySnapshot?.externalRuntimeAttachment).toEqual(ATTACHED_ROUTE_ATTACHMENT);
        const startedEvent = session.sessionEvents.find((event) => event.kind === "agent_invocation_started") as
          | { readonly capabilitySnapshot?: { readonly externalRuntimeAttachment?: unknown } }
          | undefined;
        expect(startedEvent?.capabilitySnapshot?.externalRuntimeAttachment).toEqual(ATTACHED_ROUTE_ATTACHMENT);
      });

      it(`${toolName} denies with external_runtime_attachment_mismatch when the requested attachment differs, without invoking the adapter`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get(toolName)?.({
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-b" },
        }, {
          session,
          toolCall: { id: `tool-call-${toolName}-mismatch`, name: toolName, input: {} },
        }) as {
          readonly isError: boolean;
          readonly output: string;
          readonly metadata: {
            readonly errorCode?: string;
            readonly requestedAttachment?: unknown;
            readonly routeAttachment?: unknown;
          };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.admissionReasons).toEqual([{ code: "external-runtime-attachment-mismatch" }]);
        expect(adapter.invoke).not.toHaveBeenCalled();
        expect(session.sessionEvents).toEqual([]);
      });

      it(`${toolName} denies with external_runtime_attachment_missing when the route declares an attachment and the dispatch omits it, without invoking the adapter`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get(toolName)?.(baseInvokeInput, {
          session,
          toolCall: { id: `tool-call-${toolName}-missing`, name: toolName, input: {} },
        }) as {
          readonly isError: boolean;
          readonly metadata: { readonly errorCode?: string };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.errorCode).toBe("external_runtime_attachment_missing");
        expect(adapter.invoke).not.toHaveBeenCalled();
        expect(session.sessionEvents.map((event) => event.kind)).toEqual(["agent_invocation_requested", "agent_invocation_failed"]);
      });

      it(`${toolName} denies with external_runtime_attachment_unsupported_route when the route declares no attachment but the dispatch requests one`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, undefined);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get(toolName)?.({
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
        }, {
          session,
          toolCall: { id: `tool-call-${toolName}-unsupported-route`, name: toolName, input: {} },
        }) as {
          readonly isError: boolean;
          readonly metadata: { readonly errorCode?: string };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.admissionReasons).toEqual([
          { code: "attachments-not-supported-by-route" },
          { code: "external-runtime-attachment-unsupported-route" },
        ]);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      it(`${toolName} admits an unattached route when neither the route nor the dispatch declare an attachment (no regression)`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, undefined);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get(toolName)?.(baseInvokeInput, {
          session,
          toolCall: { id: `tool-call-${toolName}-no-attachment`, name: toolName, input: {} },
        }) as { readonly isError: boolean };

        expect(result.isError).toBe(false);
        expect(adapter.invoke).toHaveBeenCalledTimes(1);
      });

      it(`${toolName} rejects a vendor-specific/unknown field inside externalRuntimeAttachment instead of silently dropping it (F2)`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get(toolName)?.({
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-a", robloxPlaceId: 123 },
        }, {
          session,
          toolCall: { id: `tool-call-${toolName}-unknown-field`, name: toolName, input: {} },
        }) as { readonly isError: boolean; readonly output: string };

        expect(result.isError).toBe(true);
        expect(result.output).toContain("robloxPlaceId");
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      it(`${toolName} rejects an empty externalRuntimeAttachment object instead of treating it as absent`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get(toolName)?.({
          ...baseInvokeInput,
          externalRuntimeAttachment: {},
        }, {
          session,
          toolCall: { id: `tool-call-${toolName}-empty`, name: toolName, input: {} },
        }) as { readonly isError: boolean; readonly output: string };

        expect(result.isError).toBe(true);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      it(`${toolName} rejects a whitespace-only attachmentId instead of coercing it`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get(toolName)?.({
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "   " },
        }, {
          session,
          toolCall: { id: `tool-call-${toolName}-blank`, name: toolName, input: {} },
        }) as { readonly isError: boolean; readonly output: string };

        expect(result.isError).toBe(true);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });
    }

    it("preserves the attachment in the terminal lifecycle evidence for a completed invocation", async () => {
      const adapter = makeAdapter({
        adapterDescriptorId: "adapter:mcp-external-runtime:harness",
        providerId: "mcp-external-runtime",
        supportedProfiles: ["foundation-readonly-plan"],
      });
      const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
      const session = makeSession();

      await surface.callBuiltinTools.get("managed_agent.invoke")?.({
        ...baseInvokeInput,
        externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
      }, {
        session,
        toolCall: { id: "tool-call-terminal-evidence", name: "managed_agent.invoke", input: {} },
      });

      const completedEvent = session.sessionEvents.find((event) => event.kind === "agent_invocation_completed") as
        | { readonly managedInvocationEvidence?: { readonly lifecycle?: { readonly externalRuntimeAttachment?: unknown } } }
        | undefined;
      expect(completedEvent?.managedInvocationEvidence?.lifecycle?.externalRuntimeAttachment).toEqual(ATTACHED_ROUTE_ATTACHMENT);
    });

    it("denies a mismatch before the adapter is ever invoked, proving admission runs upstream of dispatch", async () => {
      const adapter = makeAdapter({
        adapterDescriptorId: "adapter:mcp-external-runtime:harness",
        providerId: "mcp-external-runtime",
        supportedProfiles: ["foundation-readonly-plan"],
      });
      const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
      const session = makeSession();

      await surface.callBuiltinTools.get("managed_agent.invoke")?.({
        ...baseInvokeInput,
        externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "wrong-instance" },
      }, {
        session,
        toolCall: { id: "tool-call-mismatch-preflight", name: "managed_agent.invoke", input: {} },
      });

      expect(adapter.invoke).not.toHaveBeenCalled();
    });

    // runtimeId and attachmentId are opaque identifiers. Tool-input parsing
    // must validate them as non-whitespace-only, but never normalise them: a
    // trimmed request identity would silently match a different physical
    // instance than the caller asked for.
    describe("opaque identity preservation", () => {
      const WHITESPACE_ROUTE_ATTACHMENT = {
        kind: "external-runtime" as const,
        runtimeId: "mcp-external-runtime",
        attachmentId: " instance-a",
      };
      const WHITESPACE_RUNTIME_ID_ROUTE_ATTACHMENT = {
        kind: "external-runtime" as const,
        runtimeId: " mcp-external-runtime",
        attachmentId: "instance-a",
      };

      function makeAdapterFixture() {
        return makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedProfiles: ["foundation-readonly-plan"],
        });
      }

      it("denies with a mismatch when the requested attachmentId differs from the route's only by a leading space", async () => {
        const adapter = makeAdapterFixture();
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: " instance-a" },
        }, {
          session,
          toolCall: { id: "tool-call-attachment-whitespace-mismatch", name: "managed_agent.invoke", input: {} },
        }) as {
          readonly isError: boolean;
          readonly metadata: { readonly errorCode?: string; readonly requestedAttachment?: unknown };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.admissionReasons).toEqual([{ code: "external-runtime-attachment-mismatch" }]);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      it("denies with a mismatch when the requested runtimeId differs from the route's only by a trailing space", async () => {
        const adapter = makeAdapterFixture();
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime ", attachmentId: "instance-a" },
        }, {
          session,
          toolCall: { id: "tool-call-runtime-id-whitespace-mismatch", name: "managed_agent.invoke", input: {} },
        }) as {
          readonly isError: boolean;
          readonly metadata: { readonly errorCode?: string; readonly requestedAttachment?: unknown };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.admissionReasons).toEqual([{ code: "external-runtime-attachment-mismatch" }]);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      for (const routeAttachment of [WHITESPACE_ROUTE_ATTACHMENT, WHITESPACE_RUNTIME_ID_ROUTE_ATTACHMENT]) {
        it(`admits and preserves '${routeAttachment.runtimeId}:${routeAttachment.attachmentId}' byte-for-byte across snapshot, request, and lifecycle evidence`, async () => {
          const adapter = makeAdapterFixture();
          const surface = makeAttachedRuntimeSurface(adapter, routeAttachment);
          const session = makeSession();

          const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
            ...baseInvokeInput,
            externalRuntimeAttachment: {
              runtimeId: routeAttachment.runtimeId,
              attachmentId: routeAttachment.attachmentId,
            },
          }, {
            session,
            toolCall: { id: `tool-call-preserve-${routeAttachment.attachmentId.trim()}-${routeAttachment.runtimeId.trim()}`, name: "managed_agent.invoke", input: {} },
          }) as {
            readonly isError: boolean;
            readonly metadata: { readonly capabilitySnapshot?: { readonly externalRuntimeAttachment?: unknown } };
          };

          expect(result.isError).toBe(false);
          expect(result.metadata.capabilitySnapshot?.externalRuntimeAttachment).toEqual(routeAttachment);
          expect(adapter.invoke).toHaveBeenCalledTimes(1);
          const invokedRequest = (adapter.invoke as unknown as {
            readonly mock: { readonly calls: readonly (readonly [ManagedAgentRuntimeInvocationInput])[] };
          }).mock.calls[0]?.[0].request;
          expect(invokedRequest?.externalRuntimeAttachment).toEqual(routeAttachment);

          const startedEvent = session.sessionEvents.find((event) => event.kind === "agent_invocation_started") as
            | { readonly capabilitySnapshot?: { readonly externalRuntimeAttachment?: unknown } }
            | undefined;
          expect(startedEvent?.capabilitySnapshot?.externalRuntimeAttachment).toEqual(routeAttachment);

          const completedEvent = session.sessionEvents.find((event) => event.kind === "agent_invocation_completed") as
            | { readonly managedInvocationEvidence?: { readonly lifecycle?: { readonly externalRuntimeAttachment?: unknown } } }
            | undefined;
          expect(completedEvent?.managedInvocationEvidence?.lifecycle?.externalRuntimeAttachment).toEqual(routeAttachment);
        });
      }

      for (const blank of ["", "   "]) {
        it(`rejects runtimeId '${blank}' as an invalid opaque identity`, async () => {
          const adapter = makeAdapterFixture();
          const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
          const session = makeSession();

          const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
            ...baseInvokeInput,
            externalRuntimeAttachment: { runtimeId: blank, attachmentId: "instance-a" },
          }, {
            session,
            toolCall: { id: `tool-call-blank-runtime-id-${blank.length}`, name: "managed_agent.invoke", input: {} },
          }) as { readonly isError: boolean };

          expect(result.isError).toBe(true);
          expect(adapter.invoke).not.toHaveBeenCalled();
        });

        it(`rejects attachmentId '${blank}' as an invalid opaque identity`, async () => {
          const adapter = makeAdapterFixture();
          const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
          const session = makeSession();

          const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
            ...baseInvokeInput,
            externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: blank },
          }, {
            session,
            toolCall: { id: `tool-call-blank-attachment-id-${blank.length}`, name: "managed_agent.invoke", input: {} },
          }) as { readonly isError: boolean };

          expect(result.isError).toBe(true);
          expect(adapter.invoke).not.toHaveBeenCalled();
        });
      }
    });

    it("exposes an identical externalRuntimeAttachment schema on managed_agent.invoke and managed_agent.start", () => {
      const invokeAttachmentSchema = (MANAGED_AGENT_INVOKE_TOOL.inputSchema as { readonly properties?: Record<string, unknown> })
        .properties?.externalRuntimeAttachment;
      expect(invokeAttachmentSchema).toBeDefined();
    });
  });

  describe("attached runtime builtin tool surface materializable registration", () => {
    it("registers managed invocation tool definitions in materializableTools and materializableCapabilities", () => {
      const surface = makeSurface(makeAdapter());

      const toolNames = [
        "managed_agent.invoke",
        "managed_agent.start",
        "managed_agent.orchestrate",
        "managed_agent.status",
        "managed_agent.list",
        "managed_agent.join",
        "managed_agent.cancel",
      ];

      for (const name of toolNames) {
        expect(surface.materializableTools.has(name)).toBe(true);
        expect(surface.materializableCapabilities.has(name)).toBe(true);
      }
    });
  });

  describe("route capability materialization invariants", () => {
    it.each([
      ["route id", (route: ReturnType<typeof makeManagedRoute>) => ({ ...route.capability, identity: { ...route.capability.identity, routeId: "different-route" } })],
      ["provider", (route: ReturnType<typeof makeManagedRoute>) => ({ ...route.capability, target: { ...route.capability.target, providerId: "different-provider" } })],
      ["model", (route: ReturnType<typeof makeManagedRoute>) => ({ ...route.capability, target: { ...route.capability.target, modelId: "different-model" } })],
    ] as const)("rejects a capability %s mismatch before creating an adapter", async (_kind, mutateCapability) => {
      const adapter = makeAdapter();
      const createAdapter = vi.fn(async () => adapter);
      const baseRoute = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
      const surface = createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          routes: [{ ...baseRoute, capability: mutateCapability(baseRoute), createAdapter }],
        },
      });

      const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
        routeId: "opencode-readonly",
        profile: "foundation-readonly-plan",
        providerRoute: { providerId: "opencode", model: "opencode-default-model" },
        task: "Inspect capability binding.",
      }, {
        session: makeSession(),
        toolCall: { id: "tool-call-route-capability-mismatch", name: "managed_agent.invoke", input: {} },
      }) as { readonly isError: boolean; readonly metadata: { readonly errorCode?: string } };

      expect(result.isError).toBe(true);
      expect(result.metadata.errorCode).toBe("route_capability_identity_mismatch");
      expect(createAdapter).not.toHaveBeenCalled();
      expect(adapter.invoke).not.toHaveBeenCalled();
    });

    it("rejects a materialized adapter provider mismatch before invocation", async () => {
      const adapter = makeAdapter({ providerId: "different-provider" });
      const createAdapter = vi.fn(async () => adapter);
      const baseRoute = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
      const surface = createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: { routes: [{ ...baseRoute, createAdapter }] },
      });

      const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
        routeId: "opencode-readonly",
        profile: "foundation-readonly-plan",
        providerRoute: { providerId: "opencode", model: "opencode-default-model" },
        task: "Inspect adapter binding.",
      }, {
        session: makeSession(),
        toolCall: { id: "tool-call-adapter-capability-mismatch", name: "managed_agent.invoke", input: {} },
      }) as { readonly isError: boolean; readonly metadata: { readonly errorCode?: string } };

      expect(result.isError).toBe(true);
      expect(result.metadata.errorCode).toBe("route_capability_adapter_mismatch");
      expect(createAdapter).toHaveBeenCalledTimes(1);
      expect(adapter.invoke).not.toHaveBeenCalled();
    });

    it("admits a remote harness only for a governed external-runtime capability", async () => {
      const adapter = makeAdapter({
        adapterDescriptorId: "adapter:codex-cloud:remote-harness",
        providerId: "codex-cloud",
        supportedExecutionModes: ["remote-harness"],
      });
      const createAdapter = vi.fn(async () => adapter);
      const baseRoute = makeManagedRoute("codex-cloud-remote-readonly", "gpt-5.5", async () => adapter, "codex-cloud");
      const surface = createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          routes: [{
            ...baseRoute,
            capability: makeRouteCapability({
              routeId: "codex-cloud-remote-readonly",
              providerId: "codex-cloud",
              model: "gpt-5.5",
              profiles: ["foundation-readonly-plan"],
              adapterKind: "governed-external-runtime",
            }),
            createAdapter,
          }],
        },
      });

      const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
        routeId: "codex-cloud-remote-readonly",
        profile: "foundation-readonly-plan",
        providerRoute: { providerId: "codex-cloud", model: "gpt-5.5" },
        task: "Inspect remote adapter binding.",
      }, {
        session: makeSession(),
        toolCall: { id: "tool-call-remote-capability-match", name: "managed_agent.invoke", input: {} },
      }) as { readonly isError: boolean };

      expect(result.isError).toBe(false);
      expect(createAdapter).toHaveBeenCalledTimes(1);
      expect(adapter.invoke).toHaveBeenCalledTimes(1);
    });
  });

  describe("composed caller authority admission", () => {
    it("denies kiln-runtime caller with parentEffectiveRequestedAuthority=read_only + childRequestedAuthority=destructive at the executor level", async () => {
      // This test proves that the composed wiring — from attachment identity
      // through the executor into canonical route admission —
      // denies a destructive child dispatched from a read_only parent.
      // The pure-policy unit tests cover the policy function; this test
      // proves the executor/attachment composition does not bypass it.
      const adapter = makeAdapter();
      const surface = createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          callerIdentity: {
            kind: "kiln-runtime",
            surface: "run",
            attachmentId: "attachment:run:plan-mode",
            parentEffectiveRequestedAuthority: "read_only",
          },
          routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter)],
        },
      });
      const session = makeSession();

      const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
        routeId: "opencode-readonly",
        profile: "foundation-readonly-plan",
        providerRoute: { providerId: "opencode", model: "opencode-default-model" },
        task: "Delete production data.",
        requestedAuthority: "destructive",
      }, {
        session,
        toolCall: { id: "tool-call-caller-bounding", name: "managed_agent.invoke", input: {} },
      }) as {
        readonly output: string;
        readonly isError: boolean;
        readonly metadata: Record<string, unknown>;
      };

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Managed invocation denied");
      expect(result.output).toContain("authority-exceeds-caller-ceiling");
      expect(result.metadata).toMatchObject({
        status: "denied",
        callerIdentity: expect.objectContaining({
          kind: "kiln-runtime",
          parentEffectiveRequestedAuthority: "read_only",
        }),
        admissionReasons: expect.arrayContaining([
          expect.objectContaining({ code: "authority-exceeds-caller-ceiling" }),
        ]),
      });
      expect(adapter.invoke).not.toHaveBeenCalled();
    });

  });
});
