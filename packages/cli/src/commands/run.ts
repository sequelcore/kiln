import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SessionManager } from "../wrapper/session-manager.js";
import { createDefaultRegistry, isDirectApiProvider } from "../wrapper/session-registry.js";
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
import { SessionHooks } from "../application/session-hooks.js";
import { runSession } from "../application/run-session.js";
import { ApprovalMemoryStore as ApprovalMemoryStoreImpl } from "../wrapper/index.js";
import { TranscriptStore } from "../wrapper/session-store.js";
import type { ResumeOutcome } from "../wrapper/index.js";
import { resolveEffectiveModel } from "../config/env-config.js";
import { readGlobalConfig } from "../config/global-config.js";
import {
  SkillGenerator,
  AnthropicAdapter,
  type ContextArtifact,
  VerificationResult,
  scoreComplexity,
} from "@kilnai/core";
import { getProjectContextArtifactCache } from "../application/project-context-cache.js";
import type { ContextArtifactCache } from "@kilnai/core";

export interface RunFlags {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly model?: string;
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
}

function resolveMode(flags: RunFlags): SessionMode {
  if (flags.apiKey && flags.provider) return "byok";
  if (flags.apiKey) return "api-key";
  return "cli-wrapper";
}

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "never", sandbox: "workspace-write" };
const PLAN_POLICY: KilnPermissionPolicy = { approval: "untrusted", sandbox: "read-only" };

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

function normalizeTaskKey(task: string): string {
  return task
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "interactive";
}

export async function runCommand(appConfig: KilnAppConfig, task: string, flags: RunFlags): Promise<void> {
  if (!task.trim()) {
    console.error(`Error: No task provided. Usage: kiln run "your task here"`);
    process.exit(1);
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
  const effectiveModel = resolveEffectiveModel(flags.model, globalConfig?.model) ?? resolvedAgent?.model;
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

  const requirements: SessionRequirements = {
    preferredProvider,
    requiresMcp: !isDirectApiProvider(preferredProvider),
  };

  const startedAt = new Date().toISOString();
  await transcriptStore.init(sessionId, {
    kilnSessionId: sessionId,
    provider: preferredProvider ?? "unknown",
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
    model: effectiveModel,
  };

  const sessionHooks = new SessionHooks(appConfig.kilnYaml?.hooks, {
    sessionId,
    workingDirectory: context.workingDirectory,
  });
  const approvalMemoryStore: ApprovalMemoryStore = new ApprovalMemoryStoreImpl(cwd);

  const shutdown = (): void => {
    void cleanupRegistry.runAll();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
  });

  sessionHooks.sessionEnd();

  try {
    for (const [seq, entry] of transcript.entries()) {
      await transcriptStore.append(sessionId, {
        seq: seq + 1,
        ts: "ts" in entry && typeof entry.ts === "string" ? entry.ts : new Date().toISOString(),
        type: entry.event.type,
        data: entry.event,
      });
    }
  } catch {
    // fail-open
  }

  if (sessionSucceeded) {
    const completedAt = new Date().toISOString();
    const meta = {
      kilnSessionId: sessionId,
      provider: successfulProviderId ?? "unknown",
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
        key: `session-summary:${sessionId}`,
        kind: "session-summary",
        content: summaryLines.join("\n"),
        createdAt: now,
        updatedAt: now,
      };
      contextArtifactCache.set(artifact);
      const projectArtifact: ContextArtifact = {
        key: `project-summary:${cwd}`,
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
        key: `plan-summary:${cwd}:${normalizeTaskKey(task)}`,
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
}
