import pkg from "../package.json" with { type: "json" };
import type { KilnAppConfig } from "./config.js";

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

type OperatorTurnRequestedAuthority = "auto" | "read_only" | "audited" | "destructive";
type RunOutputMode = "human" | "answer" | "json";
type ParseRunOutputMode = (value: string | undefined) => RunOutputMode;
type ParseDeliberationLevel = (value: string | undefined) => string;

export type CliComposition = "none" | "filesystem-domain-registry";

export interface CliCommandHandlerInput {
  readonly config: KilnAppConfig;
  readonly args: readonly string[];
}

export type CliCommandHandler = (input: CliCommandHandlerInput) => Promise<void>;

export interface CliCommandDefinition {
  readonly id: string;
  readonly description: string;
  readonly owner: "cli";
  readonly composition: CliComposition;
  readonly handler: CliCommandHandler;
}

export interface CliExecutionComposition {
  /** Compose a concrete registry only after a registry-owning command is selected. */
  readonly composeRegistry?: () => Promise<KilnAppConfig["createRegistry"]>;
}

const APP_NAME = "kiln";
const VERSION = pkg.version as string;
const DESCRIPTION = "Governed AI control-plane CLI";

/**
 * The sole command registry.  It owns display order, validation metadata, and
 * dispatch.  Handler imports stay literal and deferred until the selected
 * command runs, so help and simple commands do not load command modules.
 */
