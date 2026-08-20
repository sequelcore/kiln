import type {
  KilnWorkGovernanceEvidence,
  ManagedEconomicAmount,
  ManagedEconomicComparableReservation,
  ManagedEconomicScheme,
  McpServerConfiguration,
  MemoryLayerKind,
  MemoryScopeKind,
  CommunicationIntent,
} from "@kilnai/core";
import type { KilnMemoryAuthorityOperation } from "./wrapper/session.js";

export type { KilnWorkGovernanceEvidence } from "@kilnai/core";

export class KilnYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KilnYamlError";
  }
}

export type KilnYamlMcpServer = McpServerConfiguration;

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

export type KilnYamlSkillVisibility = "implicit" | "explicit-only" | "disabled";

export interface KilnYamlSkillVisibilityConfig {
  readonly default?: KilnYamlSkillVisibility;
  readonly overrides?: Readonly<Record<string, KilnYamlSkillVisibility>>;
}

export interface KilnExternalCatalogKeepImplicitDecision {
  readonly sourceId: string;
  readonly packageDigest: string;
}

export interface KilnExternalCatalogPolicy {
  readonly version: 1;
  readonly harnesses: {
    readonly codex?: { readonly expectedFingerprint: string; readonly keepImplicit: readonly KilnExternalCatalogKeepImplicitDecision[] };
    readonly claude?: { readonly expectedFingerprint: string; readonly keepImplicit: readonly KilnExternalCatalogKeepImplicitDecision[] };
    readonly opencode?: { readonly expectedFingerprint: string; readonly keepImplicit: readonly KilnExternalCatalogKeepImplicitDecision[] };
  };
}

