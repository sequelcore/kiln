import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import readline from "node:readline";
import { SessionManager } from "../wrapper/session-manager.js";
import {
  createDefaultRegistry,
  getRuntimeProviderAvailability,
  isDirectApiProvider,
} from "../wrapper/session-registry.js";
import { cleanupRegistry } from "../wrapper/cleanup-registry.js";
import type {
  ApprovalMemoryStore,
  ProviderId,
  SessionRequirements,
  SessionMode,
  WrapperConfig,
  KilnPermissionPolicy,
} from "../wrapper/index.js";
import type { KilnAppConfig } from "../config.js";
import { defaultBuildSystemPrompt } from "../config.js";
import {
  findAgent,
  loadAgentDefinitions,
  type KilnAgentDefinition,
} from "../application/agent-loader.js";
import {
  computeEvalScore,
  printContextGovernancePreview,
  printReport,
  summarizeContextGovernance,
} from "../application/session-report.js";
import { buildModuleSummaryArtifact, extractTouchedFilePaths } from "../application/repo-summary-cache.js";
import { inferResumeStrategyFeedback } from "../application/resume-strategy-feedback.js";
import { resolveResumeSessionId } from "../application/session-resume.js";
import { deriveSessionMetadata } from "../application/session-metadata.js";
import { SessionHooks } from "../application/session-hooks.js";
import { runSession } from "../application/run-session.js";
import { ApprovalMemoryStore as ApprovalMemoryStoreImpl } from "../wrapper/index.js";
import { TranscriptStore } from "../wrapper/session-store.js";
import type { ResumeOutcome } from "../wrapper/index.js";
import { resolveEffectiveModel } from "../config/env-config.js";
import { readGlobalConfig, resolveGlobalDefaultModel } from "../config/global-config.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { resolveManagedInvocationToolOptions } from "../config/managed-agent-routes.js";
import { loadConfiguredWebToolSurfaceOptions } from "../config/web-tools-config.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import {
  SkillGenerator,
  AnthropicAdapter,
  createSessionBuiltinToolOptions,
  type ContextArtifact,
  type CanonicalSessionEventKind,
  type ReasoningEffort,
  type SessionEventSource,
  VerificationResult,
  scoreComplexity,
} from "@kilnai/core";
import {
  discoverGuiDirectProviderModelDiscovery,
  getProjectContextArtifactCache,
} from "@kilnai/runtime";
import type { ContextArtifactCache } from "@kilnai/core";
import {
  buildCliPlanSummaryArtifactKey,
  buildCliProjectSummaryArtifactKey,
  buildCliSessionSummaryArtifactKey,
} from "../application/context-artifact-keys.js";

export interface RunFlags {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly agent?: string;
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly isolate?: boolean;
  readonly resume?: boolean;
  readonly plan?: boolean;
  readonly ephemeral?: boolean;
  readonly profile?: string;
  readonly skipGitRepoCheck?: boolean;
  readonly outputSchema?: string;
  readonly addDir?: string;
  readonly localProvider?: string;
  readonly workers?: number;
}

function resolveMode(flags: RunFlags): SessionMode {
  if (flags.apiKey && flags.provider) return "byok";
  if (flags.apiKey) return "api-key";
  return "cli-wrapper";
}

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "never", sandbox: "workspace-write" };
const PLAN_POLICY: KilnPermissionPolicy = { approval: "untrusted", sandbox: "read-only" };

export function buildRunSessionRequirements(preferredProvider: ProviderId | undefined): SessionRequirements {
  return {
    preferredProvider,
    requiresMcp: preferredProvider === undefined,
  };
}

interface RunProviderModelDiscovery {
  readonly models: readonly string[];
  readonly status: string;
  readonly reason: string;
}

export type RunProviderModelAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export function resolveRunProviderModelAdmission(input: {
  readonly provider: ProviderId | undefined;
  readonly model: string | undefined;
  readonly discovery: Readonly<Record<string, RunProviderModelDiscovery | undefined>>;
}): RunProviderModelAdmission {
  if (!isDirectApiProvider(input.provider)) {
    return { ok: true };
  }

  const discovery = input.discovery[input.provider];
  if (!discovery) {
    return {
      ok: false,
      error: `Provider '${input.provider}' is unavailable`,
    };
  }
  if (discovery.status !== "available") {
    return {
      ok: false,
      error: discovery.reason,
    };
  }

  const model = input.model?.trim() ?? "";
  if (model.length === 0) {
    return {
      ok: false,
      error: `Provider '${input.provider}' requires a selected model.`,
    };
  }
  if (!discovery.models.includes(model)) {
    return {
      ok: false,
      error: `Provider '${input.provider}' does not advertise model '${model}'`,
    };
  }

  return { ok: true };
}

