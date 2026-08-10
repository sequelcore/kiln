import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManagedAgentCapabilitySnapshot,
  GPT4O,
  OPENCODE_BASE_URL,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentWriteAuthority,
  textParts,
  type ManagedAgentInvocationRequest,
  type OpenCodeAuthFile,
  type OpenCodeTier,
  type ToolResourceProvider,
} from "@kilnai/core";
import {
  createOperatorCockpitReadOnlyViewState,
  projectOperatorCockpitReadOnlyView,
  type KilnConfigSetupAction,
  type GuiProviderDescriptor,
} from "@kilnai/gateway-contracts";
import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processAdmittedTurn } from "../../src/gateway/message-pipeline/index.js";
import { mountGuiStaticAssets, resolveGuiDistPath } from "../../src/gateway/gui-static-assets.js";
import {
  buildGuiOperatorDiscoveryResults,
  buildWelcomeProviderDescriptors,
  discoverCodexCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
  resolveOpenCodeExecutable,
  markGuiProviderDiscoveryStale,
  probeCodexCliModelReadiness,
  projectGuiProviderModelDiscovery,
  projectGuiOperatorModels,
  resolveGuiOperatorDiscoveryResults,
  resolveGuiProviderSwitch,
  type GuiCliProviderModelDiscovery,
} from "../../src/gateway/gui-provider-models.js";
import type {
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
} from "../../src/agents/managed-invocation/runtime-tool/index.js";
import { createManagedInvocationLifecycleToolExecutors } from "../../src/agents/managed-invocation/runtime-tool/index.js";
import {
  ManagedAgentWorktreeReviewRequiredError,
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
  type ManagedAgentWorktreeLeaseManager,
  type ManagedAgentRuntimeAdapter,
} from "../../src/agents/managed-invocation/index.js";
import { CodexOAuthCredentialPoolService } from "../../src/agents/credential-pool/codex-oauth-credential-pool.js";
import { OpenCodeCredentialPoolService } from "../../src/agents/credential-pool/opencode-credential-pool.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

const guiSocketHarness = vi.hoisted(() => {
  type HandlerFactory = Parameters<UpgradeWebSocket>[0];
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket: UpgradeWebSocket = (factory) => {
    capturedFactory = factory;
    return async (_c, next) => next();
  };

  function simulateConnection(queryParams: Record<string, string> = {}) {
    if (!capturedFactory) throw new Error("upgradeWebSocket not called yet");

    const url = new URL("http://localhost/gui/ws");
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }

    const ctx = {
      req: {
        query: (key: string) => url.searchParams.get(key) ?? undefined,
      },
    } as Parameters<HandlerFactory>[0];

    const handlers = capturedFactory(ctx);
    const mockWs = {
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    };

    return { handlers, mockWs, wsCtx: mockWs as unknown as Parameters<typeof handlers.onOpen>[1] };
  }

  function reset(): void {
    capturedFactory = null;
  }

  return {
    upgradeWebSocket,
    simulateConnection,
    reset,
  };
});

vi.mock("hono/bun", () => ({
  createBunWebSocket: () => ({
    upgradeWebSocket: guiSocketHarness.upgradeWebSocket,
    websocket: {},
  }),
}));

vi.mock("../../src/gateway/message-pipeline/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/gateway/message-pipeline/index.js")>();
  return {
    ...actual,
    processAdmittedTurn: vi.fn(),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");

  return {
    ...actual,
    execFileSync: vi.fn(() => ""),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
        kill: () => void;
      };

      proc.stdout = new EventEmitter();
      proc.stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
      proc.kill = () => {
        proc.emit("close");
      };

      queueMicrotask(() => {
        proc.emit("close");
      });

      return proc;
    }),
  };
});

function createGuiDist(): string {
  const distDir = mkdtempSync(join(tmpdir(), "gui-gateway-dist-"));
  mkdirSync(join(distDir, "assets"), { recursive: true });
  writeFileSync(
    join(distDir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/gui/assets/app.js\"></script></head><body><div id=\"app\">GUI Test Build</div></body></html>",
    "utf-8",
  );
  writeFileSync(join(distDir, "assets", "app.js"), "console.log('asset-ok');", "utf-8");
  return distDir;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCondition(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await flushAsyncWork();
  }
  throw new Error(message);
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gui-gateway-empty-"));
}

type GuiOperatorDiscoveryBuilderInput = Parameters<typeof buildGuiOperatorDiscoveryResults>[0];

const AVAILABLE_CANONICAL_PROVIDERS: Record<string, boolean> = {
  anthropic: true,
  openai: true,
  deepseek: true,
  openrouter: true,
  ollama: true,
  "opencode-go": true,
  "opencode-zen": true,
  "codex-oauth": true,
};

function makeGuiOperatorDiscoveryBuilderInput(
  overrides: Partial<GuiOperatorDiscoveryBuilderInput> = {},
): GuiOperatorDiscoveryBuilderInput {
  return {
    opencodeModels: [],
    codexModels: [],
    ...overrides,
  };
}

function projectGuiOperatorDiscoveryInput(input: GuiOperatorDiscoveryBuilderInput): Record<string, string[]> {
  return projectGuiOperatorModels(buildGuiOperatorDiscoveryResults(input));
}

function makeGuiOperatorDiscoveryFromModels(
  models: Readonly<Record<string, readonly string[]>>,
) {
  const directProviderDiscovery: Record<string, GuiCliProviderModelDiscovery> = Object.fromEntries(
    Object.entries(models).flatMap(([provider, providerModels]) => (
      provider === "claude" || provider === "codex" || provider === "opencode" || providerModels.length === 0
        ? []
        : [[provider, {
            models: [...providerModels],
            status: "available",
            reason: `${provider} models discovered.`,
            authState: "authenticated",
          }]]
    )),
  );
  return buildGuiOperatorDiscoveryResults({
    opencodeModels: models.opencode ?? [],
    codexModels: models.codex ?? [],
    providerAvailability: Object.fromEntries(
      Object.keys(models).map((provider) => [provider, true]),
    ),
    directProviderDiscovery,
    lastCheckedAt: "2026-04-28T12:00:00.000Z",
  });
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
      profiles: {
        "foundation-readonly-plan": {
          authorityProfileId: "authority:opencode-readonly:foundation-readonly-plan",
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
        },
      },
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
    readonly requestedAuthority: "destructive";
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
    requestedAuthority: "destructive",
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
    readonly requestedAuthority: "destructive";
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
      profiles: {
        "foundation-apply-approved-writes": {
          authorityProfileId: "authority:opencode:isolated-write",
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
        },
      },
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
    requestedAuthority: "destructive",
    task: "Apply the approved runtime edit in an isolated worktree.",
  } as const;

  return {
    invocationService,
    managedInvocation,
    completeChild,
    startInput,
  };
}

function projectDirectProviderDiscoveryForTest(
  directProviderDiscovery: Awaited<ReturnType<typeof discoverGuiDirectProviderModelDiscovery>>,
  providerAvailability: Readonly<Record<string, boolean>>,
): Record<string, string[]> {
  return projectGuiOperatorModels(buildGuiOperatorDiscoveryResults({
    opencodeModels: [],
    codexModels: [],
    providerAvailability,
    directProviderDiscovery,
  }));
}

function mockOpenCodeCredentialPool(
  credentialsForTier: (tier: OpenCodeTier) => readonly OpenCodeAuthFile[] = () => [],
) {
  type OpenCodePool = Awaited<ReturnType<OpenCodeCredentialPoolService["createPool"]>>;
  return vi.spyOn(OpenCodeCredentialPoolService.prototype, "createPool").mockImplementation(async (tier) => ({
    getAllCredentials: () => credentialsForTier(tier).map((auth, index) => ({
      id: `${tier}-${index}`,
      label: `${tier}-${index}`,
      providerId: "opencode",
      source: "manual",
      priority: 0,
      tier: auth.tier,
      auth,
      requestCount: 0,
      lastSuccess: null,
      lastExhausted: null,
      cooldownUntil: null,
      invalidReason: null,
      softLeaseCount: 0,
    })),
  }) as OpenCodePool);
}

