import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { KilnYamlError } from "./kiln-yaml-types.js";
import type {
  KilnYaml,
  KilnYamlMcp,
  KilnYamlMcpServer,
} from "./kiln-yaml-types.js";
export { KilnYamlError } from "./kiln-yaml-types.js";
export { validateKilnHooks } from "./kiln-yaml-types.js";
export type {
  KilnYaml,
  KilnYamlMcp,
  KilnYamlMcpServer,
  KilnYamlModel,
  KilnContextGovernanceConfig,
  KilnContextGovernanceSource,
  KilnContextGovernanceAggressiveness,
  KilnContextGovernanceCachePolicy,
  KilnYamlPermissions,
  KilnYamlToolRule,
  KilnYamlCommandRule,
  KilnYamlFileGovernance,
  KilnYamlDataFirewallRule,
  KilnYamlAgentScope,
  KilnYamlProvider,
  KilnYamlSkillGeneration,
  KilnHooksConfig,
} from "./kiln-yaml-types.js";

export function readKilnYaml(kilnDir: string): KilnYaml | null {
  const path = join(kilnDir, "kiln.yaml");
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  try {
    const parsed = parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new KilnYamlError("kiln.yaml must be an object");
    }
    return parsed as KilnYaml;
  } catch (err) {
    if (err instanceof KilnYamlError) {
      throw err;
    }
    throw new KilnYamlError(
      `Failed to parse kiln.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function writeKilnYaml(kilnDir: string, config: KilnYaml): void {
  if (!existsSync(kilnDir)) {
    mkdirSync(kilnDir, { recursive: true });
  }
  const path = join(kilnDir, "kiln.yaml");
  writeFileSync(path, stringify(config), "utf-8");
}

export function mergeKilnYaml(base: KilnYaml, override: Partial<KilnYaml>): KilnYaml {
  return {
    version: override.version ?? base.version ?? "1",
    domain: override.domain ?? base.domain,
    provider: override.provider ?? base.provider,
    channels: override.channels ?? base.channels,
    teamMode: override.teamMode ?? base.teamMode,
    requireApproval: override.requireApproval ?? base.requireApproval,
    maxDepth: override.maxDepth ?? base.maxDepth,
    parallelWorkers: override.parallelWorkers ?? base.parallelWorkers,
    mode: override.mode ?? base.mode,
    mcp: mergeMcp(base.mcp, override.mcp),
    model: override.model ?? base.model,
    permissions: override.permissions ?? base.permissions,
    providers: override.providers ?? base.providers,
    contextGovernance: override.contextGovernance ?? base.contextGovernance,
    hooks: override.hooks ?? base.hooks,
  };
}

function mergeMcp(
  base: KilnYamlMcp | undefined,
  override: KilnYamlMcp | undefined,
): KilnYamlMcp | undefined {
  if (!base && !override) return undefined;
  const allNames = new Set([
    ...Object.keys(base?.servers ?? {}),
    ...Object.keys(override?.servers ?? {}),
  ]);
  const servers: Record<string, KilnYamlMcpServer> = {};
  for (const name of allNames) {
    const baseServer = base?.servers?.[name];
    const overrideServer = override?.servers?.[name];
    servers[name] = {
      ...baseServer,
      ...overrideServer,
    };
  }
  return { servers };
}

export function migrateConfigJson(kilnDir: string): boolean {
  const configJsonPath = join(kilnDir, "config.json");
  if (!existsSync(configJsonPath)) {
    return false;
  }
  const raw = readFileSync(configJsonPath, "utf-8");
  const config = JSON.parse(raw) as {
    domain?: string;
    provider?: string;
    channels?: string[];
    teamMode?: string;
    requireApproval?: boolean;
    maxDepth?: number;
    parallelWorkers?: number;
    mode?: string;
  };
  const kilnYaml: KilnYaml = {
    version: "1",
    domain: config.domain,
    provider: config.provider,
    channels: config.channels,
    teamMode: config.teamMode,
    requireApproval: config.requireApproval,
    maxDepth: config.maxDepth,
    parallelWorkers: config.parallelWorkers,
    mode: config.mode,
    permissions: {
      approval: config.requireApproval ? "on-request" : "never",
      sandbox: "read-only",
    },
  };
  writeKilnYaml(kilnDir, kilnYaml);
  rmSync(configJsonPath);
  return true;
}

export function defaultKilnYaml(domain: string): KilnYaml {
  return {
    version: "1",
    domain,
    provider: "claude",
    mode: "api-key",
    permissions: {
      approval: "on-request",
      sandbox: "read-only",
    },
  };
}