function buildConfig(flags: RunFlags, mode: SessionMode): WrapperConfig {
  return {
    mode,
    apiKey: flags.apiKey,
    provider: flags.provider,
    permissionPolicy: flags.plan ? PLAN_POLICY : (flags.permissionPolicy ?? DEFAULT_POLICY),
  };
}

function appendAgentInstructionsToSystemPrompt(
  appConfig: KilnAppConfig,
  agent?: KilnAgentDefinition,
): KilnAppConfig {
  const instructions = agent?.instructions?.trim();
  if (!instructions) {
    return appConfig;
  }

  return {
    ...appConfig,
    buildSystemPrompt: (opts) => {
      const basePrompt = (appConfig.buildSystemPrompt ?? defaultBuildSystemPrompt)(opts);
      if (basePrompt.trim().length === 0) {
        return instructions;
      }
      return `${basePrompt}\n\n${instructions}`;
    },
  };
}

function parseSubmittedPlan(line: string): string | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.kind === "tool_call_started") {
      const payload = typeof parsed.payload === "object" && parsed.payload !== null
        ? parsed.payload as Record<string, unknown>
        : undefined;
      return payload ? extractSubmitPlan(payload) : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function extractSubmitPlan(event: Record<string, unknown>): string | undefined {
  if (event.type !== "tool_use") return undefined;

  const toolName = typeof event.name === "string"
    ? event.name
    : (typeof event.toolName === "string" ? event.toolName : undefined);

  if (toolName !== "submit_plan") return undefined;

  const input = typeof event.input === "object" && event.input !== null
    ? event.input as Record<string, unknown>
    : undefined;
  const plan = input?.plan;
  return typeof plan === "string" ? plan : undefined;
}

async function readSubmittedPlanFromTranscript(projectPath: string, sessionId: string): Promise<string | undefined> {
  try {
    const transcriptPath = join(projectPath, ".kiln", "sessions", sessionId, "transcript.jsonl");
    const content = await readFile(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const submittedPlan = parseSubmittedPlan(lines[i]!);
      if (submittedPlan !== undefined) {
        return submittedPlan;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function promptForPlanApproval(): Promise<boolean> {
  process.stdout.write("Approve and execute? [y/N]: ");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    let settled = false;
    rl.once("line", (line) => {
      settled = true;
      resolve(line);
    });
    rl.once("close", () => {
      if (!settled) {
        resolve("");
      }
    });
  });

  rl.close();
  return answer.trim().toLowerCase() === "y";
}

export async function runCommand(appConfig: KilnAppConfig, task: string, flags: RunFlags): Promise<void> {
  if (!task.trim()) {
    console.error(`Error: No task provided. Usage: kiln run "your task here"`);
    process.exit(1);
  }

  const workerCount = flags.workers ?? 1;
  if (workerCount > 1) {
    await runParallelWorkers(appConfig, task, flags, workerCount);
    return;
  }

  const mode = resolveMode(flags);
  const cwd = process.cwd();
  let resolvedAgent: KilnAgentDefinition | undefined;
  if (flags.agent) {
    const definitions = await loadAgentDefinitions(cwd);
    resolvedAgent = findAgent(definitions, flags.agent);
    if (!resolvedAgent) {
      console.error(`Error: Agent "${flags.agent}" not found in .kiln/agents/ or ~/.kiln/agents/`);
      process.exit(1);
    }
  }

  const globalConfig = readGlobalConfig();
  const effectiveModel = resolveEffectiveModel(flags.model, resolveGlobalDefaultModel(globalConfig)) ?? resolvedAgent?.model;
  const config = buildConfig(flags, mode);
  const runtimeAppConfig = appendAgentInstructionsToSystemPrompt(appConfig, resolvedAgent);
  const sessionId = randomUUID();
  const { registry, worktreeManager } = createDefaultRegistry();
  const contextArtifactCache: ContextArtifactCache = await getProjectContextArtifactCache(cwd);
  const manager = new SessionManager(config, runtimeAppConfig, contextArtifactCache, worktreeManager);
  const preferredProvider = config.provider as ProviderId | undefined;
  const resumeSessionId = await resolveResumeSessionId(
    cwd,
    flags.resume,
    preferredProvider,
  );
  const transcriptStore = new TranscriptStore(cwd);
  const resumedMeta = resumeSessionId
    ? await transcriptStore.readMeta(resumeSessionId)
    : null;
  const resumeStrategyFeedback = resumeSessionId
    ? await inferResumeStrategyFeedback(transcriptStore, preferredProvider)
    : undefined;

  let context;
  try {
    context = await manager.prepare(
      task,
      cwd,
      undefined,
      flags.isolate,
      resumeSessionId,
      resumedMeta ?? undefined,
      preferredProvider,
      resumeStrategyFeedback,
    );
  } catch (err) {
    console.error("Error: Failed to prepare session.", err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const approvalMemorySessionId = resumeSessionId ?? sessionId;
  const previewContextGovernance = summarizeContextGovernance(context.projectedContext);
  if (appConfig.kilnYaml?.contextGovernance?.previewBeforeApply) {
    printContextGovernancePreview(previewContextGovernance);
  }

  console.log(`Domain:  ${context.domain.displayName}`);
  console.log(`Mode:    ${mode}`);
  console.log("Kiln session starting...");
  console.log("");

  const env: Record<string, string> = {};
  if (config.mode === "api-key" && config.apiKey) {
    env.ANTHROPIC_API_KEY = config.apiKey;
  }
  if (config.mode === "byok" && config.provider && config.apiKey) {
    env[`${config.provider.toUpperCase()}_API_KEY`] = config.apiKey;
  }

  if (isDirectApiProvider(preferredProvider)) {
    const providerAvailability = {
      ...getRuntimeProviderAvailability(registry),
      [preferredProvider]: true,
    };
    const directProviderDiscovery = await discoverGuiDirectProviderModelDiscovery(providerAvailability, {
      ...process.env,
      ...env,
    });
    const admission = resolveRunProviderModelAdmission({
      provider: preferredProvider,
      model: effectiveModel,
      discovery: directProviderDiscovery,
    });
    if (!admission.ok) {
      console.error(`Error: ${admission.error}`);
      process.exit(1);
    }
  }

  const requirements = buildRunSessionRequirements(preferredProvider);

  const startedAt = new Date().toISOString();
  const initialMetadata = deriveSessionMetadata({
    task,
    provider: preferredProvider,
    model: effectiveModel,
  });
  await transcriptStore.init(sessionId, {
    kilnSessionId: sessionId,
    provider: preferredProvider ?? "unknown",
    title: initialMetadata.title,
    summary: initialMetadata.summary,
    tags: initialMetadata.tags,
    task,
    startedAt,
    resumeStrategy: context.resumeStrategy,
    resumeFeedback: context.resumeFeedback,
    sessionLedger: {
      currentPhase: "prepare",
      resumedFrom: resumeSessionId,
      workingDirectory: context.workingDirectory,
      worktreePath: context.worktreePath,
    },
    exactArtifacts: context.projectedContext.blocks
      .filter((block) => block.kind === "artifact")
      .map((block) => block.content),
  });

  const builtinToolOptions = createSessionBuiltinToolOptions(
    await loadConfiguredWebToolSurfaceOptions(appConfig, cwd, {
      memoryAuthority: {
        modelFacingSession: true,
        permissionPolicy: config.permissionPolicy,
        permissionAgent: resolvedAgent?.name,
        caller: { kind: "operator_surface", id: "run" },
      },
    }),
  );
  const engineAvailability = resolveEngineAvailabilityMap(globalConfig);
  const managedInvocationResolution = await resolveManagedInvocationToolOptions(globalConfig, {
    cwd,
    registry,
    surface: "run",
    isProviderAvailable: (providerId) => engineAvailability.get(providerId),
    directAdapterFactory: createManagedDirectProviderAdapterFactory({ builtinToolOptions, runtimeEnv: env }),
  });
  const managedInvocation = appConfig.managedInvocation ?? managedInvocationResolution.managedInvocation;

  const sessionConfig = {
    task,
    systemPrompt: context.systemPrompt,
    mcpServerEntryPath: context.mcpServerEntryPath,
    cwd,
    env,
    permissionPolicy: config.permissionPolicy,
    resumeSessionId: context.resumeSessionId,
    ephemeral: flags.ephemeral,
    profile: flags.profile,
    skipGitRepoCheck: flags.skipGitRepoCheck,
    outputSchema: flags.outputSchema,
    addDir: flags.addDir,
    localProvider: flags.localProvider,
    builtinToolOptions,
    managedInvocation,
    model: effectiveModel,
    reasoningEffort: flags.reasoningEffort,
  };

  const sessionHooks = new SessionHooks(appConfig.kilnYaml?.hooks, {
    sessionId,
    workingDirectory: context.workingDirectory,
  });
  const approvalMemoryStore: ApprovalMemoryStore = new ApprovalMemoryStoreImpl(cwd);

  let signalHandlersRegistered = false;
  let shutdownStarted = false;
  const unregisterSignalHandlers = (): void => {
    if (!signalHandlersRegistered) return;
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    signalHandlersRegistered = false;
  };
  const shutdown = (): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    unregisterSignalHandlers();
    void cleanupRegistry.runAll().finally(() => {
      process.exit(130);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  signalHandlersRegistered = true;

  sessionHooks.sessionStart();
  const {
    finalCostUsd,
    sessionSucceeded,
    lastError,
    accumulatedText,
    toolCallCount,
    turnDepth,
    successfulProviderId,
    transcript,
    exactArtifacts,
    submittedPlan: submittedPlanFromSession,
  } = await runSession({
    registry,
    cleanupRegistry,
    manager,
    context,
    requirements,
    sessionConfig,
    permissionPolicy: config.permissionPolicy,
    permissionAgent: resolvedAgent?.name,
    sessionId: approvalMemorySessionId,
    approvalMemoryStore,
    env,
    sessionHooks,
  }).finally(() => {
    sessionHooks.sessionEnd();
    unregisterSignalHandlers();
  });

  try {
    for (const [seq, entry] of transcript.entries()) {
      const timestamp = "ts" in entry && typeof entry.ts === "string"
        ? entry.ts
        : new Date().toISOString();
      const legacyType = typeof entry.event.type === "string" ? entry.event.type : "assistant_message";
      await transcriptStore.append(sessionId, {
        eventId: randomUUID(),
        kilnSessionId: sessionId,
        sequence: seq + 1,
        timestamp,
        kind: mapTranscriptTypeToKind(legacyType),
        source: mapTranscriptTypeToSource(legacyType),
        payload: entry.event as Record<string, unknown>,
      });
    }
  } catch {
    // fail-open
  }

  if (flags.plan && submittedPlanFromSession !== undefined) {
    try {
      await transcriptStore.append(sessionId, {
        eventId: randomUUID(),
        kilnSessionId: sessionId,
        sequence: transcript.length + 1,
        timestamp: new Date().toISOString(),
        kind: "tool_call_started",
        source: { actor: "tool", surface: "cli", component: "run-command" },
        payload: {
          type: "tool_use",
          name: "submit_plan",
          input: { plan: submittedPlanFromSession },
        },
      });
    } catch {
      // fail-open
    }
  }

  const submittedPlan = flags.plan
    ? await readSubmittedPlanFromTranscript(cwd, sessionId)
    : undefined;

  if (sessionSucceeded) {
    const completedAt = new Date().toISOString();
    const meta = {
      kilnSessionId: sessionId,
      provider: successfulProviderId ?? "unknown",
      title: initialMetadata.title,
      summary: initialMetadata.summary,
      tags: deriveSessionMetadata({
        task,
        provider: successfulProviderId ?? preferredProvider,
        model: effectiveModel,
        hasFileChanges: exactArtifacts.some((artifact) => /\b(created|modified|deleted|file)\b/i.test(artifact)),
      }).tags,
      task,
      startedAt,
      completedAt,
      costUsd: finalCostUsd,
      toolCount: toolCallCount,
      turnDepth,
      resumeStrategy: context.resumeStrategy,
      resumeFeedback: context.resumeFeedback,
      sessionLedger: {
        currentPhase: "completed",
        resumedFrom: resumeSessionId,
        workingDirectory: context.workingDirectory,
        worktreePath: context.worktreePath,
        lastProvider: successfulProviderId,
        toolCallCount,
        turnDepth,
      },
      exactArtifacts: exactArtifacts.slice(0, 20),
    };

    try {
      await transcriptStore.finalize(sessionId, meta);
      const summaryLines = [
        `Task: ${task}`,
        `Phase: completed`,
        `Provider: ${successfulProviderId ?? "unknown"}`,
        `Tool calls: ${toolCallCount}`,
        `Turn depth: ${turnDepth}`,
        ...(exactArtifacts.length > 0 ? ["Exact artifacts:", ...exactArtifacts.slice(0, 10).map((artifact) => `- ${artifact}`)] : []),
      ];
      const now = new Date();
      const artifact: ContextArtifact = {
        key: buildCliSessionSummaryArtifactKey(sessionId),
        kind: "session-summary",
        content: summaryLines.join("\n"),
        createdAt: now,
        updatedAt: now,
      };
      contextArtifactCache.set(artifact);
      const projectArtifact: ContextArtifact = {
        key: buildCliProjectSummaryArtifactKey(cwd),
        kind: "project-summary",
        content: [
          `Project path: ${cwd}`,
          `Domain: ${context.domain.displayName}`,
          `Last successful provider: ${successfulProviderId ?? "unknown"}`,
          `Latest task: ${task}`,
          `Latest turn depth: ${turnDepth}`,
        ].join("\n"),
        createdAt: now,
        updatedAt: now,
      };
      contextArtifactCache.set(projectArtifact);
      const planArtifact: ContextArtifact = {
        key: buildCliPlanSummaryArtifactKey(cwd, task, 80),
        kind: "plan-summary",
        content: [
          `Task pattern: ${task}`,
          `Successful provider: ${successfulProviderId ?? "unknown"}`,
          `Observed turn depth: ${turnDepth}`,
          `Observed tool calls: ${toolCallCount}`,
          "Useful exact artifacts:",
          ...exactArtifacts.slice(0, 8).map((artifact) => `- ${artifact}`),
        ].join("\n"),
        createdAt: now,
        updatedAt: now,
      };
      contextArtifactCache.set(planArtifact);
      const touchedFiles = extractTouchedFilePaths(exactArtifacts);
      for (const filePath of touchedFiles.slice(0, 5)) {
        const moduleArtifact = await buildModuleSummaryArtifact(cwd, filePath);
        if (moduleArtifact) {
          contextArtifactCache.set(moduleArtifact);
        }
      }
    } catch {
      // fail-open
    }

    const sg = appConfig.kilnYaml?.skillGeneration;
    const threshold = sg?.complexityThreshold ?? 0.6;
    const shouldAttemptSkillGeneration = sg?.enabled !== false
      && scoreComplexity({ messageText: task, toolCount: toolCallCount, turnDepth }).score >= threshold;

    if (shouldAttemptSkillGeneration && config.apiKey) {
      try {
        const skillsDir = join(cwd, ".kiln", "skills");
        const generator = new SkillGenerator({
          provider: new AnthropicAdapter({ apiKey: config.apiKey }),
          registry: new (await import("@kilnai/core")).SkillRegistry(),
          skillsDir,
          complexityThreshold: sg?.complexityThreshold,
        });
        void generator.maybeGenerate(task, accumulatedText, toolCallCount, turnDepth, transcript);
      } catch {
        // fail-open
      }
    } else if (
      shouldAttemptSkillGeneration
      && config.mode === "cli-wrapper"
      && !config.apiKey
    ) {
      console.log('[kiln] Tip: run "kiln skill capture --last" after configuring ANTHROPIC_API_KEY to capture this session as a skill.');
    }
  }
  if (!sessionSucceeded) {
    await transcriptStore.finalize(sessionId, {
      completedAt: new Date().toISOString(),
      title: initialMetadata.title,
      summary: initialMetadata.summary,
      tags: initialMetadata.tags,
      costUsd: finalCostUsd,
      toolCount: toolCallCount,
      turnDepth,
      resumeStrategy: context.resumeStrategy,
      resumeFeedback: context.resumeFeedback,
      sessionLedger: {
        currentPhase: "failed",
        resumedFrom: resumeSessionId,
        workingDirectory: context.workingDirectory,
        worktreePath: context.worktreePath,
        lastError: lastError ?? undefined,
        toolCallCount,
        turnDepth,
      },
      exactArtifacts: exactArtifacts.slice(0, 20),
    });
  }

  if (!sessionSucceeded && lastError) {
    console.error(`[kiln] All providers failed. Last error: ${lastError}`);
    process.exit(1);
  }

  let verificationResult: VerificationResult | undefined;
  const gates = appConfig.kilnYaml?.qualityGates;
  if (gates?.length) {
    const mappedGates = gates.map((g) => ({
      name: g.name,
      command: g.command,
      description: g.name,
      required: g.required ?? true,
    }));
    verificationResult = await manager.runVerification(mappedGates, cwd);
  }

  const evalScore = (() => {
    try {
      return computeEvalScore({
        succeeded: sessionSucceeded,
        durationMs: Date.now() - (manager.sessionStartTimeMs ?? Date.now()),
        costUsd: finalCostUsd,
        verificationPassed: verificationResult?.passed,
        toolCallCount,
      });
    } catch {
      return undefined;
    }
  })();

  const resumeOutcome: ResumeOutcome = {
    succeeded: sessionSucceeded,
    finalProvider: successfulProviderId,
    costUsd: finalCostUsd,
    toolCallCount: toolCallCount,
    durationMs: Date.now() - (manager.sessionStartTimeMs ?? Date.now()),
    verificationPassed: verificationResult?.passed,
  };

  try {
    await transcriptStore.finalize(sessionId, {
      resumeOutcome,
    });
  } catch {
    // fail-open
  }

  const report = manager.cleanup(sessionId, finalCostUsd, verificationResult, evalScore);
  const reportWithResumeStrategy = {
    ...report,
    resumeStrategy: context.resumeStrategy,
    resumeFeedback: context.resumeFeedback,
    resumeOutcome,
    contextGovernance: previewContextGovernance,
  };
  const finalReport = resumeSessionId
    ? { ...reportWithResumeStrategy, resumedFrom: resumeSessionId }
    : reportWithResumeStrategy;
  printReport(finalReport, "kiln");

  if (verificationResult && !verificationResult.passed) {
    process.exit(1);
  }

  await manager.cleanupWorktree(context);

  if (flags.plan && submittedPlan !== undefined) {
    console.log("═══════════════════════════════");
    console.log(" PROPOSED PLAN");
    console.log("═══════════════════════════════");
    process.stdout.write(submittedPlan.endsWith("\n") ? submittedPlan : `${submittedPlan}\n`);
    console.log("═══════════════════════════════");

    const approved = await promptForPlanApproval();
    if (approved) {
      await runCommand(appConfig, task, { ...flags, plan: false });
    }
    return;
  }
}

interface WorkerResult {
  workerIndex: number;
  success: boolean;
  error?: string;
}

function mapTranscriptTypeToKind(type: string): CanonicalSessionEventKind {
  switch (type) {
    case "user":
      return "user_message";
    case "text_delta":
      return "assistant_delta";
    case "tool_use":
      return "tool_call_started";
    case "tool_result":
      return "tool_call_completed";
    case "error":
      return "error_recorded";
    default:
      return "assistant_message";
  }
}

function mapTranscriptTypeToSource(type: string): SessionEventSource {
  switch (type) {
    case "user":
      return { actor: "user", surface: "cli", component: "run-command" };
    case "text_delta":
      return { actor: "assistant", surface: "cli", component: "run-command" };
    case "tool_use":
    case "tool_result":
      return { actor: "tool", surface: "cli", component: "run-command" };
    case "error":
      return { actor: "runtime", surface: "cli", component: "run-command" };
    default:
      return { actor: "system", surface: "cli", component: "run-command" };
  }
}

export async function runParallelWorkers(
  appConfig: KilnAppConfig,
  task: string,
  flags: RunFlags,
  workerCount: number,
  runner: (appConfig: KilnAppConfig, task: string, flags: RunFlags) => Promise<void> = runCommand,
): Promise<void> {
  const results = await Promise.allSettled(
    Array.from({ length: workerCount }, async (_, i) => {
      await runner(appConfig, task, { ...flags, workers: 1, isolate: true });
      return { workerIndex: i + 1, success: true };
    }),
  );

  const workerResults: WorkerResult[] = results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      workerIndex: index + 1,
      success: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log(" PARALLEL WORKERS COMPLETE");
  console.log("═══════════════════════════════════════");

  for (const wr of workerResults) {
    if (wr.success) {
      console.log(` Worker ${wr.workerIndex}: ✓ succeeded`);
    } else {
      console.log(` Worker ${wr.workerIndex}: ✗ failed — ${wr.error ?? "unknown error"}`);
    }
  }

  console.log("═══════════════════════════════════════");

  const succeededCount = workerResults.filter((wr) => wr.success).length;
  console.log(`${succeededCount}/${workerCount} workers succeeded`);

  if (succeededCount === 0) {
    process.exit(1);
  }
}