afterEach(() => {
  guiSocketHarness.reset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const TEST_HANDOFF_PROVENANCE = {
  delivery: "runtime-generated",
  configuredModelId: "test-model",
  observedModelIds: [],
} as const;

describe("startGuiGateway static mount", () => {
  it("serves /gui/index.html and falls back to index.html for unknown /gui routes", async () => {
    const distDir = createGuiDist();
    const app = new Hono();
    app.get("/gui", (c) => c.redirect("/gui/"));
    mountGuiStaticAssets(app, distDir);

    try {
      const indexResponse = await app.request("http://localhost/gui/index.html");
      expect(indexResponse.status).toBe(200);
      const indexHtml = await indexResponse.text();
      expect(indexHtml).toContain("GUI Test Build");

      const routeResponse = await app.request("http://localhost/gui/sessions/alpha");
      expect(routeResponse.status).toBe(200);
      const routeHtml = await routeResponse.text();
      expect(routeHtml).toContain("GUI Test Build");
      expect(routeHtml).toContain("/gui/assets/app.js");

      const assetResponse = await app.request("http://localhost/gui/assets/app.js");
      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toContain("asset-ok");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("builds structured provider discovery results with unavailable reasons", () => {
    const checkedAt = "2026-04-28T12:00:00.000Z";
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: ["gpt-5.4"],
      providerAvailability: {
        claude: true,
        codex: true,
        openai: true,
        "codex-oauth": false,
      },
      lastCheckedAt: checkedAt,
    });

    expect(discovery.find((entry) => entry.provider === "claude")).toMatchObject({
      provider: "claude",
      available: true,
      models: [],
      status: "model_selection_not_required",
      reason: "Claude CLI is available. Model selection is not required.",
      authState: "not_required",
      lastCheckedAt: checkedAt,
    });
    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: true,
      models: ["gpt-5.4"],
      status: "available",
    });
    expect(discovery.find((entry) => entry.provider === "openai")).toMatchObject({
      provider: "openai",
      available: false,
      models: [],
      status: "empty_model_list",
      reason: "No models were discovered for OpenAI.",
    });
    expect(discovery.find((entry) => entry.provider === "codex-oauth")).toMatchObject({
      provider: "codex-oauth",
      available: false,
      models: [],
      status: "missing_auth",
      reason: "Codex OAuth is unavailable in this runtime.",
    });

    expect(projectGuiOperatorModels(discovery)).toEqual({
      claude: [],
      codex: ["gpt-5.4"],
    });
    expect(buildWelcomeProviderDescriptors(discovery).find((entry) => entry.id === "openai")).toMatchObject({
      id: "openai",
      available: false,
      models: [],
      status: "empty_model_list",
      reason: "No models were discovered for OpenAI.",
    });
  });

  it("projects exact Claude CLI deliberation capabilities into operator discovery", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      claudeModels: ["claude-sonnet-5"],
      claudeDiscovery: {
        models: ["claude-sonnet-5"],
        modelCapabilities: {
          "claude-sonnet-5": {
            deliberation: {
              provider: "claude",
              model: "claude-sonnet-5",
              levels: [{ id: "low" }, { id: "high" }],
              supportsAdaptive: true,
              evidence: {
                sourceIdentity: "claude-code-model-catalog",
                sourceRevision: "2.1.226",
                observedAt: "2026-08-10T00:00:00.000Z",
              },
            },
          },
        },
        status: "available",
        reason: "Claude Code models discovered through the Agent SDK control plane.",
        authState: "authenticated",
      },
      opencodeModels: [],
      codexModels: [],
    });

    expect(discovery.find((entry) => entry.provider === "claude")).toMatchObject({
      available: true,
      models: ["claude-sonnet-5"],
      modelCapabilities: {
        "claude-sonnet-5": {
          deliberation: {
            provider: "claude",
            model: "claude-sonnet-5",
            levels: [{ id: "low" }, { id: "high" }],
            evidence: { sourceRevision: "2.1.226" },
          },
        },
      },
    });
  });

  it("uses structured discovery reasons when rejecting provider switches", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: { openai: true },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(resolveGuiProviderSwitch({
      provider: "openai",
      model: "gpt-5.4",
      discovery,
    })).toEqual({
      ok: false,
      error: "No models were discovered for OpenAI.",
    });
  });

  it("projects unhealthy direct provider model routes into structured discovery", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: { openrouter: true },
      directProviderDiscovery: {
        openrouter: {
          models: ["openrouter/free", "qwen/qwen3-coder:free"],
          modelRouteHealth: {
            "openrouter/free": {
              healthy: true,
            },
            "qwen/qwen3-coder:free": {
              healthy: false,
              reason: "Provider/model route 'openrouter/qwen/qwen3-coder:free' is cooling down.",
              cooldownUntil: 1_777_777_777_000,
            },
            "unused/free": {
              healthy: false,
              reason: "This model is not advertised.",
            },
          },
          status: "available",
          reason: "OpenRouter models discovered.",
          authState: "authenticated",
        },
      },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "openrouter")).toMatchObject({
      provider: "openrouter",
      available: true,
      models: ["openrouter/free", "qwen/qwen3-coder:free"],
      modelRouteHealth: {
        "openrouter/free": {
          healthy: true,
        },
        "qwen/qwen3-coder:free": {
          healthy: false,
          reason: "Provider/model route 'openrouter/qwen/qwen3-coder:free' is cooling down.",
          cooldownUntil: 1_777_777_777_000,
        },
      },
    });

    const projection = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-04-28T12:00:00.000Z",
    });
    expect(projection.entries.find((entry) =>
      entry.providerRoute.providerId === "openrouter"
      && entry.providerRoute.providerModelId === "openrouter/free"
    )).toMatchObject({
      routeHealth: {
        status: "healthy",
      },
      eligibility: {
        reasonCodes: expect.not.arrayContaining([
          "missing-route-health-evidence",
          "route-unhealthy",
        ]),
      },
    });
    expect(projection.entries.find((entry) =>
      entry.providerRoute.providerId === "openrouter"
      && entry.providerRoute.providerModelId === "qwen/qwen3-coder:free"
    )).toMatchObject({
      routeHealth: {
        status: "unhealthy",
        reason: "Provider/model route 'openrouter/qwen/qwen3-coder:free' is cooling down.",
      },
      eligibility: {
        eligible: false,
        reasonCodes: expect.arrayContaining(["route-unhealthy"]),
      },
    });
    expect(projection.entries.find((entry) =>
      entry.providerRoute.providerId === "openrouter"
      && entry.providerRoute.providerModelId === "qwen/qwen3-coder:free"
    )?.eligibility.reasonCodes).not.toContain("missing-route-health-evidence");
  });

  it("uses one provider readiness wording path for switches and prompt execution", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "openai",
      model: undefined,
      models: {
        openai: ["gpt-5.4"],
      },
    });
    expect(resolution).toMatchObject({
      ok: false,
      error: "Provider 'openai' requires a selected model.",
    });
  });

  it("keeps Claude model-less when availability says it is live", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: { claude: true },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "claude")).toMatchObject({
      provider: "claude",
      available: true,
      models: [],
      status: "model_selection_not_required",
      reason: "Claude CLI is available. Model selection is not required.",
    });
    expect(projectGuiOperatorModels(discovery).claude).toEqual([]);
    expect(buildWelcomeProviderDescriptors(discovery).find((entry) => entry.id === "claude")).toMatchObject({
      id: "claude",
      models: [],
      available: true,
    });
  });

  it("does not probe Codex or OpenCode CLI models when provider availability is empty", async () => {
    vi.mocked(execFileSync).mockClear();
    vi.mocked(spawn).mockClear();

    const discovery = await resolveGuiOperatorDiscoveryResults({});

    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: false,
      status: "cli_missing",
    });
    expect(discovery.find((entry) => entry.provider === "opencode")).toMatchObject({
      provider: "opencode",
      available: false,
      status: "cli_missing",
    });
  });

  it("keeps Codex and OpenCode CLI model discovery active when availability admits them", async () => {
    vi.mocked(execFileSync).mockClear();
    vi.mocked(spawn).mockClear();

    await resolveGuiOperatorDiscoveryResults({
      codex: true,
      opencode: true,
    });

    expect(vi.mocked(execFileSync)).toHaveBeenCalled();
    expect(vi.mocked(spawn)).toHaveBeenCalled();
  });

  it("fails fast when an explicit GUI dist path is missing index.html", () => {
    const distDir = createTempDir();

    try {
      expect(() => resolveGuiDistPath(distDir)).toThrow("GUI bundle missing");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("starts an API-only gateway without resolving a GUI bundle when assets are external", async () => {
    const missingDistDir = createTempDir();
    const stop = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    const gateway = await startGuiGateway({
      guiAssetMode: "external",
      guiDistPath: missingDistDir,
      getSnapshot: async () => ({ } as never),
    });

    try {
      expect(gateway.hasMountedGui).toBe(false);
    } finally {
      gateway.shutdown();
      rmSync(missingDistDir, { recursive: true, force: true });
    }
  });

  it("starts listening before operator provider discovery resolves", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const discoverOperatorProviders = vi.fn(() => new Promise<never>(() => undefined));
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
        discoverOperatorProviders,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      expect(gateway.operatorModels).toEqual({});
      expect(gateway.operatorDiscovery).toEqual([]);
      expect(discoverOperatorProviders).toHaveBeenCalledTimes(1);
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("seeds the welcome frame from injected operator discovery", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: {
        claude: true,
        codex: false,
        opencode: false,
      },
      lastCheckedAt: "2026-07-28T09:00:00.000Z",
    });
    const discoverOperatorProviders = vi.fn(async () => discovery);
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
        discoverOperatorProviders,
        initialOperatorDiscovery: discovery,
        initialOperatorDiscoveryFreshness: "fresh",
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "claude",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection();
      await handlers.onOpen!(new Event("open"), wsCtx);
      const welcome = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; activeProvider?: string })
        .find((frame) => frame.type === "welcome");

      expect(discoverOperatorProviders).toHaveBeenCalled();
      expect(welcome).toMatchObject({
        type: "welcome",
        activeProvider: "claude",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("executes only GUI-authorized setup actions through the gateway callback", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    const setup = {
      projectRoot: "C:/workspace/kiln",
      projectContext: {
        path: "C:/workspace/kiln/.kiln/project-context.md",
        status: "valid" as const,
        recommendation: "none" as const,
      },
      repoShims: [],
      globalInstructionShims: [],
      nativeProjections: [],
      permissionIntegrity: [],
      recommendedActions: ["none" as const],
    };
    const executeSetupAction = vi.fn(async (action: KilnConfigSetupAction) => ({
      action,
      status: "applied" as const,
      message: "Repo shims synced.",
      errors: [],
      setup,
    }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return {
          port: port ?? 4810,
          stop,
        };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        getSetupSnapshot: async () => setup,
        executeSetupAction,
      });

      const response = await appFetch!(new Request("http://localhost/gui/api/config/setup/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync-global-instruction-shims" }),
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        action: "sync-global-instruction-shims",
        status: "applied",
      });
      expect(executeSetupAction).toHaveBeenCalledTimes(1);
      expect(executeSetupAction).toHaveBeenCalledWith("sync-global-instruction-shims");

      for (const action of [
        "adopt-or-back-up-global-instructions",
        "review-global-instruction-drift",
        "adopt-or-back-up-native-guidance",
        "review-and-force-sync-repo-shims",
        "review-native-projection-drift",
      ] as const) {
        const blocked = await appFetch!(new Request("http://localhost/gui/api/config/setup/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }));

        expect(blocked.status).toBe(200);
        expect(await blocked.json()).toMatchObject({
          action,
          status: "blocked",
          errors: [`GUI setup action '${action}' is not executable.`],
          setup,
        });
      }
      expect(executeSetupAction).toHaveBeenCalledTimes(1);

      const malformed = await appFetch!(new Request("http://localhost/gui/api/config/setup/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "not-a-setup-action" }),
      }));
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({ error: "invalid_setup_action" });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("reads resources through target-aware operator resource requests", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    const resourceProvider: ToolResourceProvider = {
      listResources: () => [{
        uri: "kiln://test/resources/work-1",
        name: "work_item_1",
        title: "Work item 1",
        mimeType: "text/markdown",
      }],
      listTemplates: () => [],
      read: vi.fn(async (uri, options) => ({
        contents: [{
          uri,
          mimeType: "text/markdown",
          text: `# ${options?.cursor ?? "start"}`,
        }],
        nextCursor: "line:125",
      })),
    };
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return {
          port: port ?? 4810,
          stop,
        };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
        builtinToolOptions: {
          resourceProviders: [resourceProvider],
        },
      });

      const response = await appFetch!(new Request("http://localhost/gui/api/resources/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uri: "kiln://test/resources/work-1",
          target: {
            gatewayTargetId: "gateway:local-app",
            instanceId: "local-app:instance",
            sessionId: "session-1",
            resourceUri: "kiln://test/resources/work-1",
          },
          cursor: "line:100",
          limit: 25,
        }),
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        uri: "kiln://test/resources/work-1",
        target: {
          gatewayTargetId: "gateway:local-app",
          instanceId: "local-app:instance",
          sessionId: "session-1",
          resourceUri: "kiln://test/resources/work-1",
        },
        contents: [{
          kind: "text",
          uri: "kiln://test/resources/work-1",
          mimeType: "text/markdown",
          text: "# line:100",
        }],
        nextCursor: "line:125",
      });
      expect(resourceProvider.read).toHaveBeenCalledWith("kiln://test/resources/work-1", {
        target: {
          gatewayTargetId: "gateway:local-app",
          instanceId: "local-app:instance",
          sessionId: "session-1",
          resourceUri: "kiln://test/resources/work-1",
        },
        cursor: "line:100",
        limit: 25,
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("exposes health with CORS for direct dev GUI polling", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return {
          port: port ?? 4810,
          stop,
        };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
      });

      const response = await appFetch!(new Request("http://localhost/health", {
        headers: { origin: "http://localhost:5183" },
      }));

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toMatchObject({
        status: "ok",
        channel: "gui",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("omits stale active provider/model selections from the welcome frame when they are absent from the authoritative models map", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
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
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "claude",
            setProvider: vi.fn(),
            getModel: () => "claude-sonnet-4-6",
            setModel: vi.fn(),
          },
        },
      });
      await flushAsyncWork();

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        activeProvider?: string;
        activeModel?: string;
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.activeProvider).toBeUndefined();
      expect(welcomeFrame.activeModel).toBeUndefined();
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects a durable operator provider preference without canonical eligibility", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ openrouter: ["openrouter/free"] }));
    const setProvider = vi.fn();
    const setModel = vi.fn();
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
        resolveProviderPreference: () => ({ provider: "openrouter", model: "openrouter/free" }),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });
      await flushAsyncWork();

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        activeProvider?: string;
        activeModel?: string;
      };

      expect(setProvider).toHaveBeenCalledWith("");
      expect(setModel).toHaveBeenCalledWith("");
      expect(welcomeFrame).toMatchObject({
        type: "welcome",
      });
      expect(welcomeFrame.activeProvider).toBeUndefined();
      expect(welcomeFrame.activeModel).toBeUndefined();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("omits stale active provider/model selections from the welcome frame when the authoritative provider model list is empty", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [] }));
    let activeProvider = "openai";
    let activeModel = "gpt-4o";
    const factory = vi.fn() as never;
    const setProvider = vi.fn((provider: string) => {
      activeProvider = provider;
    });
    const setModel = vi.fn((model: string) => {
      activeModel = model;
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
        operatorTransport: {
          sessionManager: {
            factory,
            getProvider: () => activeProvider,
            setProvider,
            getModel: () => activeModel,
            setModel,
          },
        },
      });
      await waitForCondition(
        () => (gateway?.operatorDiscovery?.length ?? 0) > 0,
        "Expected GUI provider discovery to finish before authoritative welcome validation.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        activeProvider?: string;
        activeModel?: string;
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.activeProvider).toBeUndefined();
      expect(welcomeFrame.activeModel).toBeUndefined();
      expect(setModel).toHaveBeenCalledWith("");
      expect(setProvider).toHaveBeenCalledWith("");
      expect(activeProvider).toBe("");
      expect(activeModel).toBe("");
      expect(factory).not.toHaveBeenCalled();
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["blank", ""],
    ["stale", "gpt-4o-stale"],
  ])("does not fall back to providerModels[0] in the welcome frame when the stored model is %s", async (_kind, storedModel) => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let activeProvider = "openai";
    let activeModel = storedModel;
    const factory = vi.fn() as never;
    const setProvider = vi.fn((provider: string) => {
      activeProvider = provider;
    });
    const setModel = vi.fn((model: string) => {
      activeModel = model;
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
        operatorTransport: {
          sessionManager: {
            factory,
            getProvider: () => activeProvider,
            setProvider,
            getModel: () => activeModel,
            setModel,
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models to be ready before welcome validation.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        activeProvider?: string;
        activeModel?: string;
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.activeProvider).toBeUndefined();
      expect(welcomeFrame.activeModel).toBeUndefined();
      expect(setProvider).toHaveBeenCalledWith("");
      expect(setModel).toHaveBeenCalledWith("");
      expect(activeProvider).toBe("");
      expect(activeModel).toBe("");
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects turn execution when the active provider is advertised with an empty model list", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [] }));
    const factory = vi.fn() as never;
    vi.mocked(processAdmittedTurn).mockReset();
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
          sessionManager: {
            factory,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => "gpt-4o",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string });

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual({
        type: "error",
        message: "No models were discovered for OpenAI.",
      });
      expect(processAdmittedTurn).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects turn execution with a clear error when no provider is selected", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const factory = vi.fn() as never;
    vi.mocked(processAdmittedTurn).mockReset();
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
          sessionManager: {
            factory,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string });

      expect(outboundFrames).toContainEqual({
        type: "error",
        message: "No provider selected. Choose a provider before sending a message.",
      });
      expect(processAdmittedTurn).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("admits model-less Claude turns without leaking a stale stored model", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ claude: [] }));
    const setModel = vi.fn();
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "hello" }],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "session-1",
        sessionMode: "mode-a",
        traceId: "trace-1",
      },
    } as never);
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
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "claude",
            setProvider: vi.fn(),
            getModel: () => "stale-model",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; routedProvider?: string; routedModel?: string });

      expect(setModel).toHaveBeenCalledWith("");
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        routedProvider: "claude",
        routedModel: "",
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("clears transport resume state before admitting a fresh GUI message", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const onClear = vi.fn().mockResolvedValue(undefined);
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "fresh turn admitted" }],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "fresh-session",
        sessionMode: "mode-a",
        traceId: "trace-fresh",
      },
    } as never);
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
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
          onClear,
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui", sessionIntent: "fresh" }),
        }),
        wsCtx,
      );

      expect(onClear).toHaveBeenCalledWith();
      expect(onClear.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(processAdmittedTurn).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
      expect(processAdmittedTurn).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: undefined,
      }));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining("fresh turn admitted"));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("omits model from model-less Claude provider switch acknowledgements", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ claude: [] }));
    const setProvider = vi.fn();
    const setModel = vi.fn();
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
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "provider", provider: "claude", requestId: "request-claude" }),
        }),
        wsCtx,
      );

      expect(setProvider).toHaveBeenCalledWith("claude");
      expect(setModel).toHaveBeenCalledWith("");
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "provider_changed",
        provider: "claude",
        requestId: "request-claude",
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses the initial canonical projection to reject an ineligible provider switch before socket welcome", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ openrouter: ["openrouter/free"] }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const setProvider = vi.fn();
    const setModel = vi.fn();
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
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "provider", provider: "openrouter", model: "openrouter/free", requestId: "request-drift" }),
        }),
        wsCtx,
      );

      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledTimes(1);
      expect(setProvider).not.toHaveBeenCalled();
      expect(setModel).not.toHaveBeenCalled();
      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "error",
        message: expect.stringContaining("not eligible"),
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses the cached canonical projection to reject ineligible switches without cold rediscovery", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ openrouter: ["openrouter/free"] }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const setProvider = vi.fn();
    const setModel = vi.fn();
    const updateProviderPreference = vi.fn();
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
        updateProviderPreference,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider",
            provider: "openrouter",
            model: "openrouter/free",
            requestId: "request-openrouter",
          }),
        }),
        wsCtx,
      );

      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledTimes(1);
      expect(setProvider).not.toHaveBeenCalled();
      expect(setModel).not.toHaveBeenCalled();
      expect(updateProviderPreference).not.toHaveBeenCalled();
      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "error",
        message: expect.stringContaining("not eligible"),
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("refreshes GUI provider discovery on request without reconnecting", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let openAiAvailable = false;
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockImplementation(async () => [
        {
          provider: "openai",
          available: openAiAvailable,
          models: openAiAvailable ? [GPT4O] : [],
          status: openAiAvailable ? "available" : "missing_auth",
          reason: openAiAvailable ? "OpenAI models discovered." : "OPENAI_API_KEY is missing.",
          authState: openAiAvailable ? "authenticated" : "missing",
          lastCheckedAt: openAiAvailable ? "2026-04-28T12:01:00.000Z" : "2026-04-28T12:00:00.000Z",
        },
      ]);
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
        getProviderAvailability: () => ({ openai: true }),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);

      openAiAvailable = true;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_providers" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "providers_refreshed",
        models: { openai: [GPT4O] },
        providers: [
          expect.objectContaining({
            id: "openai",
            available: true,
            models: [GPT4O],
          }),
        ],
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("preserves gateway target identity when selecting a continuation session", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const onContinueSession = vi.fn();
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
          onContinueSession,
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "continue",
            sessionId: "session-123",
            gatewayTargetId: "gateway:local-app",
          }),
        }),
        wsCtx,
      );

      expect(onContinueSession).toHaveBeenCalledWith("session-123", undefined);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "continuation_selected",
        sessionId: "session-123",
        gatewayTargetId: "gateway:local-app",
      }));
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses cached provider models before admitting a turn", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }))
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ openai: [] }));
    const factory = vi.fn() as never;
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "cached discovery admitted" }],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "session-1",
        sessionMode: "mode-a",
        traceId: "trace-1",
        routingDecision: {
          provider: "openai",
          model: GPT4O,
          routingTier: "rule",
          reasoning: "GUI route selected",
          selectionMode: "automatic",
          rationale: {
            selectedProvider: "openai",
            selectedModel: GPT4O,
            selectionMode: "automatic",
            routingReason: "GUI route selected",
            confidence: 1,
            routingTier: "rule",
            inputsUsed: {
              tenantId: "default",
              complexityClass: "simple",
              complexityScore: 0.2,
              hasTools: false,
              toolCount: 0,
              requiresStreaming: false,
            },
            rankingEvidence: [],
            diagnostics: [],
          },
        },
      },
    } as never);
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
          sessionManager: {
            factory,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string; routingRationale?: Record<string, unknown> });

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "cached discovery admitted",
        routingRationale: expect.objectContaining({
          selectedProvider: "openai",
          selectedModel: GPT4O,
          selectionMode: "automatic",
          routingReason: "GUI route selected",
        }),
      }));
      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledTimes(1);
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

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
      await input.turnCapture?.start?.(session.id, 10);
      const managedInvoke = input.callBuiltinTools?.get("managed_agent.invoke");
      if (!managedInvoke) {
        throw new Error("managed_agent.invoke was not attached to the GUI turn surface");
      }
      expect(input.perCallConfig?.toolAllowlist?.has("managed_agent.invoke")).toBe(true);
      expect(input.perCallConfig?.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
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
        toolCall: {
          id: "tool-call-managed-1",
          name: "managed_agent.invoke",
          input: {},
        },
      });
      await input.turnCapture?.finish?.(session.id);

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
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-gui",
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
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
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

  it("streams route-unavailable managed-agent start results without child lifecycle frames", async () => {
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
    const startManagedAgent = createManagedInvocationLifecycleToolExecutors(
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
    const toolOutput = managedToolResult.output;
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
    const factory = vi.fn(() => ({
      run: async function* () {
        yield {
          type: "tool_use",
          toolCallScopeId: "turn-1:response:1",
          toolName: "managed_agent.start",
          input: toolInput,
          toolCallId,
        };
        yield {
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolName: "managed_agent.start",
          output: toolOutput,
          outputSummary: toolOutput,
          toolCallId,
          isError: true,
          metadata: expectedMetadata,
          toolUsage: {
            scope: "turn",
            toolName: "managed_agent.start",
            calls: 2,
          },
        };
        yield {
          type: "cost_update",
          usd: 0.0123,
          provider: "openai",
          model: GPT4O,
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 20,
        };
        yield {
          type: "text_delta",
          content: "The managed child route is unavailable before invocation.",
        };
        yield {
          type: "completed",
          totalUsd: 0,
          durationMs: 12,
          isError: false,
          isPreflightCrash: false,
        };
      },
      dispose: vi.fn(async () => undefined),
    }));
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
          sessionManager: {
            factory: factory as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
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
          kind: string;
          parentEventId?: string;
          payload: Record<string, unknown>;
        };
      });
      const sessionEventFrames = outboundFrames.filter((frame) => frame.type === "session_event");
      const toolEventFrames = sessionEventFrames.filter((frame) => frame.event?.kind.startsWith("tool_call_"));
      const completedFrame = toolEventFrames.find((frame) => frame.event?.kind === "tool_call_completed");
      const completedPayload = completedFrame?.event?.payload;
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
      expect(admittedTurn?.perCallConfig?.toolAllowlist?.has("managed_agent.start")).toBe(true);
      expect(admittedTurn?.perCallConfig?.additionalTools?.some((tool) => tool.name === "managed_agent.start")).toBe(
        true,
      );
      expect(toolEventFrames.map((frame) => frame.event?.kind)).toEqual([
        "tool_call_started",
        "tool_call_completed",
      ]);
      expect(completedPayload).toMatchObject({
        toolCallId,
        toolCallScopeId: "turn-1:response:1",
        toolName: "managed_agent.start",
        output: toolOutput,
        outputSummary: toolOutput,
        toolUsage: {
          scope: "turn",
          toolName: "managed_agent.start",
          calls: 2,
        },
        status: {
          state: "failed",
        },
        metadata: {
          toolName: "managed_agent.start",
          kind: "managed-invocation",
          routeId: "openrouter-readonly",
          profile: "foundation-readonly-plan",
          status: "unavailable",
          providerRoute: {
            providerId: "openrouter",
            model: "openrouter/free",
          },
        },
      });
      expect(completedPayload?.metadata).toEqual(expectedMetadata);
      expect(managedLifecycleFrames).toEqual([]);
      expect(sessionEventFrames.some((frame) => frame.event?.kind === "cost_updated")).toBe(true);
      expect(sessionEventFrames.some((frame) => frame.event?.kind === "lifecycle_attribution_recorded")).toBe(false);
      expect(factory).toHaveBeenCalledTimes(1);
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
        const profile = route.profiles["foundation-readonly-plan"]!;
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
            profiles: {
              "foundation-readonly-plan": {
                ...profile,
                allowedToolNames: ["read", "grep", "glob", "web_search", "browser_observe"],
                networkAllowed: false,
              },
            },
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
  ])("streams $label managed-agent start results without child lifecycle frames", async ({
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
    const startManagedAgent = createManagedInvocationLifecycleToolExecutors(
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
    const toolOutput = managedToolResult.output;
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
    const factory = vi.fn(() => ({
      run: async function* () {
        yield {
          type: "tool_use",
          toolCallScopeId: "turn-1:response:1",
          toolName: "managed_agent.start",
          input: toolInput,
          toolCallId,
        };
        yield {
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolName: "managed_agent.start",
          output: toolOutput,
          outputSummary: toolOutput,
          toolCallId,
          isError: true,
          metadata: runtimeMetadata,
        };
        yield {
          type: "text_delta",
          content: "The managed child route requirements are unavailable before invocation.",
        };
        yield {
          type: "completed",
          totalUsd: 0,
          durationMs: 12,
          isError: false,
          isPreflightCrash: false,
        };
      },
      dispose: vi.fn(async () => undefined),
    }));
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
          sessionManager: {
            factory: factory as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
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
      const toolEventFrames = sessionEventFrames.filter((frame) => frame.event?.kind.startsWith("tool_call_"));
      const completedFrame = toolEventFrames.find((frame) => frame.event?.kind === "tool_call_completed");
      const completedPayload = completedFrame?.event?.payload;
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
      expect(admittedTurn?.perCallConfig?.toolAllowlist?.has("managed_agent.start")).toBe(true);
      expect(toolEventFrames.map((frame) => frame.event?.kind)).toEqual([
        "tool_call_started",
        "tool_call_completed",
      ]);
      expect(completedPayload).toMatchObject({
        toolCallId,
        toolName: "managed_agent.start",
        output: toolOutput,
        outputSummary: toolOutput,
        status: {
          state: "failed",
        },
        metadata: {
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
        },
      });
      expect(completedPayload?.metadata).toEqual(runtimeMetadata);
      expect(managedLifecycleFrames).toEqual([]);
      expect(factory).toHaveBeenCalledTimes(1);
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
      await input.turnCapture?.start?.(session.id, 10);
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
        toolCall: {
          id: "tool-call-managed-active-write",
          name: "managed_agent.start",
          input: startInput,
        },
        requestApproval,
      });
      if (active.isError) {
        throw new Error(active.output);
      }
      activeInvocationId = (active.metadata as { invocationId: string }).invocationId;
      const denied = await startManagedAgent(startInput, {
        session,
        toolCall: {
          id: "tool-call-managed-conflicting-write",
          name: "managed_agent.start",
          input: startInput,
        },
        requestApproval,
      });
      if (!denied.isError) {
        throw new Error("Expected second same-checkout managed_agent.start to be denied");
      }
      deniedMetadata = denied.metadata as Record<string, unknown>;
      deniedInvocationId = String(deniedMetadata.invocationId);
      await input.sessionRegistry.save(session);
      await input.turnCapture?.finish?.(session.id);
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
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
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
            kind: string;
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

  it("streams denied worktree-conflict managed-agent start tool metadata without reshaping", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const actualMessagePipeline = await vi.importActual<typeof import("../../src/gateway/message-pipeline/index.js")>(
      "../../src/gateway/message-pipeline/index.js",
    );
    const { invocationService, managedInvocation, releaseActive, startInput } = makeManagedWriteConflictFixture();
    const startManagedAgent = createManagedInvocationLifecycleToolExecutors(
      makeManagedInvocationAttachment(managedInvocation),
    ).get("managed_agent.start");
    if (!startManagedAgent) {
      throw new Error("managed_agent.start executor was not registered");
    }
    const requestApproval = vi.fn(async () => ({
      approved: true,
      reason: "operator approved bounded write",
    }));
    const parentSession = new RuntimeSession({
      sessionId: "gui-denied-worktree-conflict-tool-parent",
      appName: "kiln-gui",
      tenantId: "gui",
      userId: "operator-1",
      systemPrompt: "You are a helpful assistant.",
    });
    const active = await startManagedAgent(startInput, {
      session: parentSession,
      toolCall: {
        id: "tool-call-managed-active-write",
        name: "managed_agent.start",
        input: startInput,
      },
      requestApproval,
    });
    if (active.isError) {
      throw new Error(active.output);
    }
    const activeInvocationId = (active.metadata as { invocationId: string }).invocationId;
    const toolCallId = "tool-call-managed-conflicting-write";
    const denied = await startManagedAgent(startInput, {
      session: parentSession,
      toolCall: {
        id: toolCallId,
        name: "managed_agent.start",
        input: startInput,
      },
      requestApproval,
    });
    if (!denied.isError) {
      throw new Error("Expected second same-checkout managed_agent.start to be denied");
    }
    const toolOutput = denied.output;
    const runtimeMetadata = denied.metadata as Record<string, unknown>;
    const deniedInvocationId = String(runtimeMetadata.invocationId);
    const factory = vi.fn(() => ({
      run: async function* () {
        yield {
          type: "tool_use",
          toolCallScopeId: "turn-1:response:1",
          toolName: "managed_agent.start",
          input: startInput,
          toolCallId,
        };
        yield {
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolName: "managed_agent.start",
          output: toolOutput,
          outputSummary: toolOutput,
          toolCallId,
          isError: true,
          metadata: runtimeMetadata,
        };
        yield {
          type: "text_delta",
          content: "Denied conflicting managed write.",
        };
        yield {
          type: "completed",
          totalUsd: 0,
          durationMs: 12,
          isError: false,
          isPreflightCrash: false,
        };
      },
      dispose: vi.fn(async () => undefined),
    }));
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
          sessionManager: {
            factory: factory as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start conflicting write child" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: { kind: string; payload: Record<string, unknown> };
      });
      const sessionEventFrames = outboundFrames.filter((frame) => frame.type === "session_event");
      const toolEventFrames = sessionEventFrames.filter((frame) => frame.event?.kind.startsWith("tool_call_"));
      const completedFrame = toolEventFrames.find((frame) => frame.event?.kind === "tool_call_completed");
      const completedPayload = completedFrame?.event?.payload;
      const managedLifecycleFrames = sessionEventFrames.filter((frame) =>
        frame.event?.kind.startsWith("agent_invocation_")
      );
      const admittedTurn = vi.mocked(processAdmittedTurn).mock.calls[0]?.[0];

      expect(runtimeMetadata).toMatchObject({
        invocationId: deniedInvocationId,
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
              failureReason: expect.stringContaining("missingCapabilities=resourceLease.worktreeConflict"),
            }),
          ],
        },
      });
      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "Denied conflicting managed write.",
      }));
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
      expect(admittedTurn?.callBuiltinTools?.get("managed_agent.start")).toEqual(expect.any(Function));
      expect(admittedTurn?.perCallConfig?.toolAllowlist?.has("managed_agent.start")).toBe(true);
      expect(toolEventFrames.map((frame) => frame.event?.kind)).toEqual([
        "tool_call_started",
        "tool_call_completed",
      ]);
      expect(completedPayload).toMatchObject({
        toolCallId,
        toolName: "managed_agent.start",
        output: toolOutput,
        outputSummary: toolOutput,
        status: {
          state: "failed",
        },
      });
      expect(completedPayload?.metadata).toEqual(runtimeMetadata);
      expect(managedLifecycleFrames).toEqual([]);
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      releaseActive.resolve?.();
      await invocationService.join(activeInvocationId).catch(() => undefined);
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("forwards browser session stream updates from the configured provider", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let browserSessionUpdateHandler: ((state: {
      readonly target: "browser";
      readonly status: "running" | "succeeded" | "failed";
      readonly updatedAt: string;
      readonly provider: "playwright";
      readonly sessionId: string;
      readonly ownership: "agent" | "operator" | "released";
      readonly viewMode: "snapshot" | "live";
      readonly stream: { readonly status: "starting" | "live" | "ended" | "failed" };
      readonly latestCapture?: {
        readonly uri: string;
        readonly relation: "snapshot";
        readonly mimeType: "image/png";
        readonly width?: number;
        readonly height?: number;
      };
    }) => void) | undefined;
    const browserProvider = {
      execute: vi.fn(),
      setBrowserSessionUpdateHandler: vi.fn((handler) => {
        browserSessionUpdateHandler = handler;
      }),
    };
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      await input.turnCapture?.start?.("gui-browser-session", 10);
      browserSessionUpdateHandler?.({
        target: "browser",
        status: "running",
        updatedAt: "2026-05-12T12:00:00.000Z",
        provider: "playwright",
        sessionId: "browser-live",
        ownership: "agent",
        viewMode: "live",
        stream: { status: "live" },
        latestCapture: {
          uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
          relation: "snapshot",
          mimeType: "image/png",
          width: 1280,
          height: 720,
        },
      });
      await input.turnCapture?.finish?.("gui-browser-session");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Browser stream observed." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
        },
      };
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
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "open the browser" }),
        }),
        wsCtx,
      );

      const browserFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; browserSession?: Record<string, unknown> })
        .find((frame) => frame.type === "browser_session_updated");
      const liveFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; [key: string]: unknown })
        .find((frame) => frame.type === "browser_live_viewport_frame");

      expect(browserProvider.setBrowserSessionUpdateHandler).toHaveBeenCalledWith(expect.any(Function));
      expect(browserFrame).toEqual({
        type: "browser_session_updated",
        browserSession: {
          target: "browser",
          status: "running",
          updatedAt: "2026-05-12T12:00:00.000Z",
          provider: "playwright",
          kilnSessionId: "gui-browser-session",
          sessionId: "browser-live",
          ownership: "agent",
          viewMode: "live",
          stream: { status: "live" },
          latestCapture: {
            uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
            relation: "snapshot",
            mimeType: "image/png",
            width: 1280,
            height: 720,
          },
        },
      });
      expect(liveFrame).toEqual({
        type: "browser_live_viewport_frame",
        sessionId: "browser-live",
        kilnSessionId: "gui-browser-session",
        frameId: "browser-live:2026-05-12T12:00:00.000Z",
        transport: "snapshot-polling",
        format: "png",
        artifactUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
        width: 1280,
        height: 720,
        capturedAt: "2026-05-12T12:00:00.000Z",
      });
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("preserves CDP screencast transport in forwarded browser live viewport frames", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let browserSessionUpdateHandler: ((state: {
      readonly target: "browser";
      readonly status: "running";
      readonly updatedAt: string;
      readonly provider: "playwright";
      readonly sessionId: string;
      readonly ownership: "operator";
      readonly viewMode: "live";
      readonly stream: { readonly status: "live" };
      readonly latestCapture: {
        readonly uri: string;
        readonly relation: "snapshot";
        readonly mimeType: "image/png";
        readonly width: number;
        readonly height: number;
        readonly transport: "cdp-screencast";
      };
    }) => void) | undefined;
    const browserProvider = {
      execute: vi.fn(),
      setBrowserSessionUpdateHandler: vi.fn((handler) => {
        browserSessionUpdateHandler = handler;
      }),
    };
    vi.mocked(processAdmittedTurn).mockImplementationOnce(async (input: {
      readonly turnCapture?: {
        readonly start: (sessionId: string, nextSequence: number) => void;
        readonly finish: (sessionId: string) => void;
      };
    }) => {
      input.turnCapture?.start("gui-browser-session", 1);
      input.turnCapture?.finish("gui-browser-session");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "watching" }],
          inputTokens: 1,
          outputTokens: 1,
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
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "open the browser" }),
        }),
        wsCtx,
      );

      browserSessionUpdateHandler?.({
        target: "browser",
        status: "running",
        updatedAt: "2026-05-13T12:00:00.000Z",
        provider: "playwright",
        sessionId: "browser-live",
        ownership: "operator",
        viewMode: "live",
        stream: { status: "live" },
        latestCapture: {
          uri: "kiln://artifacts/interactive-screenshots/artifact_2/content",
          relation: "snapshot",
          mimeType: "image/png",
          width: 1440,
          height: 900,
          transport: "cdp-screencast",
        },
      });

      const liveFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; [key: string]: unknown })
        .find((frame) => frame.type === "browser_live_viewport_frame" && frame.frameId === "browser-live:2026-05-13T12:00:00.000Z");

      expect(liveFrame).toMatchObject({
        type: "browser_live_viewport_frame",
        sessionId: "browser-live",
        kilnSessionId: "gui-browser-session",
        transport: "cdp-screencast",
        artifactUri: "kiln://artifacts/interactive-screenshots/artifact_2/content",
        width: 1440,
        height: 900,
      });
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("routes browser session control requests to the configured provider", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let browserSessionUpdateHandler: ((state: {
      readonly target: "browser";
      readonly status: "running";
      readonly updatedAt: string;
      readonly provider: "playwright";
      readonly sessionId: string;
      readonly ownership: "operator";
      readonly viewMode: "live";
      readonly stream: { readonly status: "paused"; readonly reason: string };
    }) => void) | undefined;
    const requestBrowserSessionControl = vi.fn(async () => {
      const state = {
        target: "browser" as const,
        status: "running" as const,
        updatedAt: "2026-05-12T12:00:00.000Z",
        provider: "playwright",
        sessionId: "browser-live",
        ownership: "operator" as const,
        viewMode: "live" as const,
        stream: {
          status: "paused" as const,
          reason: "Inspect before continuing.",
        },
      };
      browserSessionUpdateHandler?.(state);
      return state;
    });
    const browserProvider = {
      execute: vi.fn(),
      setBrowserSessionUpdateHandler: vi.fn((handler) => {
        browserSessionUpdateHandler = handler;
      }),
      requestBrowserSessionControl,
    };
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
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "browser_session_control",
            action: "takeover",
            gatewayTargetId: "gateway:browser-app",
            sessionId: "browser-live",
            reason: "Inspect before continuing.",
            requestId: "browser-control-1",
          }),
        }),
        wsCtx,
      );

      expect(requestBrowserSessionControl).toHaveBeenCalledWith({
        action: "takeover",
        gatewayTargetId: "gateway:browser-app",
        sessionId: "browser-live",
        operatorId: "operator-1",
        reason: "Inspect before continuing.",
      });
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "browser_session_updated",
        browserSession: {
          target: "browser",
          status: "running",
          updatedAt: "2026-05-12T12:00:00.000Z",
          provider: "playwright",
          sessionId: "browser-live",
          kilnSessionId: undefined,
          ownership: "operator",
          viewMode: "live",
          stream: {
            status: "paused",
            reason: "Inspect before continuing.",
          },
        },
      }));
    } finally {
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
          sessionManager: {
            factory: vi.fn() as never,
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
      profiles: {
        ...baseRoute.profiles,
        "foundation-readonly-plan": {
          ...baseRoute.profiles["foundation-readonly-plan"]!,
          credentialRoute: { mode: "credentialless" as const },
        },
      },
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
        await new Promise<never>(() => undefined);
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
        toolCall: {
          id: "tool-call-managed-start",
          name: "managed_agent.start",
          input: {},
        },
      });
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
          sessionManager: {
            factory: vi.fn() as never,
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
        cancelMessage.then(() => "resolved" as const),
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
      profiles: {
        ...baseRoute.profiles,
        "foundation-readonly-plan": {
          ...baseRoute.profiles["foundation-readonly-plan"]!,
          credentialRoute: { mode: "credentialless" as const },
        },
      },
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
        toolCall: {
          id: "tool-call-managed-prompt-start",
          name: "managed_agent.start",
          input: {},
        },
      });
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
          sessionManager: {
            factory: vi.fn() as never,
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
      profiles: {
        ...baseRoute.profiles,
        "foundation-readonly-plan": {
          ...baseRoute.profiles["foundation-readonly-plan"]!,
          credentialRoute: { mode: "credentialless" as const },
        },
      },
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
        toolCall: {
          id: "tool-call-managed-start",
          name: "managed_agent.start",
          input: {},
        },
      });
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
          sessionManager: {
            factory: vi.fn() as never,
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
      await input.turnCapture?.start?.(session.id, 10);
      const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
      if (!startManagedAgent) {
        throw new Error("managed_agent.start was not attached to the GUI turn surface");
      }
      const toolResult = await startManagedAgent(startInput, {
        session,
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
      if (toolResult.isError) {
        throw new Error(toolResult.output);
      }
      startedInvocationId = (toolResult.metadata as { invocationId: string }).invocationId;
      await input.sessionRegistry.save(session);
      await input.turnCapture?.finish?.(session.id);
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
          sessionManager: {
            factory: vi.fn() as never,
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
            kind: string;
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
      diagnosticKind: "timeout",
      attentionState: "timed_out",
    },
    {
      lifecycleState: "stale" as const,
      expectedKind: "agent_invocation_failed",
      errorCode: "ENGINE_STALE",
      diagnosticKind: "heartbeat",
      attentionState: "stale",
    },
    {
      lifecycleState: "failed" as const,
      expectedKind: "agent_invocation_failed",
      errorCode: "ENGINE_FAILURE",
      diagnosticKind: "failure",
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
      profiles: {
        ...baseRoute.profiles,
        "foundation-readonly-plan": {
          ...baseRoute.profiles["foundation-readonly-plan"]!,
          credentialRoute: { mode: "credentialless" as const },
        },
      },
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
        toolCall: {
          id: `tool-call-managed-start-${terminalCase.lifecycleState}`,
          name: "managed_agent.start",
          input: {},
        },
      });
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
          sessionManager: {
            factory: vi.fn() as never,
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
            kind: string;
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

  it("routes browser operator input requests to the configured provider and forwards acknowledgements", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const requestBrowserOperatorInput = vi.fn(async () => ({
      requestId: "browser-input-1",
      sessionId: "browser-live",
      status: "accepted" as const,
      handledAt: "2026-05-13T12:00:00.000Z",
    }));
    const browserProvider = {
      execute: vi.fn(),
      requestBrowserOperatorInput,
    };
    vi.mocked(processAdmittedTurn).mockImplementationOnce(async (input: {
      readonly turnCapture?: {
        readonly start: (sessionId: string, nextSequence: number) => void;
        readonly finish: (sessionId: string) => void;
      };
    }) => {
      input.turnCapture?.start("gui-browser-session", 1);
      input.turnCapture?.finish("gui-browser-session");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "ready" }],
          inputTokens: 1,
          outputTokens: 1,
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
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start browser work" }),
        }),
        wsCtx,
      );
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "browser_operator_input",
            requestId: "browser-input-1",
            gatewayTargetId: "gateway:browser-app",
            sessionId: "browser-live",
            input: {
              kind: "pointer",
              phase: "down",
              x: 120,
              y: 80,
              button: "left",
            },
          }),
        }),
        wsCtx,
      );

      expect(requestBrowserOperatorInput).toHaveBeenCalledWith({
        requestId: "browser-input-1",
        gatewayTargetId: "gateway:browser-app",
        sessionId: "browser-live",
        operatorId: "operator-1",
        input: {
          kind: "pointer",
          phase: "down",
          x: 120,
          y: 80,
          button: "left",
        },
      });
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "browser_operator_input_ack",
        requestId: "browser-input-1",
        sessionId: "browser-live",
        status: "accepted",
        handledAt: "2026-05-13T12:00:00.000Z",
      }));
      const evidenceFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          event?: {
            kind: string;
            kilnSessionId: string;
            payload: Record<string, unknown>;
          };
        })
        .find((frame) => frame.type === "session_event" && frame.event?.kind === "browser_operator_evidence");
      expect(evidenceFrame?.event).toMatchObject({
        kilnSessionId: "gui-browser-session",
        kind: "browser_operator_evidence",
        payload: {
          action: "operator_input",
          gatewayTargetId: "gateway:browser-app",
          browserSessionId: "browser-live",
          input: {
            kind: "pointer",
            phase: "down",
          },
          acknowledgement: {
            status: "accepted",
          },
        },
      });
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["blank", ""],
    ["stale", "gpt-4o-stale"],
  ])("does not fall back to providerModels[0] in the message path when the stored model is %s", async (_kind, storedModel) => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const factory = vi.fn() as never;
    const setModel = vi.fn();
    vi.mocked(processAdmittedTurn).mockReset();
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
          sessionManager: {
            factory,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => storedModel,
            setModel,
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models to be ready before message validation.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual({
        type: "error",
        message: storedModel
          ? `Provider 'openai' does not advertise model '${storedModel}'`
          : "Provider 'openai' requires a selected model.",
      });
      expect(setModel).not.toHaveBeenCalled();
      expect(processAdmittedTurn).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects provider switch frames without a nonblank requestId before mutating provider state", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const setProvider = vi.fn();
    const setModel = vi.fn();
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
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "provider", provider: "openai", model: GPT4O, requestId: "   " }),
        }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "error",
        message: "Provider switch requestId is required",
      }));
      expect(setProvider).not.toHaveBeenCalled();
      expect(setModel).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("publishes no provider descriptors in the fallback websocket welcome frame when no operator transport is available", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
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
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection();
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        providers: unknown[];
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.providers).toEqual([]);
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });


  it("reuses cached provider availability on welcome and refreshes drifted direct provider models on request", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let providerAvailability: Record<string, boolean> = { openai: true };
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: GPT4O }] }),
    })));
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
        getProviderAvailability: () => providerAvailability,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models to be ready before cached welcome validation.",
      );

      expect(gateway.operatorModels?.openai).toContain(GPT4O);
      providerAvailability = { openai: false };

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        models: Record<string, string[]>;
        providers: GuiProviderDescriptor[];
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.models.openai).toEqual([GPT4O]);
      expect(welcomeFrame.providers.find((descriptor) => descriptor.id === "openai")).toMatchObject({
        id: "openai",
        available: true,
        models: [GPT4O],
      });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_providers" }),
        }),
        wsCtx,
      );
      const refreshFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          models?: Record<string, string[]>;
          providers?: GuiProviderDescriptor[];
        })
        .find((frame) => frame.type === "providers_refreshed");

      expect(refreshFrame?.models?.openai).toBeUndefined();
      expect(refreshFrame?.providers?.find((descriptor) => descriptor.id === "openai")).toMatchObject({
        id: "openai",
        available: false,
        models: [],
        reason: "OpenAI is unavailable in this runtime.",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses the runtime operator model resolver to advertise codex-oauth models", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({
        "codex-oauth": ["gpt-5.4-mini"],
      }));
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
        getProviderAvailability: () => ({ "codex-oauth": true }),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.["codex-oauth"]?.includes("gpt-5.4-mini") ?? false,
        "Expected codex-oauth models to be advertised after background discovery.",
      );

      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledWith({ "codex-oauth": true });
      expect(gateway.operatorModels?.["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});

describe("projectGuiOperatorModels", () => {
  it("projects large OpenCode catalogs as diagnostic evidence without making routes selectable", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: Array.from({ length: 397 }, (_, index) => `provider-${index}/model-${index}`),
      opencodeDiscovery: {
        models: Array.from({ length: 397 }, (_, index) => `provider-${index}/model-${index}`),
        status: "available",
        reason: "OpenCode CLI models discovered.",
        authState: "authenticated",
      },
      codexModels: [],
      providerAvailability: { opencode: true },
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    });

    const projection = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    expect(projection.catalogEvidence).toMatchObject({
      status: "partial",
      counts: { total: 397, returned: 397, omitted: 0 },
    });
    expect(projection.entries).toHaveLength(397);
    expect(projection.entries[0]).toMatchObject({
      providerRoute: {
        providerId: "opencode",
        providerModelId: "provider-0/model-0",
        scope: "opencode-harness",
      },
      harnessRoute: {
        harnessId: "opencode",
        reportedProviderId: "opencode",
        reportedModelId: "provider-0/model-0",
      },
      rawEvidence: {
        rawId: "provider-0/model-0",
      },
      credentialEvidence: {
        state: "authenticated",
      },
      entitlementEvidence: {
        state: "unknown",
      },
      freshness: {
        status: "fresh",
      },
      routeHealth: {
        status: "healthy",
      },
      policyAdmission: {
        use: "interactive",
        status: "admitted",
      },
      eligibility: {
        eligible: false,
      },
    });
    expect(projection.entries[0].eligibility.reasonCodes).toEqual(expect.arrayContaining([
      "missing-entitlement-evidence",
    ]));
  });

  it("keeps direct provider route-health diagnostic without granting eligibility", () => {
    const projection = projectGuiProviderModelDiscovery([{
      provider: "openrouter",
      available: true,
      models: ["openrouter/free"],
      modelRouteHealth: {
        "openrouter/free": { healthy: true },
      },
      status: "available",
      reason: "OpenRouter models discovered.",
      authState: "authenticated",
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }], {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0]).toMatchObject({
      credentialEvidence: { state: "authenticated" },
      entitlementEvidence: { state: "unknown" },
      routeHealth: { status: "healthy" },
      policyAdmission: { use: "interactive", status: "admitted" },
      eligibility: {
        eligible: false,
        reasonCodes: expect.arrayContaining([
          "missing-entitlement-evidence",
        ]),
      },
    });
    expect(projection.entries[0].eligibility.reasonCodes).not.toContain("missing-route-health-evidence");
  });

  it("marks account-scoped direct service models eligible for interactive GUI selection", () => {
    const projection = projectGuiProviderModelDiscovery([{
      provider: "opencode-go",
      available: true,
      models: ["deepseek-v4-flash"],
      status: "available",
      reason: "OpenCode Go models discovered.",
      authState: "authenticated",
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }, {
      provider: "codex-oauth",
      available: true,
      models: ["gpt-5.5"],
      status: "available",
      reason: "Codex OAuth models discovered.",
      authState: "authenticated",
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }], {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    expect(projection.entries).toHaveLength(2);
    expect(projection.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerRoute: {
          providerId: "opencode-go",
          providerModelId: "deepseek-v4-flash",
          scope: "opencode-service",
        },
        credentialEvidence: expect.objectContaining({ state: "authenticated" }),
        entitlementEvidence: expect.objectContaining({ state: "confirmed" }),
        routeHealth: expect.objectContaining({ status: "healthy" }),
        policyAdmission: expect.objectContaining({ use: "interactive", status: "admitted" }),
        eligibility: { eligible: true, reasonCodes: [] },
      }),
      expect.objectContaining({
        providerRoute: {
          providerId: "codex-oauth",
          providerModelId: "gpt-5.5",
          scope: "direct-provider",
        },
        credentialEvidence: expect.objectContaining({ state: "authenticated" }),
        entitlementEvidence: expect.objectContaining({ state: "confirmed" }),
        routeHealth: expect.objectContaining({ status: "healthy" }),
        policyAdmission: expect.objectContaining({ use: "interactive", status: "admitted" }),
        eligibility: { eligible: true, reasonCodes: [] },
      }),
    ]));
  });

  it("keeps stale catalog entries visible but fail-closed in the provider-model projection", () => {
    const discovery = markGuiProviderDiscoveryStale(buildGuiOperatorDiscoveryResults({
      opencodeModels: ["openai/gpt-5.4-mini"],
      opencodeDiscovery: {
        models: ["openai/gpt-5.4-mini"],
        status: "available",
        reason: "OpenCode CLI models discovered.",
        authState: "authenticated",
      },
      codexModels: [],
      providerAvailability: { opencode: true },
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }));

    const projection = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    expect(projection.catalogEvidence.status).toBe("partial");
    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0]).toMatchObject({
      freshness: { status: "stale" },
      eligibility: { eligible: false },
    });
    expect(projection.entries[0].eligibility.reasonCodes).toContain("stale-discovered-evidence");
  });

  it("includes discovered codex-oauth subscription models from direct OAuth discovery", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      opencodeModels: ["openai/gpt-5.4-mini"],
      codexModels: ["gpt-5.4", "gpt-5.4-mini"],
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    expect(models.codex).toEqual(["gpt-5.4", "gpt-5.4-mini"]);
    expect(models.opencode).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("does not expose codex-oauth when only local Codex CLI models are discovered", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      codexModels: ["gpt-5.4"],
    }));

    expect(models.codex).toEqual(["gpt-5.4"]);
    expect(models["codex-oauth"]).toBeUndefined();
  });

  it("publishes only directly discovered codex-oauth models when direct OAuth discovery is present", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      codexModels: ["gpt-5.4"],
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    expect(models["codex-oauth"]).not.toContain("gpt-5.4");
  });

  it("uses structured codex-oauth discovery instead of local Codex CLI discovery", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: ["gpt-5.4"],
      codexDiscovery: {
        models: ["gpt-5.4"],
        status: "available",
        reason: "Codex CLI models discovered.",
        authState: "authenticated",
      },
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: true,
      models: ["gpt-5.4"],
      reason: "Codex CLI models discovered.",
    });
    expect(discovery.find((entry) => entry.provider === "codex-oauth")).toMatchObject({
      provider: "codex-oauth",
      available: true,
      models: ["gpt-5.4-mini"],
      reason: "Codex OAuth models discovered.",
    });
    expect(projectGuiOperatorModels(discovery)["codex-oauth"]).not.toContain("gpt-5.4");
  });

  it("publishes discovered direct provider models when discovery and availability agree", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        anthropic: {
          models: ["claude-sonnet-4-6"],
          status: "available",
          reason: "Anthropic models discovered.",
          authState: "authenticated",
        },
        openai: {
          models: [GPT4O],
          status: "available",
          reason: "OpenAI models discovered.",
          authState: "authenticated",
        },
        deepseek: {
          models: ["deepseek-chat"],
          status: "available",
          reason: "DeepSeek models discovered.",
          authState: "authenticated",
        },
        openrouter: {
          models: ["nvidia/nemotron-3-nano-30b-a3b:free"],
          status: "available",
          reason: "OpenRouter models discovered.",
          authState: "authenticated",
        },
        "opencode-go": {
          models: ["minimax-m2.5"],
          status: "available",
          reason: "OpenCode Go models discovered.",
          authState: "authenticated",
        },
        "opencode-zen": {
          models: ["openai/gpt-5.4"],
          status: "available",
          reason: "OpenCode Zen models discovered.",
          authState: "authenticated",
        },
        ollama: {
          models: ["ollama-local"],
          status: "available",
          reason: "Ollama models discovered.",
          authState: "not_required",
        },
      },
    }));

    expect(models.anthropic).toContain("claude-sonnet-4-6");
    expect(models.openai).toContain(GPT4O);
    expect(models.deepseek).toContain("deepseek-chat");
    expect(models.openrouter).toContain("nvidia/nemotron-3-nano-30b-a3b:free");
    expect(models["opencode-go"]).toContain("minimax-m2.5");
    expect(models["opencode-zen"]).toContain("openai/gpt-5.4");
    expect(models.ollama).toContain("ollama-local");
    expect(models.claude).toBeUndefined();
  });

  it("keeps OpenCode CLI wrapper models separate from OpenCode subscription models", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: ["opencode/wrapper-model"],
      codexModels: [],
      opencodeDiscovery: {
        models: ["opencode/wrapper-model"],
        status: "available",
        reason: "OpenCode CLI models discovered.",
        authState: "authenticated",
      },
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "opencode-go": {
          models: ["opencode/go-model"],
          status: "available",
          reason: "OpenCode Go models discovered.",
          authState: "authenticated",
        },
        "opencode-zen": {
          models: ["opencode/zen-model"],
          status: "available",
          reason: "OpenCode Zen models discovered.",
          authState: "authenticated",
        },
      },
    });

    const models = projectGuiOperatorModels(discovery);

    expect(models.opencode).toEqual(["opencode/wrapper-model"]);
    expect(models["opencode-go"]).toEqual(["opencode/go-model"]);
    expect(models["opencode-zen"]).toEqual(["opencode/zen-model"]);
    expect(models.opencode).not.toContain("opencode/go-model");
    expect(models.opencode).not.toContain("opencode/zen-model");
    expect(models["opencode-go"]).not.toContain("opencode/wrapper-model");
    expect(models["opencode-zen"]).not.toContain("opencode/wrapper-model");
  });

  it("publishes Claude as a model-less operator provider when availability says it is live", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: {
        claude: true,
      },
    }));

    expect(models.claude).toEqual([]);
  });

  it("does not expose codex-oauth when codex discovery returns no models", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        openai: {
          models: [GPT4O],
          status: "available",
          reason: "OpenAI models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models.codex).toBeUndefined();
    expect(models["codex-oauth"]).toBeUndefined();
    expect(models.openai).toContain(GPT4O);
  });
});

