import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SessionManager } from "../wrapper/session-manager.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import { buildPreamble } from "../wrapper/preamble-builder.js";
import { cleanupRegistry } from "../wrapper/cleanup-registry.js";
import { HookRegistry, HookExecutor, SessionStore } from "../wrapper/index.js";
import type {
  ProviderId,
  SessionRequirements,
  SessionReport,
  SessionMode,
  WrapperConfig,
  KilnPermissionPolicy,
} from "../wrapper/index.js";
import type { KilnAppConfig } from "../config.js";
import { SkillGenerator, AnthropicAdapter, VerificationResult } from "@kilnai/core";

export interface RunFlags {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly isolate?: boolean;
  readonly resume?: boolean;
}

function resolveMode(flags: RunFlags): SessionMode {
  if (flags.apiKey && flags.provider) return "byok";
  return "api-key";
}

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "ask", sandbox: "none" };

function buildConfig(flags: RunFlags, mode: SessionMode): WrapperConfig {
  return {
    mode,
    apiKey: flags.apiKey,
    provider: flags.provider,
    permissionPolicy: flags.permissionPolicy ?? DEFAULT_POLICY,
  };
}

type EvalScoreLabel = "excellent" | "good" | "fair" | "poor";

export function computeEvalScore(opts: {
  succeeded: boolean;
  durationMs: number;
  costUsd: number;
  verificationPassed: boolean | undefined;
  toolCallCount: number;
}): { score: number; label: EvalScoreLabel; signals: string[] } {
  let score = 0.5;
  const signals: string[] = [];

  if (opts.succeeded) {
    score += 0.2;
    signals.push("session succeeded");
  }

  if (opts.verificationPassed === true) {
    score += 0.1;
    signals.push("gates passed");
  } else if (opts.verificationPassed === false) {
    score -= 0.2;
    signals.push("gates failed");
  }

  if (opts.costUsd > 0.5) {
    score -= 0.1;
    signals.push("high cost");
  }

  if (opts.toolCallCount > 0) {
    score += 0.1;
    signals.push("agent used tools");
  }

  if (opts.durationMs > 120_000) {
    score -= 0.1;
    signals.push("slow session");
  }

  const clamped = Math.max(0, Math.min(1, score));
  const label: EvalScoreLabel = clamped >= 0.8
    ? "excellent"
    : clamped >= 0.6
      ? "good"
      : clamped >= 0.4
        ? "fair"
        : "poor";

  return { score: clamped, label, signals };
}

export function printReport(report: SessionReport, appName: string): void {
  const costParts = Object.entries(report.cost.byRoleModel)
    .map(([role, value]) => `${role}: $${value.toFixed(2)}`)
    .join(", ");

  const durationSec = (report.duration / 1000).toFixed(1);
  const appLabel = appName.charAt(0).toUpperCase() + appName.slice(1);

  console.log(`\n--- ${appLabel} Session Complete ---`);
  console.log(`Task:     ${report.task}`);
  console.log(`Domain:   ${report.domain}`);
  console.log(`Phase:    ${report.phaseReached}`);
  console.log(`Cost:     $${report.cost.total.toFixed(2)}${costParts ? ` (${costParts})` : ""}`);
  console.log(`Duration: ${durationSec}s`);
  if ((report as { resumedFrom?: string }).resumedFrom) {
    console.log(`Resumed:  from session ${(report as { resumedFrom: string }).resumedFrom}`);
  }
  if (report.verificationResult) {
    const v = report.verificationResult;
    console.log(`Gates:    ${v.passed ? "all passed" : "FAILED"}`);
    for (const check of v.checks) {
      const icon = check.passed ? "✓" : "✗";
      console.log(`  ${icon} ${check.name} (${check.duration}ms)`);
      if (!check.passed) {
        console.log(`    ${check.output.slice(0, 300)}`);
      }
    }
  }
  if (report.evalScore) {
    console.log(`Score:    ${report.evalScore.label} (${(report.evalScore.score * 100).toFixed(0)}%)`);
  }
  console.log("");
}

