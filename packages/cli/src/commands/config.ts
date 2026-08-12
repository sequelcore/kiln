import { join } from "node:path";
import {
  readKilnYaml,
  writeKilnYaml,
  defaultKilnYaml,
  type KilnYaml,
} from "../kiln-yaml.js";
import type { KilnWorkGovernanceConfig } from "../kiln-yaml-types.js";
import type { KilnAppConfig } from "../config.js";
import {
  isConfigReadView,
  readConfigStatusSnapshot,
  readConfigStatusView,
} from "../application/config-status.js";
import { executeConfigSetupAction } from "../application/config-setup-actions.js";
import { approveConfigChangeProposal } from "../application/config-approval.js";
import {
  KILN_CONFIG_SETUP_ACTIONS,
  type KilnConfigSetupAction,
  type KilnConfigSetupActionResult,
  type KilnConfigSetupSnapshot,
} from "@kilnai/gateway-contracts";
import {
  defaultGlobalConfig,
  mutateGlobalConfig,
  type KilnGlobalConfig,
  type KilnGlobalIdentity,
} from "../config/global-config.js";

type KilnYamlKey =
  | "identity.name"
  | "identity.timezone"
  | "activeInstructionProfiles"
  | "workGovernance.defaultPosture"
  | "workGovernance.directExecution.maxFiles"
  | "workGovernance.directExecution.maxRisk"
  | "workGovernance.requireDelegationFor"
  | "workGovernance.requiredEvidence"
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
  | "interactiveUse.applicationAliases"
  | "interactiveUse.allowExternalBrowser"
  | "interactiveUse.allowComputer"
  | "interactiveUse.browserProvider"
  | "interactiveUse.computerProvider"
  | "interactiveUse.browserEnvironment"
  | "interactiveUse.computerEnvironment"
  | "skills.selection.mode";

const VALID_KEYS: ReadonlySet<KilnYamlKey> = new Set([
  "identity.name",
  "identity.timezone",
  "activeInstructionProfiles",
  "workGovernance.defaultPosture",
  "workGovernance.directExecution.maxFiles",
  "workGovernance.directExecution.maxRisk",
  "workGovernance.requireDelegationFor",
  "workGovernance.requiredEvidence",
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
  "interactiveUse.applicationAliases",
  "interactiveUse.allowExternalBrowser",
  "interactiveUse.allowComputer",
  "interactiveUse.browserProvider",
  "interactiveUse.computerProvider",
  "interactiveUse.browserEnvironment",
  "interactiveUse.computerEnvironment",
  "skills.selection.mode",
]);

function isValidConfigKey(key: string): key is KilnYamlKey {
  return VALID_KEYS.has(key as KilnYamlKey);
}

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
      const snapshot = await readConfigStatusSnapshot({ projectPath: root, view: "effective" });
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
      const snapshot = await readConfigStatusSnapshot({ projectPath: root, view: viewArg });
      const result = await readConfigStatusView(snapshot, viewArg);
      console.log(JSON.stringify(result.value, null, 2));
      break;
    }

    case "setup": {
      const setup = await runConfigSetupCommand(root, args);
      console.log(JSON.stringify(setup, null, 2));
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
      const positionals = readPositionalArgs(args);
      const key = positionals[0];
      const value = positionals[1];

      if (!key || value === undefined) {
        console.log(`Usage: kiln config set [--global] <key> <value>`);
        return;
      }

      if (!isValidConfigKey(key)) {
        console.log(`Unknown config key: ${key}`);
        console.log(`Valid keys: ${[...VALID_KEYS].join(", ")}`);
        return;
      }

      const scopedKey = key as KilnYamlKey;
      const projectConfig = hasGlobalFlag(args) ? undefined : readKilnYaml(kilnDir);
      if (!hasGlobalFlag(args) && !projectConfig) {
        console.log(`Not initialized. Run 'kiln init' first.`);
        return;
      }
      let updated: KilnGlobalConfig | KilnYaml;
      if (hasGlobalFlag(args)) {
        updated = mutateGlobalConfig((current) =>
          setGlobalNestedKey(current ?? defaultGlobalConfig(), scopedKey, value) as KilnGlobalConfig
        ).config;
      } else {
        updated = setProjectNestedKey(projectConfig!, scopedKey, value);
        writeKilnYaml(kilnDir, updated as KilnYaml);
      }

      const displayVal = getNestedKey(updated, scopedKey);
      console.log(`Set ${key} = ${String(displayVal)}`);
      break;
    }

    case "reset": {
      if (hasGlobalFlag(args)) {
        const result = mutateGlobalConfig(
          () => defaultGlobalConfig(),
          { invalidCurrent: "backup-and-replace" },
        );
        console.log("Global config reset to V2 defaults.");
        if (result.invalidBackupPath) {
          console.log(`Previous invalid config backed up to ${result.invalidBackupPath}`);
        }
        break;
      }
      writeKilnYaml(kilnDir, defaultKilnYaml("generic"));
      console.log("Config reset to defaults.");
      break;
    }

    default:
      console.log(`Unknown config subcommand: ${subcommand}`);
      printConfigHelp();
  }
}