describe("discoverOpencodeCliModelDiscovery", () => {
  afterEach(() => {
    vi.mocked(execFileSync).mockReturnValue("");
    vi.unstubAllGlobals();
  });

  it("probes an npm OpenCode command shim with the platform-required shell mode", () => {
    vi.mocked(execFileSync).mockImplementation((command) => {
      if (String(command).toLowerCase().endsWith("opencode.cmd")) return "opencode 1.18.16";
      throw new Error("not this candidate");
    });

    expect(resolveOpenCodeExecutable()).toMatchObject({ evidence: { version: "1.18.16" } });
    const shimCall = vi.mocked(execFileSync).mock.calls.find(([command]) =>
      String(command).toLowerCase().endsWith("opencode.cmd"));
    expect(shimCall?.[2]).toEqual(expect.objectContaining({
      shell: process.platform === "win32",
    }));
  });

  it("discovers only enabled OpenCode variants through its local structured model API", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.includes("--version")) {
        return "opencode 1.0.0";
      }
      return "";
    });
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => {
        proc.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:43123\n"));
      });
      return proc as never;
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: "gpt-5.4",
          providerID: "opencode",
          enabled: true,
          variants: [
            { id: "none", body: { enableThinking: false } },
            { id: "minimal", body: { modelParams: { reasoning_effort: "minimal" } } },
            { id: "low", body: { reasoningEffort: "low" } },
            { id: "medium", body: { thinkingConfig: { thinkingLevel: "medium" } } },
            { id: "xhigh", body: { reasoning: { effort: "xhigh" } } },
            { id: "max", body: { enable_thinking: true, thinking_budget: 32000 } },
            { id: "high", body: { reasoningEffort: "low" } },
            { id: "high", body: { reasoningEffort: "high", thinking: { type: "disabled" } } },
            { id: "high", body: { textVerbosity: "high" } },
          ],
        },
        {
          id: "disabled-model",
          providerID: "opencode",
          enabled: false,
          variants: [{ id: "high" }],
        },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: ["opencode/gpt-5.4"],
      status: "available",
      reason: "OpenCode CLI models discovered through its local model API.",
      authState: "authenticated",
      modelCapabilities: {
        "opencode/gpt-5.4": {
          deliberation: {
            provider: "opencode",
            model: "opencode/gpt-5.4",
            levels: [
              { id: "none" },
              { id: "minimal" },
              { id: "low" },
              { id: "medium" },
              { id: "xhigh" },
              { id: "max" },
            ],
            supportsAdaptive: false,
            evidence: {
              sourceIdentity: "opencode-cli-model-catalog",
              sourceRevision: expect.stringMatching(/^1\.0\.0:[a-f0-9]{16}$/u),
            },
          },
        },
      },
    });
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/api\/model$/u), expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(spawn).toHaveBeenCalledWith(expect.any(String), ["serve", "--hostname=127.0.0.1", "--port=0"], expect.objectContaining({
      stdio: ["ignore", "pipe", "pipe"],
    }));
  });

  it("revises OpenCode capability evidence when variant reasoning semantics change", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => args?.includes("--version") ? "opencode 1.0.0" : "");
    vi.mocked(spawn).mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => proc.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:43123\n")));
      return proc as never;
    });
    let budget = 16000;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: "reasoning-model",
        providerID: "provider",
        enabled: true,
        variants: [{ id: "high", body: { enable_thinking: true, thinking_budget: budget } }],
      }],
    }), { status: 200 })));

    const first = await discoverOpencodeCliModelDiscovery();
    budget = 32000;
    const second = await discoverOpencodeCliModelDiscovery();

    expect(first.modelCapabilities?.["provider/reasoning-model"]?.deliberation.evidence.sourceRevision)
      .not.toBe(second.modelCapabilities?.["provider/reasoning-model"]?.deliberation.evidence.sourceRevision);
  });

  it("diagnoses missing OpenCode CLI executable", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("missing opencode");
    });

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "cli_missing",
      reason: "OpenCode CLI executable was not found.",
      authState: "not_required",
    });
  });

  it("diagnoses OpenCode local model server failure after the executable is found", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.includes("--version")) {
        return "opencode 1.0.0";
      }
      return "";
    });
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => proc.emit("close", 1));
      return proc as never;
    });

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenCode CLI model server failed.",
      authState: "unknown",
    });
  });

  it("diagnoses an empty OpenCode structured model list", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.includes("--version")) {
        return "opencode 1.0.0";
      }
      return "";
    });
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => {
        proc.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:43123\n"));
      });
      return proc as never;
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenCode local model API returned an empty model list.",
      authState: "unknown",
    });
  });
});

describe("discoverCodexCliModelDiscovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(execFileSync).mockReturnValue("");
  });

  it("initializes Codex app-server before requesting local models", async () => {
    const writes: unknown[] = [];
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          writes.push(message);
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: {
                  userAgent: "codex-test",
                  codexHome: "C:/tmp/codex",
                  platformFamily: "windows",
                  platformOs: "windows",
                },
              }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: {
                  data: [
                    { id: "gpt-5.4" },
                    { id: "gpt-5.4-mini" },
                  ],
                },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    const discovery = await discoverCodexCliModelDiscovery();

    expect(spawn).toHaveBeenCalledWith(expect.any(String), ["app-server"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    expect(writes).toEqual([
      expect.objectContaining({
        method: "initialize",
        id: 1,
      }),
      { method: "initialized" },
      expect.objectContaining({
        method: "model/list",
        id: 2,
        params: { limit: 100, includeHidden: false },
      }),
    ]);
    expect(discovery).toMatchObject({
      models: ["gpt-5.4", "gpt-5.4-mini"],
      status: "available",
      reason: "Codex CLI models discovered.",
      authState: "authenticated",
    });
  });

  it("diagnoses missing Codex CLI executable", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("missing codex");
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "cli_missing",
      reason: "Codex CLI executable was not found.",
      authState: "not_required",
    });
  });

  it("diagnoses Codex app-server timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = { write: vi.fn(() => true) };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    const discoveryPromise = discoverCodexCliModelDiscovery();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(discoveryPromise).resolves.toMatchObject({
      models: [],
      status: "endpoint_timeout",
      reason: "Codex app-server did not return models before timeout.",
      authState: "unknown",
    });
  });

  it("diagnoses Codex app-server auth failures", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result: {} }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                error: { code: -32000, message: "OpenAI authentication required" },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "Codex CLI authentication is missing or expired.",
      authState: "missing",
    });
  });

  it("diagnoses Codex model version gates separately from endpoint failures", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result: {} }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                error: {
                  code: -32603,
                  message: "The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
                },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "model_version_unsupported",
      reason: "Codex CLI model support is out of date: The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      authState: "authenticated",
    });
  });

  it("diagnoses an empty Codex app-server model list", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result: {} }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: { data: [] },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Codex app-server returned an empty model list.",
      authState: "unknown",
    });
  });

  it("proves explicit Codex model readiness through a live exec probe", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = {
        write: vi.fn(() => true),
        end: vi.fn(() => {
          queueMicrotask(() => {
            proc.emit("close", 0);
          });
        }),
      };
      proc.kill = vi.fn();
      return proc as never;
    });

    await expect(probeCodexCliModelReadiness({
      model: "gpt-5.5",
      deliberationLevel: "medium",
      cwd: "C:/repo",
      env: { KILN_TEST: "1" },
    })).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.5",
      runnable: true,
      status: "available",
      reason: "Codex CLI model 'gpt-5.5' passed live readiness probe.",
      authState: "authenticated",
    });
    expect(spawn).toHaveBeenCalledWith(expect.any(String), [
      "exec",
      "--json",
      "-m",
      "gpt-5.5",
      "-c",
      "model_reasoning_effort=medium",
      "--ephemeral",
      "--skip-git-repo-check",
      "-",
    ], expect.objectContaining({
      cwd: "C:/repo",
      stdio: ["pipe", "pipe", "pipe"],
    }));
  });

  it("diagnoses Codex model readiness version gates", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = {
        write: vi.fn(() => true),
        end: vi.fn(() => {
          queueMicrotask(() => {
            proc.stdout.emit("data", Buffer.from(JSON.stringify({
              type: "error",
              error: {
                message: "The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
              },
            }) + "\n"));
            proc.emit("close", 1);
          });
        }),
      };
      proc.kill = vi.fn();
      return proc as never;
    });

    await expect(probeCodexCliModelReadiness({
      model: "gpt-5.5",
    })).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.5",
      runnable: false,
      status: "model_version_unsupported",
      reason: "Codex CLI model support is out of date: The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      authState: "authenticated",
    });
  });
});

