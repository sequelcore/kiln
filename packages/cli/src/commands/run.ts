import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "../wrapper/session-manager.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import { cleanupRegistry } from "../wrapper/cleanup-registry.js";
import type {
  ProviderId,
  SessionRequirements,
  SessionMode,
  WrapperConfig,
  KilnPermissionPolicy,
} from "../wrapper/index.js";
import type { KilnAppConfig } from "../config.js";
import { computeEvalScore, printReport } from "../application/session-report.js";
import { resolveResumeSessionId } from "../application/session-resume.js";
import { SessionHooks } from "../application/session-hooks.js";
import { runSession } from "../application/run-session.js";
import {
  SkillGenerator,
  AnthropicAdapter,
  VerificationResult,
  scoreComplexity,
} from "@kilnai/core";

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

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "on-request", sandbox: "read-only" };

function buildConfig(flags: RunFlags, mode: SessionMode): WrapperConfig {
  return {
    mode,
    apiKey: flags.apiKey,
    provider: flags.provider,
    permissionPolicy: flags.permissionPolicy ?? DEFAULT_POLICY,
  };
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
  const manager = new SessionManager(config, appConfig, worktreeManager);

  let context;
  try {
    context = await manager.prepare(task, process.cwd(), undefined, flags.isolate);
  } catch (err) {
    console.error("Error: Failed to prepare session.", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const preferredProvider = config.provider as ProviderId | undefined;
  const resumeSessionId = await resolveResumeSessionId(
    process.cwd(),
    flags.resume,
    preferredProvider,
  );

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

  const sessionConfig = {
    task,
    systemPrompt: context.systemPrompt,
    mcpServerEntryPath: context.mcpServerEntryPath,
    cwd: process.cwd(),
    env,
    permissionPolicy: config.permissionPolicy,
    resumeSessionId,
  };

  const sessionHooks = new SessionHooks(appConfig.kilnYaml?.hooks, {
    sessionId,
    workingDirectory: context.workingDirectory,
  });

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
  } = await runSession({
    registry,
    cleanupRegistry,
    manager,
    context,
    requirements,
    sessionConfig,
    permissionPolicy: config.permissionPolicy,
    env,
    sessionHooks,
  });

  sessionHooks.sessionEnd();

  if (!sessionSucceeded && lastError) {
    console.error(`[kiln] All providers failed. Last error: ${lastError}`);
    process.exit(1);
  }

  if (sessionSucceeded) {
    const completedAt = new Date().toISOString();
    const sessionDir = join(process.cwd(), ".kiln", "sessions", sessionId);
    const meta = {
      kilnSessionId: sessionId,
      provider: successfulProviderId,
      task,
      startedAt,
      completedAt,
      costUsd: finalCostUsd,
      toolCount: toolCallCount,
      turnDepth,
    };

    try {
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        join(sessionDir, "meta.json"),
        JSON.stringify(meta, null, 2),
        "utf-8",
      );
      await writeFile(
        join(sessionDir, "transcript.jsonl"),
        transcript.map((entry) => JSON.stringify(entry)).join("\n"),
        "utf-8",
      );
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

  const report = manager.cleanup(sessionId, finalCostUsd, verificationResult, evalScore);
  const finalReport = resumeSessionId ? { ...report, resumedFrom: resumeSessionId } : report;
  printReport(finalReport, "kiln");

  if (verificationResult && !verificationResult.passed) {
    process.exit(1);
  }

  await manager.cleanupWorktree(context);
}
