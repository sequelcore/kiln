import "./gui-gateway-test-fixture.js";
import * as guiFixture from "./gui-gateway-test-fixture.js";
import {
  rmSync,
} from "node:fs";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentWriteAuthority,
  type ManagedAgentInvocationRequest,
  type ManagedAgentInvocationRecord,
} from "@kilnai/core/agents";
import { GPT4O } from "../../src/agents/provider-adapters/openai.js";
import {
  textParts,
} from "@kilnai/core/engine";
import {
  createOperatorCockpitReadOnlyViewState,
  projectOperatorCockpitReadOnlyView,
  type OperatorSessionEvent,
} from "@kilnai/gateway-contracts";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  processAdmittedTurn,
} from "../../src/gateway/message-pipeline/index.js";
import {
  createManagedInvocationLifecycleToolExecutors,
  type ManagedInvocationToolAttachment,
  type ManagedInvocationToolOptions,
} from "../../src/agents/managed-invocation/runtime-tool/index.js";
import type {
  ManagedInvocationToolResult,
} from "../../src/agents/managed-invocation/runtime-tool/types.js";
import {
  ManagedAgentWorktreeReviewRequiredError,
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
  type ManagedAgentWorktreeLeaseManager,
  type ManagedAgentRuntimeAdapter,
} from "../../src/agents/managed-invocation/index.js";
import { runtimeCompletedDisposition } from "../session/runtime-terminal-fixture.js";
import {
  RuntimeSession,
} from "../../src/session/runtime-session.js";
import type {
  EffectiveTurnAuthoritySnapshot,
} from "../../src/session/runtime-session-orchestrator.types.js";

const {guiOperatorTransportDefaults, createGuiDist, flushAsyncWork, waitForCondition, selectGuiTestExecutionTarget, makeGuiOperatorDiscoveryFromModels} = guiFixture;
const TEST_PARENT_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "read_only",
  admittedAuthority: "destructive",
  sourcePolicy: "runtime_surface_projection",
  reason: "GUI test parent turn authority is explicitly admitted",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} satisfies EffectiveTurnAuthoritySnapshot;

const TEST_WRITE_PARENT_AUTHORITY = {
  ...TEST_PARENT_AUTHORITY,
  requestedAuthority: "destructive",
} satisfies EffectiveTurnAuthoritySnapshot;

const guiSocketHarness = guiFixture.getGuiSocketHarness();

function makeToolCallingProvider(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
  finalText: string,
) {
  let round = 0;
  return {
    name: "openai",
    createMessage: vi.fn(async () => {
      round += 1;
      return round === 1
        ? {
            parts: textParts("Calling the admitted tool."),
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [{ id: toolCallId, name: toolName, input }],
            stopReason: "tool_use" as const,
          }
        : {
            parts: textParts(finalText),
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn" as const,
          };
    }),
    streamMessage: vi.fn() as never,
  };
}

function makeGuiRuntimeAuthorityObserver() {
  return {
    observe: vi.fn(async ({ request }: { readonly request: ManagedAgentInvocationRequest }) => ({
      approval: "on-request" as const,
      sandbox: request.authority.toolAuthority.writeAllowed === true && request.authority.workingDirectory.mode !== "read-only"
        ? "workspace-write" as const
        : "read-only" as const,
      source: "runtime-observation" as const,
      proof: "proven" as const,
      observedAt: "2026-07-02T08:00:00.000Z",
      validUntil: "2099-01-01T00:00:00.000Z",
    })),
  };
}

function makeManagedInvocationOptions(): ManagedInvocationToolOptions & { readonly routeAdapter: ManagedAgentRuntimeAdapter } {
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: defineManagedAgentAdapterDescriptor({
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
    }),
    invoke: vi.fn(async ({ request, admission }: {
      readonly request: ManagedAgentInvocationRequest;
      readonly admission: { readonly capabilitySnapshot: ReturnType<typeof buildManagedAgentCapabilitySnapshot> };
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
          summary: "GUI child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
        },
      })),
  };

  return {
    invocationService: new RuntimeManagedAgentInvocationService({
      authorityObserver: makeGuiRuntimeAuthorityObserver(),
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: ["credential-route:opencode:runtime-selected"],
      }),
    }),
    routes: [{
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
      providerId: "opencode",
      model: "openai/gpt-4o:free",
      surface: "cli-harness",
      capability: {
        identity: { routeId: "opencode-readonly", revision: "test-v1" },
        target: { providerId: "opencode", modelId: "openai/gpt-4o:free" },
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
      createAdapter: async () => adapter,
      profiles: [{
          authorityProfileId: "authority:opencode-readonly:foundation-readonly-plan",
          admissionProfile: "foundation-readonly-plan",
          permissionProfile: "read-only",
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
          workingDirectory: {
            path: "C:/workspace/kiln",
            mode: "read-only",
          },
          timeoutMs: 120000,
          credentialRoute: {
            mode: "runtime-selected",
            routeId: "credential-route:opencode:runtime-selected",
          },
          memoryScope: {
            scope: { kind: "project", id: "kiln" },
            access: "read-only",
          },
      }],
    }],
    requestedBy: "assistant",
    requestSource: "gui",
    routeAdapter: adapter,
  };
}

function makeManagedInvocationAttachment(
  options: ManagedInvocationToolOptions = makeManagedInvocationOptions(),
): ManagedInvocationToolAttachment {
  return {
    options,
    callerIdentity: {
      kind: "kiln-runtime",
      surface: "gui-test",
      attachmentId: "attachment:gui-test",
    },
  };
}

function createTestManagedInvocationExecutors(attachment: ManagedInvocationToolAttachment) {
  const executors = createManagedInvocationLifecycleToolExecutors(attachment);
  const wrapped = new Map<string, typeof executors extends ReadonlyMap<string, infer E> ? E : never>();
  for (const [toolName, executor] of executors) {
    wrapped.set(toolName, async (input, context) => {
      if (!context) return executor(input, context);
      return executor(input, {
        ...context,
        ...(context.effectiveTurnAuthority
          ? { effectiveTurnAuthority: context.effectiveTurnAuthority }
          : { effectiveTurnAuthority: TEST_PARENT_AUTHORITY }),
      });
    });
  }
  return wrapped;
}

