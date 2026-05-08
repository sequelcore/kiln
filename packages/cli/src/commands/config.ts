import { join } from "node:path";
import {
  readKilnYaml,
  writeKilnYaml,
  defaultKilnYaml,
  type KilnYaml,
} from "../kiln-yaml.js";
import type { KilnAppConfig } from "../config.js";
import {
  isConfigReadView,
  readConfigStatusSnapshot,
  readConfigStatusView,
} from "../application/config-status.js";
import { approveConfigChangeProposal } from "../application/config-approval.js";

type KilnYamlKey =
  | "domain"
  | "provider"
  | "channels"
  | "teamMode"
  | "requireApproval"
  | "maxDepth"
  | "parallelWorkers"
  | "mode"
  | "permissions.approval"
  | "permissions.sandbox"
  | "permissions.safeDefaults"
  | "permissions.auditLog"
  | "permissions.tools"
  | "permissions.commands"
  | "permissions.fileGovernance"
  | "permissions.dataFirewall"
  | "permissions.agentScopes"
  | "interactiveUse.enabled"
  | "interactiveUse.allowedDomains"
  | "interactiveUse.allowedApplications"
  | "interactiveUse.allowExternalBrowser"
  | "interactiveUse.allowComputer"
  | "interactiveUse.browserProvider"
  | "interactiveUse.computerProvider"
  | "interactiveUse.browserEnvironment"
  | "interactiveUse.computerEnvironment";

const VALID_KEYS: ReadonlySet<KilnYamlKey> = new Set([
  "domain",
  "provider",
  "channels",
  "teamMode",
  "requireApproval",
  "maxDepth",
  "parallelWorkers",
  "mode",
  "permissions.approval",
  "permissions.sandbox",
  "permissions.safeDefaults",
  "permissions.auditLog",
  "permissions.tools",
  "permissions.commands",
  "permissions.fileGovernance",
  "permissions.dataFirewall",
  "permissions.agentScopes",
  "interactiveUse.enabled",
  "interactiveUse.allowedDomains",
  "interactiveUse.allowedApplications",
  "interactiveUse.allowExternalBrowser",
  "interactiveUse.allowComputer",
  "interactiveUse.browserProvider",
  "interactiveUse.computerProvider",
  "interactiveUse.browserEnvironment",
  "interactiveUse.computerEnvironment",
]);