export async function runCommand(appConfig: KilnAppConfig, task: string, flags: RunFlags): Promise<void> {
  if (!task.trim()) {
    console.error(`Error: No task provided. Usage: ${appConfig.appName} run "your task here"`);
    process.exit(1);
  }

  if (!flags.apiKey) {
    console.error(
      "Error: An API key is required. Anthropic's ToS prohibits OAuth/subscription credentials in third-party tools.\n" +
      `Usage: ${appConfig.appName} run --api-key sk-ant-... "your task here"\n` +
      `  or:  ${appConfig.appName} run --provider openai --api-key sk-... "your task here"`,
    );
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
  let resumeSessionId: string | undefined;
  if (flags.resume && preferredProvider) {
    try {
      const store = new SessionStore(process.cwd());
      const lastRecord = await store.last(preferredProvider);
      if (lastRecord) {
        resumeSessionId = lastRecord.sessionId;
      }
    } catch {
      console.error("[SessionStore] Failed to look up last session for resume");
    }
  }

  const appLabel = appConfig.appName.charAt(0).toUpperCase() + appConfig.appName.slice(1);
  console.log(`${appLabel} session starting...`);
  console.log(`Domain:  ${context.domain.displayName}`);
  console.log(`Mode:    ${mode}`);
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

  const selection = registry.selectBest(requirements);
  const candidates: ProviderId[] = [
    selection.primary,
    ...selection.orderedFallbacks,
  ];

  let finalCostUsd = 0;
  let sessionSucceeded = false;
  let lastError: string | null = null;
  let accumulatedText = "";
  let toolCallCount = 0;

  const sessionConfig = {
    task,
    systemPrompt: context.systemPrompt,
    mcpServerEntryPath: context.mcpServerEntryPath,
    cwd: process.cwd(),
    env,
    permissionPolicy: config.permissionPolicy,
    resumeSessionId,
  };

  const hookRegistry = new HookRegistry(appConfig.kilnYaml?.hooks ?? {});
  const hookExecutor = new HookExecutor();
  let isFirstDeltaOfTurn = false;
  let lastToolName: string | undefined;
  const hookCwd = context.workingDirectory;

  const shutdown = (): void => {
    void cleanupRegistry.runAll();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  function fireHook(event: "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart" | "SessionEnd", extra?: { toolName?: string }): void {
    const handlers = hookRegistry.getRules(event, extra?.toolName);
    if (handlers.length === 0) return;
    hookExecutor
      .run(handlers, { event, toolName: extra?.toolName, sessionId, workingDirectory: hookCwd })
      .then((results) => {
        for (const result of results) {
          if (result.exitCode !== 0) {
            console.error(`[hook:${event}] non-zero exit ${result.exitCode} from: ${result.handler.command}`);
            if (result.stderr) console.error(`[hook:${event}] stderr: ${result.stderr.trim()}`);
          }
        }
      })
      .catch((err: unknown) => console.error(`[hook:${event}] hook execution failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  fireHook("SessionStart");

  for (const providerId of candidates) {
    let isPreflightCrash = false;

    const session = registry.createSession(providerId, sessionConfig);
    cleanupRegistry.register(async () => session.dispose());

    try {
      for await (const event of session.run({
        prompt: buildPreamble(context, config.permissionPolicy, undefined),
        cwd: process.cwd(),
        env,
      })) {
        switch (event.type) {
          case "text_delta": {
            if (isFirstDeltaOfTurn) {
              isFirstDeltaOfTurn = false;
              fireHook("UserPromptSubmit");
            }
            process.stdout.write(event.content);
            accumulatedText += event.content;
            break;
          }
          case "tool_use": {
            console.log(`[tool] ${event.toolName}`);
            toolCallCount++;
            lastToolName = event.toolName;
            fireHook("PreToolUse", { toolName: event.toolName });
            break;
          }
          case "tool_result": {
            isFirstDeltaOfTurn = true;
            if (lastToolName) {
              fireHook("PostToolUse", { toolName: lastToolName });
            }
            break;
          }
          case "cost_update": {
            finalCostUsd = event.usd;
            manager.trackCostUpdate(
              event.inputTokens ?? 0,
              event.outputTokens ?? 0,
              event.cacheReadTokens ?? 0,
              event.usd,
            );
            break;
          }
          case "completed": {
            isPreflightCrash = event.isPreflightCrash;
            if (event.isPreflightCrash) {
              lastError = `Provider ${providerId} crashed before starting`;
              registry.reportFailure(providerId, true);
              break;
            }
            if (event.isError) {
              lastError = `Provider ${providerId} ended with error`;
              registry.reportFailure(providerId, false);
              break;
            }
            sessionSucceeded = true;
            registry.reportSuccess(providerId);
            {
              const sg = appConfig.kilnYaml?.skillGeneration;
              if (sg?.enabled !== false && config.apiKey) {
                try {
                  const skillsDir = join(process.cwd(), ".kiln", "skills");
                  const generator = new SkillGenerator({
                    provider: new AnthropicAdapter({ apiKey: config.apiKey }),
                    registry: new (await import("@kilnai/core")).SkillRegistry(),
                    skillsDir,
                    complexityThreshold: sg?.complexityThreshold,
                  });
                  void generator.maybeGenerate(task, accumulatedText, 0, 0);
                } catch { /* fail-open */ }
              }
            }
            break;
          }
          case "error": {
            lastError = event.message;
            if (!event.isRetryable) {
              registry.reportFailure(providerId, false);
            }
            break;
          }
        }
      }
    } finally {
      cleanupRegistry.register(async () => session.dispose());
      await session.dispose();
    }

    if (sessionSucceeded) break;

    if (!isPreflightCrash && !sessionSucceeded) {
      console.error(`[kiln] Provider ${providerId} failed, trying next...`);
    }
  }

  fireHook("SessionEnd");

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

  const report = manager.cleanup(sessionId, finalCostUsd, verificationResult, evalScore);
  const finalReport = resumeSessionId ? { ...report, resumedFrom: resumeSessionId } : report;
  printReport(finalReport, appConfig.appName);

  if (verificationResult && !verificationResult.passed) {
    process.exit(1);
  }

  await manager.cleanupWorktree(context);
}