describe("discoverGuiDirectProviderModelDiscovery", () => {
  it("discovers OpenAI chat-capable models and filters clearly incompatible model families", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.openai.com/v1/models",
      json: async () => ({
        data: [
          { id: "gpt-5.4" },
          { id: "gpt-4o-mini" },
          { id: "o3" },
          { id: "ft:gpt-4o-mini:sequel:custom:abc123" },
          { id: "text-embedding-3-large" },
          { id: "omni-moderation-latest" },
          { id: "tts-1" },
          { id: "whisper-1" },
          { id: "gpt-image-1" },
          { id: "dall-e-3" },
          { id: "gpt-realtime" },
          { id: "gpt-audio" },
          { id: "computer-use-preview" },
        ],
      }),
    }));
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { openai: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.openai).toMatchObject({
      status: "available",
      reason: "OpenAI models discovered.",
      authState: "authenticated",
    });
    expect(models.openai).toEqual([
      "gpt-5.4",
      "gpt-4o-mini",
      "o3",
      "ft:gpt-4o-mini:sequel:custom:abc123",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-openai-key" },
      }),
    );
  });

  it("diagnoses missing OpenAI API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "OPENAI_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses OpenAI model endpoint failures", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenAI model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty OpenAI model lists", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenAI model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses OpenAI lists with no usable chat models after filtering", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "text-embedding-3-large" },
          { id: "omni-moderation-latest" },
          { id: "gpt-image-1" },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenAI model endpoint returned no usable chat models.",
      authState: "unknown",
    });
  });

  it("discovers Anthropic message-capable models from the Models API", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.anthropic.com/v1/models",
      json: async () => ({
        data: [
          {
            id: "claude-opus-4-7",
            type: "model",
            max_input_tokens: 1_000_000,
            max_tokens: 128_000,
            capabilities: {
              messages: { supported: true },
            },
          },
          {
            id: "claude-sonnet-4-6",
            type: "model",
            max_input_tokens: 1_000_000,
            max_tokens: 64_000,
            capabilities: {
              messages: { supported: true },
            },
          },
          {
            id: "claude-embedding-preview",
            type: "model",
            capabilities: {
              messages: { supported: false },
            },
          },
        ],
      }),
    }));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { anthropic: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.anthropic).toMatchObject({
      status: "available",
      reason: "Anthropic models discovered.",
      authState: "authenticated",
    });
    expect(models.anthropic).toEqual([
      "claude-opus-4-7",
      "claude-sonnet-4-6",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": "test-anthropic-key",
        },
      }),
    );
  });

  it("keeps Anthropic Claude IDs when the provider omits capability metadata", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "claude-haiku-4-5-20251001", type: "model" },
          { id: "not-claude-experimental", type: "model" },
        ],
      }),
    })));

    const providerAvailability = { anthropic: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(models.anthropic).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it("diagnoses missing Anthropic API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "ANTHROPIC_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses Anthropic model endpoint failures", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "Anthropic model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty Anthropic model lists", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Anthropic model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses Anthropic lists with no message-capable models after filtering", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "claude-embedding-preview",
            type: "model",
            capabilities: {
              messages: { supported: false },
            },
          },
          {
            id: "non-claude-model",
            type: "model",
          },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Anthropic model endpoint returned no message-capable models.",
      authState: "unknown",
    });
  });

  it("discovers DeepSeek chat and reasoner models from the Models API", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.deepseek.com/models",
      json: async () => ({
        object: "list",
        data: [
          { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
          { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
          { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
          { id: "deepseek-reasoner", object: "model", owned_by: "deepseek" },
          { id: "deepseek-embedding-preview", object: "model", owned_by: "deepseek" },
          { id: "not-deepseek-chat", object: "model", owned_by: "third-party" },
        ],
      }),
    }));
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { deepseek: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.deepseek).toMatchObject({
      status: "available",
      reason: "DeepSeek models discovered.",
      authState: "authenticated",
    });
    expect(models.deepseek).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-deepseek-key" },
      }),
    );
  });

  it("diagnoses missing DeepSeek API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "DEEPSEEK_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses DeepSeek model endpoint failures", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "DeepSeek model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty DeepSeek model lists", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ object: "list", data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "DeepSeek model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses DeepSeek lists with no usable chat models after filtering", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "deepseek-embedding-preview" },
          { id: "deepseek-audio-preview" },
          { id: "not-deepseek-chat" },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "DeepSeek model endpoint returned no usable chat models.",
      authState: "unknown",
    });
  });

  it("discovers OpenRouter text chat models and filters incompatible modalities", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://openrouter.ai/api/v1/models",
      json: async () => ({
        data: [
          {
            id: "openai/gpt-4.1",
            architecture: {
              modality: "text->text",
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            supported_parameters: ["tools", "temperature"],
          },
          {
            id: "anthropic/claude-sonnet-4.5",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            context_length: 200_000,
          },
          {
            id: "openai/text-embedding-3-large",
            architecture: {
              modality: "text->embedding",
              input_modalities: ["text"],
              output_modalities: ["embedding"],
            },
          },
          {
            id: "google/gemini-image-preview",
            architecture: {
              modality: "text->image",
              input_modalities: ["text"],
              output_modalities: ["image"],
            },
          },
          {
            id: "unscoped-model",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
        ],
      }),
    }));
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { openrouter: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.openrouter).toMatchObject({
      status: "available",
      reason: "OpenRouter models discovered.",
      authState: "authenticated",
    });
    expect(models.openrouter).toEqual([
      "openai/gpt-4.1",
      "anthropic/claude-sonnet-4.5",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-openrouter-key" },
      }),
    );
  });

  it("diagnoses missing OpenRouter API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "OPENROUTER_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses OpenRouter model endpoint failures", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenRouter model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty OpenRouter model lists", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenRouter model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses OpenRouter lists with no usable text chat models after filtering", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "openai/text-embedding-3-large",
            architecture: { output_modalities: ["embedding"] },
          },
          {
            id: "google/gemini-image-preview",
            architecture: { output_modalities: ["image"] },
          },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenRouter model endpoint returned no usable text chat models.",
      authState: "unknown",
    });
  });

  it("discovers locally installed Ollama models from the daemon without remote auth", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [
          { name: "llama3.1:8b", digest: "sha256-local-a" },
          { model: "qwen2.5-coder:7b", digest: "sha256-local-b" },
          { id: "remote/library-model" },
          { name: "  " },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { ollama: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.ollama).toMatchObject({
      models: ["llama3.1:8b", "qwen2.5-coder:7b"],
      status: "available",
      reason: "Ollama models discovered.",
      authState: "not_required",
    });
    expect(models.ollama).toEqual(["llama3.1:8b", "qwen2.5-coder:7b"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("diagnoses an unreachable Ollama daemon separately from no installed models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      ollama: true,
    });

    expect(discovered.ollama).toMatchObject({
      models: [],
      status: "daemon_unreachable",
      reason: "Ollama daemon is not reachable at http://localhost:11434.",
      authState: "not_required",
    });
  });

  it("diagnoses an Ollama daemon with no installed models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      ollama: true,
    });

    expect(discovered.ollama).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Ollama daemon returned no installed models.",
      authState: "not_required",
    });
  });

  it.each([
    ["go", "opencode-go", "https://opencode.ai/zen/go/v1/models"],
    ["zen", "opencode-zen", `${OPENCODE_BASE_URL}/models`],
  ])("discovers %s tier OpenCode models from the tiered credential pool", async (tier, providerId, modelsUrl) => {
    const poolSpy = mockOpenCodeCredentialPool((requestedTier) => requestedTier === tier
      ? [{
          api_key: "test-opencode-key",
          tier: tier as "go" | "zen",
          created_at: "2026-01-01T00:00:00.000Z",
        }]
      : []);
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === modelsUrl,
      json: async () => ({ data: [{ id: "opencode/live-model" }] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        [providerId]: true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models[providerId]).toEqual(["opencode/live-model"]);
      expect(models[tier === "go" ? "opencode-zen" : "opencode-go"]).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        modelsUrl,
        expect.objectContaining({
          headers: { Authorization: "Bearer test-opencode-key" },
        }),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("uses OPENCODE_API_KEY to discover both OpenCode Go and Zen requested tiers", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        data: [
          { id: url.includes("/go/") ? "go-model" : "zen-model" },
        ],
      }),
    }));
    vi.stubEnv("OPENCODE_API_KEY", "env-opencode-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = {
      "opencode-go": true,
      "opencode-zen": true,
    };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(models["opencode-go"]).toEqual(["go-model"]);
    expect(models["opencode-zen"]).toEqual(["zen-model"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer env-opencode-key" } }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      `${OPENCODE_BASE_URL}/models`,
      expect.objectContaining({ headers: { Authorization: "Bearer env-opencode-key" } }),
    );
  });

  it("uses tiered Kiln OpenCode credential pool entries to discover Go and Zen models", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: tier === "go" ? "go-pool-key" : "zen-pool-key",
      tier,
      created_at: "2026-05-15T00:00:00.000Z",
    }]);
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        data: [
          { id: url.includes("/go/") ? "go-model" : "zen-model" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "opencode-go": true,
        "opencode-zen": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

      expect(models["opencode-go"]).toEqual(["go-model"]);
      expect(models["opencode-zen"]).toEqual(["zen-model"]);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://opencode.ai/zen/go/v1/models",
        expect.objectContaining({ headers: { Authorization: "Bearer go-pool-key" } }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        `${OPENCODE_BASE_URL}/models`,
        expect.objectContaining({ headers: { Authorization: "Bearer zen-pool-key" } }),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses missing OpenCode API credentials for requested subscription tiers", async () => {
    const poolSpy = mockOpenCodeCredentialPool();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-go": true,
        "opencode-zen": true,
      });

      expect(discovered["opencode-go"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "No OpenCode Go credential is linked.",
        authState: "missing",
      });
      expect(discovered["opencode-zen"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "No OpenCode Zen credential is linked.",
        authState: "missing",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses OpenCode subscription model endpoint failures", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: "test-opencode-key",
      tier,
      created_at: "2026-01-01T00:00:00.000Z",
    }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-go": true,
      });

      expect(discovered["opencode-go"]).toMatchObject({
        models: [],
        status: "endpoint_error",
        reason: "OpenCode Go model endpoint failed.",
        authState: "unknown",
      });
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses empty OpenCode subscription model responses", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: "test-opencode-key",
      tier,
      created_at: "2026-01-01T00:00:00.000Z",
    }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-zen": true,
      });

      expect(discovered["opencode-zen"]).toMatchObject({
        models: [],
        status: "empty_model_list",
        reason: "OpenCode Zen model endpoint returned an empty model list.",
        authState: "unknown",
      });
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("discovers codex-oauth models from live OAuth auth and the Codex models endpoint", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token" }]);
    const fetchSpy = vi.fn(async (url: string) => {
      const requestedUrl = new URL(url);
      return {
        ok: (
          requestedUrl.origin === "https://chatgpt.com"
          && requestedUrl.pathname === "/backend-api/codex/models"
          && requestedUrl.searchParams.get("client_version") === "2.0.0"
        ),
        json: async () => ({
          models: [
            {
              slug: "gpt-5.4",
              shell_type: "shell_command",
              apply_patch_tool_type: "freeform",
              supports_parallel_tool_calls: true,
              context_window: 272000,
              input_modalities: ["text", "image"],
              default_reasoning_level: "medium",
              supported_reasoning_levels: [
                { effort: "low", description: "Fast responses with lighter reasoning" },
                { effort: "medium", description: "Balances speed and reasoning depth" },
                { effort: "high", description: "Greater reasoning depth" },
              ],
            },
            {
              slug: "gpt-5.4-mini",
              shell_type: "disabled",
            },
            {
              slug: "gpt-no-functions",
              supports_tools: false,
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "codex-oauth": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models["codex-oauth"]).toEqual(["gpt-5.4", "gpt-5.4-mini", "gpt-no-functions"]);
      expect(discovered["codex-oauth"]?.modelCapabilities).toEqual({
        "gpt-5.4": {
          supportsNativeShellTools: true,
          supportsNativePatchTools: true,
          supportsParallelToolCalls: true,
          contextWindow: 272000,
          supportsVision: true,
          deliberation: {
            provider: "codex-oauth",
            model: "gpt-5.4",
            levels: [{ id: "low" }, { id: "medium" }, { id: "high" }],
            defaultLevel: "medium",
            supportsAdaptive: true,
            evidence: {
              sourceIdentity: "codex-oauth-model-catalog",
              sourceRevision: "gpt-5.4",
              observedAt: expect.any(String),
            },
          },
        },
        "gpt-5.4-mini": {
          supportsNativeShellTools: false,
        },
        "gpt-no-functions": {
          supportsFunctionTools: false,
          supportsRuntimeTools: false,
          supportsTools: false,
        },
      });
      const discoveryResults = buildGuiOperatorDiscoveryResults({
        opencodeModels: [],
        codexModels: [],
        providerAvailability,
        directProviderDiscovery: discovered,
        lastCheckedAt: "2026-04-28T12:00:00.000Z",
      });
      expect(discoveryResults.find((entry) => entry.provider === "codex-oauth")?.modelCapabilities)
        .toEqual(discovered["codex-oauth"]?.modelCapabilities);
      const [url, options] = fetchSpy.mock.calls[0] ?? [];
      const requestedUrl = new URL(String(url));
      expect(requestedUrl.origin).toBe("https://chatgpt.com");
      expect(requestedUrl.pathname).toBe("/backend-api/codex/models");
      expect(requestedUrl.searchParams.get("client_version")).toBe("2.0.0");
      expect(options).toEqual(expect.objectContaining({
        headers: { Authorization: "Bearer test-codex-token" },
      }));
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("skips backend-invalidated codex-oauth credentials during model discovery", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([
        { credentialId: "old", accessToken: "old-invalidated-token" },
        { credentialId: "fresh", accessToken: "fresh-token" },
      ]);
    const recordAuthenticationFailureSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "recordAuthenticationFailure")
      .mockResolvedValue();
    const fetchSpy = vi.fn(async (_url: string, options?: RequestInit) => {
      const authorization = (options?.headers as Record<string, string> | undefined)?.Authorization;
      if (authorization === "Bearer old-invalidated-token") {
        return {
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({
            error: {
              message: "Your authentication token has been invalidated. Please try signing in again.",
              code: "token_invalidated",
            },
          }),
        };
      }
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ models: [{ slug: "gpt-5.4" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });

      expect(discovered["codex-oauth"]).toMatchObject({
        models: ["gpt-5.4"],
        status: "available",
        authState: "authenticated",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls.map(([, options]) => (options?.headers as Record<string, string>).Authorization))
        .toEqual(["Bearer old-invalidated-token", "Bearer fresh-token"]);
      expect(recordAuthenticationFailureSpy).toHaveBeenCalledWith("old");
    } finally {
      codexAuthSpy.mockRestore();
      recordAuthenticationFailureSpy.mockRestore();
    }
  });

  it("diagnoses missing codex-oauth OAuth credentials", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "Codex OAuth authentication is missing.",
        authState: "missing",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses expired codex-oauth OAuth credentials", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockRejectedValue(new Error("refresh token expired"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "auth_expired",
        reason: "Codex OAuth authentication is expired.",
        authState: "expired",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses codex-oauth model endpoint failure", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-endpoint-failure" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "endpoint_error",
        reason: "Codex OAuth model endpoint failed.",
        authState: "unknown",
      });
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses an empty codex-oauth model response", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-empty-models" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [] }),
    })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "empty_model_list",
        reason: "Codex OAuth model endpoint returned an empty model list.",
        authState: "unknown",
      });
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("reuses in-flight and cached codex-oauth model discovery", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-cache" }]);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [{ slug: "gpt-5.4" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "codex-oauth": true,
      };
      const [first, second] = await Promise.all([
        discoverGuiDirectProviderModelDiscovery(providerAvailability),
        discoverGuiDirectProviderModelDiscovery(providerAvailability),
      ]);
      const third = await discoverGuiDirectProviderModelDiscovery(providerAvailability);

      expect(projectDirectProviderDiscoveryForTest(first, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(projectDirectProviderDiscoveryForTest(second, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(projectDirectProviderDiscoveryForTest(third, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("does not expose opencode-go/opencode-zen without live OpenCode auth and /models discovery", async () => {
    const poolSpy = mockOpenCodeCredentialPool();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "opencode-go": true,
        "opencode-zen": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models["opencode-go"]).toBeUndefined();
      expect(models["opencode-zen"]).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalledWith(
        `${OPENCODE_BASE_URL}/models`,
        expect.anything(),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });
});

describe("buildWelcomeProviderDescriptors", () => {
  it("includes live modeled providers and strips stale model lists from model-less providers", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      "opencode-go": ["minimax-m2.5"],
      openai: ["gpt-5.4"],
    });

    expect(descriptors).toEqual([
      expect.objectContaining({
        id: "claude",
        models: [],
        available: true,
      }),
      expect.objectContaining({
        id: "opencode-go",
        models: ["minimax-m2.5"],
        available: true,
      }),
      expect.objectContaining({
        id: "openai",
        models: ["gpt-5.4"],
        available: true,
      }),
    ]);
  });

  it("omits metadata-only providers when they are absent from the live model map", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      "codex-oauth": ["gpt-5.4-mini"],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual([
      "claude",
      "codex-oauth",
    ]);
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-go")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-zen")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "openai")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "anthropic")).toBeUndefined();
  });

  it("omits providers whose advertised model lists are empty instead of surfacing unavailable static descriptors", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      openai: [],
      anthropic: ["claude-sonnet-4-6"],
      "opencode-go": [],
      "opencode-zen": [],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(["anthropic"]);
    expect(descriptors.find((descriptor) => descriptor.id === "openai")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-go")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-zen")).toBeUndefined();
  });

  it("includes model-less Claude as an available welcome provider descriptor", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: [],
    });

    expect(descriptors).toEqual([
      expect.objectContaining({
        id: "claude",
        available: true,
        models: [],
      }),
    ]);
  });

  it("does not expose codex-oauth when codex discovery returns no models", () => {
    const descriptors = buildWelcomeProviderDescriptors(
      projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput()),
    );

    expect(descriptors.find((descriptor) => descriptor.id === "codex-oauth")?.available ?? false).toBe(false);
  });

  it("does not expose codex or codex-oauth when codex discovery returns no models", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput());

    expect(models.codex).toBeUndefined();
    expect(models["codex-oauth"]).toBeUndefined();

    const descriptors = buildWelcomeProviderDescriptors(models);

    expect(descriptors.find((descriptor) => descriptor.id === "codex")?.available ?? false).toBe(false);
    expect(descriptors.find((descriptor) => descriptor.id === "codex-oauth")?.available ?? false).toBe(false);
  });

  it("does not expose opencode as available when discovery returns no models", () => {
    const descriptors = buildWelcomeProviderDescriptors(
      projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput()),
    );

    expect(descriptors.find((descriptor) => descriptor.id === "opencode")?.available ?? false).toBe(false);
  });

  it("does not surface unknown provider ids from the operator models map", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      unknown: ["mystery-model"],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).not.toContain("unknown");
  });
});

