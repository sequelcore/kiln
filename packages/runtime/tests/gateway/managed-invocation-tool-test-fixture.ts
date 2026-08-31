import { expect, vi } from "vitest";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  type ManagedAgentAdapterDescriptor,
  type ManagedAgentAccess,
  type ManagedAgentCallerAttachmentIdentity,
  type ManagedAgentInvocationRequest,
  type RouteCapability,
} from "@kilnai/core/agents";
import type { StructuredExecutionResult } from "@kilnai/core/efficiency";
import { textParts } from "@kilnai/core/engine";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import {
  createAttachedRuntimeBuiltinToolSurface as createRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationInput,
} from "../../src/agents/managed-invocation/index.js";
import {
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import {
  type ManagedInvocationSessionEventSink,
  type ManagedInvocationToolOptions,
} from "../../src/agents/managed-invocation/runtime-tool/index.js";
import type {
  ManagedInvocationToolResult,
  ManagedInvocationToolRoute,
} from "../../src/agents/managed-invocation/runtime-tool/types.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { EffectiveTurnAuthoritySnapshot } from "../../src/session/runtime-session-orchestrator.types.js";
import { withAdmittedRuntimeCalls } from "./attached-runtime-admission-fixture.js";

export const TEST_HANDOFF_PROVENANCE = {
  delivery: "runtime-generated",
  configuredModelId: "test-model",
  observedModelIds: [],
} as const;

export const TEST_DESTRUCTIVE_PARENT_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "destructive",
  admittedAuthority: "destructive",
  sourcePolicy: "runtime_surface_projection",
  reason: "managed invocation test parent turn authority is explicitly admitted",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} satisfies EffectiveTurnAuthoritySnapshot;

export const TEST_READ_ONLY_PARENT_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "read_only",
  admittedAuthority: "read_only",
  sourcePolicy: "runtime_surface_projection",
  reason: "managed invocation test parent turn authority is explicitly admitted",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} satisfies EffectiveTurnAuthoritySnapshot;

export const TEST_REQUESTED_DESTRUCTIVE_READ_ONLY_PARENT_AUTHORITY = {
  ...TEST_READ_ONLY_PARENT_AUTHORITY,
  requestedAuthority: "destructive",
} satisfies EffectiveTurnAuthoritySnapshot;

export function assertManagedToolResult(value: unknown): ManagedInvocationToolResult {
  if (
    typeof value !== "object"
    || value === null
    || !("output" in value)
    || typeof value.output !== "string"
    || !("isError" in value)
    || typeof value.isError !== "boolean"
    || !("metadata" in value)
    || typeof value.metadata !== "object"
    || value.metadata === null
  ) {
    throw new Error("Expected a managed invocation tool result.");
  }
  return value as ManagedInvocationToolResult;
}

