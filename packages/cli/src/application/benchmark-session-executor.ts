import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { BenchmarkItemExecutor } from "@kilnai/core";
import {
  GoalRunStore,
  WorkItemStore,
  createSessionBuiltinToolOptions,
  mapProviderModelRouteErrorToOutcome,
} from "@kilnai/core";
import {
  getProjectContextArtifactCache,
  ProviderModelRouteHealthStore,
  withManagedAgentInvocationResourceProvider,
  withManagedInvocationService,
} from "@kilnai/runtime";
import type { KilnAppConfig } from "../config.js";
import { defaultBuildSystemPrompt } from "../config.js";
import { withGlobalIdentityContext } from "../config/operator-identity-context.js";
import type { KilnPermissionPolicy, SessionMode } from "../wrapper/index.js";
import { ApprovalMemoryStore as ApprovalMemoryStoreImpl } from "../wrapper/index.js";
import { SessionManager } from "../wrapper/session-manager.js";
import { CleanupRegistry } from "../wrapper/cleanup-registry.js";
import {
  createDefaultRegistry,
  isDirectApiProvider,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { resolveProviderRouteCandidates } from "../config/provider-route-candidates.js";
import { readGlobalConfig, resolveGlobalDefaultModel } from "../config/global-config.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { resolveEffectiveModel } from "../config/env-config.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { withContextCandidates } from "./agent-skill-context.js";
import { resolveInstructionProfileContextCandidates } from "./instruction-profile-context.js";
import { withWorkGovernanceContext } from "./work-governance-context.js";
import { loadConfiguredBuiltinToolSurfaceOptions } from "../config/builtin-tool-surface-config.js";
import { createKilnConfigTools } from "./config-tools.js";
import { createWorkGovernanceTools } from "./work-governance-tool.js";
import { createKilnRuntimeManagedInvocationAttachment } from "./managed-invocation-attachment.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import { discoverManagedAgentProviderModels } from "../config/managed-agent-provider-models.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { resolveManagedInvocationToolOptions } from "../config/managed-agent-routes.js";
import { SessionHooks } from "./session-hooks.js";
import { runSession } from "./run-session.js";
import { createNonHumanRunOutputSink } from "./run-output.js";
import { resolveProjectRoot } from "./project-root-resolver.js";

const BENCHMARK_POLICY: KilnPermissionPolicy = { approval: "never", sandbox: "read-only" };
const BENCHMARK_EXECUTION_ENVELOPE = { toolRounds: { max: 32 } } as const;

export interface BenchmarkSessionExecutorFlags {
  readonly provider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly skipGitRepoCheck?: boolean;
}

export interface BenchmarkSessionExecutorOptions {
  readonly appConfig: KilnAppConfig;
  readonly flags?: BenchmarkSessionExecutorFlags;
}

export function createBenchmarkSessionExecutor(options: BenchmarkSessionExecutorOptions): BenchmarkItemExecutor {
  return async (input, context) => {
    const startedAt = Date.now();
    const cwd = resolveProjectRoot().rootPath;
    const mode = resolveMode(options.flags);
    const globalConfig = readGlobalConfig();
    const projectConfig = readKilnYaml(join(cwd, ".kiln"));
    const resolvedKilnConfig = await loadKilnConfig(cwd);
    const configuredRouteCandidates = resolveProviderRouteCandidates({
      globalConfig,
      flagProvider: options.flags?.provider,
      flagModel: options.flags?.model,
    });
    const preferredProvider = configuredRouteCandidates[0]?.provider;
    const effectiveModel = configuredRouteCandidates[0]?.model
      ?? resolveEffectiveModel(options.flags?.model, resolveGlobalDefaultModel(globalConfig));
    const wrapperConfig = {
      mode,
      apiKey: options.flags?.apiKey,
      provider: preferredProvider,
      permissionPolicy: BENCHMARK_POLICY,
    };
    let identityAppConfig = withWorkGovernanceContext(
      withGlobalIdentityContext(options.appConfig, globalConfig),
      resolvedKilnConfig?.workGovernance,
    );
    identityAppConfig = withContextCandidates(
      identityAppConfig,
      resolveInstructionProfileContextCandidates({
        projectPath: cwd,
        globalConfig,
        projectConfig,
      }),
    );
    const runtimeAppConfig = {
      ...identityAppConfig,
      buildSystemPrompt: identityAppConfig.buildSystemPrompt ?? defaultBuildSystemPrompt,
    };
    const { registry, worktreeManager } = createDefaultRegistry();
    const benchmarkCleanupRegistry = new CleanupRegistry();
    const contextArtifactCache = await getProjectContextArtifactCache(cwd);
    const manager = new SessionManager(wrapperConfig, runtimeAppConfig, contextArtifactCache, worktreeManager);
    const sessionContext = await manager.prepare(
      input,
      cwd,
      undefined,
      true,
      undefined,
      undefined,
      preferredProvider,
      undefined,
    );
    const env = buildEnv(wrapperConfig);
    const configuredBuiltinToolOptions = await loadConfiguredBuiltinToolSurfaceOptions(options.appConfig, cwd, {
      memoryAuthority: {
        modelFacingSession: true,
        permissionPolicy: BENCHMARK_POLICY,
        caller: { kind: "operator_surface", id: "benchmark" },
      },
    });
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    let builtinToolOptions = createSessionBuiltinToolOptions({
      ...configuredBuiltinToolOptions,
      workItemStore,
      goalRunStore,
      additionalTools: [
        ...(configuredBuiltinToolOptions.additionalTools ?? []),
        ...createKilnConfigTools(cwd),
        ...createWorkGovernanceTools(resolvedKilnConfig?.workGovernance, { workItemStore, goalRunStore }),
      ],
    });
    const engineAvailability = resolveEngineAvailabilityMap(globalConfig);
    const managedAgentProviderModels = await discoverManagedAgentProviderModels();
    const managedInvocationResolution = await resolveManagedInvocationToolOptions(globalConfig, {
      cwd,
      registry,
      surface: "run",
      isProviderAvailable: (providerId) => engineAvailability.get(providerId),
      providerModelEligibility: managedAgentProviderModels,
      directAdapterFactory: createManagedDirectProviderAdapterFactory({
        builtinToolOptions: () => builtinToolOptions,
        runtimeEnv: env,
        executionEnvelope: BENCHMARK_EXECUTION_ENVELOPE,
      }),
      builtinToolOptions: () => builtinToolOptions,
      artifactStore: builtinToolOptions.artifactResources?.store,
    });
    const managedInvocation = options.appConfig.managedInvocation ?? managedInvocationResolution.managedInvocation;
    const managedInvocationWithService = managedInvocation
      ? withManagedInvocationService(managedInvocation)
      : undefined;
    const managedInvocationAttachment = managedInvocationWithService
      ? createKilnRuntimeManagedInvocationAttachment("benchmark", managedInvocationWithService)
      : undefined;
    builtinToolOptions = withManagedAgentInvocationResourceProvider(
      builtinToolOptions,
      managedInvocationWithService ? { service: managedInvocationWithService.invocationService } : undefined,
    );
    const sessionId = randomUUID();
    const sessionConfig = {
      task: input,
      systemPrompt: sessionContext.systemPrompt,
      mcpServerEntryPath: sessionContext.mcpServerEntryPath,
      cwd,
      env,
      permissionPolicy: BENCHMARK_POLICY,
      continuationSessionId: sessionContext.continuationSessionId,
      ephemeral: true,
      skipGitRepoCheck: options.flags?.skipGitRepoCheck,
      builtinToolOptions,
      managedInvocation: managedInvocationAttachment,
      executionEnvelope: BENCHMARK_EXECUTION_ENVELOPE,
      model: effectiveModel,
    };
    const sessionHooks = new SessionHooks(options.appConfig.kilnYaml?.hooks, {
      sessionId,
      workingDirectory: sessionContext.workingDirectory,
    });
    const runOutput = createNonHumanRunOutputSink();
    const result = await runSession({
      registry,
      cleanupRegistry: benchmarkCleanupRegistry,
      manager,
      context: sessionContext,
      requirements: {
        preferredProvider,
        requiresMcp: preferredProvider === undefined,
      },
      routeCandidates: configuredRouteCandidates.length > 0 ? configuredRouteCandidates : undefined,
      sessionConfig,
      permissionPolicy: BENCHMARK_POLICY,
      sessionId,
      approvalMemoryStore: new ApprovalMemoryStoreImpl(cwd),
      env,
      sessionHooks,
      output: runOutput,
    }).finally(async () => {
      await benchmarkCleanupRegistry.runAll();
      await manager.cleanupWorktree(sessionContext);
      closeBuiltinResources(configuredBuiltinToolOptions);
    });
    await recordDirectRouteHealth(configuredRouteCandidates, result.attempts, result.lastError);

    return {
      output: result.accumulatedText,
      durationMs: Date.now() - startedAt,
      costUsd: result.finalCostUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      metadata: {
        activeAgentId: context.profile.id,
        providerId: result.successfulProviderId,
        modelId: result.successfulModelId,
        costEvidence: result.finalCostEvidence,
        sessionSucceeded: result.sessionSucceeded,
        toolCalls: result.transcript.flatMap((entry) => {
          if (entry.event.type !== "tool_use") return [];
          return [{
            name: entry.event.toolName,
            ...(entry.event.input && typeof entry.event.input === "object" ? {
              args: entry.event.input as Record<string, unknown>,
            } : {}),
          }];
        }),
        exactArtifacts: result.exactArtifacts,
        ...(result.lastError ? { policyViolations: [result.lastError] } : {}),
      },
    };
  };
}

function closeBuiltinResources(options: {
  readonly memoryResources?: { readonly repository?: { close?: () => void } };
}): void {
  try {
    options.memoryResources?.repository?.close?.();
  } catch {
    // fail-open cleanup
  }
}

function resolveMode(flags: BenchmarkSessionExecutorFlags | undefined): SessionMode {
  if (flags?.apiKey && flags.provider) return "byok";
  if (flags?.apiKey) return "api-key";
  return "cli-wrapper";
}

function buildEnv(config: {
  readonly mode: SessionMode;
  readonly apiKey?: string;
  readonly provider?: ProviderId;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.mode === "api-key" && config.apiKey) {
    env.ANTHROPIC_API_KEY = config.apiKey;
  }
  if (config.mode === "byok" && config.provider && config.apiKey) {
    env[`${config.provider.toUpperCase()}_API_KEY`] = config.apiKey;
  }
  return env;
}

async function recordDirectRouteHealth(
  candidates: readonly { readonly provider: ProviderId; readonly model?: string }[],
  attempts: readonly { readonly providerId: ProviderId; readonly model?: string; readonly succeeded: boolean; readonly error: string | null }[],
  lastError: string | null,
): Promise<void> {
  if (!candidates.some((candidate) => isDirectApiProvider(candidate.provider))) {
    return;
  }
  const routeHealthStore = new ProviderModelRouteHealthStore();
  for (const attempt of attempts) {
    if (!isDirectApiProvider(attempt.providerId) || !attempt.model) {
      continue;
    }
    const errorMessage = attempt.error ?? lastError ?? "Provider ended with unknown error";
    await routeHealthStore.recordOutcome({
      providerId: attempt.providerId,
      modelId: attempt.model,
      outcome: attempt.succeeded
        ? { type: "ok" }
        : mapProviderModelRouteErrorToOutcome(errorMessage),
      ...(attempt.succeeded ? {} : { errorMessage }),
    });
  }
}
