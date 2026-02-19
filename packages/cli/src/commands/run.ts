import { randomUUID } from "node:crypto";
import { Orchestrator } from "@kiln/core";
import type { KilnEvent } from "@kiln/core";
import { SessionManager } from "../wrapper/session-manager.js";
import { ClaudeSession } from "../wrapper/claude-code-process.js";
import type { SessionMode, SessionReport, WrapperConfig } from "../wrapper/index.js";
import type { KilnAppConfig } from "../config.js";
import { formatEvent } from "../formatters.js";

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
    claudeCodePath: "claude",
    dangerouslySkipPermissions: flags.dangerouslySkipPermissions ?? false,
    sandbox: true,
    autoApprove: false,
    autoApproveTimeout: 30000,
  };
}

export function printReport(report: SessionReport, appName: string): void {
  const costParts = Object.entries(report.cost.byRole)
    .map(([role, value]) => `${role}: $${value.toFixed(2)}`)
    .join(", ");

  const durationSec = (report.duration / 1000).toFixed(1);
  const appLabel = appName.charAt(0).toUpperCase() + appName.slice(1);

  console.log(`\n--- ${appLabel} Session Complete ---`);
  console.log(`Task:     ${report.task}`);
  console.log(`Domain:   ${report.domain}`);
  console.log(`Phases:   ${report.phasesCompleted}/${report.totalPhases} (reached: ${report.phaseReached})`);
  console.log(`Cost:     $${report.cost.total.toFixed(2)}${costParts ? ` (${costParts})` : ""}`);
  console.log(`Duration: ${durationSec}s`);
  console.log(`Gates:    ${report.qualityGates.passed} passed, ${report.qualityGates.failed} failed`);
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

  const orchestrator = new Orchestrator();

  const appLabel = appConfig.appName.charAt(0).toUpperCase() + appConfig.appName.slice(1);
  console.log(`${appLabel} session starting...`);
  console.log(`Domain:  ${context.domain.displayName}`);
  console.log(`Mode:    ${mode}`);
  console.log("");

  orchestrator.eventBus.onAny((event: KilnEvent) => {
    console.log(formatEvent(event));
  });

  // Build env
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

  // Print SDK messages to console
  session.onMessage((msg) => {
    switch (msg.type) {
      case "system": {
        const subtype = (msg as { subtype?: string }).subtype;
        if (subtype === "init") {
          const sysMsg = msg as { model?: string };
          if (sysMsg.model) console.log(`Model: ${sysMsg.model}`);
        }
        break;
      }
      case "assistant": {
        const assMsg = msg as {
          message?: {
            content?: Array<{ type: string; text?: string; name?: string }>;
          };
        };
        if (assMsg.message?.content) {
          for (const block of assMsg.message.content) {
            if (block.type === "text" && block.text) {
              process.stdout.write(block.text + "\n");
            } else if (block.type === "tool_use" && block.name) {
              console.log(`[tool] ${block.name}`);
            }
          }
        }
        break;
      }
      case "result": {
        const resultMsg = msg as { subtype?: string; result?: string };
        if (resultMsg.subtype === "success" && resultMsg.result) {
          console.log("\n--- Result ---");
          console.log(resultMsg.result);
        }
        break;
      }
    }
  });

  const shutdown = (): void => {
    session.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await session.start();
  } catch {
    console.error(
      "Error: Could not launch Claude Code. Make sure it is installed and available on your PATH.\n" +
      "Install: npm install -g @anthropic-ai/claude-code",
    );
    process.exit(1);
  }

  process.off("SIGINT", shutdown);
  process.off("SIGTERM", shutdown);

  const report = manager.cleanup(sessionId);
  printReport(report, appConfig.appName);
}