function makeManagedWriteConflictFixture(): {
  readonly invocationService: RuntimeManagedAgentInvocationService;
  readonly managedInvocation: ManagedInvocationToolOptions;
  readonly releaseActive: { resolve?: () => void };
  readonly startInput: {
    readonly profile: "foundation-apply-approved-writes";
    readonly routeId: "opencode-approved-write";
    readonly providerRoute: {
      readonly providerId: "opencode";
      readonly model: "opencode-default-model";
    };
    readonly requestedAuthority: "audited";
    readonly task: "Apply the approved runtime edit.";
  };
} {
  const invocationService = new RuntimeManagedAgentInvocationService({
    authorityObserver: makeGuiRuntimeAuthorityObserver(),
  });
  const releaseActive = { resolve: undefined as (() => void) | undefined };
  const activeCompleted = new Promise<void>((resolve) => {
    releaseActive.resolve = resolve;
  });
  const writeAdapter: ManagedAgentRuntimeAdapter = {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:opencode:approved-write",
      providerId: "opencode",
      adapterKind: "harness",
      supportedProfiles: ["foundation-apply-approved-writes"],
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
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: false,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    }),
    invoke: async ({ request, admission }) => {
      await activeCompleted;
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
    },
  };
  const managedInvocation = {
    invocationService,
    routes: [{
      routeId: "opencode-approved-write",
      routeSource: "explicit-managed-route",
      providerId: "opencode",
      model: "opencode-default-model",
      capability: {
        identity: { routeId: "opencode-approved-write", revision: "test-v1" },
        target: { providerId: "opencode", modelId: "opencode-default-model" },
        adapter: { kind: "cli-harness", capabilityId: "opencode-approved-write", capabilityVersion: "test-v1" },
        authorityCeiling: "destructive",
        toolNames: ["read", "grep", "apply-patch"],
        supportsRecursion: true,
        supportsAttachments: false,
        supportsWrite: true,
        proof: { status: "configured", source: "test-fixture", provenProfiles: ["foundation-apply-approved-writes"] },
        capacity: { kind: "accountless" },
        settlement: { kind: "not-required" },
      },
      createAdapter: async () => writeAdapter,
      profiles: [{
          authorityProfileId: "authority:opencode:approved-write",
          admissionProfile: "foundation-apply-approved-writes",
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
      }],
    }],
    requestedBy: "assistant",
    requestSource: "gui",
  } satisfies ManagedInvocationToolOptions;
  const startInput = {
    profile: "foundation-apply-approved-writes",
    routeId: "opencode-approved-write",
    providerRoute: {
      providerId: "opencode",
      model: "opencode-default-model",
    },
    requestedAuthority: "audited",
    task: "Apply the approved runtime edit.",
  } as const;

  return {
    invocationService,
    managedInvocation,
    releaseActive,
    startInput,
  };
}

function makeManagedDirtyWorktreeReviewFixture(): {
  readonly invocationService: RuntimeManagedAgentInvocationService;
  readonly managedInvocation: ManagedInvocationToolOptions;
  readonly completeChild: { resolve?: () => void };
  readonly startInput: {
    readonly profile: "foundation-apply-approved-writes";
    readonly routeId: "opencode-isolated-write";
    readonly providerRoute: {
      readonly providerId: "opencode";
      readonly model: "opencode-default-model";
    };
    readonly requestedAuthority: "audited";
    readonly task: "Apply the approved runtime edit in an isolated worktree.";
  };
} {
  const completeChild = { resolve: undefined as (() => void) | undefined };
  const childCompleted = new Promise<void>((resolve) => {
    completeChild.resolve = resolve;
  });
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
  const invocationService = new RuntimeManagedAgentInvocationService({
    authorityObserver: makeGuiRuntimeAuthorityObserver(),
    worktreeLeaseManager,
  });
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:opencode:isolated-write",
      providerId: "opencode",
      adapterKind: "harness",
      supportedProfiles: ["foundation-apply-approved-writes"],
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
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: false,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    }),
    invoke: async ({ request, admission }) => {
      await childCompleted;
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
          summary: "Gateway isolated worktree child completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/handoff`],
          memoryWriteProposalUris: [],
        },
      });
    },
  };
  const managedInvocation = {
    invocationService,
    routes: [{
      routeId: "opencode-isolated-write",
      routeSource: "explicit-managed-route",
      providerId: "opencode",
      model: "opencode-default-model",
      capability: {
        identity: { routeId: "opencode-isolated-write", revision: "test-v1" },
        target: { providerId: "opencode", modelId: "opencode-default-model" },
        adapter: { kind: "cli-harness", capabilityId: "opencode-isolated-write", capabilityVersion: "test-v1" },
        authorityCeiling: "destructive",
        toolNames: ["read", "grep", "apply-patch"],
        supportsRecursion: true,
        supportsAttachments: false,
        supportsWrite: true,
        proof: { status: "configured", source: "test-fixture", provenProfiles: ["foundation-apply-approved-writes"] },
        capacity: { kind: "accountless" },
        settlement: { kind: "not-required" },
      },
      createAdapter: async () => adapter,
      profiles: [{
          authorityProfileId: "authority:opencode:isolated-write",
          admissionProfile: "foundation-apply-approved-writes",
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
                deniedToolNames: ["git-commit"],
              },
            },
            approval: {
              mode: "required-before-apply",
              evidenceRequired: true,
            },
          }),
      }],
    }],
    requestedBy: "assistant",
    requestSource: "gui",
  } satisfies ManagedInvocationToolOptions;
  const startInput = {
    profile: "foundation-apply-approved-writes",
    routeId: "opencode-isolated-write",
    providerRoute: {
      providerId: "opencode",
      model: "opencode-default-model",
    },
    requestedAuthority: "audited",
    task: "Apply the approved runtime edit in an isolated worktree.",
  } as const;

  return {
    invocationService,
    managedInvocation,
    completeChild,
    startInput,
  };
}

const TEST_HANDOFF_PROVENANCE = {
  delivery: "runtime-generated",
  configuredModelId: "test-model",
  observedModelIds: [],
} as const;

function assertManagedToolResult(value: unknown): asserts value is ManagedInvocationToolResult {
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
}

