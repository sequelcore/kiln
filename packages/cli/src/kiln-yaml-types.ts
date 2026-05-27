import type { MemoryLayerKind, MemoryScopeKind } from "@kilnai/core";
import type { KilnMemoryAuthorityOperation } from "./wrapper/session.js";

export class KilnYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KilnYamlError";
  }
}

export interface KilnYamlMcpServer {
  type?: "stdio" | "http" | "kiln-bundled";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  module?: string;
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

export interface KilnYamlMemoryAuthorityRule {
  operations: KilnMemoryAuthorityOperation[];
  scopeKinds?: MemoryScopeKind[];
  scopeIds?: string[];
  layers?: MemoryLayerKind[];
  allowAuditWrite?: boolean;
}

export interface KilnYamlMemoryPermissions {
  read?: KilnYamlMemoryAuthorityRule[];
  write?: KilnYamlMemoryAuthorityRule[];
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
  memory?: KilnYamlMemoryPermissions;
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
  memory?: KilnYamlMemoryPermissions;
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

export interface KilnYamlBuiltinSkillsConfig {
  readonly enabled?: boolean;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export type KilnYamlSkillSelectionMode = "advisory" | "auto";

export interface KilnYamlSkillSelectionConfig {
  readonly mode?: KilnYamlSkillSelectionMode;
}

export interface KilnYamlSkillsConfig {
  readonly builtin?: KilnYamlBuiltinSkillsConfig;
  readonly selection?: KilnYamlSkillSelectionConfig;
}

export type KilnWorkGovernancePosture = "orchestrate" | "direct";

export type KilnWorkGovernanceRisk = "low" | "medium" | "high";

export type KilnWorkGovernanceTrigger =
  | "architecture"
  | "security"
  | "ui"
  | "runtime"
  | "provider-routing"
  | "managed-agents"
  | "config"
  | "multi-file"
  | "cross-surface"
  | "long-running"
  | "verification-heavy"
  | "formal-proof-candidate";

export type KilnWorkGovernanceEvidence =
  | "surface-map"
  | "risk-hypothesis"
  | "spec"
  | "plan"
  | "tests"
  | "typecheck"
  | "visual-reference-research"
  | "browser-qa"
  | "managed-agent-review"
  | "managed-orchestration:result-handoff"
  | "managed-orchestration:completion-signal"
  | "managed-orchestration:comparison-summary"
  | "managed-orchestration:route-outcome"
  | "managed-orchestration:adoption-gate"
  | "managed-orchestration:diff"
  | "managed-orchestration:verification"
  | "managed-orchestration:review"
  | "managed-orchestration:merge:compare-and-select"
  | "managed-orchestration:merge:collect-all"
  | "managed-orchestration:merge:first-success"
  | "managed-orchestration:merge:manual-review-required"
  | "managed-orchestration:merge:none"
  | "formal-proof"
  | "residual-risk";

export interface KilnWorkGovernanceDirectExecutionConfig {
  readonly maxFiles?: number;
  readonly maxRisk?: KilnWorkGovernanceRisk;
}

export interface KilnWorkGovernanceConfig {
  readonly defaultPosture?: KilnWorkGovernancePosture;
  readonly directExecution?: KilnWorkGovernanceDirectExecutionConfig;
  readonly requireDelegationFor?: readonly KilnWorkGovernanceTrigger[];
  readonly requiredEvidence?: readonly KilnWorkGovernanceEvidence[];
}

export const DEFAULT_WORK_GOVERNANCE_CONFIG: KilnWorkGovernanceConfig = {
  defaultPosture: "orchestrate",
  directExecution: {
    maxFiles: 1,
    maxRisk: "low",
  },
  requireDelegationFor: [
    "architecture",
    "security",
    "ui",
    "runtime",
    "provider-routing",
    "managed-agents",
    "config",
    "multi-file",
    "cross-surface",
    "long-running",
    "verification-heavy",
    "formal-proof-candidate",
  ],
  requiredEvidence: [
    "surface-map",
    "risk-hypothesis",
    "plan",
    "tests",
    "typecheck",
    "residual-risk",
  ],
};

export type KilnModelTaskSuitabilityTask =
  | "architecture-review"
  | "backend-coding"
  | "frontend-design"
  | "mechanical-edit"
  | "research"
  | "test-writing";

export type KilnModelTaskSuitabilityLevel = "preferred" | "capable" | "limited";

export interface KilnModelTaskSuitabilityOverride {
  readonly provider: string;
  readonly model: string;
  readonly task: KilnModelTaskSuitabilityTask;
  readonly level: KilnModelTaskSuitabilityLevel;
  readonly reason: string;
}

export type KilnReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type KilnReasoningPolicyUnsupported = "omit" | "fail";

export interface KilnReasoningPolicyConfig {
  readonly default?: KilnReasoningEffort;
  readonly unsupported?: KilnReasoningPolicyUnsupported;
  readonly byTask?: Partial<Record<KilnModelTaskSuitabilityTask, KilnReasoningEffort>>;
}

export type KilnYamlWebNetPolicy = "none" | "documentation" | "package-managers" | "full";

export interface KilnYamlWebHttpSearchProvider {
  readonly type: "http";
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export interface KilnYamlWebHttpExtractProvider {
  readonly type: "http";
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export interface KilnYamlWebSearxngSearchProvider {
  readonly type: "searxng";
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export interface KilnYamlWebBraveSearchProvider {
  readonly type: "brave";
  readonly apiKeyEnv: string;
  readonly url?: string;
}

export interface KilnYamlWebTavilySearchProvider {
  readonly type: "tavily";
  readonly apiKeyEnv: string;
  readonly url?: string;
}

export interface KilnYamlWebExaSearchProvider {
  readonly type: "exa";
  readonly apiKeyEnv: string;
  readonly url?: string;
}

export interface KilnYamlWebTavilyExtractProvider {
  readonly type: "tavily";
  readonly apiKeyEnv: string;
  readonly url?: string;
}

export interface KilnYamlWebFirecrawlExtractProvider {
  readonly type: "firecrawl";
  readonly apiKeyEnv: string;
  readonly url?: string;
}

export interface KilnYamlWebDisabledSearchProvider {
  readonly type?: "none";
}

export interface KilnYamlWebDisabledExtractProvider {
  readonly type?: "none";
}

export type KilnYamlWebSearchProvider =
  | KilnYamlWebDisabledSearchProvider
  | KilnYamlWebHttpSearchProvider
  | KilnYamlWebSearxngSearchProvider
  | KilnYamlWebBraveSearchProvider
  | KilnYamlWebTavilySearchProvider
  | KilnYamlWebExaSearchProvider;

export type KilnYamlWebExtractProvider =
  | KilnYamlWebDisabledExtractProvider
  | KilnYamlWebHttpExtractProvider
  | KilnYamlWebTavilyExtractProvider
  | KilnYamlWebFirecrawlExtractProvider;

export interface KilnYamlWebConfig {
  readonly enabled?: boolean;
  readonly netPolicy?: KilnYamlWebNetPolicy;
  readonly allowedDomains?: readonly string[];
  readonly searchProvider?: KilnYamlWebSearchProvider;
  readonly extractProvider?: KilnYamlWebExtractProvider;
}

export type KilnYamlInteractiveUseBrowserProvider = "none" | "playwright";
export type KilnYamlInteractiveUseComputerProvider = "none" | "windows" | "windows-uia";
export type KilnYamlInteractiveUseProvider =
  | KilnYamlInteractiveUseBrowserProvider
  | KilnYamlInteractiveUseComputerProvider;
export type KilnYamlInteractiveUseBrowserEnvironment = "isolated-headless" | "isolated-headed";
export type KilnYamlInteractiveUseComputerEnvironment = "local-active-desktop";

export interface KilnYamlInteractiveUseConfig {
  readonly enabled?: boolean;
  readonly allowedDomains?: readonly string[];
  readonly allowedApplications?: readonly string[];
  readonly applicationAliases?: Readonly<Record<string, readonly string[]>>;
  readonly allowExternalBrowser?: boolean;
  readonly allowComputer?: boolean;
  readonly browserProvider?: KilnYamlInteractiveUseBrowserProvider;
  readonly computerProvider?: KilnYamlInteractiveUseComputerProvider;
  readonly browserEnvironment?: KilnYamlInteractiveUseBrowserEnvironment;
  readonly computerEnvironment?: KilnYamlInteractiveUseComputerEnvironment;
}

export type KilnManagedAgentRouteKind = "harness" | "direct";

export type KilnManagedAgentProfile =
  | "foundation-readonly-plan"
  | "foundation-propose-writes"
  | "foundation-apply-approved-writes"
  | "foundation-memory-write-proposals";

export interface KilnManagedAgentToolsConfig {
  readonly allowed?: readonly string[];
  readonly network?: boolean;
  readonly writes?: boolean;
}

export interface KilnManagedAgentMemoryConfig {
  readonly access?: "none" | "read-only" | "write-proposals";
}

export type KilnManagedAgentWriteMode = "none" | "propose" | "apply-approved";

export type KilnManagedAgentArtifactWriteRetention = "none" | "session" | "durable" | "external";

export type KilnManagedAgentMemoryWriteOperation =
  | "create"
  | "update"
  | "archive"
  | "forget"
  | "redact"
  | "promote";

export type KilnManagedAgentWriteApprovalMode = "required-before-apply" | "policy-approved";

export interface KilnManagedAgentWorkspaceWriteConfig {
  readonly mode?: KilnManagedAgentWriteMode;
  readonly allowedPaths?: readonly string[];
  readonly deniedPaths?: readonly string[];
}

export interface KilnManagedAgentMemoryWriteConfig {
  readonly mode?: KilnManagedAgentWriteMode;
  readonly operations?: readonly KilnManagedAgentMemoryWriteOperation[];
}

export interface KilnManagedAgentArtifactWriteConfig {
  readonly mode?: KilnManagedAgentWriteMode;
  readonly resourceUris?: readonly string[];
  readonly retention?: KilnManagedAgentArtifactWriteRetention;
}

export interface KilnManagedAgentToolWriteConfig {
  readonly allowed?: readonly string[];
  readonly denied?: readonly string[];
}

export interface KilnManagedAgentWriteApprovalConfig {
  readonly mode: KilnManagedAgentWriteApprovalMode;
  readonly approver?: string;
  readonly evidenceUris?: readonly string[];
}

export interface KilnManagedAgentWriteAuthorityConfig {
  readonly workspace?: KilnManagedAgentWorkspaceWriteConfig;
  readonly memory?: KilnManagedAgentMemoryWriteConfig;
  readonly artifacts?: KilnManagedAgentArtifactWriteConfig;
  readonly tools?: KilnManagedAgentToolWriteConfig;
  readonly approval: KilnManagedAgentWriteApprovalConfig;
}

export type KilnManagedAgentCredentialsConfig =
  | {
    readonly mode: "runtime-selected";
    readonly routeId?: string;
  }
  | {
    readonly mode: "credentialless";
  };

export interface KilnManagedAgentWorktreeLeaseConfig {
  readonly mode: "git";
  readonly rootPath: string;
  readonly ref?: string;
  readonly gitBinary?: string;
}

export interface KilnManagedAgentRemoteHarnessConfig {
  readonly invokeUrl: string;
  readonly cancelUrl: string;
  readonly authTokenEnv?: string;
  readonly limitations?: readonly string[];
}

export interface KilnManagedAgentRouteConfig {
  readonly id: string;
  readonly kind: KilnManagedAgentRouteKind;
  readonly provider: string;
  readonly model?: string;
  readonly voiceProfile?: string;
  readonly profiles?: readonly KilnManagedAgentProfile[];
  readonly workingDirectory?: "project" | "isolated-worktree" | "sandbox";
  readonly timeoutMs?: number;
  readonly tools?: KilnManagedAgentToolsConfig;
  readonly memory?: KilnManagedAgentMemoryConfig;
  readonly writeAuthority?: KilnManagedAgentWriteAuthorityConfig;
  readonly credentials?: KilnManagedAgentCredentialsConfig;
  readonly remoteHarness?: KilnManagedAgentRemoteHarnessConfig;
}

export interface KilnManagedAgentsConfig {
  readonly enabled?: boolean;
  readonly defaultProfile?: KilnManagedAgentProfile;
  readonly defaultProvider?: string;
  readonly defaultVoiceProfile?: string;
  readonly model?: string;
  readonly worktreeLease?: KilnManagedAgentWorktreeLeaseConfig;
  readonly requireApproval?: boolean;
  readonly routes?: readonly KilnManagedAgentRouteConfig[];
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
  readonly activeInstructionProfiles?: readonly string[];
  readonly workGovernance?: KilnWorkGovernanceConfig;
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
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  readonly reasoningPolicy?: KilnReasoningPolicyConfig;
  readonly web?: KilnYamlWebConfig;
  readonly interactiveUse?: KilnYamlInteractiveUseConfig;
  readonly skills?: KilnYamlSkillsConfig;
  readonly skillGeneration?: KilnYamlSkillGeneration;
  readonly qualityGates?: readonly KilnYamlQualityGate[];
  readonly hooks?: KilnHooksConfig;
  readonly contextGovernance?: KilnContextGovernanceConfig;
}
