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
  | "permissions.sandbox";

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
]);

export function configCommand(
  appConfig: KilnAppConfig,
  subcommand: string,
  args: string[],
  projectPath?: string,
): void {
  const root = projectPath ?? process.cwd();
  const kilnDir = join(root, appConfig.dirName);

  if (!subcommand) {
    printConfigHelp(appConfig);
    return;
  }

  if (subcommand !== "reset") {
    const config = readKilnYaml(kilnDir);
    if (!config) {
      console.log(`Not initialized. Run '${appConfig.appName} init' first.`);
      return;
    }
  }

  switch (subcommand) {
    case "show": {
      const config = readKilnYaml(kilnDir);
      if (!config) {
        console.log(`Not initialized. Run '${appConfig.appName} init' first.`);
        return;
      }
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    case "set": {
      const key = args[0];
      const value = args[1];

      if (!key || value === undefined) {
        console.log(`Usage: ${appConfig.appName} config set <key> <value>`);
        return;
      }

      if (!VALID_KEYS.has(key as KilnYamlKey)) {
        console.log(`Unknown config key: ${key}`);
        console.log(`Valid keys: ${[...VALID_KEYS].join(", ")}`);
        return;
      }

      const config = readKilnYaml(kilnDir);
      if (!config) {
        console.log(`Not initialized. Run '${appConfig.appName} init' first.`);
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
      printConfigHelp(appConfig);
  }
}

function setNestedKey(config: KilnYaml, key: KilnYamlKey, rawValue: string): KilnYaml {
  if (key === "permissions.approval") {
    const val = rawValue as "auto-approve" | "ask" | "deny";
    if (val !== "auto-approve" && val !== "ask" && val !== "deny") {
      console.error(`Invalid approval value: ${rawValue}. Must be auto-approve, ask, or deny.`);
      process.exit(1);
    }
    return {
      ...config,
      permissions: { ...(config.permissions ?? { sandbox: "none" }), approval: val },
    };
  }

  if (key === "permissions.sandbox") {
    const val = rawValue as "none" | "workspace-write" | "full";
    if (val !== "none" && val !== "workspace-write" && val !== "full") {
      console.error(`Invalid sandbox value: ${rawValue}. Must be none, workspace-write, or full.`);
      process.exit(1);
    }
    return {
      ...config,
      permissions: { ...(config.permissions ?? { approval: "ask" }), sandbox: val },
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

function printConfigHelp(appConfig: KilnAppConfig): void {
  console.log(`\nUsage: ${appConfig.appName} config <subcommand>\n`);
  console.log("Subcommands:");
  console.log("  show              Print current config");
  console.log("  set <key> <value> Update a config value");
  console.log("  reset             Reset config to defaults");
  console.log(`\nValid keys: ${[...VALID_KEYS].join(", ")}`);
  console.log("");
}
