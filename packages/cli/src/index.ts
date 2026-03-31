#!/usr/bin/env bun

import { join } from "node:path";
import { migrateConfigJson } from "./kiln-yaml.js";
import type { KilnAppConfig } from "./config.js";

// Re-export types and config
export type { KilnAppConfig, SystemPromptOptions } from "./config.js";
export { ClaudeSession } from "./wrapper/claude-code-process.js";
export type { ClaudeSessionConfig } from "./wrapper/claude-code-process.js";
export type { SessionMode, SessionContext, SessionReport, WrapperConfig } from "./wrapper/index.js";
export { SessionManager } from "./wrapper/session-manager.js";
export { KilnMcpServer, KILN_TOOLS } from "./mcp/index.js";
export type { KilnTool, McpServerInfo } from "./mcp/index.js";

export async function createCli(config: KilnAppConfig): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const COMMANDS: Record<string, string> = {
    init: `Initialize ${config.appName} in the current project (--force, --non-interactive, --domain, --provider, --channels, --team-mode)`,
    run: "Start a CLI-only coding session with Claude Code",
    status: "Show current phase, tasks, and costs",
    memory: "Browse and search memory layers",
    config: "Edit domain config and provider settings",
    serve: `Start ${config.appName} MCP server (used by Claude Code)`,
    "mcp-config": "Generate MCP client configuration JSON",
    domain: "Manage domain packages (install, list, search, info, remove)",
    gateway: "Start persistent Gateway (multi-app hosting)",
    dev: "Start development mode with hot-reload and event streaming (--playground)",
    skill: "Manage skills (list, install, publish)",
    cron: "Manage scheduled jobs (list, add, remove, run)",
    sync: "Sync permissions and hooks to Claude Code, Codex, and OpenCode (--permissions, --hooks, --all)",
  };

  function printHelp(): void {
    console.log(`\n${capitalize(config.appName)} -- ${config.description}\n`);
    console.log(`Usage: ${config.appName} [command] [options]\n`);
    console.log("Commands:");
    for (const [cmd, desc] of Object.entries(COMMANDS)) {
      console.log(`  ${cmd.padEnd(12)} ${desc}`);
    }
    console.log("\nOptions:");
    console.log("  --api-key    Anthropic API key (required for Mode A)");
    console.log("  --provider   LLM provider (claude, openai, deepseek)");
    console.log("  --port       Port override (dev/gateway)");
    console.log("  --playground Open Studio in browser (dev mode)");
    console.log(`\nRun '${config.appName} <command> --help' for command-specific help.\n`);
  }

  if (!command) {
    const { devCommand } = await import("./commands/dev.js");
    await devCommand(config, {});
    return;
  }

  if (command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log(`${config.appName} ${config.version}`);
    process.exit(0);
  }

  if (!(command in COMMANDS)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  if (command === "init") {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(config, process.cwd(), {
      force: args.includes("--force"),
      interactive: !args.includes("--non-interactive"),
      domain: findFlag(args, "--domain"),
      provider: findFlag(args, "--provider"),
      channels: findFlag(args, "--channels"),
      teamMode: findFlag(args, "--team-mode"),
    });
    return;
  }

  if (command === "serve") {
    const { serveCommand } = await import("./commands/serve.js");
    await serveCommand(config);
    return;
  }

  if (command === "run") {
    const { task, flags } = parseRunArgs(args.slice(1));
    const { runCommand } = await import("./commands/run.js");
    await runCommand(config, task, flags);
    return;
  }

  if (command === "status") {
    const { statusCommand } = await import("./commands/status.js");
    const root = process.cwd();
    const kilnDir = join(root, config.dirName);
    if (migrateConfigJson(kilnDir)) {
      console.log("Migrated .kiln/config.json → kiln.yaml");
    }
    statusCommand(config);
    return;
  }

  if (command === "memory") {
    const { memoryCommand } = await import("./commands/memory.js");
    memoryCommand(config, args[1] ?? "", args.slice(2));
    return;
  }

  if (command === "config") {
    const { configCommand } = await import("./commands/config.js");
    const root = process.cwd();
    const kilnDir = join(root, config.dirName);
    if (migrateConfigJson(kilnDir)) {
      console.log("Migrated .kiln/config.json → kiln.yaml");
    }
    configCommand(config, args[1] ?? "", args.slice(2));
    return;
  }

  if (command === "mcp-config") {
    const { mcpConfigCommand } = await import("./commands/mcp-config.js");
    await mcpConfigCommand(config, parseMcpConfigFlags(args.slice(1)));
    return;
  }

  if (command === "domain") {
    const { domainCommand } = await import("./commands/domain.js");
    await domainCommand(config, args[1] ?? "", args.slice(2));
    return;
  }

  if (command === "gateway") {
    const { gatewayCommand } = await import("./commands/gateway.js");
    await gatewayCommand(args.slice(1));
    return;
  }

  if (command === "dev") {
    const { devCommand } = await import("./commands/dev.js");
    const port = parsePort(args);
    const configPath = findFlag(args, "--config");
    const playground = args.includes("--playground");
    await devCommand(config, { port, configPath, playground });
    return;
  }

  if (command === "skill") {
    const { skillCommand } = await import("./commands/skill.js");
    await skillCommand(config, args[1] ?? "", args.slice(2));
    return;
  }

  if (command === "cron") {
    const { cronCommand } = await import("./commands/cron.js");
    await cronCommand(config, undefined, args.slice(1));
    return;
  }

  if (command === "sync") {
    const { syncCommand } = await import("./commands/sync.js");
    await syncCommand(config, undefined, args.slice(1));
    return;
  }
}