export interface KilnYamlSkillsConfig {
  readonly builtin?: KilnYamlBuiltinSkillsConfig;
  readonly selection?: KilnYamlSkillSelectionConfig;
  readonly visibility?: KilnYamlSkillVisibilityConfig;
  /** Global-only reviewed exposure policy for external harness catalogs. */
  readonly externalCatalog?: KilnExternalCatalogPolicy;
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
  | "cross-surface"
  | "long-running"
  | "verification-heavy"
  | "formal-proof-candidate";

/** Global ceilings only. A goal contract remains explicit and may be narrower. */
export interface KilnBoundedWorkPolicyCeiling {
  readonly allowedEffects?: readonly (
    | "inspect" | "modify_source" | "modify_tests" | "modify_documentation"
    | "modify_configuration" | "run_verification" | "invoke_managed_agent" | "external_write"
  )[];
  readonly allowedRoots?: readonly string[];
  readonly deniedRoots?: readonly string[];
  readonly maximumLimits?: {
    readonly maxExecutionAttempts?: number;
    readonly maxManagedInvocations?: number;
    readonly maxConcurrentManagedInvocations?: number;
    readonly maxChildDepth?: number;
    readonly maxReviewRounds?: number;
    readonly maxRemediationRounds?: number;
    readonly maxToolCalls?: number;
    readonly maxActiveDurationMs?: number;
  };
  readonly minimumHarnessCapability?: "authoritative" | "partially_enforced" | "advisory_only";
}

export interface KilnWorkGovernanceConfig {
  readonly defaultPosture?: KilnWorkGovernancePosture;
  readonly requireDelegationFor?: readonly KilnWorkGovernanceTrigger[];
  readonly requiredEvidence?: readonly KilnWorkGovernanceEvidence[];
  readonly boundedWorkCeiling?: KilnBoundedWorkPolicyCeiling;
}

export const DEFAULT_WORK_GOVERNANCE_CONFIG: KilnWorkGovernanceConfig = {
  defaultPosture: "direct",
  requireDelegationFor: [],
  requiredEvidence: [],
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

export type KilnDeliberationMode = "provider-default" | "fixed" | "adaptive";
export type KilnDeliberationTarget = "latency-first" | "balanced" | "quality-first";
export type KilnUnsupportedDeliberationPolicy = "deny" | "omit" | "allow-clamp";

export interface KilnDeliberationBoundsConfig {
  readonly min?: string;
  readonly max?: string;
}

export type KilnDeliberationRuleConfig =
  | {
    readonly mode: "provider-default";
    readonly onUnsupported?: KilnUnsupportedDeliberationPolicy;
  }
  | {
    readonly mode: "fixed";
    readonly preferredLevel: string;
    readonly bounds?: KilnDeliberationBoundsConfig;
    readonly onUnsupported?: KilnUnsupportedDeliberationPolicy;
  }
  | {
    readonly mode: "adaptive";
    readonly target: KilnDeliberationTarget;
    readonly bounds?: KilnDeliberationBoundsConfig;
    readonly onUnsupported?: KilnUnsupportedDeliberationPolicy;
  };

export type KilnDeliberationRouteRuleConfig = KilnDeliberationRuleConfig & {
  readonly provider: string;
  readonly model: string;
};

export interface KilnDeliberationPolicyConfig {
  readonly default?: KilnDeliberationRuleConfig;
  readonly byTask?: Partial<Record<KilnModelTaskSuitabilityTask, KilnDeliberationRuleConfig>>;
  readonly byRoute?: readonly KilnDeliberationRouteRuleConfig[];
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
  readonly searchFallbackProviders?: readonly KilnYamlWebSearchProvider[];
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

export interface KilnManagedAgentWorkspaceReadConfig {
  readonly allowedPaths?: readonly string[];
  readonly deniedPaths?: readonly string[];
}

export interface KilnManagedAgentReadAuthorityConfig {
  readonly workspace?: KilnManagedAgentWorkspaceReadConfig;
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

/**
 * Roadmap 01 Slice 3.1 - declares which external-runtime instance this
 * route is physically attached to. A property of the target, not of any one
 * admission profile: every profile of this route addresses the same
 * instance. When declared, every dispatch against this route must request
 * the exact same attachment or be denied.
 */
export interface KilnManagedAgentExternalRuntimeAttachmentConfig {
  readonly runtimeId: string;
  readonly attachmentId: string;
}

/** Physical execution identity. Authority is selected separately by profile id. */
export type KilnExecutionTargetConfig =
  | {
    readonly id: string;
    readonly kind: "direct";
    readonly label: string;
    readonly providerId: string;
    readonly providerModelId: string;
    readonly accountSelection: import("@kilnai/core").ExecutionRouteAccountSelection;
    readonly dataClassification: import("@kilnai/core").ExecutionDataClassification;
    readonly dataPolicyEvidence: import("@kilnai/core").ExecutionRouteDataPolicyEvidence;
    readonly economics: import("@kilnai/core").ExecutionRouteEconomicsConfig;
  }
  | {
    readonly id: string;
    readonly kind: "harness";
    readonly label: string;
    readonly providerId: string;
    readonly providerModelId: string;
    readonly dataClassification: import("@kilnai/core").ExecutionDataClassification;
    readonly dataPolicyEvidence: import("@kilnai/core").ExecutionRouteDataPolicyEvidence;
    readonly remoteHarness?: KilnManagedAgentRemoteHarnessConfig;
    readonly externalRuntimeAttachment?: KilnManagedAgentExternalRuntimeAttachmentConfig;
  };

export interface KilnTargetCatalogConfig {
  readonly accounts: readonly import("@kilnai/core").ExecutionAccount[];
  readonly accountPolicies: readonly import("@kilnai/core").ExecutionAccountPolicy[];
  readonly targets: readonly KilnExecutionTargetConfig[];
}

/** Reusable authority/environment policy, independent from physical target identity. */
export interface KilnAuthorityProfileConfig {
  readonly id: string;
  readonly admissionProfile: KilnManagedAgentProfile;
  readonly voiceProfile?: string;
  readonly workingDirectory?: "project" | "isolated-worktree" | "sandbox";
  readonly timeoutMs?: number;
  readonly tools?: KilnManagedAgentToolsConfig;
  readonly memory?: KilnManagedAgentMemoryConfig;
  readonly readAuthority?: KilnManagedAgentReadAuthorityConfig;
  readonly writeAuthority?: KilnManagedAgentWriteAuthorityConfig;
}

export interface KilnManagedEconomicComparisonDomainConfig {
  readonly id: string;
  readonly rank: number;
  readonly unit: string;
  readonly scheme: ManagedEconomicScheme;
  readonly rateCardBasis: string;
  readonly envelopeSemantics: string;
}

export interface KilnManagedEconomicPolicyCandidateConfig {
  readonly targetId: string;
  readonly comparisonDomainId: string;
  readonly priorityRank: number;
  readonly worstCaseReservation: ManagedEconomicComparableReservation;
  readonly ceiling:
    | { readonly kind: "none" }
    | { readonly kind: "finite"; readonly amount: ManagedEconomicAmount };
}

export interface KilnManagedEconomicPolicyConfig {
  readonly id: string;
  readonly revision: string;
  readonly evidenceRequirements: {
    readonly quota: "optional" | "required-for-account-bound";
    readonly price: "optional" | "required";
  };
  readonly noRouteAction: "deny";
  readonly comparisonDomains: readonly KilnManagedEconomicComparisonDomainConfig[];
  readonly candidates: readonly KilnManagedEconomicPolicyCandidateConfig[];
}

export interface KilnManagedAgentsConfig {
  readonly enabled?: boolean;
  readonly defaultAuthorityProfileId?: string;
  readonly defaultVoiceProfile?: string;
  readonly worktreeLease?: KilnManagedAgentWorktreeLeaseConfig;
  readonly requireApproval?: boolean;
  readonly economicPolicies?: readonly KilnManagedEconomicPolicyConfig[];
}

export interface KilnYamlQualityGate {
  readonly name: string;
  readonly command: string;
  readonly required?: boolean;
}

/** Agent authority is always inherited; `inherit:false` would remove parent
 * restrictions and is therefore rejected at the configuration boundary. */
export function validateAgentScopeInheritance(value: unknown, path = "permissions"): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const permissions = value as Record<string, unknown>;
  if (permissions.agentScopes === undefined) return;
  if (!Array.isArray(permissions.agentScopes)) {
    throw new KilnYamlError(`${path}.agentScopes must be an array`);
  }
  for (const [index, scope] of permissions.agentScopes.entries()) {
    if (typeof scope !== "object" || scope === null || Array.isArray(scope)) continue;
    const inherit = (scope as Record<string, unknown>).inherit;
    if (inherit !== undefined && inherit !== true) {
      throw new KilnYamlError(
        `${path}.agentScopes[${index}].inherit:false is unsupported; agent scopes may only narrow their parent.`,
      );
    }
  }
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
  allocationMode?: "whole-block" | "segmented" | "retrieval-on-demand";
  previewBeforeApply?: boolean;
  preferredSources?: readonly KilnContextGovernanceSource[];
  summaryAggressiveness?: KilnContextGovernanceAggressiveness;
  cachePolicy?: KilnContextGovernanceCachePolicy;
  adaptation?: {
    readonly version: "policy-adaptation-selection-v1";
    readonly revision: number;
    readonly activePolicyId: string;
    readonly activeConfigurationHash: string;
    readonly frozen: boolean;
    readonly freezeReason?: string;
    readonly rollback?: {
      readonly policyId: string;
      readonly configurationHash: string;
      readonly allocationMode: "whole-block" | "segmented" | "retrieval-on-demand";
    };
    readonly candidateRecordHash?: string;
    readonly evaluationEvidenceHash?: string;
  };
}

/** Repository-owned restrictions and project facts. It cannot define execution targets or models. */
export interface KilnProjectConfig {
  readonly version: "1";
  readonly activeInstructionProfiles?: readonly string[];
  readonly workGovernance?: KilnWorkGovernanceConfig;
  readonly domain?: string;
  readonly channels?: string[];
  readonly teamMode?: string;
  readonly requireApproval?: boolean;
  readonly maxDepth?: number;
  readonly parallelWorkers?: number;
  readonly mcp?: KilnYamlMcp;
  readonly permissions?: KilnYamlPermissions;
  readonly communication?: CommunicationIntent;
  readonly web?: KilnYamlWebConfig;
  readonly interactiveUse?: KilnYamlInteractiveUseConfig;
  readonly skills?: KilnYamlSkillsConfig;
  readonly qualityGates?: readonly KilnYamlQualityGate[];
  readonly contextGovernance?: KilnContextGovernanceConfig;
}

/** Fully resolved Runtime input after global authority and project restrictions are composed. */
export interface ResolvedKilnConfig extends KilnProjectConfig {
  readonly provider?: string;
  readonly model?: KilnYamlModel;
  readonly providers?: Record<string, KilnYamlProvider>;
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  readonly deliberationPolicy?: KilnDeliberationPolicyConfig;
  readonly skillGeneration?: KilnYamlSkillGeneration;
  readonly hooks?: KilnHooksConfig;
  /** Global-only physical target authority projected into Runtime composition. */
  readonly targetCatalog?: KilnTargetCatalogConfig;
  /** Global-only reusable authority profiles projected into Runtime composition. */
  readonly authorityProfiles?: readonly KilnAuthorityProfileConfig[];
}