describe("resolveGuiProviderSwitch", () => {
  it("rejects unavailable providers", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "openai",
      model: undefined,
      models: {
        claude: ["claude-sonnet-4-6"],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected unavailable provider resolution failure");
    }
    expect(resolution.error).toContain("openai");
  });

  it("rejects providers whose advertised model list is empty", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "opencode",
      model: undefined,
      models: {
        opencode: [],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected empty-provider-model resolution failure");
    }
    expect(resolution.error).toContain("opencode");
  });

  it("accepts model-less Claude switches without requiring a fake model id", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "claude",
      model: undefined,
      models: {
        claude: [],
      },
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      throw new Error(`expected model-less Claude switch to resolve: ${resolution.error}`);
    }
    expect(resolution.modelForSessionManager).toBe("");
    expect(resolution.modelForAck).toBeUndefined();
  });

  it("rejects provider switches without an explicit model", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "anthropic",
      model: undefined,
      models: {
        anthropic: ["claude-sonnet-4-6"],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected missing model resolution failure");
    }
    expect(resolution.error).toContain("model");
  });

  it("rejects requested models that are not advertised by the selected provider", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "anthropic",
      model: "gpt-5.4",
      models: {
        anthropic: ["claude-sonnet-4-6"],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected invalid provider-model resolution failure");
    }
    expect(resolution.error).toContain("anthropic");
    expect(resolution.error).toContain("gpt-5.4");
  });

  it("rejects requested models that are cooling down", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      discovery: [{
        provider: "openrouter",
        available: true,
        models: ["openrouter/free", "qwen/qwen3-coder:free"],
        modelRouteHealth: {
          "qwen/qwen3-coder:free": {
            healthy: false,
            reason: "qwen route is temporarily rate-limited.",
          },
        },
        status: "available",
        reason: "OpenRouter models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-04-28T12:00:00.000Z",
      }],
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected cooling provider-model route resolution failure");
    }
    expect(resolution.error).toBe("qwen route is temporarily rate-limited.");
  });

  it("rejects legacy-listed routes that canonical discovery marks ineligible", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: ["openai/gpt-5.4-mini"],
      opencodeDiscovery: {
        models: ["openai/gpt-5.4-mini"],
        status: "available",
        reason: "OpenCode CLI models discovered.",
        authState: "authenticated",
      },
      codexModels: [],
      providerAvailability: { opencode: true },
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    });
    const providerModelDiscovery = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    const resolution = resolveGuiProviderSwitch({
      provider: "opencode",
      model: "openai/gpt-5.4-mini",
      models: { opencode: ["openai/gpt-5.4-mini"] },
      discovery,
      providerModelDiscovery,
    });

    expect(resolution).toMatchObject({
      ok: false,
      error: expect.stringContaining("not eligible"),
    });
  });

  it("does not let legacy route health override canonical eligibility", () => {
    const discovery = [{
      provider: "openrouter",
      available: true,
      models: ["openrouter/free"],
      modelRouteHealth: {
        "openrouter/free": {
          healthy: false,
          reason: "legacy diagnostic says cooling down",
        },
      },
      status: "available" as const,
      reason: "OpenRouter models discovered.",
      authState: "authenticated" as const,
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }];
    const projected = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-07-01T12:00:00.000Z",
    });
    const providerModelDiscovery = {
      ...projected,
      entries: projected.entries.map((entry) => ({
        ...entry,
        routeHealth: { status: "healthy" as const },
        eligibility: { eligible: true, reasonCodes: [] },
      })),
    };

    expect(resolveGuiProviderSwitch({
      provider: "openrouter",
      model: "openrouter/free",
      discovery,
      providerModelDiscovery,
    })).toEqual({
      ok: true,
      provider: "openrouter",
      modelForSessionManager: "openrouter/free",
      modelForAck: "openrouter/free",
    });
  });

  it("rejects unknown providers even when the models map contains them", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "unknown",
      model: "mystery-model",
      models: {
        unknown: ["mystery-model"],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected unknown provider resolution failure");
    }
    expect(resolution.error).toContain("unknown");
  });

  it("aborts the active turn and acknowledges operator cancellation", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({ port: port ?? 4810, stop })),
    });
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const signal = input.perCallConfig?.abortSignal;
      if (!signal) throw new Error("Expected active turn abort signal.");
      if (!signal.aborted) {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      }
      throw new Error("turn aborted");
    });
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({}) as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models before cancellation test.",
      );
      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      const activeMessage = handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "long task" }) }),
        wsCtx,
      );
      await waitForCondition(() => vi.mocked(processAdmittedTurn).mock.calls.length === 1, "Expected active GUI turn.");

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "turn_cancel", requestId: "cancel-1" }) }),
        wsCtx,
      );
      await activeMessage;

      const frames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string));
      expect(frames).toContainEqual({
        type: "turn_cancel_result",
        requestId: "cancel-1",
        status: "accepted",
      });
      expect(frames).not.toContainEqual(expect.objectContaining({ type: "error", message: "turn aborted" }));
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("keeps runtime execution alive when the replaceable GUI operator surface disconnects", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({ port: port ?? 4810, stop })),
    });
    let completeTurn!: () => void;
    const turnCompletion = new Promise<void>((resolve) => {
      completeTurn = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      observedSignal = input.perCallConfig?.abortSignal;
      await turnCompletion;
      return {
        ok: true,
        result: {
          parts: textParts("Completed while the operator surface was detached."),
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: "session-detached",
          sessionMode: "mode-a",
          traceId: "trace-detached",
          outcome: "completed",
        },
      } as never;
    });
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({}) as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models before disconnect test.",
      );
      const { handlers, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      const activeMessage = handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "long task" }) }),
        wsCtx,
      );
      await waitForCondition(() => observedSignal !== undefined, "Expected active GUI turn.");

      handlers.onClose!(new Event("close") as unknown as CloseEvent, wsCtx);

      expect(observedSignal?.aborted).toBe(false);
      const reconnect = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await reconnect.handlers.onOpen!(new Event("open"), reconnect.wsCtx);
      await reconnect.handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "duplicate task" }) }),
        reconnect.wsCtx,
      );
      expect(reconnect.mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string))).toContainEqual({
        type: "error",
        message: "A GUI turn is already active. Cancel it before starting another turn.",
      });
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
      completeTurn();
      await activeMessage;
      expect(observedSignal?.aborted).toBe(false);
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("routes goal controls through the canonical controller and streams the resulting event", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({ port: port ?? 4810, stop })),
    });
    const control = vi.fn().mockResolvedValue({
      eventId: "goal-event-1",
      kilnSessionId: "session-1",
      sequence: 3,
      timestamp: new Date("2026-07-18T20:00:00.000Z"),
      kind: "goal.updated",
      source: { actor: "user", surface: "gui", component: "goal-control" },
      goal: {
        id: "goal-1",
        objective: "Repair lifecycle.",
        ownerSessionId: "session-1",
        source: { kind: "operator_direct", turnId: "turn-1" },
        status: "paused",
        workItemIds: [],
        authorityEnvelope: { maximumAuthority: "audited", escalationPolicy: "approval_required", reason: "Test." },
        routePolicy: { workflowProfile: "small-fix" },
        evidenceRequirements: [],
        evidence: [],
        currentPhase: "operator_paused",
        activeDurationMs: 5_000,
        createdAt: "2026-07-18T19:59:55.000Z",
        updatedAt: "2026-07-18T20:00:00.000Z",
        sequence: 2,
      },
      changedFields: ["status"],
    });
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({}) as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
        goalController: { control },
      });
      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "goal_control",
            requestId: "goal-control-1",
            goalRunId: "goal-1",
            action: "pause",
          }),
        }),
        wsCtx,
      );

      expect(control).toHaveBeenCalledWith({
        goalRunId: "goal-1",
        action: "pause",
        requestedBy: "operator-1",
      });
      const frames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string));
      expect(frames).toContainEqual({
        type: "goal_control_result",
        requestId: "goal-control-1",
        goalRunId: "goal-1",
        action: "pause",
        status: "accepted",
      });
      expect(frames).toContainEqual(expect.objectContaining({
        type: "session_event",
        event: expect.objectContaining({ eventId: "goal-event-1", kind: "goal.updated" }),
      }));

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "goal_control",
            requestId: "goal-control-invalid",
            goalRunId: "goal-1",
            action: "restart",
          }),
        }),
        wsCtx,
      );

      expect(control).toHaveBeenCalledTimes(1);
      expect(mockWs.send).not.toHaveBeenCalledWith(expect.stringContaining('"action":"restart"'));
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});

