import { join } from "node:path";
import {
  readKilnYaml,
  writeKilnYaml,
  defaultKilnYaml,
  type KilnYaml,
} from "../kiln-yaml.js";
import type { KilnAppConfig } from "../config.js";

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
  | "permissions.agentScopes";

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
]);

export function configCommand(
  _appConfig: KilnAppConfig,
  subcommand: string,
  args: string[],
  projectPath?: string,
): void {
  const root = projectPath ?? process.cwd();
  const kilnDir = join(root, ".kiln");

  if (!subcommand) {
    printConfigHelp();
    return;
  }

  if (subcommand !== "reset") {
    const config = readKilnYaml(kilnDir);
    if (!config) {
      console.log(`Not initialized. Run 'kiln init' first.`);
      return;
    }
  }

  switch (subcommand) {
    case "show": {
      const config = readKilnYaml(kilnDir);
      if (!config) {
        console.log(`Not initialized. Run 'kiln init' first.`);
        return;
      }
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    case "set": {
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

      const config = readKilnYaml(kilnDir);
      if (!config) {
        console.log(`Not initialized. Run 'kiln init' first.`);
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
  console.log("  set <key> <value> Update a config value");
  console.log("  reset             Reset config to defaults");
  console.log(`\nValid keys: ${[...VALID_KEYS].join(", ")}`);
  console.log("");
}
