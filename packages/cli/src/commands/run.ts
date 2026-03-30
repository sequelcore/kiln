import { randomUUID } from "node:crypto";
import { SessionManager } from "../wrapper/session-manager.js";
import { ClaudeSession } from "../wrapper/claude-code-process.js";
import type { SessionMode, SessionReport, WrapperConfig } from "../wrapper/index.js";
import type { KilnAppConfig } from "../config.js";

export interface RunFlags {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly dangerouslySkipPermissions?: boolean;
}

function resolveMode(flags: RunFlags): SessionMode {
  if (flags.apiKey && flags.provider) return "byok";
  return "api-key";
}

function buildConfig(flags: RunFlags, mode: SessionMode): WrapperConfig {
  return {
    mode,
    apiKey: flags.apiKey,
    provider: flags.provider,
    dangerouslySkipPermissions: flags.dangerouslySkipPermissions ?? false,
  };
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
  const manager = new SessionManager(config, appConfig);

  let context;
  try {
    context = manager.prepare(task, process.cwd());
  } catch (err) {
    console.error("Error: Failed to prepare session.", err instanceof Error ? err.message : err);
    process.exit(1);
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

  const session = new ClaudeSession({
    task,
    systemPrompt: context.systemPrompt,
    mcpServers: {
      [appConfig.mcpServerName]: {
        command: "bun",
        args: ["run", context.mcpServerEntryPath],
      },
    },
    cwd: process.cwd(),
    env,
    permissionMode: config.dangerouslySkipPermissions ? "bypassPermissions" : "default",
    allowDangerouslySkipPermissions: config.dangerouslySkipPermissions,
  });

  let finalCostUsd = 0;

  const shutdown = (): void => {
    session.dispose();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    for await (const event of session.run({
      prompt: task,
      cwd: process.cwd(),
      env,
    })) {
      switch (event.type) {
        case "text_delta": {
          process.stdout.write(event.content);
          break;
        }
        case "tool_use": {
          console.log(`[tool] ${event.toolName}`);
          break;
        }
        case "cost_update": {
          finalCostUsd = event.usd;
          break;
        }
        case "completed": {
          if (event.isPreflightCrash) {
            console.error(
              "\nSession crashed before starting. Check Claude Code installation.",
            );
            process.exit(1);
          }
          if (event.isError) {
            console.error("\nSession ended with error.");
            process.exit(1);
          }
          break;
        }
        case "error": {
          console.error(`Error: ${event.message}`);
          if (!event.isRetryable) process.exit(1);
          break;
        }
      }
    }
  } finally {
    await session.dispose();
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }

  const report = manager.cleanup(sessionId, finalCostUsd);
  printReport(report, appConfig.appName);
}
