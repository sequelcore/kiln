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

export interface KilnYamlPermissions {
  approval: "auto-approve" | "ask" | "deny";
  sandbox: "none" | "workspace-write" | "full";
}

export interface KilnYamlProvider {
  apiKeyEnv?: string;
}

export interface KilnYamlSkillGeneration {
  readonly enabled?: boolean;
  readonly model?: string;
  readonly complexityThreshold?: number;
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
  readonly skillGeneration?: KilnYamlSkillGeneration;
  readonly qualityGates?: readonly KilnYamlQualityGate[];
  readonly hooks?: KilnHooksConfig;
}