export const CLI_COMMANDS = [
  {
    id: "init",
    description: "Adopt this project for a safe first turn (--non-interactive, --target-id, --approve)",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { initCommand } = await import("./commands/init.js");
      await initCommand(config, process.cwd(), {
        interactive: !args.includes("--non-interactive"),
        targetId: findFlag(args, "--target-id"),
        posture: findFlag(args, "--permission-posture") === "read-only" ? "read-only" : undefined,
        approve: args.includes("--approve"),
      });
    },
  },
  {
    id: "run",
    description: "Start a CLI-only coding session with Claude Code (use --plan for plan mode, --agent for agent profile)",
    owner: "cli",
    composition: "filesystem-domain-registry",
    handler: async ({ config, args }) => {
      if (args.includes("--help") || args.includes("-h")) {
        printRunHelp(APP_NAME);
        process.exit(0);
      }
      const { defineDeliberationLevelId } = await import("@kilnai/core");
      const { parseRunOutputMode } = await import("./application/run-output.js");
      const { task, flags } = parseRunArgs(
        args.slice(1),
        (value) => defineDeliberationLevelId(value?.trim() ?? ""),
        parseRunOutputMode,
      );
      const { runCommand } = await import("./commands/run.js");
      await runCommand(config, task, flags);
    },
  },
  {
    id: "plan",
    description: "Switch the next turns into planning mode.",
    owner: "cli",
    composition: "filesystem-domain-registry",
    handler: async ({ config, args }) => {
      const { defineDeliberationLevelId } = await import("@kilnai/core");
      const { parseRunOutputMode } = await import("./application/run-output.js");
      const { task, flags } = parseRunArgs(
        args.slice(1),
        (value) => defineDeliberationLevelId(value?.trim() ?? ""),
        parseRunOutputMode,
      );
      const { runCommand } = await import("./commands/run.js");
      await runCommand(config, task, { ...flags, plan: true });
    },
  },
  {
    id: "project",
    description: "Scout or adopt canonical repo context for generated project shims",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { projectCommand } = await import("./commands/project.js");
      await projectCommand(config, args[1], args.slice(2));
    },
  },
  {
    id: "status",
    description: "Show current phase, tasks, and costs",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { statusCommand } = await import("./commands/status.js");
      await statusCommand(config, args[1]);
    },
  },
  {
    id: "doctor",
    description: "Diagnose local harness installation, path, version, auth, and model readiness",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { doctorCommand } = await import("./commands/doctor.js");
      await doctorCommand(config, { json: args.includes("--json") });
    },
  },
  {
    id: "memory",
    description: "Browse and search memory layers",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { memoryCommand } = await import("./commands/memory.js");
      await memoryCommand(config, args[1] ?? "", args.slice(2));
    },
  },
  {
    id: "config",
    description: "Inspect global authority and edit admitted project restrictions",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { configCommand } = await import("./commands/config.js");
      await configCommand(config, args[1] ?? "", args.slice(2));
    },
  },
  {
    id: "mcp-config",
    description: "Synchronize canonical MCP servers into governed native harness projections",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { mcpConfigCommand, printMcpConfigHelp } = await import("./commands/mcp-config.js");
      if (args.includes("--help") || args.includes("-h")) {
        printMcpConfigHelp(APP_NAME);
        process.exit(0);
      }
      await mcpConfigCommand(config, parseMcpConfigFlags(args.slice(1)));
    },
  },
  {
    id: "native-harness",
    description: "Run an internal native-harness adapter",
    owner: "cli",
    composition: "none",
    handler: async ({ args }) => {
      const { nativeHarnessCommand } = await import("./commands/native-harness.js");
      await nativeHarnessCommand(args.slice(1));
    },
  },
  {
    id: "operator-runtime",
    description: "Run or inspect the machine-global operator runtime",
    owner: "cli",
    composition: "none",
    handler: async ({ args }) => {
      const { operatorRuntimeCommand } = await import("./commands/operator-runtime.js");
      await operatorRuntimeCommand(args.slice(1));
    },
  },
  {
    id: "domain",
    description: "Manage domain packages (install, list, search, info, remove)",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { domainCommand } = await import("./commands/domain.js");
      await domainCommand(config, args[1] ?? "", args.slice(2));
    },
  },
  {
    id: "gateway",
    description: "Start persistent Gateway (multi-app hosting)",
    owner: "cli",
    composition: "none",
    handler: async ({ args }) => {
      const { gatewayCommand } = await import("./commands/gateway.js");
      await gatewayCommand(args.slice(1));
    },
  },
  {
    id: "model-gateway",
    description: "Run or inspect the dedicated loopback model gateway",
    owner: "cli",
    composition: "none",
    handler: async ({ args }) => {
      const { modelGatewayCommand } = await import("./commands/model-gateway.js");
      await modelGatewayCommand(args.slice(1));
    },
  },
  {
    id: "dev",
    description: "Start the App Gateway for local development (--open)",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { devCommand } = await import("./commands/dev.js");
      await devCommand(config, {
        port: parsePort(args, 4800),
        configPath: findFlag(args, "--config"),
        open: args.includes("--open"),
      });
    },
  },
  {
    id: "gui",
    description: "Start the GUI operator surface or attach to an App Gateway",
    owner: "cli",
    composition: "filesystem-domain-registry",
    handler: async ({ config, args }) => {
      const { guiCommand } = await import("./commands/gui.js");
      const mode = parseGuiMode(args);
      if (!mode.ok) {
        console.error(mode.error);
        process.exit(1);
      }
      await guiCommand(config, {
        port: parsePort(args, 4810),
        guiPort: parsePortForFlag(args, "--gui-port", 5183),
        mode: mode.value,
        cwd: findFlag(args, "--cwd"),
        connect: findFlag(args, "--connect"),
        open: parseOpenFlag(args),
        theme: findFlag(args, "--theme"),
        plan: args.includes("--plan"),
      });
    },
  },
  {
    id: "goal",
    description: "Open governed goal and work-item controls.",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { goalCommand } = await import("./commands/goal.js");
      await goalCommand(config, args[1], args.slice(2));
    },
  },
  {
    id: "managed-agent",
    description: "Inspect managed child invocations from canonical session transcripts",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { managedAgentCommand } = await import("./commands/managed-agent.js");
      await managedAgentCommand(config, args[1], args.slice(2));
    },
  },
  {
    id: "feedback",
    description: "Create local-only redacted session feedback bundles and issue drafts",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { feedbackCommand } = await import("./commands/feedback.js");
      await feedbackCommand(config, args[1], args.slice(2));
    },
  },
  {
    id: "benchmark",
    description: "Inspect benchmark-facing profiles, external tracks, and readiness baselines",
    owner: "cli",
    composition: "filesystem-domain-registry",
    handler: async ({ config, args }) => {
      const { benchmarkCommand } = await import("./commands/benchmark.js");
      await benchmarkCommand(config, args[1], args.slice(2));
      process.exit(0);
    },
  },
  {
    id: "external-engagement",
    description: "Inspect and report governed external evidence sources",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { externalEngagementCommand } = await import("./commands/external-engagement.js");
      await externalEngagementCommand(config, args[1], args.slice(2));
    },
  },
  {
    id: "skill",
    description: "Manage skills (list, install, publish)",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { skillCommand } = await import("./commands/skill.js");
      await skillCommand(config, args[1] ?? "", args.slice(2));
    },
  },
  {
    id: "auth",
    description: "Authenticate subscription-backed providers (codex login/status/logout)",
    owner: "cli",
    composition: "none",
    handler: async ({ args }) => {
      const { runAuth } = await import("./commands/auth.js");
      const { resolveKilnHomePath } = await import("./config/global-config/path.js");
      await runAuth(args.slice(1), { kilnHome: resolveKilnHomePath() });
    },
  },
  {
    id: "trust",
    description: "Explicitly accept or revoke a documented native-harness limitation",
    owner: "cli",
    composition: "none",
    handler: async ({ args }) => {
      const { trustCommand } = await import("./commands/trust.js");
      await trustCommand(args.slice(1));
    },
  },
  {
    id: "cron",
    description: "Manage scheduled jobs (list, add, remove, run)",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { cronCommand } = await import("./commands/cron.js");
      await cronCommand(config, undefined, args.slice(1));
    },
  },
  {
    id: "sync",
    description: "Preview or sync explicit native projection targets (--target, --all, --dry-run)",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { printSyncHelp, syncCommand } = await import("./commands/sync.js");
      if (args.includes("--help") || args.includes("-h")) {
        printSyncHelp(APP_NAME);
        process.exit(0);
      }
      await syncCommand(config, undefined, args.slice(1));
    },
  },
  {
    id: "target",
    description: "List, select, create, or inspect execution targets",
    owner: "cli",
    composition: "none",
    handler: async ({ args }) => {
      const { targetCommand } = await import("./commands/target.js");
      await targetCommand(args.slice(1));
    },
  },
  {
    id: "import-native",
    description: "Import supported native engine config into Kiln global config (codex, opencode)",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { importNativeCommand } = await import("./commands/import-native.js");
      await importNativeCommand(config, args[1], args.slice(2));
    },
  },
  {
    id: "uninstall",
    description: "Remove Kiln-managed native projections without deleting unmanaged native settings",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
      const { uninstallCommand } = await import("./commands/uninstall.js");
      await uninstallCommand(config, args[1], args.slice(2));
    },
  },
  {
    id: "tools",
    description: "Launch native dev tools MCP server over stdio and inspect shared resources (--mcp, --resources, --resource <uri>)",
    owner: "cli",
    composition: "none",
    handler: async ({ config, args }) => {
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
    },
  },
  {
    id: "tui",
    description: "Interactive terminal chat (TUI mode)",
    owner: "cli",
    composition: "filesystem-domain-registry",
    handler: async ({ config, args }) => {
      const { tuiCommand } = await import("./commands/tui.js");
      const portIdx = args.indexOf("--port");
      const port = portIdx >= 0 && portIdx + 1 < args.length ? parseInt(args[portIdx + 1]!, 10) : undefined;
      await tuiCommand(config, {
        cwd: findFlag(args, "--cwd"),
        port: !Number.isNaN(port!) && port! > 0 ? port : undefined,
        theme: findFlag(args, "--theme"),
      });
    },
  },
] as const satisfies readonly CliCommandDefinition[];