export async function configCommand(
  _appConfig: KilnAppConfig,
  subcommand: string,
  args: string[],
  projectPath?: string,
): Promise<void> {
  const root = projectPath ?? readProjectFlag(args) ?? process.cwd();
  const kilnDir = join(root, ".kiln");

  if (!subcommand) {
    printConfigHelp();
    return;
  }

  switch (subcommand) {
    case "show": {
      const snapshot = await readConfigStatusSnapshot({ projectPath: root });
      if (!snapshot.effectiveConfig) {
        console.log(`Not initialized. Run 'kiln init' first.`);
        return;
      }
      console.log(JSON.stringify(snapshot.effectiveConfig, null, 2));
      break;
    }

    case "read": {
      const viewArg = readPositionalArgs(args)[0] ?? "effective";
      if (!isConfigReadView(viewArg)) {
        console.log(`Unknown config read view: ${viewArg}`);
        console.log("Valid views: effective, providers, routes, agents, skills, permissions, memory, projections, setup, health");
        return;
      }
      const snapshot = await readConfigStatusSnapshot({ projectPath: root });
      const result = await readConfigStatusView(snapshot, viewArg);
      console.log(JSON.stringify(result.value, null, 2));
      break;
    }

    case "approve": {
      const proposalId = readPositionalArgs(args)[0];
      if (!proposalId) {
        console.log("Usage: kiln config approve <proposalId>");
        return;
      }
      try {
        const approval = approveConfigChangeProposal({
          projectPath: root,
          proposalId,
          approvedBy: process.env.USERNAME ?? process.env.USER ?? "operator",
          surface: "cli",
        });
        console.log(JSON.stringify(approval, null, 2));
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      break;
    }

    case "set": {
      const config = readKilnYaml(kilnDir);
      if (!config) {
        console.log(`Not initialized. Run 'kiln init' first.`);
        return;
      }
      const key = args[0];
      const value = args[1];

      if (!key || value === undefined) {
        console.log(`Usage: kiln config set <key> <value>`);
        return;
      }

      if (!VALID_KEYS.has(key as KilnYamlKey)) {
        console.log(`Unknown config key: ${key}`);
        console.log(`Valid keys: ${[...VALID_KEYS].join(", ")}`);
        return;
      }

      const updated = setNestedKey(config, key as KilnYamlKey, value);
      writeKilnYaml(kilnDir, updated);

      const displayVal = getNestedKey(updated, key as KilnYamlKey);
      console.log(`Set ${key} = ${String(displayVal)}`);
      break;
    }

    case "reset": {
      writeKilnYaml(kilnDir, defaultKilnYaml("generic"));
      console.log("Config reset to defaults.");
      break;
    }

    default:
      console.log(`Unknown config subcommand: ${subcommand}`);
      printConfigHelp();
  }
}

function setNestedKey(config: KilnYaml, key: KilnYamlKey, rawValue: string): KilnYaml {
  if (key === "permissions.approval") {
    const val = rawValue as "never" | "on-request" | "on-failure" | "untrusted";
    if (val !== "never" && val !== "on-request" && val !== "on-failure" && val !== "untrusted") {
      console.error(`Invalid approval value: ${rawValue}. Must be never, on-request, on-failure, or untrusted.`);
      process.exit(1);
    }
    return {
      ...config,
      permissions: { ...(config.permissions ?? { sandbox: "read-only" }), approval: val },
    };
  }

  if (key === "permissions.sandbox") {
    const val = rawValue as "read-only" | "workspace-write" | "danger-full-access";
    if (val !== "read-only" && val !== "workspace-write" && val !== "danger-full-access") {
      console.error(`Invalid sandbox value: ${rawValue}. Must be read-only, workspace-write, or danger-full-access.`);
      process.exit(1);
    }
    return {
      ...config,
      permissions: { ...(config.permissions ?? { approval: "on-request" }), sandbox: val },
    };
  }

  if (key === "permissions.safeDefaults" || key === "permissions.auditLog") {
    return {
      ...config,
      permissions: {
        ...(config.permissions ?? {}),
        [key === "permissions.safeDefaults" ? "safeDefaults" : "auditLog"]: parseBoolean(rawValue, key),
      },
    };
  }

  if (
    key === "permissions.tools" ||
    key === "permissions.commands" ||
    key === "permissions.fileGovernance" ||
    key === "permissions.dataFirewall" ||
    key === "permissions.agentScopes"
  ) {
    return {
      ...config,
      permissions: {
        ...(config.permissions ?? {}),
        [key.slice("permissions.".length)]: parseJson(rawValue, key),
      },
    };
  }

  if (key.startsWith("interactiveUse.")) {
    return setInteractiveUseKey(config, key, rawValue);
  }

  return {
    ...config,
    [key]: parseScalar(rawValue, key),
  };
}

function getNestedKey(config: KilnYaml, key: KilnYamlKey): unknown {
  if (key === "permissions.approval") return config.permissions?.approval;
  if (key === "permissions.sandbox") return config.permissions?.sandbox;
  if (key === "permissions.safeDefaults") return config.permissions?.safeDefaults;
  if (key === "permissions.auditLog") return config.permissions?.auditLog;
  if (key === "permissions.tools") return config.permissions?.tools;
  if (key === "permissions.commands") return config.permissions?.commands;
  if (key === "permissions.fileGovernance") return config.permissions?.fileGovernance;
  if (key === "permissions.dataFirewall") return config.permissions?.dataFirewall;
  if (key === "permissions.agentScopes") return config.permissions?.agentScopes;
  if (key === "interactiveUse.enabled") return config.interactiveUse?.enabled;
  if (key === "interactiveUse.allowedDomains") return config.interactiveUse?.allowedDomains;
  if (key === "interactiveUse.allowedApplications") return config.interactiveUse?.allowedApplications;
  if (key === "interactiveUse.allowExternalBrowser") return config.interactiveUse?.allowExternalBrowser;
  if (key === "interactiveUse.allowComputer") return config.interactiveUse?.allowComputer;
  if (key === "interactiveUse.browserProvider") return config.interactiveUse?.browserProvider;
  if (key === "interactiveUse.computerProvider") return config.interactiveUse?.computerProvider;
  if (key === "interactiveUse.browserEnvironment") return config.interactiveUse?.browserEnvironment;
  if (key === "interactiveUse.computerEnvironment") return config.interactiveUse?.computerEnvironment;
  switch (key) {
    case "domain": return config.domain;
    case "provider": return config.provider;
    case "channels": return config.channels;
    case "teamMode": return config.teamMode;
    case "requireApproval": return config.requireApproval;
    case "maxDepth": return config.maxDepth;
    case "parallelWorkers": return config.parallelWorkers;
    case "mode": return config.mode;
    default: return undefined;
  }
}

function parseScalar(value: string, key: KilnYamlKey): string | number | boolean | string[] {
  if (value === "true") return true;
  if (value === "false") return false;

  if (key === "maxDepth" || key === "parallelWorkers") {
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
  }

  if (key === "channels") {
    return value.split(",").map((c) => c.trim()).filter(Boolean);
  }

  return value;
}

function setInteractiveUseKey(config: KilnYaml, key: KilnYamlKey, rawValue: string): KilnYaml {
  const interactiveUse = config.interactiveUse ?? {};
  if (key === "interactiveUse.enabled") {
    return { ...config, interactiveUse: { ...interactiveUse, enabled: parseBoolean(rawValue, key) } };
  }
  if (key === "interactiveUse.allowedDomains") {
    return { ...config, interactiveUse: { ...interactiveUse, allowedDomains: parseStringList(rawValue) } };
  }
  if (key === "interactiveUse.allowedApplications") {
    return { ...config, interactiveUse: { ...interactiveUse, allowedApplications: parseStringList(rawValue) } };
  }
  if (key === "interactiveUse.allowExternalBrowser") {
    return { ...config, interactiveUse: { ...interactiveUse, allowExternalBrowser: parseBoolean(rawValue, key) } };
  }
  if (key === "interactiveUse.allowComputer") {
    return { ...config, interactiveUse: { ...interactiveUse, allowComputer: parseBoolean(rawValue, key) } };
  }
  if (key === "interactiveUse.browserProvider") {
    if (rawValue !== "none" && rawValue !== "playwright") {
      console.error(`Invalid browser provider: ${rawValue}. Must be none or playwright.`);
      process.exit(1);
    }
    return { ...config, interactiveUse: { ...interactiveUse, browserProvider: rawValue } };
  }
  if (key === "interactiveUse.computerProvider") {
    if (rawValue !== "none" && rawValue !== "windows" && rawValue !== "windows-uia") {
      console.error(`Invalid computer provider: ${rawValue}. Must be none, windows, or windows-uia.`);
      process.exit(1);
    }
    return { ...config, interactiveUse: { ...interactiveUse, computerProvider: rawValue } };
  }
  if (key === "interactiveUse.browserEnvironment") {
    if (rawValue !== "isolated-headless" && rawValue !== "isolated-headed") {
      console.error(`Invalid browser environment: ${rawValue}. Must be isolated-headless or isolated-headed.`);
      process.exit(1);
    }
    return { ...config, interactiveUse: { ...interactiveUse, browserEnvironment: rawValue } };
  }
  if (key === "interactiveUse.computerEnvironment") {
    if (rawValue !== "local-active-desktop") {
      console.error(`Invalid computer environment: ${rawValue}. Must be local-active-desktop.`);
      process.exit(1);
    }
    return { ...config, interactiveUse: { ...interactiveUse, computerEnvironment: rawValue } };
  }
  return config;
}

function parseStringList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseBoolean(value: string, key: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  console.error(`Invalid boolean value for ${key}: ${value}. Must be true or false.`);
  process.exit(1);
}

function parseJson(value: string, key: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(
      `Invalid JSON value for ${key}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

function printConfigHelp(): void {
  console.log(`\nUsage: kiln config <subcommand>\n`);
  console.log("Subcommands:");
  console.log("  show              Print current config");
  console.log("  read [view]       Print canonical config/status view as JSON");
  console.log("  approve <id>      Approve a stored config proposal for kiln_config.apply_change");
  console.log("  set <key> <value> Update a config value");
  console.log("  reset             Reset config to defaults");
  console.log("\nRead views: effective, providers, routes, agents, skills, permissions, memory, projections, setup, health");
  console.log(`\nValid keys: ${[...VALID_KEYS].join(", ")}`);
  console.log("");
}

function readProjectFlag(args: readonly string[]): string | undefined {
  const index = args.findIndex((arg) => arg === "--project" || arg === "--cwd");
  if (index >= 0) {
    return args[index + 1];
  }
  const inline = args.find((arg) => arg.startsWith("--project=") || arg.startsWith("--cwd="));
  return inline?.slice(inline.indexOf("=") + 1);
}

function readPositionalArgs(args: readonly string[]): readonly string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--project" || arg === "--cwd") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--project=") || arg.startsWith("--cwd=")) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
  }
  return positionals;
}