describe("GUI gateway managed control", () => {
  it("streams managed invocation session events from a GUI turn", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const session = new RuntimeSession({
        sessionId: "gui-parent-session",
        appName: "kiln-gui",
        tenantId: "gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      session.addUserMessage(textParts("Delegate a managed read-only review."));
      const managedInvoke = input.callBuiltinTools?.get("managed_agent.invoke");
      if (!managedInvoke) {
        throw new Error("managed_agent.invoke was not attached to the GUI turn surface");
      }
      const managedInvokePermission = input.perCallConfig?.authorityAdmission?.turn.tools.allowedToolPermissions
        .find((permission) => permission.toolName === "managed_agent.invoke");
      expect(managedInvokePermission?.authority).toMatchObject({
        allowed: false,
        requiresApproval: true,
      });

      const toolResult = await managedInvoke({
        profile: "foundation-readonly-plan",
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "openai/gpt-4o:free",
        },
        task: "Inspect the managed invocation docs and report risks.",
      }, {
        session,
        effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
        toolCall: {
          id: "tool-call-managed-1",
          name: "managed_agent.invoke",
          input: {},
        },
      });
      assertManagedToolResult(toolResult);

      expect(toolResult.isError).toBe(false);
      expect(toolResult.output).toContain("GUI child review completed.");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Parent turn completed." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-gui",
          ...runtimeCompletedDisposition(),
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
       getSnapshot: async () => ({ } as never),
       managedInvocation: makeManagedInvocationAttachment(),
       operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "delegate from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: { kind: string; payload: Record<string, unknown> };
      });
      const sessionEventFrames = outboundFrames.filter((frame) => frame.type === "session_event");

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "Parent turn completed.",
      }));
      expect(sessionEventFrames.map((frame) => frame.event?.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        "agent_invocation_completed",
      ]);
      expect(sessionEventFrames.map((frame) => frame.event?.payload.instanceId)).toEqual([
        "local-gui",
        "local-gui",
        "local-gui",
      ]);
      expect(sessionEventFrames.map((frame) => frame.event?.payload.sessionId)).toEqual([
        "gui-parent-session",
        "gui-parent-session",
        "gui-parent-session",
      ]);
      expect(sessionEventFrames[2]?.event?.payload).toMatchObject({
        resultSummary: "GUI child review completed.",
        managedInvocationEvidence: {
          childSessionId: expect.stringContaining("gui-parent-session:managed:"),
        },
      });
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses the exact admitted provider when a managed-agent route is unavailable", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const actualMessagePipeline = await vi.importActual<typeof import("../../src/gateway/message-pipeline/index.js")>(
      "../../src/gateway/message-pipeline/index.js",
    );
    const unavailableReason = "Direct provider route 'openrouter-readonly' requires a tool-call-capable model.";
    const toolInput = {
      profile: "foundation-readonly-plan",
      routeId: "openrouter-readonly",
      providerRoute: {
        providerId: "openrouter",
        model: "openrouter/free",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
    };
    const toolCallId = "tool-call-managed-start-unavailable";
    const managedInvocation = {
      ...makeManagedInvocationOptions(),
      routes: [],
      unavailableRoutes: [{
        routeId: "openrouter-readonly",
        routeSource: "explicit-managed-route",
        providerId: "openrouter",
        model: "openrouter/free",
        profiles: ["foundation-readonly-plan" as const],
        reason: unavailableReason,
      }],
    } satisfies ManagedInvocationToolOptions;
    const startManagedAgent = createTestManagedInvocationExecutors(
      makeManagedInvocationAttachment(managedInvocation),
    ).get("managed_agent.start");
    if (!startManagedAgent) {
      throw new Error("managed_agent.start executor was not registered");
    }
    const toolResult = await startManagedAgent(toolInput, {
      session: new RuntimeSession({
        sessionId: "gui-route-unavailable-parent",
        appName: "kiln-gui",
        tenantId: "gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      }),
      effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
      toolCall: {
        id: toolCallId,
        name: "managed_agent.start",
        input: toolInput,
      },
    });
    if (!toolResult || typeof toolResult !== "object" || Array.isArray(toolResult)) {
      throw new Error("managed_agent.start returned a non-object result");
    }
    const managedToolResult = toolResult as {
      output: string;
      outputSummary?: string;
      isError?: boolean;
      metadata?: Record<string, unknown>;
    };
    const expectedMetadata = managedToolResult.metadata;
    const runtimePresentationIntent = expectedMetadata?.presentationIntent;
    expect(managedToolResult.isError).toBe(true);
    expect(expectedMetadata).toMatchObject({
      toolName: "managed_agent.start",
      kind: "managed-invocation",
      routeId: "openrouter-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "openrouter",
        model: "openrouter/free",
      },
      status: "unavailable",
    });
    expect(runtimePresentationIntent).toMatchObject({
      source: "managed_agent.start",
      rows: [
        expect.objectContaining({
          routeId: "openrouter-readonly",
          provider: "openrouter",
          model: "openrouter/free",
          profile: "foundation-readonly-plan",
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: unavailableReason,
        }),
      ],
    });
    const createProvider = vi.fn(async () => makeToolCallingProvider(
      toolCallId,
      "managed_agent.start",
      toolInput,
      "The managed child route is unavailable before invocation.",
    ));
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(actualMessagePipeline.processAdmittedTurn);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
       managedInvocation: makeManagedInvocationAttachment(managedInvocation),
      operatorTransport: {
        ...guiOperatorTransportDefaults,
          createProvider,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start unavailable child" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: {
          eventId: string;
            kind: OperatorSessionEvent["kind"];
          parentEventId?: string;
          payload: Record<string, unknown>;
        };
      });
      const sessionEventFrames = outboundFrames.filter((frame) => frame.type === "session_event");
      const managedLifecycleFrames = sessionEventFrames.filter((frame) =>
        frame.event?.kind.startsWith("agent_invocation_")
      );
      const admittedTurn = vi.mocked(processAdmittedTurn).mock.calls[0]?.[0];

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "The managed child route is unavailable before invocation.",
      }));
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
      expect(admittedTurn?.callBuiltinTools?.get("managed_agent.start")).toEqual(expect.any(Function));
      expect(admittedTurn?.perCallConfig?.authorityAdmission?.turn.tools.allowedToolPermissions.some(
        (permission) => permission.toolName === "managed_agent.start",
      )).toBe(true);
      expect(admittedTurn?.perCallConfig?.additionalTools?.some((tool) => tool.name === "managed_agent.start")).toBe(
        true,
      );
      expect(managedLifecycleFrames).toEqual([]);
      expect(sessionEventFrames.some((frame) => frame.event?.kind === "cost_updated")).toBe(true);
      expect(sessionEventFrames.some((frame) => frame.event?.kind === "lifecycle_attribution_recorded")).toBe(true);
      expect(createProvider).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "missing required tools",
      createManagedInvocation: () => makeManagedInvocationOptions(),
      toolInput: {
        profile: "foundation-readonly-plan",
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "openai/gpt-4o:free",
        },
        task: "Collect visual-reference-research.",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_observe"],
        requestedAuthority: "read_only",
      },
      expectedMetadata: {
        routeId: "opencode-readonly",
        missingRequiredTools: ["web_search", "browser_observe"],
        requiredToolNames: ["web_search", "browser_observe"],
        allowedToolNames: ["read", "grep", "glob"],
      },
      expectedFailureReason: "Missing required route tools: web_search, browser_observe",
    },
    {
      label: "missing required capabilities",
      createManagedInvocation: () => {
        const base = makeManagedInvocationOptions();
        const route = base.routes[0]!;
        const profile = route.profiles[0]!;
        return {
          ...base,
          routes: [{
            ...route,
            routeId: "opencode-readonly-visual-without-network",
            capability: {
              ...route.capability,
              identity: { ...route.capability.identity, routeId: "opencode-readonly-visual-without-network" },
              toolNames: ["read", "grep", "glob", "web_search", "browser_observe"],
            },
            profiles: [{
                ...profile,
                allowedToolNames: ["read", "grep", "glob", "web_search", "browser_observe"],
                networkAllowed: false,
            }],
          }],
        } satisfies ManagedInvocationToolOptions;
      },
      toolInput: {
        profile: "foundation-readonly-plan",
        routeId: "opencode-readonly-visual-without-network",
        providerRoute: {
          providerId: "opencode",
          model: "openai/gpt-4o:free",
        },
        task: "Collect visual-reference-research.",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_observe"],
        requestedAuthority: "read_only",
      },
      expectedMetadata: {
        routeId: "opencode-readonly-visual-without-network",
        missingRequiredCapabilities: ["network"],
        requiredToolNames: ["web_search", "browser_observe"],
      },
      expectedFailureReason: "Missing required route capabilities: network",
    },
  ])("uses the exact admitted provider after $label admission", async ({
    createManagedInvocation,
    toolInput,
    expectedMetadata,
    expectedFailureReason,
  }) => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const actualMessagePipeline = await vi.importActual<typeof import("../../src/gateway/message-pipeline/index.js")>(
      "../../src/gateway/message-pipeline/index.js",
    );
    const managedInvocation = createManagedInvocation();
    const toolCallId = `tool-call-managed-start-${expectedMetadata.routeId}`;
    const startManagedAgent = createTestManagedInvocationExecutors(
      makeManagedInvocationAttachment(managedInvocation),
    ).get("managed_agent.start");
    if (!startManagedAgent) {
      throw new Error("managed_agent.start executor was not registered");
    }
    const toolResult = await startManagedAgent(toolInput, {
      session: new RuntimeSession({
        sessionId: `gui-${expectedMetadata.routeId}-parent`,
        appName: "kiln-gui",
        tenantId: "gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      }),
      effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
      toolCall: {
        id: toolCallId,
        name: "managed_agent.start",
        input: toolInput,
      },
    });
    if (!toolResult || typeof toolResult !== "object" || Array.isArray(toolResult)) {
      throw new Error("managed_agent.start returned a non-object result");
    }
    const managedToolResult = toolResult as {
      output: string;
      outputSummary?: string;
      isError?: boolean;
      metadata?: Record<string, unknown>;
    };
    const runtimeMetadata = managedToolResult.metadata;
    const runtimePresentationIntent = runtimeMetadata?.presentationIntent;
    expect(managedToolResult.isError).toBe(true);
    const canonicalAdmissionDenied = expectedMetadata.routeId === "opencode-readonly";
    expect(runtimeMetadata).toMatchObject({
      toolName: "managed_agent.start",
      kind: "managed-invocation",
      profile: "foundation-readonly-plan",
      ...(canonicalAdmissionDenied
        ? {
            status: "denied",
            admissionReasons: [
              { code: "missing-tool", requiredToolName: "web_search" },
              { code: "missing-tool", requiredToolName: "browser_observe" },
            ],
          }
        : { status: "unavailable", ...expectedMetadata }),
    });
    if (canonicalAdmissionDenied) expect(runtimePresentationIntent).toBeUndefined();
    else expect(runtimePresentationIntent).toMatchObject({
      source: "managed_agent.start",
      rows: [
        expect.objectContaining({
          routeId: expectedMetadata.routeId,
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: expectedFailureReason,
        }),
      ],
    });
    const createProvider = vi.fn(async () => makeToolCallingProvider(
      toolCallId,
      "managed_agent.start",
      toolInput,
      "The managed child route requirements are unavailable before invocation.",
    ));
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(actualMessagePipeline.processAdmittedTurn);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        managedInvocation: makeManagedInvocationAttachment(managedInvocation),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          createProvider,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start unavailable child requirements" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: { kind: string; payload: Record<string, unknown> };
      });
      const sessionEventFrames = outboundFrames.filter((frame) => frame.type === "session_event");
      const managedLifecycleFrames = sessionEventFrames.filter((frame) =>
        frame.event?.kind.startsWith("agent_invocation_")
      );
      const admittedTurn = vi.mocked(processAdmittedTurn).mock.calls[0]?.[0];

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "The managed child route requirements are unavailable before invocation.",
      }));
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
      expect(admittedTurn?.callBuiltinTools?.get("managed_agent.start")).toEqual(expect.any(Function));
      expect(admittedTurn?.perCallConfig?.authorityAdmission?.turn.tools.allowedToolPermissions.some(
        (permission) => permission.toolName === "managed_agent.start",
      )).toBe(true);
      expect(managedLifecycleFrames).toEqual([]);
      expect(createProvider).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("streams denied worktree-conflict managed-agent start evidence through shared cockpit projection", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const { invocationService, managedInvocation, releaseActive, startInput } = makeManagedWriteConflictFixture();
    const parentSessionId = "session-denied-worktree-conflict";
    let activeInvocationId = "";
    let deniedInvocationId = "";
    let deniedMetadata: Record<string, unknown> | undefined;
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const session = await input.sessionRegistry.getOrCreate({
        sessionId: parentSessionId,
        appName: "kiln-gui",
        tenantId: "_gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
      if (!startManagedAgent) {
        throw new Error("managed_agent.start was not attached to the GUI turn surface");
      }
      const requestApproval = vi.fn(async () => ({
        approved: true,
        reason: "operator approved bounded write",
      }));
      const active = await startManagedAgent(startInput, {
        session,
        effectiveTurnAuthority: TEST_WRITE_PARENT_AUTHORITY,
        toolCall: {
          id: "tool-call-managed-active-write",
          name: "managed_agent.start",
          input: startInput,
        },
       requestApproval,
      });
      assertManagedToolResult(active);
      if (active.isError) {
        throw new Error(active.output);
      }
      activeInvocationId = (active.metadata as { invocationId: string }).invocationId;
      const denied = await startManagedAgent(startInput, {
        session,
        effectiveTurnAuthority: TEST_WRITE_PARENT_AUTHORITY,
        toolCall: {
          id: "tool-call-managed-conflicting-write",
          name: "managed_agent.start",
          input: startInput,
        },
        requestApproval,
      });
      assertManagedToolResult(denied);
      if (!denied.isError) {
        throw new Error("Expected second same-checkout managed_agent.start to be denied");
      }
      deniedMetadata = denied.metadata as Record<string, unknown>;
      deniedInvocationId = String(deniedMetadata.invocationId);
      await input.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Denied conflicting managed write." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-denied-worktree-conflict",
          ...runtimeCompletedDisposition(),
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        managedInvocation: makeManagedInvocationAttachment(managedInvocation),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start conflicting write child" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          content?: string;
          event?: {
            eventId: string;
            kilnSessionId: string;
            sequence: number;
            timestamp: string;
            kind: OperatorSessionEvent["kind"];
            payload: Record<string, unknown>;
          };
        });
      const deniedLifecycleFrames = outboundFrames.filter((frame) =>
        frame.type === "session_event"
        && frame.event?.kind.startsWith("agent_invocation_")
        && frame.event.payload.invocationId === deniedInvocationId
      );
      const deniedFailedFrame = deniedLifecycleFrames.find((frame) =>
        frame.event?.kind === "agent_invocation_failed"
      );

      expect(activeInvocationId).not.toBe("");
      expect(deniedInvocationId).not.toBe("");
      expect(deniedMetadata).toMatchObject({
        status: "denied",
        lifecycleState: "failed",
        missingCapabilities: ["resourceLease.worktreeConflict"],
        resourceLease: {
          worktreeConflict: {
            status: "blocked",
            reason: "same-checkout-write-conflict",
            requestedInvocationId: deniedInvocationId,
            conflictingInvocationId: activeInvocationId,
          },
        },
        presentationIntent: {
          source: "managed_agent.start",
          rows: [
            expect.objectContaining({
              routeId: "opencode-approved-write",
              status: "denied",
              substantiveEvidence: false,
            }),
          ],
        },
      });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "Denied conflicting managed write.",
      }));
      expect(deniedLifecycleFrames.map((frame) => frame.event?.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_failed",
      ]);
      expect(deniedLifecycleFrames.some((frame) => frame.event?.kind === "agent_invocation_started")).toBe(false);
      expect(deniedFailedFrame?.event?.payload).toMatchObject({
        invocationId: deniedInvocationId,
        managedInvocationId: deniedInvocationId,
        lifecycleState: "failed",
        errorCode: "ADMISSION_DENIED",
        managedInvocationEvidence: {
          lifecycle: {
            resourceLease: {
              worktreeConflict: {
                status: "blocked",
                reason: "same-checkout-write-conflict",
                requestedInvocationId: deniedInvocationId,
                conflictingInvocationId: activeInvocationId,
              },
            },
          },
        },
      });

      const event = deniedFailedFrame?.event;
      if (!event) {
        throw new Error("Expected denied worktree-conflict failed session event frame");
      }
      const instanceId = String(event.payload.instanceId);
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-05-25T12:01:00.000Z",
        attachTargets: [{
          instanceId,
          label: "GUI / kiln",
          kind: "local",
        }],
        events: [event],
      });
      const view = createOperatorCockpitReadOnlyViewState({
        projection,
        viewState: {},
      });

      expect(view.managedAgents.items[0]).toMatchObject({
        managedInvocationId: deniedInvocationId,
        attentionState: "needs_review",
        status: "failed",
        lifecycleState: "failed",
        worktreeConflictBlocked: true,
        worktreeConflict: {
          status: "blocked",
          reason: "same-checkout-write-conflict",
          requestedInvocationId: deniedInvocationId,
          conflictingInvocationId: activeInvocationId,
        },
      });
    } finally {
      releaseActive.resolve?.();
      if (activeInvocationId) {
        await invocationService.join(activeInvocationId).catch(() => undefined);
      }
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("fails managed-agent cancel control closed when no live invocation service is configured", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => (gateway?.operatorDiscovery?.length ?? 0) > 0,
        "Expected GUI provider discovery to finish before starting managed-agent control fixture.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "managed_agent_control",
            action: "cancel",
            sessionId: "session-1",
            invocationId: "child-running",
            reason: "Operator stopped duplicate work.",
            requestId: "managed-agent-control-1",
          }),
        }),
        wsCtx,
      );

      const controlResultFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string })
        .find((frame) => frame.type === "managed_agent_control_result");

      expect(controlResultFrame).toMatchObject({
        type: "managed_agent_control_result",
        action: "cancel",
        sessionId: "session-1",
        invocationId: "child-running",
        status: "failed",
        reason: "Managed agent control requires a live invocation service.",
        requestId: "managed-agent-control-1",
      });
      expect(typeof (controlResultFrame as { handledAt?: unknown } | undefined)?.handledAt).toBe("string");
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("cancels a live managed-agent invocation and streams terminal evidence", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const invocationService = new RuntimeManagedAgentInvocationService({
      authorityObserver: makeGuiRuntimeAuthorityObserver(),
    });
    const baseManagedInvocation = makeManagedInvocationOptions();
    const baseRoute = baseManagedInvocation.routes[0]!;
    const controlRoute = {
      ...baseRoute,
      profiles: [{
          ...baseRoute.profiles[0]!,
          credentialRoute: { mode: "credentialless" as const },
      }],
    };
    const parentSessionId = "session-control";
    let startedInvocationId = "";
    let abortObserved = false;
    const sessionEventSink = { publish: vi.fn() };
    const cancellableAdapter: ManagedAgentRuntimeAdapter = {
      descriptor: baseManagedInvocation.routeAdapter.descriptor,
      invoke: async ({ abortSignal }) => {
        if (!abortSignal.aborted) {
          await new Promise<void>((resolve) => {
            abortSignal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        abortObserved = true;
        return new Promise<ManagedAgentInvocationRecord>(() => undefined);
      },
    };
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const session = await input.sessionRegistry.getOrCreate({
        sessionId: parentSessionId,
        appName: "kiln-gui",
        tenantId: "_gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
      if (!startManagedAgent) {
        throw new Error("managed_agent.start was not attached to the GUI turn surface");
      }
      const toolResult = await startManagedAgent({
        profile: "foundation-readonly-plan",
        routeId: baseRoute.routeId,
        providerRoute: {
          providerId: baseRoute.providerId,
          model: baseRoute.model,
        },
        task: "Inspect a long-running GUI child.",
      }, {
        session,
        effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
        toolCall: {
          id: "tool-call-managed-start",
          name: "managed_agent.start",
          input: {},
        },
      });
      assertManagedToolResult(toolResult);
      if (toolResult.isError) {
        throw new Error(toolResult.output);
      }
      startedInvocationId = (toolResult.metadata as { invocationId: string }).invocationId;
      await input.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Child is running." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-control",
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        managedInvocation: makeManagedInvocationAttachment({
          ...baseManagedInvocation,
          invocationService,
          sessionEventSink,
          routes: [{
            ...controlRoute,
            createAdapter: async () => cancellableAdapter,
          }],
        }),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => (gateway?.operatorDiscovery?.length ?? 0) > 0,
        "Expected GUI provider discovery to finish before starting managed-agent control fixture.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start child" }),
        }),
        wsCtx,
      );
      expect(startedInvocationId).not.toBe("");
      const cancelMessage = handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "managed_agent_control",
            action: "cancel",
            sessionId: parentSessionId,
            invocationId: startedInvocationId,
            reason: "Operator stopped duplicate work.",
            requestId: "managed-agent-control-accepted",
          }),
        }),
        wsCtx,
      );
      await flushAsyncWork();
      const cancelState = await Promise.race([
        Promise.resolve(cancelMessage).then(() => "resolved" as const),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0)),
      ]);

      const outboundFrames = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          action?: string;
          status?: string;
          requestId?: string;
          event?: { kind: string; payload: Record<string, unknown> };
        });
      const controlResultFrame = outboundFrames.find((frame) => frame.type === "managed_agent_control_result");
      const cancelledEventFrame = outboundFrames.find((frame) =>
        frame.type === "session_event"
        && frame.event?.kind === "agent_invocation_cancelled"
      );

      expect(abortObserved).toBe(true);
      expect(cancelState).toBe("resolved");
      expect(controlResultFrame).toMatchObject({
        type: "managed_agent_control_result",
        action: "cancel",
        sessionId: parentSessionId,
        invocationId: startedInvocationId,
        status: "accepted",
        requestId: "managed-agent-control-accepted",
      });
      expect(cancelledEventFrame?.event?.payload).toMatchObject({
        invocationId: startedInvocationId,
        lifecycleState: "cancelled",
        managedInvocationEvidence: {
          lifecycle: {
            resultSummary: "Operator stopped duplicate work.",
          },
        },
      });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "managed_agent_control",
            action: "cancel",
            sessionId: parentSessionId,
            invocationId: startedInvocationId,
            reason: "Operator retried the same cancellation.",
            requestId: "managed-agent-control-duplicate",
          }),
        }),
        wsCtx,
      );
      const terminalSinkCalls = sessionEventSink.publish.mock.calls.filter(([events]) => (
        (events as readonly { kind?: string }[]).some((event) => event.kind === "agent_invocation_cancelled")
      ));
      expect(terminalSinkCalls).toHaveLength(3);
      const terminalEventIds = new Set(
        terminalSinkCalls.flatMap(([events]) =>
          (events as readonly { eventId?: string; kind?: string }[])
            .filter((event) => event.kind === "agent_invocation_cancelled")
            .map((event) => event.eventId)
        ),
      );
      expect(terminalEventIds.size).toBe(1);
      for (const terminalSinkCall of terminalSinkCalls.slice(1)) {
        expect(terminalSinkCall[0]).toEqual(terminalSinkCalls[0]?.[0]);
      }
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("admits live managed-agent prompts and streams canonical prompt evidence", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const invocationService = new RuntimeManagedAgentInvocationService({
      authorityObserver: makeGuiRuntimeAuthorityObserver(),
    });
    const baseManagedInvocation = makeManagedInvocationOptions();
    const baseRoute = baseManagedInvocation.routes[0]!;
    const controlRoute = {
      ...baseRoute,
      profiles: [{
          ...baseRoute.profiles[0]!,
          credentialRoute: { mode: "credentialless" as const },
      }],
    };
    const parentSessionId = "session-prompt-control";
    let completeChild!: () => void;
    let startedInvocationId = "";
    const sessionEventSink = { publish: vi.fn() };
    const promptableAdapter: ManagedAgentRuntimeAdapter = {
      descriptor: baseManagedInvocation.routeAdapter.descriptor,
      invoke: async ({ request: adapterRequest, admission }) => {
        await new Promise<void>((resolve) => {
          completeChild = resolve;
        });
        return defineManagedAgentInvocationRecord({
          invocationId: adapterRequest.invocationId,
          agentId: adapterRequest.agentId,
          parentSessionId: adapterRequest.parentSessionId,
          parentTurnId: adapterRequest.parentTurnId,
          profile: adapterRequest.profile,
          lifecycleState: "completed",
          providerRoute: adapterRequest.providerRoute,
          adapterKind: adapterRequest.adapterKind,
          executionMode: adapterRequest.executionMode,
          authority: adapterRequest.authority,
          capabilitySnapshot: admission.capabilitySnapshot,
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: "Promptable child completed.",
            resourceUris: [],
            memoryWriteProposalUris: [],
          },
        });
      },
    };
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const session = await input.sessionRegistry.getOrCreate({
        sessionId: parentSessionId,
        appName: "kiln-gui",
        tenantId: "_gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
      if (!startManagedAgent) {
        throw new Error("managed_agent.start was not attached to the GUI turn surface");
      }
      const toolResult = await startManagedAgent({
        profile: "foundation-readonly-plan",
        routeId: baseRoute.routeId,
        providerRoute: {
          providerId: baseRoute.providerId,
          model: baseRoute.model,
        },
        task: "Inspect a promptable GUI child.",
      }, {
        session,
        effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
        toolCall: {
          id: "tool-call-managed-prompt-start",
          name: "managed_agent.start",
          input: {},
        },
      });
      assertManagedToolResult(toolResult);
      if (toolResult.isError) {
        throw new Error(toolResult.output);
      }
      startedInvocationId = (toolResult.metadata as { invocationId: string }).invocationId;
      await input.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Child is running." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-prompt-control",
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        managedInvocation: makeManagedInvocationAttachment({
          ...baseManagedInvocation,
          invocationService,
          sessionEventSink,
          routes: [{
            ...controlRoute,
            createAdapter: async () => promptableAdapter,
          }],
        }),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => (gateway?.operatorDiscovery?.length ?? 0) > 0,
        "Expected GUI provider discovery to finish before starting managed-agent prompt fixture.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start child" }),
        }),
        wsCtx,
      );
      expect(startedInvocationId).not.toBe("");
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "managed_agent_control",
            action: "prompt",
            sessionId: parentSessionId,
            invocationId: startedInvocationId,
            prompt: "Use the latest runtime ledger evidence before continuing.",
            deliveryMode: "steer",
            wakeRequested: true,
            requestId: "managed-agent-prompt-accepted",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          action?: string;
          status?: string;
          requestId?: string;
          event?: { kind: string; payload: Record<string, unknown> };
        });
      const controlResultFrame = outboundFrames.find((frame) =>
        frame.type === "managed_agent_control_result" && frame.action === "prompt"
      );
      const promptEventFrame = outboundFrames.find((frame) =>
        frame.type === "session_event"
        && frame.event?.kind === "agent_invocation_prompt_admitted"
      );

      expect(controlResultFrame).toMatchObject({
        type: "managed_agent_control_result",
        action: "prompt",
        sessionId: parentSessionId,
        invocationId: startedInvocationId,
        status: "accepted",
        requestId: "managed-agent-prompt-accepted",
      });
      expect(promptEventFrame?.event?.payload).toMatchObject({
        invocationId: startedInvocationId,
        agentId: invocationService.status(startedInvocationId)?.agentId,
        parentSessionId,
        deliveryMode: "steer",
        admissionState: "admitted",
        inputSummary: "Use the latest runtime ledger evidence before continuing.",
        wakeRequested: true,
        requestedBy: "operator-1",
        requestSource: "gui",
      });
      expect(invocationService.status(startedInvocationId)?.promptInbox).toEqual([
        expect.objectContaining({
          promptAdmissionId: promptEventFrame?.event?.payload.promptAdmissionId,
          deliveryMode: "steer",
          deliveryState: "available",
        }),
      ]);
      expect(sessionEventSink.publish).toHaveBeenCalledWith(
        [expect.objectContaining({ kind: "agent_invocation_prompt_admitted" })],
        expect.objectContaining({
          toolCall: expect.objectContaining({
            id: "managed-agent-prompt-accepted",
            name: "managed_agent.prompt",
          }),
        }),
      );

      completeChild();
      await invocationService.join(startedInvocationId);
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("joins a live managed-agent invocation and streams terminal evidence", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const invocationService = new RuntimeManagedAgentInvocationService({
      authorityObserver: makeGuiRuntimeAuthorityObserver(),
    });
    const baseManagedInvocation = makeManagedInvocationOptions();
    const baseRoute = baseManagedInvocation.routes[0]!;
    const controlRoute = {
      ...baseRoute,
      profiles: [{
          ...baseRoute.profiles[0]!,
          credentialRoute: { mode: "credentialless" as const },
      }],
    };
    const parentSessionId = "session-join-control";
    let startedInvocationId = "";
    let completeChild!: () => void;
    const joinableAdapter: ManagedAgentRuntimeAdapter = {
      descriptor: baseManagedInvocation.routeAdapter.descriptor,
      invoke: async ({ request: adapterRequest, admission }) => {
        await new Promise<void>((resolve) => {
          completeChild = resolve;
        });
        return defineManagedAgentInvocationRecord({
          invocationId: adapterRequest.invocationId,
          agentId: adapterRequest.agentId,
          parentSessionId: adapterRequest.parentSessionId,
          parentTurnId: adapterRequest.parentTurnId,
          profile: adapterRequest.profile,
          lifecycleState: "completed",
          providerRoute: adapterRequest.providerRoute,
          adapterKind: adapterRequest.adapterKind,
          executionMode: adapterRequest.executionMode,
          authority: adapterRequest.authority,
          capabilitySnapshot: admission.capabilitySnapshot,
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: "Gateway join child completed.",
            resourceUris: [],
            memoryWriteProposalUris: [],
          },
        });
      },
    };
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const session = await input.sessionRegistry.getOrCreate({
        sessionId: parentSessionId,
        appName: "kiln-gui",
        tenantId: "_gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
      if (!startManagedAgent) {
        throw new Error("managed_agent.start was not attached to the GUI turn surface");
      }
      const toolResult = await startManagedAgent({
        profile: "foundation-readonly-plan",
        routeId: baseRoute.routeId,
        providerRoute: {
          providerId: baseRoute.providerId,
          model: baseRoute.model,
        },
        task: "Inspect a long-running GUI child.",
      }, {
        session,
        effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
        toolCall: {
          id: "tool-call-managed-start",
          name: "managed_agent.start",
          input: {},
        },
      });
      assertManagedToolResult(toolResult);
      if (toolResult.isError) {
        throw new Error(toolResult.output);
      }
      startedInvocationId = (toolResult.metadata as { invocationId: string }).invocationId;
      await input.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Child is running." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-join-control",
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        managedInvocation: makeManagedInvocationAttachment({
          ...baseManagedInvocation,
          invocationService,
          routes: [{
            ...controlRoute,
            createAdapter: async () => joinableAdapter,
          }],
        }),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => (gateway?.operatorDiscovery?.length ?? 0) > 0,
        "Expected GUI provider discovery to finish before starting managed-agent join fixture.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start child" }),
        }),
        wsCtx,
      );
      expect(startedInvocationId).not.toBe("");
      const joinPromise = handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "managed_agent_control",
            action: "join",
            sessionId: parentSessionId,
            invocationId: startedInvocationId,
            requestId: "managed-agent-join-accepted",
          }),
        }),
        wsCtx,
      );
      await flushAsyncWork();
      completeChild();
      await joinPromise;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "managed_agent_control",
            action: "join",
            sessionId: parentSessionId,
            invocationId: startedInvocationId,
            requestId: "managed-agent-join-replay",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          action?: string;
          status?: string;
          requestId?: string;
          event?: { kind: string; payload: Record<string, unknown> };
        });
      const controlResultFrame = outboundFrames.find((frame) =>
        frame.type === "managed_agent_control_result" && frame.action === "join"
      );
      const completedEventFrame = outboundFrames.find((frame) =>
        frame.type === "session_event"
        && frame.event?.kind === "agent_invocation_completed"
      );
      const completedEventFrames = outboundFrames.filter((frame) =>
        frame.type === "session_event"
        && frame.event?.kind === "agent_invocation_completed"
      );
      const replayControlResultFrame = outboundFrames.find((frame) =>
        frame.type === "managed_agent_control_result" && frame.requestId === "managed-agent-join-replay"
      );

      expect(controlResultFrame).toMatchObject({
        type: "managed_agent_control_result",
        action: "join",
        sessionId: parentSessionId,
        invocationId: startedInvocationId,
        status: "accepted",
        requestId: "managed-agent-join-accepted",
      });
      expect(completedEventFrame?.event?.payload).toMatchObject({
        invocationId: startedInvocationId,
        lifecycleState: "completed",
        managedInvocationEvidence: {
          lifecycle: {
            resultSummary: "Gateway join child completed.",
          },
        },
      });
      expect(replayControlResultFrame).toMatchObject({
        type: "managed_agent_control_result",
        action: "join",
        sessionId: parentSessionId,
        invocationId: startedInvocationId,
        status: "accepted",
        requestId: "managed-agent-join-replay",
      });
      expect(completedEventFrames).toHaveLength(2);
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("streams dirty-worktree review evidence through shared cockpit projection", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const { invocationService, managedInvocation, completeChild, startInput } = makeManagedDirtyWorktreeReviewFixture();
    const parentSessionId = "session-dirty-worktree-review-control";
    let startedInvocationId = "";
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const session = await input.sessionRegistry.getOrCreate({
        sessionId: parentSessionId,
        appName: "kiln-gui",
        tenantId: "_gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
      if (!startManagedAgent) {
        throw new Error("managed_agent.start was not attached to the GUI turn surface");
      }
      const toolResult = await startManagedAgent(startInput, {
        session,
        effectiveTurnAuthority: TEST_WRITE_PARENT_AUTHORITY,
        toolCall: {
          id: "tool-call-managed-dirty-worktree-start",
          name: "managed_agent.start",
          input: startInput,
        },
        requestApproval: vi.fn(async () => ({
          approved: true,
          reason: "operator approved isolated worktree write",
        })),
      });
      assertManagedToolResult(toolResult);
      if (toolResult.isError) {
        throw new Error(toolResult.output);
      }
      startedInvocationId = (toolResult.metadata as { invocationId: string }).invocationId;
      await input.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Isolated worktree child is running." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-dirty-worktree-review-control",
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        managedInvocation: makeManagedInvocationAttachment(managedInvocation),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => (gateway?.operatorDiscovery?.length ?? 0) > 0,
        "Expected GUI provider discovery to finish before starting dirty-worktree fixture.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start isolated write child" }),
        }),
        wsCtx,
      );
      expect(startedInvocationId).not.toBe("");

      const joinPromise = handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "managed_agent_control",
            action: "join",
            sessionId: parentSessionId,
            invocationId: startedInvocationId,
            requestId: "managed-agent-dirty-worktree-join",
          }),
        }),
        wsCtx,
      );
      await flushAsyncWork();
      completeChild.resolve?.();
      await joinPromise;

      const outboundFrames = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          action?: string;
          status?: string;
          requestId?: string;
          event?: {
            eventId: string;
            kilnSessionId: string;
            sequence: number;
            timestamp: string;
            kind: OperatorSessionEvent["kind"];
            payload: Record<string, unknown>;
          };
        });
      const lifecycleFrames = outboundFrames.filter((frame) =>
        frame.type === "session_event"
        && frame.event?.kind.startsWith("agent_invocation_")
        && frame.event.payload.invocationId === startedInvocationId
      );
      const completedFrame = lifecycleFrames.find((frame) =>
        frame.event?.kind === "agent_invocation_completed"
      );
      const controlResultFrame = outboundFrames.find((frame) =>
        frame.type === "managed_agent_control_result"
        && frame.requestId === "managed-agent-dirty-worktree-join"
      );
      const worktreeLeaseUri = `kiln://artifacts/${startedInvocationId}/worktree-lease`;
      const cleanupFailureUri = `kiln://artifacts/${startedInvocationId}/worktree-lease-cleanup-failed`;
      const worktreeReviewUri = `kiln://artifacts/${startedInvocationId}/worktree-review`;
      const worktreeReviewDiagnosticUri = `kiln://artifacts/${startedInvocationId}/worktree-review-required`;
      const handoffUri = `kiln://managed-agents/invocations/${startedInvocationId}/handoff`;
      const transcriptUri = `kiln://managed-agents/invocations/${startedInvocationId}/transcript`;

      expect(controlResultFrame).toMatchObject({
        type: "managed_agent_control_result",
        action: "join",
        sessionId: parentSessionId,
        invocationId: startedInvocationId,
        status: "accepted",
        requestId: "managed-agent-dirty-worktree-join",
      });
      expect(lifecycleFrames.map((frame) => frame.event?.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        "agent_invocation_completed",
      ]);
      expect(completedFrame?.event?.payload).toMatchObject({
        invocationId: startedInvocationId,
        managedInvocationId: startedInvocationId,
        lifecycleState: "completed",
        managedInvocationEvidence: {
          lifecycle: {
            lifecycleState: "completed",
            resourceLease: {
              healthStatus: "leaked",
              cleanupStatus: "failed",
              resourceUris: [worktreeLeaseUri],
              diagnosticUris: [
                cleanupFailureUri,
                worktreeReviewDiagnosticUri,
              ],
              worktreeReview: {
                status: "required",
                reason: "dirty-worktree-preserved",
                resourceUris: [worktreeReviewUri],
                diagnosticUris: [worktreeReviewDiagnosticUri],
              },
            },
          },
          transcript: {
            uri: transcriptUri,
          },
          resultHandoff: {
            resourceUris: [handoffUri],
          },
          diagnostics: expect.arrayContaining([
            {
              uri: cleanupFailureUri,
              kind: "cleanup",
            },
            {
              uri: worktreeReviewDiagnosticUri,
              kind: "cleanup",
            },
          ]),
        },
      });

      const event = completedFrame?.event;
      if (!event) {
        throw new Error("Expected dirty-worktree completed session event frame");
      }
      const instanceId = String(event.payload.instanceId);
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-05-25T12:02:00.000Z",
        attachTargets: [{
          instanceId,
          label: "GUI / kiln",
          kind: "local",
        }],
        events: [event],
      });
      const view = createOperatorCockpitReadOnlyViewState({
        projection,
        viewState: {},
      });

      expect(view.managedAgents.items[0]).toMatchObject({
        managedInvocationId: startedInvocationId,
        attentionState: "needs_review",
        status: "completed",
        lifecycleState: "completed",
        dirtyWorkspaceReviewRequired: true,
      });
      expect(view.managedAgents.items[0]?.resourceUris).toEqual(expect.arrayContaining([
        worktreeLeaseUri,
        cleanupFailureUri,
        worktreeReviewUri,
        worktreeReviewDiagnosticUri,
        handoffUri,
        transcriptUri,
      ]));
    } finally {
      completeChild.resolve?.();
      if (startedInvocationId) {
        await invocationService.join(startedInvocationId).catch(() => undefined);
      }
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      lifecycleState: "timed_out" as const,
      expectedKind: "agent_invocation_failed",
      errorCode: "ENGINE_TIMEOUT",
      diagnosticKind: "timeout" as const,
      attentionState: "timed_out",
    },
    {
      lifecycleState: "stale" as const,
      expectedKind: "agent_invocation_failed",
      errorCode: "ENGINE_STALE",
      diagnosticKind: "failure" as const,
      attentionState: "stale",
    },
    {
      lifecycleState: "failed" as const,
      expectedKind: "agent_invocation_failed",
      errorCode: "ENGINE_FAILURE",
      diagnosticKind: "failure" as const,
      attentionState: "failed",
    },
  ])("streams terminal managed-agent $lifecycleState evidence through shared cockpit projection", async (terminalCase) => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const invocationService = new RuntimeManagedAgentInvocationService({
      authorityObserver: makeGuiRuntimeAuthorityObserver(),
    });
    const baseManagedInvocation = makeManagedInvocationOptions();
    const baseRoute = baseManagedInvocation.routes[0]!;
    const controlRoute = {
      ...baseRoute,
      profiles: [{
          ...baseRoute.profiles[0]!,
          credentialRoute: { mode: "credentialless" as const },
      }],
    };
    const parentSessionId = `session-${terminalCase.lifecycleState}-control`;
    let startedInvocationId = "";
    let completeChild!: () => void;
    const terminalAdapter: ManagedAgentRuntimeAdapter = {
      descriptor: baseManagedInvocation.routeAdapter.descriptor,
      invoke: async ({ request: adapterRequest, admission }) => {
        await new Promise<void>((resolve) => {
          completeChild = resolve;
        });
        return defineManagedAgentInvocationRecord({
          invocationId: adapterRequest.invocationId,
          agentId: adapterRequest.agentId,
          parentSessionId: adapterRequest.parentSessionId,
          parentTurnId: adapterRequest.parentTurnId,
          profile: adapterRequest.profile,
          lifecycleState: terminalCase.lifecycleState,
          providerRoute: adapterRequest.providerRoute,
          adapterKind: adapterRequest.adapterKind,
          executionMode: adapterRequest.executionMode,
          authority: adapterRequest.authority,
          capabilitySnapshot: admission.capabilitySnapshot,
          childSessionId: `${adapterRequest.parentSessionId}:managed:${adapterRequest.invocationId}`,
          childTurnId: `${adapterRequest.parentSessionId}:managed:${adapterRequest.invocationId}:turn:1`,
          transcript: {
            uri: `kiln://managed-invocations/${adapterRequest.invocationId}/transcript`,
            redacted: "unknown",
            truncated: false,
            persisted: true,
            retention: "session",
          },
          diagnostics: [{
            uri: `kiln://managed-invocations/${adapterRequest.invocationId}/${terminalCase.diagnosticKind}`,
            kind: terminalCase.diagnosticKind,
          }],
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: `Gateway ${terminalCase.lifecycleState} child terminal evidence.`,
            resourceUris: [
              `kiln://managed-invocations/${adapterRequest.invocationId}/handoff`,
              `kiln://managed-invocations/${adapterRequest.invocationId}/${terminalCase.diagnosticKind}`,
            ],
            memoryWriteProposalUris: [],
          },
        });
      },
    };
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const session = await input.sessionRegistry.getOrCreate({
        sessionId: parentSessionId,
        appName: "kiln-gui",
        tenantId: "_gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
      if (!startManagedAgent) {
        throw new Error("managed_agent.start was not attached to the GUI turn surface");
      }
      const toolResult = await startManagedAgent({
        profile: "foundation-readonly-plan",
        routeId: baseRoute.routeId,
        providerRoute: {
          providerId: baseRoute.providerId,
          model: baseRoute.model,
        },
        task: `Inspect a ${terminalCase.lifecycleState} GUI child.`,
      }, {
        session,
        effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
        toolCall: {
          id: `tool-call-managed-start-${terminalCase.lifecycleState}`,
          name: "managed_agent.start",
          input: {},
        },
      });
      assertManagedToolResult(toolResult);
      if (toolResult.isError) {
        throw new Error(toolResult.output);
      }
      startedInvocationId = (toolResult.metadata as { invocationId: string }).invocationId;
      await input.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Child is running." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: `trace-managed-${terminalCase.lifecycleState}-control`,
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        managedInvocation: makeManagedInvocationAttachment({
          ...baseManagedInvocation,
          invocationService,
          routes: [{
            ...controlRoute,
            createAdapter: async () => terminalAdapter,
          }],
        }),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => (gateway?.operatorDiscovery?.length ?? 0) > 0,
        "Expected GUI provider discovery to finish before starting managed-agent terminal fixture.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start child" }),
        }),
        wsCtx,
      );
      expect(startedInvocationId).not.toBe("");

      const joinPromise = handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "managed_agent_control",
            action: "join",
            sessionId: parentSessionId,
            invocationId: startedInvocationId,
            requestId: `managed-agent-${terminalCase.lifecycleState}-join`,
          }),
        }),
        wsCtx,
      );
      await flushAsyncWork();
      completeChild();
      await joinPromise;

      const outboundFrames = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          action?: string;
          status?: string;
          requestId?: string;
          event?: {
            eventId: string;
            kilnSessionId: string;
            sequence: number;
            timestamp: string;
            kind: OperatorSessionEvent["kind"];
            payload: Record<string, unknown>;
          };
        });
      const terminalFrames = outboundFrames.filter((frame) =>
        frame.type === "session_event"
        && frame.event?.kind === terminalCase.expectedKind
        && frame.event.payload.invocationId === startedInvocationId
      );
      expect(terminalFrames).toHaveLength(1);
      const terminalFrame = terminalFrames[0];
      const controlResultFrame = outboundFrames.find((frame) =>
        frame.type === "managed_agent_control_result"
        && frame.requestId === `managed-agent-${terminalCase.lifecycleState}-join`
      );

      expect(controlResultFrame).toMatchObject({
        type: "managed_agent_control_result",
        action: "join",
        sessionId: parentSessionId,
        invocationId: startedInvocationId,
        status: "accepted",
      });
      expect(terminalFrame?.event?.payload).toMatchObject({
        invocationId: startedInvocationId,
        managedInvocationId: startedInvocationId,
        lifecycleState: terminalCase.lifecycleState,
        errorCode: terminalCase.errorCode,
        managedInvocationEvidence: {
          diagnostics: [{
            uri: `kiln://managed-agents/invocations/${startedInvocationId}/resources/${terminalCase.diagnosticKind}`,
            kind: terminalCase.diagnosticKind,
          }],
          resultHandoff: {
            resourceUris: [
              `kiln://managed-agents/invocations/${startedInvocationId}/handoff`,
              `kiln://managed-agents/invocations/${startedInvocationId}/resources/${terminalCase.diagnosticKind}`,
            ],
          },
        },
      });

      const event = terminalFrame?.event;
      if (!event) {
        throw new Error(`Expected terminal ${terminalCase.lifecycleState} session event frame`);
      }
      const instanceId = String(event.payload.instanceId);
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-05-24T12:01:00.000Z",
        attachTargets: [{
          instanceId,
          label: "GUI / kiln",
          kind: "local",
        }],
        events: [event],
      });
      const view = createOperatorCockpitReadOnlyViewState({
        projection,
        viewState: {},
      });

      expect(view.managedAgents.items[0]).toMatchObject({
        managedInvocationId: startedInvocationId,
        attentionState: terminalCase.attentionState,
        status: "failed",
        lifecycleState: terminalCase.lifecycleState,
      });
      expect(view.managedAgents.items[0]?.resourceUris).toEqual(expect.arrayContaining([
        `kiln://managed-agents/invocations/${startedInvocationId}/resources/${terminalCase.diagnosticKind}`,
        `kiln://managed-agents/invocations/${startedInvocationId}/handoff`,
        `kiln://managed-agents/invocations/${startedInvocationId}/transcript`,
      ]));
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});