const CLI_COMMAND_IDS = new Set(CLI_COMMANDS.map((command) => command.id));
if (CLI_COMMAND_IDS.size !== CLI_COMMANDS.length) {
  throw new Error("CLI command registry contains duplicate command ids.");
}

export function resolveCliCommand(command: string): CliCommandDefinition | undefined {
  return CLI_COMMANDS.find((candidate) => candidate.id === command);
}

export async function createCli(
  config: KilnAppConfig,
  argv: readonly string[] = process.argv.slice(2),
  composition: CliExecutionComposition = {},
): Promise<void> {
  const command = argv[0];
  if (command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }
  if (command === "--version" || command === "-v") {
    console.log(`${APP_NAME} ${VERSION}`);
    process.exit(0);
  }

  const selectedCommand = command
    ? resolveCliCommand(command)
    : resolveCliCommand(process.stdout.isTTY ? "tui" : "dev");
  if (!selectedCommand) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  const selectedConfig = selectedCommand.composition === "filesystem-domain-registry"
    && composition.composeRegistry
    ? { ...config, createRegistry: await composition.composeRegistry() }
    : config;
  await selectedCommand.handler({ config: selectedConfig, args: argv });
}

function printHelp(): void {
  console.log(`\n${capitalize(APP_NAME)} -- ${DESCRIPTION}\n`);
  console.log(`Usage: ${APP_NAME} [command] [options]\n`);
  console.log("Commands:");
  for (const command of CLI_COMMANDS) {
    console.log(`  ${command.id.padEnd(12)} ${command.description}`);
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
  console.log("  --mcp        Start tools command in MCP stdio mode");
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

function findFlag(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  if (hasDevFlag) return { ok: true, value: "dev" };
  if (hasProdFlag) return { ok: true, value: "prod" };
  return { ok: true, value: undefined };
}

function parseOpenFlag(args: readonly string[]): boolean {
  if (args.includes("--no-open")) return false;
  if (args.includes("--open")) return true;
  return true;
}

function parseRunArgs(
  rawArgs: readonly string[],
  parseDeliberationLevel: ParseDeliberationLevel,
  parseRunOutputMode: ParseRunOutputMode,
): { task: string; flags: RunArgFlags } {
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
      const workers = Number(rawArgs[i + 1]);
      if (!Number.isNaN(workers) && workers > 0) flags.workers = workers;
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
