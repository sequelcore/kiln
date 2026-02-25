import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "./init.js";
import { initCommand } from "./init.js";
import type { KilnAppConfig } from "../config.js";

const VALID_KEYS: ReadonlySet<keyof ProjectConfig> = new Set([
  "domain",
  "requireApproval",
  "maxDepth",
  "parallelWorkers",
  "provider",
  "mode",
  "channels",
  "teamMode",
]);

export function configCommand(
  appConfig: KilnAppConfig,
  subcommand: string,
  args: string[],
  projectPath?: string,
): void {
  const root = projectPath ?? process.cwd();
  const configPath = join(root, appConfig.dirName, "config.json");

  if (!subcommand) {
    printConfigHelp(appConfig);
    return;
  }

  if (subcommand !== "reset" && !existsSync(configPath)) {
    console.log(`Not initialized. Run '${appConfig.appName} init' first.`);
    return;
  }

  switch (subcommand) {
    case "show": {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as ProjectConfig;
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

      if (!VALID_KEYS.has(key as keyof ProjectConfig)) {
        console.log(`Unknown config key: ${key}`);
        console.log(`Valid keys: ${[...VALID_KEYS].join(", ")}`);
        return;
      }

      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;

      config[key] = parseValue(value, key);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log(`Set ${key} = ${String(config[key])}`);
      break;
    }

    case "reset": {
      if (existsSync(configPath)) {
        rmSync(configPath);
      }
      initCommand(appConfig, root, { force: true });
      break;
    }

    default:
      console.log(`Unknown config subcommand: ${subcommand}`);
      printConfigHelp(appConfig);
  }
}

function parseValue(value: string, key: string): string | number | boolean | string[] {
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
