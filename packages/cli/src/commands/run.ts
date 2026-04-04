import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SessionManager } from "../wrapper/session-manager.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
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
import {
  SkillGenerator,
  AnthropicAdapter,
  type ContextArtifact,
  VerificationResult,
  scoreComplexity,
} from "@kilnai/core";
import { getProjectContextArtifactCache } from "@kilnai/runtime";

export interface RunFlags {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly isolate?: boolean;
  readonly resume?: boolean;
}

function resolveMode(flags: RunFlags): SessionMode {
  if (flags.apiKey && flags.provider) return "byok";
  if (flags.apiKey) return "api-key";
  return "cli-wrapper";
}

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "never", sandbox: "workspace-write" };

function buildConfig(flags: RunFlags, mode: SessionMode): WrapperConfig {
  return {
    mode,
    apiKey: flags.apiKey,
    provider: flags.provider,
    permissionPolicy: flags.permissionPolicy ?? DEFAULT_POLICY,
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
  const config = buildConfig(flags, mode);
  const sessionId = randomUUID();
  const { registry, worktreeManager } = createDefaultRegistry();
  const contextArtifactCache = await getProjectContextArtifactCache(process.cwd());
  const manager = new SessionManager(config, appConfig, contextArtifactCache, worktreeManager);
  const preferredProvider = config.provider as ProviderId | undefined;
  const resumeSessionId = await resolveResumeSessionId(
    process.cwd(),
    flags.resume,
    preferredProvider,
  );
  const transcriptStore = new TranscriptStore(process.cwd());
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
      process.cwd(),
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
    preferredProvider: config.provider as ProviderId | undefined,
    requiresMcp: true,
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
    cwd: process.cwd(),
    env,
    permissionPolicy: config.permissionPolicy,
    resumeSessionId: context.resumeSessionId,
  };

  const sessionHooks = new SessionHooks(appConfig.kilnYaml?.hooks, {
    sessionId,
    workingDirectory: context.workingDirectory,
  });
  const approvalMemoryStore: ApprovalMemoryStore = new ApprovalMemoryStoreImpl(process.cwd());

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
        key: `project-summary:${process.cwd()}`,
        kind: "project-summary",
        content: [
          `Project path: ${process.cwd()}`,
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
        key: `plan-summary:${process.cwd()}:${normalizeTaskKey(task)}`,
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
        const moduleArtifact = await buildModuleSummaryArtifact(process.cwd(), filePath);
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
        const skillsDir = join(process.cwd(), ".kiln", "skills");
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
    verificationResult = await manager.runVerification(mappedGates, process.cwd());
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
