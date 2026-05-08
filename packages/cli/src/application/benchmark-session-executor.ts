import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { BenchmarkItemExecutor } from "@kilnai/core";
import {
  createSessionBuiltinToolOptions,
  mapProviderModelRouteErrorToOutcome,
} from "@kilnai/core";
import { getProjectContextArtifactCache, ProviderModelRouteHealthStore } from "@kilnai/runtime";
import type { KilnAppConfig } from "../config.js";
import { defaultBuildSystemPrompt } from "../config.js";
import { withGlobalIdentityContext } from "../config/operator-identity-context.js";
import type { KilnPermissionPolicy, SessionMode } from "../wrapper/index.js";
import { ApprovalMemoryStore as ApprovalMemoryStoreImpl } from "../wrapper/index.js";
import { SessionManager } from "../wrapper/session-manager.js";
import { cleanupRegistry } from "../wrapper/cleanup-registry.js";
import {
  createDefaultRegistry,
  isDirectApiProvider,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { resolveProviderRouteCandidates } from "../config/provider-route-candidates.js";
import { readGlobalConfig, resolveGlobalDefaultModel } from "../config/global-config.js";
import { resolveEffectiveModel } from "../config/env-config.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { withContextCandidates } from "./agent-skill-context.js";
import { resolveInstructionProfileContextCandidates } from "./instruction-profile-context.js";
import { loadConfiguredWebToolSurfaceOptions } from "../config/web-tools-config.js";
import { createKilnConfigTools } from "./config-tools.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import { discoverManagedAgentProviderModels } from "../config/managed-agent-provider-models.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { resolveManagedInvocationToolOptions } from "../config/managed-agent-routes.js";
import { SessionHooks } from "./session-hooks.js";
import { runSession } from "./run-session.js";

const BENCHMARK_POLICY: KilnPermissionPolicy = { approval: "never", sandbox: "read-only" };

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
    const cwd = process.cwd();
    const mode = resolveMode(options.flags);
    const globalConfig = readGlobalConfig();
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
    let identityAppConfig = withGlobalIdentityContext(options.appConfig, globalConfig);
    identityAppConfig = withContextCandidates(
      identityAppConfig,
      resolveInstructionProfileContextCandidates({
        projectPath: cwd,
        globalConfig,
        projectConfig: readKilnYaml(join(cwd, ".kiln")),
      }),
    );
    const runtimeAppConfig = {
      ...identityAppConfig,
      buildSystemPrompt: identityAppConfig.buildSystemPrompt ?? defaultBuildSystemPrompt,
    };
    const { registry, worktreeManager } = createDefaultRegistry();
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
    const configuredBuiltinToolOptions = await loadConfiguredWebToolSurfaceOptions(options.appConfig, cwd, {
      memoryAuthority: {
        modelFacingSession: true,
        permissionPolicy: BENCHMARK_POLICY,
        caller: { kind: "operator_surface", id: "benchmark" },
      },
    });
    const builtinToolOptions = createSessionBuiltinToolOptions({
      ...configuredBuiltinToolOptions,
      additionalTools: [
        ...(configuredBuiltinToolOptions.additionalTools ?? []),
        ...createKilnConfigTools(cwd),
      ],
    });
    const engineAvailability = resolveEngineAvailabilityMap(globalConfig);
    const managedAgentProviderModels = await discoverManagedAgentProviderModels();
    const managedInvocationResolution = await resolveManagedInvocationToolOptions(globalConfig, {
      cwd,
      registry,
      surface: "run",
      isProviderAvailable: (providerId) => engineAvailability.get(providerId),
      providerModels: managedAgentProviderModels,
      directAdapterFactory: createManagedDirectProviderAdapterFactory({ builtinToolOptions, runtimeEnv: env }),
      artifactStore: builtinToolOptions.artifactResources?.store,
    });
    const sessionId = randomUUID();
    const sessionConfig = {
      task: input,
      systemPrompt: sessionContext.systemPrompt,
      mcpServerEntryPath: sessionContext.mcpServerEntryPath,
      cwd,
      env,
      permissionPolicy: BENCHMARK_POLICY,
      resumeSessionId: sessionContext.resumeSessionId,
      ephemeral: true,
      skipGitRepoCheck: options.flags?.skipGitRepoCheck,
      builtinToolOptions,
      managedInvocation: options.appConfig.managedInvocation ?? managedInvocationResolution.managedInvocation,
      model: effectiveModel,
    };
    const sessionHooks = new SessionHooks(options.appConfig.kilnYaml?.hooks, {
      sessionId,
      workingDirectory: sessionContext.workingDirectory,
    });
    const result = await runSession({
      registry,
      cleanupRegistry,
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