function findFlag(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parsePort(args: readonly string[]): number {
  const portIdx = args.indexOf("--port");
  if (portIdx >= 0 && portIdx + 1 < args.length) {
    const parsed = parseInt(args[portIdx + 1]!, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 4800;
}

function parseRunArgs(rawArgs: readonly string[]): { task: string; flags: { apiKey?: string; provider?: string } } {
  const flags: { apiKey?: string; provider?: string } = {};
  const taskParts: string[] = [];
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i]!;
    if (arg === "--api-key" && i + 1 < rawArgs.length) {
      flags.apiKey = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--provider" && i + 1 < rawArgs.length) {
      flags.provider = rawArgs[i + 1];
      i += 2;
    } else {
      taskParts.push(arg);
      i += 1;
    }
  }
  return { task: taskParts.join(" "), flags };
}

function parseMcpConfigFlags(rawArgs: readonly string[]): { client?: string; name?: string; command?: string; args?: string } {
  const flags: { client?: string; name?: string; command?: string; args?: string } = {};
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i]!;
    if (arg === "--client" && i + 1 < rawArgs.length) {
      flags.client = rawArgs[i + 1];
      i += 2;
    } else if (arg.startsWith("--client=")) {
      flags.client = arg.split("=")[1];
      i += 1;
    } else if (arg === "--name" && i + 1 < rawArgs.length) {
      flags.name = rawArgs[i + 1];
      i += 2;
    } else if (arg.startsWith("--name=")) {
      flags.name = arg.split("=")[1];
      i += 1;
    } else if (arg === "--command" && i + 1 < rawArgs.length) {
      flags.command = rawArgs[i + 1];
      i += 2;
    } else if (arg.startsWith("--command=")) {
      flags.command = arg.split("=")[1];
      i += 1;
    } else if (arg === "--args" && i + 1 < rawArgs.length) {
      flags.args = rawArgs[i + 1];
      i += 2;
    } else if (arg.startsWith("--args=")) {
      flags.args = arg.split("=")[1];
      i += 1;
    } else if (!arg.startsWith("--")) {
      flags.client = arg;
      i += 1;
    } else {
      i += 1;
    }
  }
  return flags;
}