function setProjectNestedKey(config: KilnYaml, key: KilnYamlKey, rawValue: string): KilnYaml {
  if (key.startsWith("identity.")) {
    console.error(`Config key ${key} is global-only. Use 'kiln config set --global ${key} <value>'.`);
    process.exit(1);
  }
  if (key === "activeInstructionProfiles") {
    return {
      ...config,
      activeInstructionProfiles: parseStringList(rawValue),
    };
  }
  const governed = setGovernanceOrSkillKey(config, key, rawValue);
  if (governed) {
    return governed;
  }
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

function setGlobalNestedKey(config: KilnGlobalConfig, key: KilnYamlKey, rawValue: string): KilnGlobalConfig {
  if (key === "identity.name" || key === "identity.timezone") {
    const identityKey = key.slice("identity.".length) as keyof KilnGlobalIdentity;
    return {
      ...config,
      identity: {
        ...(config.identity ?? {}),
        [identityKey]: rawValue,
      },
    };
  }
  if (key === "activeInstructionProfiles") {
    return {
      ...config,
      activeInstructionProfiles: parseStringList(rawValue),
    };
  }
  const governed = setGovernanceOrSkillKey(config, key, rawValue);
  if (governed) {
    return governed;
  }
  console.error(`Config key ${key} is project-only. Omit --global to set it in .kiln/kiln.yaml.`);
  process.exit(1);
}

function setGovernanceOrSkillKey<T extends {
  readonly workGovernance?: KilnWorkGovernanceConfig;
  readonly skills?: KilnYaml["skills"];
}>(
  config: T,
  key: KilnYamlKey,
  rawValue: string,
): T | undefined {
  if (key === "workGovernance.defaultPosture") {
    if (rawValue !== "orchestrate" && rawValue !== "direct") {
      console.error(`Invalid work governance posture: ${rawValue}. Must be orchestrate or direct.`);
      process.exit(1);
    }
    return {
      ...config,
      workGovernance: {
        ...(config.workGovernance ?? {}),
        defaultPosture: rawValue,
      },
    };
  }
  if (key === "workGovernance.directExecution.maxFiles") {
    return {
      ...config,
      workGovernance: {
        ...(config.workGovernance ?? {}),
        directExecution: {
          ...(config.workGovernance?.directExecution ?? {}),
          maxFiles: parsePositiveInteger(rawValue, key),
        },
      },
    };
  }
  if (key === "workGovernance.directExecution.maxRisk") {
    if (rawValue !== "low" && rawValue !== "medium" && rawValue !== "high") {
      console.error(`Invalid direct execution risk: ${rawValue}. Must be low, medium, or high.`);
      process.exit(1);
    }
    return {
      ...config,
      workGovernance: {
        ...(config.workGovernance ?? {}),
        directExecution: {
          ...(config.workGovernance?.directExecution ?? {}),
          maxRisk: rawValue,
        },
      },
    };
  }
  if (key === "workGovernance.requireDelegationFor") {
    return {
      ...config,
      workGovernance: {
        ...(config.workGovernance ?? {}),
        requireDelegationFor: parseStringList(rawValue) as NonNullable<KilnWorkGovernanceConfig["requireDelegationFor"]>,
      },
    };
  }
  if (key === "workGovernance.requiredEvidence") {
    return {
      ...config,
      workGovernance: {
        ...(config.workGovernance ?? {}),
        requiredEvidence: parseStringList(rawValue) as NonNullable<KilnWorkGovernanceConfig["requiredEvidence"]>,
      },
    };
  }
  if (key === "skills.selection.mode") {
    if (rawValue !== "advisory" && rawValue !== "auto") {
      console.error(`Invalid skill selection mode: ${rawValue}. Must be advisory or auto.`);
      process.exit(1);
    }
    return {
      ...config,
      skills: {
        ...(config.skills ?? {}),
        selection: {
          ...(config.skills?.selection ?? {}),
          mode: rawValue,
        },
      },
    };
  }
  return undefined;
}

function getNestedKey(config: KilnYaml | KilnGlobalConfig, key: KilnYamlKey): unknown {
  if (key === "identity.name") return (config as KilnGlobalConfig).identity?.name;
  if (key === "identity.timezone") return (config as KilnGlobalConfig).identity?.timezone;
  if (key === "activeInstructionProfiles") return config.activeInstructionProfiles;
  if (key === "workGovernance.defaultPosture") return config.workGovernance?.defaultPosture;
  if (key === "workGovernance.directExecution.maxFiles") return config.workGovernance?.directExecution?.maxFiles;
  if (key === "workGovernance.directExecution.maxRisk") return config.workGovernance?.directExecution?.maxRisk;
  if (key === "workGovernance.requireDelegationFor") return config.workGovernance?.requireDelegationFor;
  if (key === "workGovernance.requiredEvidence") return config.workGovernance?.requiredEvidence;
  if (key === "skills.selection.mode") return config.skills?.selection?.mode;
  const projectConfig = config as KilnYaml;
  if (key === "permissions.approval") return projectConfig.permissions?.approval;
  if (key === "permissions.sandbox") return projectConfig.permissions?.sandbox;
  if (key === "permissions.safeDefaults") return projectConfig.permissions?.safeDefaults;
  if (key === "permissions.auditLog") return projectConfig.permissions?.auditLog;
  if (key === "permissions.tools") return projectConfig.permissions?.tools;
  if (key === "permissions.commands") return projectConfig.permissions?.commands;
  if (key === "permissions.fileGovernance") return projectConfig.permissions?.fileGovernance;
  if (key === "permissions.dataFirewall") return projectConfig.permissions?.dataFirewall;
  if (key === "permissions.agentScopes") return projectConfig.permissions?.agentScopes;
  if (key === "interactiveUse.enabled") return projectConfig.interactiveUse?.enabled;
  if (key === "interactiveUse.allowedDomains") return projectConfig.interactiveUse?.allowedDomains;
  if (key === "interactiveUse.allowedApplications") return projectConfig.interactiveUse?.allowedApplications;
  if (key === "interactiveUse.applicationAliases") return projectConfig.interactiveUse?.applicationAliases;
  if (key === "interactiveUse.allowExternalBrowser") return projectConfig.interactiveUse?.allowExternalBrowser;
  if (key === "interactiveUse.allowComputer") return projectConfig.interactiveUse?.allowComputer;
  if (key === "interactiveUse.browserProvider") return projectConfig.interactiveUse?.browserProvider;
  if (key === "interactiveUse.computerProvider") return projectConfig.interactiveUse?.computerProvider;
  if (key === "interactiveUse.browserEnvironment") return projectConfig.interactiveUse?.browserEnvironment;
  if (key === "interactiveUse.computerEnvironment") return projectConfig.interactiveUse?.computerEnvironment;
  switch (key) {
    case "domain": return projectConfig.domain;
    case "provider": return projectConfig.provider;
    case "channels": return projectConfig.channels;
    case "teamMode": return projectConfig.teamMode;
    case "requireApproval": return projectConfig.requireApproval;
    case "maxDepth": return projectConfig.maxDepth;
    case "parallelWorkers": return projectConfig.parallelWorkers;
    case "mode": return projectConfig.mode;
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
  if (key === "interactiveUse.applicationAliases") {
    return { ...config, interactiveUse: { ...interactiveUse, applicationAliases: parseStringListRecord(rawValue, key) } };
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

function parseStringListRecord(value: string, key: string): Record<string, string[]> {
  const parsed = parseJson(value, key);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(`Invalid JSON value for ${key}: expected an object of string arrays.`);
    process.exit(1);
  }
  const out: Record<string, string[]> = {};
  for (const [recordKey, recordValue] of Object.entries(parsed)) {
    if (!Array.isArray(recordValue) || recordValue.some((item) => typeof item !== "string")) {
      console.error(`Invalid JSON value for ${key}: expected an object of string arrays.`);
      process.exit(1);
    }
    const normalizedKey = recordKey.trim();
    const normalizedValue = parseStringList(recordValue.join(","));
    if (normalizedKey && normalizedValue.length > 0) {
      out[normalizedKey] = normalizedValue;
    }
  }
  return out;
}

function parseBoolean(value: string, key: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  console.error(`Invalid boolean value for ${key}: ${value}. Must be true or false.`);
  process.exit(1);
}

function parsePositiveInteger(value: string, key: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    console.error(`Invalid integer value for ${key}: ${value}. Must be a positive integer.`);
    process.exit(1);
  }
  return number;
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
  console.log("  setup [--apply|--action <id>] Inspect or execute setup recommendations");
  console.log("  approve <id>      Approve a stored config proposal for kiln_config.apply_change");
  console.log("  set [--global] <key> <value> Update a project or global config value");
  console.log("  reset [--global]  Reset project config, or explicitly adopt clean global V2 defaults");
  console.log("\nRead views: effective, providers, routes, agents, skills, permissions, memory, projections, setup, health");
  console.log(`\nValid keys: ${[...VALID_KEYS].join(", ")}`);
  console.log("");
}

async function runConfigSetupCommand(
  projectPath: string,
  args: readonly string[],
): Promise<KilnConfigSetupSnapshot | readonly KilnConfigSetupActionResult[]> {
  const action = readActionFlag(args);
  if (action) {
    return [await executeConfigSetupAction({ projectPath, action })];
  }
  if (!args.includes("--apply")) {
    return (await readConfigStatusSnapshot({ projectPath })).setup;
  }

  const results: KilnConfigSetupActionResult[] = [];
  for (let index = 0; index < KILN_CONFIG_SETUP_ACTIONS.length; index += 1) {
    const snapshot = await readConfigStatusSnapshot({ projectPath });
    const next = snapshot.setup.recommendedActions.find((candidate) => candidate !== "none");
    if (!next) {
      break;
    }
    const result = await executeConfigSetupAction({ projectPath, action: next });
    results.push(result);
    if (result.status === "blocked" || result.status === "failed") {
      break;
    }
  }
  return results;
}

function readActionFlag(args: readonly string[]): KilnConfigSetupAction | undefined {
  const index = args.findIndex((arg) => arg === "--action");
  const value = index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith("--action="))?.slice("--action=".length);
  if (!value) {
    return undefined;
  }
  if (!KILN_CONFIG_SETUP_ACTIONS.includes(value as KilnConfigSetupAction)) {
    console.error(`Invalid setup action: ${value}. Must be one of ${KILN_CONFIG_SETUP_ACTIONS.join(", ")}.`);
    process.exit(1);
  }
  return value as KilnConfigSetupAction;
}

function hasGlobalFlag(args: readonly string[]): boolean {
  return args.includes("--global");
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
    if (arg === "--global") {
      continue;
    }
    if (arg === "--action") {
      index += 1;
      continue;
    }
    if (arg === "--apply" || arg.startsWith("--action=")) {
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
