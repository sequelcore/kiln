import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import { KilnYamlError } from "../kiln-yaml.js";
import type {
  KilnHooksConfig,
  KilnYamlWebConfig,
  KilnYamlMcp,
  KilnYamlPermissions,
} from "../kiln-yaml-types.js";

export interface KilnGlobalIdentity {
  name?: string;
  timezone?: string;
}

export interface KilnGlobalTuiConfig {
  theme?: string;
}

export interface KilnGlobalGuiConfig {
  theme?: string;
}

export interface KilnGlobalConfig {
  version?: "1";
  provider?: string;
  model?: string;
  permissions?: KilnYamlPermissions;
  mcp?: KilnYamlMcp;
  web?: KilnYamlWebConfig;
  hooks?: KilnHooksConfig;
  identity?: KilnGlobalIdentity;
  tui?: KilnGlobalTuiConfig;
  gui?: KilnGlobalGuiConfig;
}

export function resolveGlobalConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return join(xdgConfigHome, "kiln", "config.yaml");
  }
  return join(homedir(), ".kiln", "config.yaml");
}

export function readGlobalConfig(): KilnGlobalConfig | null {
  const configPath = resolveGlobalConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }
  const raw = readFileSync(configPath, "utf-8");
  try {
    const parsed = parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new KilnYamlError("Global config must be an object");
    }
    return parsed as KilnGlobalConfig;
  } catch (err) {
    if (err instanceof KilnYamlError) {
      throw err;
    }
    throw new KilnYamlError(
      `Failed to parse global config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function writeGlobalConfig(config: KilnGlobalConfig): void {
  const configPath = resolveGlobalConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringify(config), "utf-8");
}

export function defaultGlobalConfig(): KilnGlobalConfig {
  return {
    version: "1",
    provider: "claude",
    permissions: {
      approval: "on-request",
      sandbox: "read-only",
    },
  };
}
