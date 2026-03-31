import { randomUUID } from "node:crypto";
import { SessionManager } from "../wrapper/session-manager.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import type {
  ProviderId,
  SessionRequirements,
  SessionReport,
  SessionMode,
  WrapperConfig,
  KilnPermissionPolicy,
} from "../wrapper/index.js";
import type { KilnAppConfig } from "../config.js";

export interface RunFlags {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly permissionPolicy?: KilnPermissionPolicy;
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

  const requirements: SessionRequirements = {
    preferredProvider: config.provider as ProviderId | undefined,
    requiresMcp: true,
  };

  const registry = createDefaultRegistry();
  const selection = registry.selectBest(requirements);
  const candidates: ProviderId[] = [
    selection.primary,
    ...selection.orderedFallbacks,
  ];

  let finalCostUsd = 0;
  let sessionSucceeded = false;
  let lastError: string | null = null;

  const sessionConfig = {
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
    permissionPolicy: config.permissionPolicy,
  };

  const shutdown = (): void => {
    for (const id of candidates) {
      try {
        const s = registry.createSession(id, sessionConfig);
        s.dispose();
      } catch {
        // ignore
      }
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for (const providerId of candidates) {
    let isPreflightCrash = false;

    const session = registry.createSession(providerId, sessionConfig);

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
      await session.dispose();
    }

    if (sessionSucceeded) break;

    if (!isPreflightCrash && !sessionSucceeded) {
      console.error(`[kiln] Provider ${providerId} failed, trying next...`);
    }
  }

  if (!sessionSucceeded && lastError) {
    console.error(`[kiln] All providers failed. Last error: ${lastError}`);
    process.exit(1);
  }

  process.off("SIGINT", shutdown);
  process.off("SIGTERM", shutdown);

  const report = manager.cleanup(sessionId, finalCostUsd);
  printReport(report, appConfig.appName);
}
