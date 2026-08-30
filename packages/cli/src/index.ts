#!/usr/bin/env bun

import { defineDeliberationLevelId } from "@kilnai/core";
import { findOperatorCommand, type OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import pkg from "../package.json" with { type: "json" };
import { parseRunOutputMode, type RunOutputMode } from "./application/run-output.js";
import type { KilnAppConfig } from "./config.js";
import { resolveKilnHomePath } from "./config/global-config/path.js";

type RunArgFlags = {
  target?: string;
  deliberationLevel?: string;
  requestedAuthority?: OperatorTurnRequestedAuthority;
  agent?: string;
  isolate?: boolean;
  continuation?: boolean;
  continuationSessionId?: string;
  plan?: boolean;
  ephemeral?: boolean;
  profile?: string;
  skipGitRepoCheck?: boolean;
  output?: RunOutputMode;
  outputSchema?: string;
  addDir?: string;
  localProvider?: string;
  workers?: number;
};

export type { GlobalOpenCodeModelGatewayProjectionResult } from "./config/global-opencode-model-gateway-projection.js";
export { syncGlobalOpenCodeModelGatewayProjection } from "./config/global-opencode-model-gateway-projection.js";
export type {
  ClaudeMessagesProjection,
  OpenCodeResponsesProjection,
  ResponsesNativeHarness,
} from "./config/model-gateway-native-projection.js";
export {
  buildClaudeMessagesProjection,
  buildOpenCodeResponsesProjection,
  resolveClaudeMessagesNativeProjectionSource,
  resolveResponsesNativeProjectionSource,
} from "./config/model-gateway-native-projection.js";
// Re-export types and config
export type { KilnAppConfig, SystemPromptOptions } from "./config.js";
export type { ClaudeSessionConfig } from "./wrapper/claude-code-process.js";
export { ClaudeSession } from "./wrapper/claude-code-process.js";
export type { SessionContext, SessionMode, SessionReport, WrapperConfig } from "./wrapper/index.js";
export { SessionManager } from "./wrapper/session-manager.js";
export {
  applyConfigurationOnboarding,
  readConfigurationOnboarding,
} from "./application/configuration-onboarding.js";
export type {
  ApplyConfigurationOnboardingInput,
  ConfigurationOnboardingDependencies,
  ConfigurationOnboardingProjectState,
  ReadConfigurationOnboardingInput,
} from "./application/configuration-onboarding.js";

export async function createCli(config: KilnAppConfig): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const APP_NAME = "kiln";
  const VERSION = pkg.version as string;
  const DESCRIPTION = "Governed AI control-plane CLI";
  const planCommand = findOperatorCommand("plan", "cli");
  const goalCommand = findOperatorCommand("goal", "cli");

  const COMMANDS: Record<string, string> = {
    init: `Adopt this project for a safe first turn (--non-interactive, --target-id, --approve)`,
    run: "Start a CLI-only coding session with Claude Code (use --plan for plan mode, --agent for agent profile)",
    plan: planCommand?.description ?? "Start a planning session before execution (3-phase workflow)",
    project: "Scout or adopt canonical repo context for generated project shims",
    status: "Show current phase, tasks, and costs",
    doctor: "Diagnose local harness installation, path, version, auth, and model readiness",
    memory: "Browse and search memory layers",
    config: "Inspect global authority and edit admitted project restrictions",
    "mcp-config": "Synchronize canonical MCP servers into governed native harness projections",
    "native-harness": "Run an internal native-harness adapter",
    "operator-runtime": "Run or inspect the machine-global operator runtime",
    "agent-task": "Submit and inspect durable Runtime-governed Agent Tasks",
    domain: "Manage domain packages (install, list, search, info, remove)",
    gateway: "Start persistent Gateway (multi-app hosting)",
    "model-gateway": "Run or inspect the dedicated loopback model gateway",
    dev: "Start the App Gateway for local development (--open)",
    gui: "Start the GUI operator surface or attach to an App Gateway",
    goal: goalCommand?.description ?? "Inspect and update canonical workflow goals from session transcripts",
    "managed-agent": "Inspect managed child invocations from canonical session transcripts",
    feedback: "Create local-only redacted session feedback bundles and issue drafts",
    benchmark: "Inspect benchmark-facing profiles, external tracks, and readiness baselines",
    "external-engagement": "Inspect and report governed external evidence sources",
    skill: "Manage skills (list, install, publish)",
    auth: "Authenticate subscription-backed providers (codex login/status/logout)",
    trust: "Explicitly accept or revoke a documented native-harness limitation",
    cron: "Manage scheduled jobs (list, add, remove, run)",
    sync: "Preview or sync explicit native projection targets (--target, --all, --dry-run)",
    target: "List, select, create, or inspect execution targets",
    "import-native": "Import supported native engine config into Kiln global config (codex, opencode)",
    uninstall: "Remove Kiln-managed native projections without deleting unmanaged native settings",
    tools:
      "Launch native dev tools MCP server over stdio and inspect shared resources (--mcp, --resources, --resource <uri>)",
    tui: "Interactive terminal chat (TUI mode)",
  };

  function printHelp(): void {
    console.log(`\n${capitalize(APP_NAME)} -- ${DESCRIPTION}\n`);
    console.log(`Usage: ${APP_NAME} [command] [options]\n`);
    console.log("Commands:");
    for (const [cmd, desc] of Object.entries(COMMANDS)) {
      console.log(`  ${cmd.padEnd(12)} ${desc}`);
    }
    console.log("\nOptions:");
    console.log("  --target     Execution target for `run` and `plan` from global configuration");
    console.log("  --provider   Provider setting for commands that explicitly support provider intent");
    console.log("  --target-id  Admitted direct target for `init`");
    console.log("  --permission-posture  Safe project permission posture for `init` (read-only)");
    console.log("  --approve    Approve authority-bearing target selection during `init`");
    console.log("  --deliberation-level  Provider-advertised deliberation level override");
    console.log("  --authority  Requested turn authority (auto, read_only, audited, destructive)");
    console.log("  --agent      Agent name from the private project catalog or ~/.kiln/agents");
    console.log("  --port       Port override (dev/gateway)");
    console.log("  --gui-port   GUI dev server port override (gui command)");
    console.log("  --connect    Attach GUI to an existing App Gateway URL");
    console.log("  --dev        Force gui command to run in dev mode");
    console.log("  --prod       Force gui command to run in prod mode");
    console.log("  --open       Open GUI URL in default browser");
    console.log("  --no-open    Do not open browser automatically");
    console.log("  --mcp       Start tools command in MCP stdio mode");
    console.log("  --resources List shared tool resources as JSON");
    console.log("  --resource  Read one shared tool resource URI");
    console.log("  --gateway-target-id  Target identity for resource reads");
    console.log("  --app-id     App identity for target-aware resource reads");
    console.log("  --tenant-id  Tenant identity for target-aware resource reads");
    console.log("  --session-id Session identity for target-aware resource reads");
    console.log("  --plan      Plan mode: read-only exploration before execution");
    console.log("  --continue    Continue the current canonical Kiln session target");
    console.log("  --continue-session <id>  Continue an explicit Kiln session id");
    console.log("  --ephemeral Run Codex without persisting session files");
    console.log("  --profile    Codex profile name from ~/.codex/config.toml");
    console.log("  --output     Run output mode (human, answer, json)");
    console.log("  --output-schema  Path to JSON schema file for Codex structured output");
    console.log("  --add-dir  Additional writable directory for Codex (single path)");
    console.log("  --skip-git-repo-check  Allow Codex runs outside a git repo");
    console.log("  --local-provider  Codex local provider name (ollama or lmstudio)");
    console.log("  --workers N    Run N parallel isolated workers on the same task (default: 1)");
    console.log(`\nRun '${APP_NAME} <command> --help' for command-specific help.\n`);
  }

  if (!command) {
    if (process.stdout.isTTY) {
      const { tuiCommand } = await import("./commands/tui.js");
      const portIdx = args.indexOf("--port");
      const port = portIdx >= 0 && portIdx + 1 < args.length ? parseInt(args[portIdx + 1]!, 10) : undefined;
      await tuiCommand(config, {
        cwd: findFlag(args, "--cwd"),
        port: !Number.isNaN(port!) && port! > 0 ? port : undefined,
        theme: findFlag(args, "--theme"),
      });
    } else {
      const { devCommand } = await import("./commands/dev.js");
      await devCommand(config, {});
    }
    return;
  }

  if (command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log(`${APP_NAME} ${VERSION}`);
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
      interactive: !args.includes("--non-interactive"),
      targetId: findFlag(args, "--target-id"),
      posture: findFlag(args, "--permission-posture") === "read-only" ? "read-only" : undefined,
      approve: args.includes("--approve"),
    });
    return;
  }

  if (command === "run") {
    if (args.includes("--help") || args.includes("-h")) {
      printRunHelp(APP_NAME);
      process.exit(0);
    }
    const { task, flags } = parseRunArgs(args.slice(1));
    const { runCommand } = await import("./commands/run.js");
    await runCommand(config, task, flags);
    return;
  }

  if (command === "plan") {
    const { task, flags } = parseRunArgs(args.slice(1));
    const { runCommand } = await import("./commands/run.js");
    await runCommand(config, task, { ...flags, plan: true });
    return;
  }

  if (command === "project") {
    const { projectCommand } = await import("./commands/project.js");
    await projectCommand(config, args[1], args.slice(2));
    return;
  }

  if (command === "status") {
    const { statusCommand } = await import("./commands/status.js");
    statusCommand(config);
    return;
  }

  if (command === "doctor") {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand(config, {
      json: args.includes("--json"),
    });
    return;
  }

  if (command === "memory") {
    const { memoryCommand } = await import("./commands/memory.js");
    await memoryCommand(config, args[1] ?? "", args.slice(2));
    return;
  }

  if (command === "config") {
    const { configCommand } = await import("./commands/config.js");
    await configCommand(config, args[1] ?? "", args.slice(2));
    return;
  }

  if (command === "mcp-config") {
    const { mcpConfigCommand, printMcpConfigHelp } = await import("./commands/mcp-config.js");
    if (args.includes("--help") || args.includes("-h")) {
      printMcpConfigHelp(APP_NAME);
      process.exit(0);
    }
    await mcpConfigCommand(config, parseMcpConfigFlags(args.slice(1)));
    return;
  }

  if (command === "native-harness") {
    const { nativeHarnessCommand } = await import("./commands/native-harness.js");
    await nativeHarnessCommand(args.slice(1));
    return;
  }

  if (command === "operator-runtime") {
    const { operatorRuntimeCommand } = await import("./commands/operator-runtime.js");
    await operatorRuntimeCommand(args.slice(1));
    return;
  }

  if (command === "agent-task") {
    const { agentTaskCommand } = await import("./commands/agent-task.js");
    await agentTaskCommand(args.slice(1));
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

  if (command === "model-gateway") {
    const { modelGatewayCommand } = await import("./commands/model-gateway.js");
    await modelGatewayCommand(args.slice(1));
    return;
  }

  if (command === "dev") {
    const { devCommand } = await import("./commands/dev.js");
    const port = parsePort(args, 4800);
    const configPath = findFlag(args, "--config");
    const open = args.includes("--open");
    await devCommand(config, { port, configPath, open });
    return;
  }

  if (command === "gui") {
    const { guiCommand } = await import("./commands/gui.js");
    const mode = parseGuiMode(args);
    if (!mode.ok) {
      console.error(mode.error);
      process.exit(1);
    }
    const port = parsePort(args, 4810);
    const guiPort = parsePortForFlag(args, "--gui-port", 5183);
    await guiCommand(config, {
      port,
      guiPort,
      mode: mode.value,
      cwd: findFlag(args, "--cwd"),
      connect: findFlag(args, "--connect"),
      open: parseOpenFlag(args),
      theme: findFlag(args, "--theme"),
      plan: args.includes("--plan"),
    });
    return;
  }

  if (command === "goal") {
    const { goalCommand } = await import("./commands/goal.js");
    await goalCommand(config, args[1], args.slice(2));
    return;
  }

  if (command === "managed-agent") {
    const { managedAgentCommand } = await import("./commands/managed-agent.js");
    await managedAgentCommand(config, args[1], args.slice(2));
    return;
  }

  if (command === "feedback") {
    const { feedbackCommand } = await import("./commands/feedback.js");
    await feedbackCommand(config, args[1], args.slice(2));
    return;
  }

  if (command === "skill") {
    const { skillCommand } = await import("./commands/skill.js");
    await skillCommand(config, args[1] ?? "", args.slice(2));
    return;
  }

  if (command === "benchmark") {
    const { benchmarkCommand } = await import("./commands/benchmark.js");
    await benchmarkCommand(config, args[1], args.slice(2));
    process.exit(0);
    return;
  }

  if (command === "external-engagement") {
    const { externalEngagementCommand } = await import("./commands/external-engagement.js");
    await externalEngagementCommand(config, args[1], args.slice(2));
    return;
  }

  if (command === "auth") {
    const { runAuth } = await import("./commands/auth.js");
    await runAuth(args.slice(1), { kilnHome: resolveKilnHomePath() });
    return;
  }

  if (command === "trust") {
    const { trustCommand } = await import("./commands/trust.js");
    await trustCommand(args.slice(1));
    return;
  }

  if (command === "cron") {
    const { cronCommand } = await import("./commands/cron.js");
    await cronCommand(config, undefined, args.slice(1));
    return;
  }

  if (command === "sync") {
    const { printSyncHelp, syncCommand } = await import("./commands/sync.js");
    if (args.includes("--help") || args.includes("-h")) {
      printSyncHelp(APP_NAME);
      process.exit(0);
    }
    await syncCommand(config, undefined, args.slice(1));
    return;
  }

  if (command === "target") {
    const { targetCommand } = await import("./commands/target.js");
    await targetCommand(args.slice(1));
    return;
  }

  if (command === "import-native") {
    const { importNativeCommand } = await import("./commands/import-native.js");
    await importNativeCommand(config, args[1], args.slice(2));
    return;
  }

  if (command === "uninstall") {
    const { uninstallCommand } = await import("./commands/uninstall.js");
    await uninstallCommand(config, args[1], args.slice(2));
    return;
  }

  if (command === "tools") {
    const { toolsCommand } = await import("./commands/tools.js");
    await toolsCommand(config, {
      mcp: args.includes("--mcp"),
      resources: args.includes("--resources"),
      resource: findFlag(args, "--resource"),
      gatewayTargetId: findFlag(args, "--gateway-target-id"),
      appId: findFlag(args, "--app-id"),
      tenantId: findFlag(args, "--tenant-id"),
      sessionId: findFlag(args, "--session-id"),
    });
    return;
  }

  if (command === "tui") {
    const { tuiCommand } = await import("./commands/tui.js");
    const portIdx = args.indexOf("--port");
    const port = portIdx >= 0 && portIdx + 1 < args.length ? parseInt(args[portIdx + 1]!, 10) : undefined;
    await tuiCommand(config, {
      cwd: findFlag(args, "--cwd"),
      port: !Number.isNaN(port!) && port! > 0 ? port : undefined,
      theme: findFlag(args, "--theme"),
    });
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

function printRunHelp(appName: string): void {
  console.log(`\nUsage: ${appName} run [options] <task>\n`);
  console.log("Start a CLI-only Kiln session.");
  console.log("\nOptions:");
  console.log("  --target <id>                Execution target from global configuration");
  console.log("  --deliberation-level <id>    Provider-advertised deliberation level override");
  console.log("  --authority <authority>      Requested authority (auto, read_only, audited, destructive)");
  console.log("  --agent <name>               Agent profile from the private project catalog or ~/.kiln/agents");
  console.log("  --plan                       Run read-only plan mode first");
  console.log("  --continue                     Continue the current canonical Kiln session target");
  console.log("  --continue-session <id>        Continue an explicit Kiln session id");
  console.log("  --ephemeral                  Run Codex without persisting native session files");
  console.log("  --profile <name>             Codex profile name from ~/.codex/config.toml");
  console.log("  --output <mode>              Output mode (human, answer, json)");
  console.log("  --output-schema <path>       JSON schema file for Codex structured output");
  console.log("  --add-dir <path>             Additional writable directory for Codex");
  console.log("  --skip-git-repo-check        Allow Codex runs outside a git repo");
  console.log("  --local-provider <name>      Codex local provider (ollama or lmstudio)");
  console.log("  --workers <n>                Run parallel isolated workers");
  console.log("  -h, --help                   Show this help");
}

function parsePort(args: readonly string[], fallbackPort?: number): number | undefined {
  return parsePortForFlag(args, "--port", fallbackPort);
}

function parsePortForFlag(args: readonly string[], flag: string, fallbackPort?: number): number | undefined {
  const portIdx = args.indexOf(flag);
  if (portIdx >= 0 && portIdx + 1 < args.length) {
    const parsed = parseInt(args[portIdx + 1]!, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return fallbackPort;
}

function parseGuiMode(
  args: readonly string[],
): { ok: true; value: "dev" | "prod" | undefined } | { ok: false; error: string } {
  const hasDevFlag = args.includes("--dev");
  const hasProdFlag = args.includes("--prod");
  if (hasDevFlag && hasProdFlag) {
    return { ok: false, error: "Cannot use --dev and --prod together for `kiln gui`." };
  }
  if (hasDevFlag) {
    return { ok: true, value: "dev" };
  }
  if (hasProdFlag) {
    return { ok: true, value: "prod" };
  }
  return { ok: true, value: undefined };
}

function parseOpenFlag(args: readonly string[]): boolean {
  if (args.includes("--no-open")) {
    return false;
  }
  if (args.includes("--open")) {
    return true;
  }
  return true;
}

function parseRunArgs(rawArgs: readonly string[]): { task: string; flags: RunArgFlags } {
  const flags: RunArgFlags = {};
  const taskParts: string[] = [];
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i]!;
    if (arg === "--target" && i + 1 < rawArgs.length) {
      flags.target = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--deliberation-level" && i + 1 < rawArgs.length) {
      flags.deliberationLevel = parseDeliberationLevel(rawArgs[i + 1]);
      i += 2;
    } else if ((arg === "--authority" || arg === "--requested-authority") && i + 1 < rawArgs.length) {
      flags.requestedAuthority = parseRequestedAuthority(rawArgs[i + 1]);
      i += 2;
    } else if (arg === "--agent" && i + 1 < rawArgs.length) {
      flags.agent = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--isolate") {
      flags.isolate = true;
      i += 1;
    } else if (arg === "--continue") {
      flags.continuation = true;
      i += 1;
    } else if (arg === "--continue-session" && i + 1 < rawArgs.length) {
      flags.continuationSessionId = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--plan") {
      flags.plan = true;
      i += 1;
    } else if (arg === "--ephemeral") {
      flags.ephemeral = true;
      i += 1;
    } else if (arg === "--profile" && i + 1 < rawArgs.length) {
      flags.profile = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--skip-git-repo-check") {
      flags.skipGitRepoCheck = true;
      i += 1;
    } else if (arg === "--output-schema" && i + 1 < rawArgs.length) {
      flags.outputSchema = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--output" && i + 1 < rawArgs.length) {
      flags.output = parseRunOutputMode(rawArgs[i + 1]);
      i += 2;
    } else if (arg === "--add-dir" && i + 1 < rawArgs.length) {
      flags.addDir = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--local-provider" && i + 1 < rawArgs.length) {
      flags.localProvider = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--workers" && i + 1 < rawArgs.length) {
      const n = Number(rawArgs[i + 1]);
      if (!Number.isNaN(n) && n > 0) flags.workers = n;
      i += 2;
    } else if (arg.startsWith("-")) {
      throw new Error(
        `Unknown run option '${arg}'. Operator execution accepts target identity, not provider, model, or credential overrides.`,
      );
    } else {
      taskParts.push(arg);
      i += 1;
    }
  }
  return { task: taskParts.join(" "), flags };
}

function parseRequestedAuthority(value: string | undefined): OperatorTurnRequestedAuthority {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "auto" || normalized === "read_only" || normalized === "audited" || normalized === "destructive") {
    return normalized;
  }
  throw new Error(`Unknown requested authority '${value}'. Use auto, read_only, audited, or destructive.`);
}

function parseDeliberationLevel(value: string | undefined): string {
  return defineDeliberationLevelId(value?.trim() ?? "");
}

function parseMcpConfigFlags(rawArgs: readonly string[]): {
  client?: string;
  name?: string;
  command?: string;
  args?: string;
  test?: boolean;
  server?: string;
  repair?: boolean;
  uninstall?: boolean;
  credential?: string;
  fromEnv?: string;
} {
  const flags: {
    client?: string;
    name?: string;
    command?: string;
    args?: string;
    test?: boolean;
    server?: string;
    repair?: boolean;
    uninstall?: boolean;
    credential?: string;
    fromEnv?: string;
  } = {};
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i]!;
    if (arg === "--client" && i + 1 < rawArgs.length) {
      flags.client = rawArgs[i + 1];
      i += 2;
    } else if (arg.startsWith("--client=")) {
      flags.client = arg.split("=")[1];
      i += 1;
    } else if (arg === "--test") {
      flags.test = true;
      i += 1;
    } else if (arg === "--repair") {
      flags.repair = true;
      i += 1;
    } else if (arg === "--uninstall") {
      flags.uninstall = true;
      i += 1;
    } else if (arg === "--server" && i + 1 < rawArgs.length) {
      flags.server = rawArgs[i + 1];
      i += 2;
    } else if (arg.startsWith("--server=")) {
      flags.server = arg.split("=")[1];
      i += 1;
    } else if (arg === "--credential" && i + 1 < rawArgs.length) {
      flags.credential = rawArgs[i + 1];
      i += 2;
    } else if (arg === "--from-env" && i + 1 < rawArgs.length) {
      flags.fromEnv = rawArgs[i + 1];
      i += 2;
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

if (import.meta.main) {
  const { createFilesystemDomainRegistry } = await import("@kilnai/runtime");
  void createCli({
    createRegistry: () => createFilesystemDomainRegistry(),
  });
}