export function createAttachedRuntimeBuiltinToolSurface(
  options: Omit<NonNullable<Parameters<typeof createRuntimeBuiltinToolSurface>[0]>, "managedInvocation"> & {
    readonly managedInvocation?: ManagedInvocationToolOptions & {
      readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
    };
    readonly testEffectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot | null;
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
  const surface = createRuntimeBuiltinToolSurface({
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
  const hasTestAuthority = Object.prototype.hasOwnProperty.call(options, "testEffectiveTurnAuthority");
  const testEffectiveTurnAuthority = hasTestAuthority
    ? options.testEffectiveTurnAuthority ?? undefined
    : {
        ...TEST_DESTRUCTIVE_PARENT_AUTHORITY,
        requestedAuthority: "read_only",
      } satisfies EffectiveTurnAuthoritySnapshot;
  if (!managedInvocation || testEffectiveTurnAuthority === undefined) return surface;
  return withAdmittedRuntimeCalls(surface, {
    effectiveTurnAuthority: testEffectiveTurnAuthority,
    preserveMissingContext: true,
  });
}

export function makeSession(sessionId = "session-parent"): RuntimeSession {
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

export function makeDescriptor(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:opencode:harness",
    providerId: "opencode",
    adapterKind: "harness",
    supportedAccess: ["read-only"],
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

export function makeAdapter(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentRuntimeAdapter {
  return makeAdapterWithHandoff("Child review completed.", overrides);
}

export function makeAdapterWithHandoff(
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
        access: request.access,
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

export function makeAdapterWithProgressHandoff(summary: string): ManagedAgentRuntimeAdapter {
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
        access: request.access,
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

export function makeTimedOutAdapter(): ManagedAgentRuntimeAdapter {
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
        access: request.access,
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

export function deferred<T>(): {
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

export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

export async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}

export function expectPublicResourceLeaseMetadata(lease: unknown): void {
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

export const SENSITIVE_RESOURCE_LEASE_KEY_PATTERN = /secret|token|password|api[_-]?key|authorization|auth[_-]?token|credential[_-]?value/iu;
export const SENSITIVE_RESOURCE_LEASE_VALUE_PATTERN = /(?:secret|token|password|api[_-]?key|authorization|auth[_-]?token|credential[_-]?value)\s*[:=]|bearer\s+[A-Za-z0-9._~+/-]+=*/iu;
export const PUBLIC_RESOURCE_LEASE_URI_PATTERN = /^kiln:\/\/artifacts\//iu;

export function expectResourceLeaseMetadataKeysPublic(value: unknown): void {
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

export function makeDeferredAdapter(): {
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

export function makeProgressReportingDeferredAdapter(): {
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

export function makeRejectingDeferredAdapter(): {
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

export function makeAbortableDeferredAdapter(): {
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

export function makeRuntimeAuthorityObserver() {
  return {
    observe: vi.fn(async ({ request }: { readonly request: ManagedAgentInvocationRequest }) => {
      const observedAt = new Date(Date.now()).toISOString();
      const validUntil = new Date(Date.now() + 60_000).toISOString();
      return {
        approval: "on-request" as const,
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

export function makeObservedRuntimeInvocationService(
  options: NonNullable<ConstructorParameters<typeof RuntimeManagedAgentInvocationService>[0]> = {},
): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    ...options,
    authorityObserver: options.authorityObserver ?? makeRuntimeAuthorityObserver(),
  });
}

export function makeSurface(
  adapter = makeAdapter(),
  sessionEventSink?: ManagedInvocationSessionEventSink,
  artifactStore?: MemoryArtifactResourceStore,
  options: {
    readonly observeRuntimeAuthority?: boolean;
    readonly testEffectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot | null;
  } = {},
) {
  return createAttachedRuntimeBuiltinToolSurface({
    ...(artifactStore ? { builtinToolOptions: { artifactResources: { store: artifactStore } } } : {}),
    managedInvocation: makeSurfaceOptions(adapter, sessionEventSink, artifactStore, options),
    ...(Object.prototype.hasOwnProperty.call(options, "testEffectiveTurnAuthority")
      ? { testEffectiveTurnAuthority: options.testEffectiveTurnAuthority }
      : {}),
  });
}

export function makeSurfaceOptions(
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
          proof: { status: "configured", source: "test", provenAccess: ["read-only"] }, capacity: { kind: "accountless" }, settlement: { kind: "not-required" },
        },
        createAdapter: async () => adapter,
        profiles: [{
            authorityProfileId: "authority:opencode:readonly",
            access: "read-only",
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
        }],
      }],
  };
}

export function makeRouteCapability(input: {
  readonly routeId: string;
  readonly providerId: string;
  readonly model: string;
  readonly profiles: readonly ManagedAgentAccess[];
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
    proof: { status: "configured", source: "test", provenAccess: input.profiles },
    capacity: { kind: "accountless" },
    settlement: { kind: "not-required" },
  };
}

export function makeManagedRoute(
  routeId: string,
  model: string,
  createAdapter: () => Promise<ManagedAgentRuntimeAdapter | undefined> = async () => makeAdapter(),
  providerId = "opencode",
): ManagedInvocationToolRoute {
  return {
    routeId,
    routeSource: "explicit-managed-route" as const,
    providerId,
    model,
    capability: makeRouteCapability({ routeId, providerId, model, profiles: ["read-only"] }),
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
    profiles: [{
        authorityProfileId: `authority:${routeId}:read-only`,
        access: "read-only",
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
    }],
  };
}
