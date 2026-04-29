export class KilnYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KilnYamlError";
  }
}

export interface KilnYamlMcpServer {
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface KilnYamlMcp {
  servers: Record<string, KilnYamlMcpServer>;
}

export interface KilnYamlModel {
  default?: string;
  fallback?: string[];
}

export interface KilnYamlToolRule {
  tool: string;
  action: "allow" | "ask" | "deny";
  reason?: string;
}

export interface KilnYamlCommandRule {
  pattern: string;
  action: "allow" | "ask" | "deny";
  shell?: "bash" | "sh" | "zsh" | "any";
  reason?: string;
}

export interface KilnYamlFileGovernance {
  excludeFromContext?: boolean;
  denyGlobs?: string[];
  askGlobs?: string[];
  allowGlobs?: string[];
}

export interface KilnYamlDataFirewallRule {
  destination: string;
  action: "allow" | "redact" | "deny";
  classifications?: string[];
  reason?: string;
}

export interface KilnYamlAgentScope {
  agent: string;
  inherit?: boolean;
  tools?: KilnYamlToolRule[];
  commands?: KilnYamlCommandRule[];
  fileGovernance?: KilnYamlFileGovernance;
  mcpTools?: string[];
}

export interface KilnYamlPermissions {
  approval?: "never" | "on-request" | "on-failure" | "untrusted";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  safeDefaults?: boolean;
  auditLog?: boolean;
  tools?: KilnYamlToolRule[];
  commands?: KilnYamlCommandRule[];
  fileGovernance?: KilnYamlFileGovernance;
  dataFirewall?: KilnYamlDataFirewallRule[];
  agentScopes?: KilnYamlAgentScope[];
}

export interface KilnYamlProvider {
  apiKeyEnv?: string;
}

export interface KilnYamlSkillGeneration {
  readonly enabled?: boolean;
  readonly model?: string;
  readonly complexityThreshold?: number;
}

export type KilnYamlWebNetPolicy = "none" | "documentation" | "package-managers" | "full";

export interface KilnYamlWebHttpSearchProvider {
  readonly type: "http";
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export interface KilnYamlWebDisabledSearchProvider {
  readonly type?: "none";
}

export type KilnYamlWebSearchProvider =
  | KilnYamlWebDisabledSearchProvider
  | KilnYamlWebHttpSearchProvider;

export interface KilnYamlWebConfig {
  readonly enabled?: boolean;
  readonly netPolicy?: KilnYamlWebNetPolicy;
  readonly allowedDomains?: readonly string[];
  readonly searchProvider?: KilnYamlWebSearchProvider;
}

export interface KilnYamlQualityGate {
  readonly name: string;
  readonly command: string;
  readonly required?: boolean;
  readonly coverageThreshold?: number;
}

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "SubagentStart"
  | "SubagentStop";

export type HookHandlerMode = "command";

export interface HookHandler {
  readonly type: HookHandlerMode;
  readonly command: string;
  readonly timeoutSec?: number;
  readonly async?: boolean;
}

export interface HookRule {
  readonly matcher?: string;
  readonly hooks: readonly HookHandler[];
}

const VALID_HOOK_EVENTS: readonly HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
];

export function validateKilnHooks(config: KilnHooksConfig): string[] {
  const errors: string[] = [];
  for (const [eventKey, rules] of Object.entries(config)) {
    if (!VALID_HOOK_EVENTS.includes(eventKey as HookEvent)) {
      errors.push(`Unknown hook event: "${eventKey}". Valid events: ${VALID_HOOK_EVENTS.join(", ")}`);
      continue;
    }
    if (!Array.isArray(rules)) continue;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!Array.isArray(rule.hooks)) continue;
      for (let j = 0; j < rule.hooks.length; j++) {
        const handler = rule.hooks[j];
        if (handler.type !== "command") {
          errors.push(`hooks.${eventKey}[${i}].hooks[${j}]: handler type must be "command", got "${handler.type}"`);
        }
        if (!handler.command || typeof handler.command !== "string" || handler.command.trim() === "") {
          errors.push(`hooks.${eventKey}[${i}].hooks[${j}]: "command" field is required and must be a non-empty string`);
        }
      }
    }
  }
  return errors;
}

export interface KilnHooksConfig {
  readonly PreToolUse?: readonly HookRule[];
  readonly PostToolUse?: readonly HookRule[];
  readonly UserPromptSubmit?: readonly HookRule[];
  readonly SessionStart?: readonly HookRule[];
  readonly SessionEnd?: readonly HookRule[];
  readonly SubagentStart?: readonly HookRule[];
  readonly SubagentStop?: readonly HookRule[];
}

export type KilnContextGovernanceSource =
  | "ledger"
  | "artifact"
  | "summary"
  | "memory"
  | "knowledge";

export type KilnContextGovernanceAggressiveness = "low" | "medium" | "high";

export type KilnContextGovernanceCachePolicy = "off" | "prefer";

export interface KilnContextGovernanceConfig {
  turnBudget?: number;
  previewBeforeApply?: boolean;
  preferredSources?: readonly KilnContextGovernanceSource[];
  summaryAggressiveness?: KilnContextGovernanceAggressiveness;
  cachePolicy?: KilnContextGovernanceCachePolicy;
}

export interface KilnYaml {
  readonly version: "1";
  readonly domain?: string;
  readonly provider?: string;
  readonly channels?: string[];
  readonly teamMode?: string;
  readonly requireApproval?: boolean;
  readonly maxDepth?: number;
  readonly parallelWorkers?: number;
  readonly mode?: string;
  readonly mcp?: KilnYamlMcp;
  readonly model?: KilnYamlModel;
  readonly permissions?: KilnYamlPermissions;
  readonly providers?: Record<string, KilnYamlProvider>;
  readonly web?: KilnYamlWebConfig;
  readonly skillGeneration?: KilnYamlSkillGeneration;
  readonly qualityGates?: readonly KilnYamlQualityGate[];
  readonly hooks?: KilnHooksConfig;
  readonly contextGovernance?: KilnContextGovernanceConfig;
}
