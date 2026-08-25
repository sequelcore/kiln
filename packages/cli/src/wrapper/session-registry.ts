import type {
  SessionCapabilities,
  IKilnSession,
  KilnCommandPermissionRule,
  KilnFileGovernancePolicy,
  KilnPermissionPolicy,
  KilnToolPermissionRule,
} from "./session.js";
import type { DirectProviderCredentialBinding } from "./direct-provider-adapter-factory.js";
import { debug } from "./debug.js";
import {
  getFieldStrength,
  isDirectProviderId,
  resolveDirectProviderExecutionProfile,
  type DefaultBuiltinToolRegistryOptions,
  type DeliberationResolution,
  type ResolvedCommunicationIntent,
} from "@kilnai/core";
import {
  assertRuntimeHostToolEnforcement,
  HarnessCredentialPoolService,
  type HarnessHomeAuth,
  type HarnessPoolProviderId,
  type ManagedInvocationToolAttachment,
  type OperatorSurfaceController,
  OperatorSessionPreProviderLaunchRejectionError,
  type RuntimeSessionTurnBudgetAuthority,
  type RuntimeExecutionEnvelope,
  type CliDeliberationTransport,
} from "@kilnai/runtime";
import { ClaudeSession, type ClaudeSessionConfig } from "./claude-code-process.js";
import type { ClaudePrivatePlanArtifactCapability } from "./claude-private-plan-artifacts.js";
import { CodexSession } from "./codex-session.js";
import { OpenCodeSession } from "./opencode-session.js";
import { PooledHarnessSession } from "./pooled-harness-session.js";
import { ProviderSession } from "./provider-session.js";
import { WorktreeError, WorktreeManager } from "./worktree-manager.js";
import { normalizePermissionPolicy } from "./permission-normalizer.js";
import { nativeToolName } from "./tool-vocabulary.js";
import { getGuiProviderMetadata } from "@kilnai/gateway-contracts";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import { projectMcpServer, type NativeMcpHarness } from "../config/native-mcp-projection.js";
import { createCanonicalMcpClient } from "../config/mcp-credentials.js";
import { assertNativeMcpProjectionCurrent } from "../config/native-mcp-projection-sync.js";
import { resolveNativeHarnessDir } from "../config/native-harness-home.js";
import { createRuntimePermissionObservationStore } from "./runtime-permission-observation.js";
import { MODEL_FACING_DEFAULT_PERMISSION_POLICY } from "../config/model-facing-permission-policy.js";
import { digestKilnPermissionPolicy } from "../config/model-facing-permission-policy.js";
import { assertConfiguredInvocationAdmission } from "../config/builtin-tool-surface-config.js";
import { admitPreventiveRoute } from "../config/harness-integration-capabilities.js";

export type CliHarnessProviderId = "claude" | "codex" | "opencode";
export type DirectApiProviderId =
  | "codex-oauth"
  | "opencode-go"
  | "opencode-zen"
  | "anthropic"
  | "openai"
  | "deepseek"
  | "openrouter"
  | "ollama"
  | "lmstudio";
export type ProviderId = CliHarnessProviderId | DirectApiProviderId;
export type ProviderDisplayGroup = "subscription" | "harness" | "direct-api";

export interface ProviderDisplayInfo {
  readonly id: ProviderId;
  readonly group: ProviderDisplayGroup;
  readonly models: readonly string[];
  readonly free: boolean;
}

const DIRECT_PROVIDER_COST_TIERS: Record<DirectApiProviderId, "low" | "medium" | "high"> = {
  "codex-oauth": "low",
  "opencode-go": "low",
  "opencode-zen": "medium",
  anthropic: "high",
  openai: "high",
  deepseek: "medium",
  openrouter: "low",
  ollama: "low",
  lmstudio: "low",
};
const DIRECT_PROVIDER_PRIORITIES: Record<DirectApiProviderId, number> = {
  "codex-oauth": 1,
  "opencode-go": 2,
  "opencode-zen": 3,
  anthropic: 4,
  openai: 5,
  openrouter: 6,
  deepseek: 7,
  ollama: 8,
  lmstudio: 9,
};
const RUNTIME_MODEL_DISCOVERY_PROVIDER_IDS = new Set<ProviderId>([
  "codex-oauth",
  "opencode-go",
  "opencode-zen",
]);

function hasNonEmptyEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function isDirectApiProvider(provider: ProviderId | undefined): provider is DirectApiProviderId {
  if (!provider) return false;
  return isDirectProviderId(provider);
}

export function getProviderDisplayInfo(registry: SessionRegistry): ProviderDisplayInfo[] {
  return registry.list().map((provider) => {
    const metadata = getGuiProviderMetadata(provider.id);
    if (!metadata) {
      throw new Error(`Missing GUI provider metadata for ${provider.id}`);
    }
    return {
      id: provider.id,
      group: metadata.group,
      models: [],
      free: metadata.free,
    };
  });
}

export function getRuntimeProviderAvailability(registry: SessionRegistry): Record<string, boolean> {
  const availability: Record<string, boolean> = {};
  for (const provider of registry.list()) {
    if (provider.health === "suppressed") {
      availability[provider.id] = false;
      continue;
    }
    if (RUNTIME_MODEL_DISCOVERY_PROVIDER_IDS.has(provider.id)) {
      availability[provider.id] = true;
      continue;
    }
    try {
      availability[provider.id] = provider.isAvailable?.() !== false;
    } catch {
      availability[provider.id] = false;
    }
  }
  return availability;
}

export interface SessionRequirements {
  readonly requiresMcp?: boolean;
  readonly requiresStreaming?: boolean;
  readonly requiresResume?: boolean;
  readonly maxCostTier?: "low" | "medium" | "high";
  readonly preferredProvider?: ProviderId;
}

export interface SessionProviderDescriptor {
  readonly id: ProviderId;
  readonly deliberationTransport: CliDeliberationTransport;
  readonly capabilities: SessionCapabilities;
  readonly costTier: "low" | "medium" | "high";
  readonly isAvailable?: () => boolean;
  readonly create: (config: ProviderCreateConfig) => IKilnSession;
}

export interface ProviderCreateConfig {
  readonly task: string;
  readonly runtimeSessionId?: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly canonicalMcpServers?: readonly import("@kilnai/core").ResolvedMcpServer[];
  readonly mcpToolAllowlist?: ReadonlySet<string>;
  readonly permissionPolicy: KilnPermissionPolicy;
  readonly model?: string;
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly credentialBinding?: DirectProviderCredentialBinding;
  readonly executionCredential?: import("@kilnai/runtime").ConfiguredExecutionCredential;
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationIntent?: ResolvedCommunicationIntent;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly continuationSessionId?: string;
  readonly sessionLedgerOwner?: "wrapper" | "host";
  readonly ephemeral?: boolean;
  readonly profile?: string;
  readonly skipGitRepoCheck?: boolean;
  readonly outputSchema?: string;
  readonly addDir?: string;
  readonly localProvider?: string;
  readonly operatorSurface?: OperatorSurfaceController;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly managedInvocation?: ManagedInvocationToolAttachment;
  readonly operatorAdoption?: import("@kilnai/runtime").OperatorAdoptionRuntimeBinding;
  readonly authorityAdmissionContext?: import("./provider-session.js").ProviderSessionConfig["authorityAdmissionContext"];
  readonly runtimeExecutionMode?: "execute" | "plan";
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
  /** Provider-neutral managed child result contract. */
  readonly structuredOutputSchema?: Readonly<Record<string, unknown>>;
  /**
   * Operator-resolved harness executable.  When set the provider must execute
   * it and must not fall back to an SDK-bundled build.
   */
  readonly harnessExecutable?: string;
  readonly harnessEvidence?: {
    readonly executable: string;
    readonly version: string;
  };
  readonly privatePlanArtifactCapability?: ClaudePrivatePlanArtifactCapability;
}

export interface CreateDefaultRegistryCommonOptions {
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly canonicalMcpServers?: readonly import("@kilnai/core").ResolvedMcpServer[];
  /** Canonical project root that owns native MCP projection state. */
  readonly canonicalMcpProjectPath?: string;
  /** Canonical project root that owns path-free native runtime handoff evidence. */
  readonly runtimePermissionObservationProjectPath?: string;
}

export type CreateDefaultRegistryOptions = CreateDefaultRegistryCommonOptions & (
  | {
    /** No worktree manager is configured for this registry. */
    readonly worktreeRepoRoot?: undefined;
    readonly worktreeBaseDir?: undefined;
    readonly privateStateRoot?: undefined;
  }
  | {
    /** Canonical repository root used by explicitly configured isolated worktrees. */
    readonly worktreeRepoRoot: string;
    /** Operator-private worktree base directory; never derive this from the repository. */
    readonly worktreeBaseDir: string;
    /** Canonical private project-state root that owns worktreeBaseDir. */
    readonly privateStateRoot: string;
  }
);

export interface ClaudeBackendConfig {
  readonly permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  readonly allowDangerouslySkipPermissions: boolean;
}

export interface CodexBackendConfig {
  readonly approvalMode: "never" | "on-request" | "on-failure" | "untrusted";
  readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
}

export interface OpenCodeBackendConfig {
  readonly permissionDefault: "ask" | "allow" | "deny";
}

export type PermissionTranslationCategory =
  | "tool"
  | "command"
  | "file-governance"
  | "data-firewall"
  | "agent-scope";

export interface PermissionTranslationRule {
  readonly category: PermissionTranslationCategory;
  readonly selector: string;
  readonly action: string;
  readonly reason?: string;
}

export interface ClaudeNativeRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly ask: readonly string[];
}

export interface CodexNativeRules {
  readonly coarseOnly: true;
}

export interface OpenCodeNativeRules {
  readonly tools: readonly Pick<KilnToolPermissionRule, "tool" | "action">[];
  readonly commands: readonly Pick<KilnCommandPermissionRule, "pattern" | "shell" | "action">[];
  readonly fileGovernance: Required<Pick<KilnFileGovernancePolicy, "denyGlobs" | "askGlobs" | "allowGlobs">>;
}

interface BackendTranslationEnvelope<
  TBackend extends ProviderId,
  TConfig,
  TNativeRules,
> {
  readonly backend: TBackend;
  readonly config: TConfig;
  readonly nativeRules: TNativeRules;
  readonly representableRules: readonly PermissionTranslationRule[];
  readonly unsupportedRules: readonly PermissionTranslationRule[];
  readonly constraintInstructions: readonly string[];
  readonly warnings: readonly string[];
}

export type BackendConfig =
  | BackendTranslationEnvelope<"claude", ClaudeBackendConfig, ClaudeNativeRules>
  | BackendTranslationEnvelope<"codex", CodexBackendConfig, CodexNativeRules>
  | BackendTranslationEnvelope<"opencode", OpenCodeBackendConfig, OpenCodeNativeRules>;

type ClaudeTranslationEnvelope = Extract<BackendConfig, { backend: "claude" }>;
type CodexTranslationEnvelope = Extract<BackendConfig, { backend: "codex" }>;
type OpenCodeTranslationEnvelope = Extract<BackendConfig, { backend: "opencode" }>;

const OPENCODE_SANDBOX_WARNING =
  "OpenCode does not natively enforce Kiln sandbox modes; Kiln maps sandbox intent to permission prompting semantics only.";
const DIRECT_PROVIDER_POLICY_WARNING =
  "Direct API providers do not natively enforce Kiln granular permission rules; constraints are appended to the system prompt.";

export interface ProviderPermissionTranslation {
  readonly provider: DirectApiProviderId;
  readonly unsupportedRules: readonly PermissionTranslationRule[];
  readonly constraintInstructions: readonly string[];
  readonly warnings: readonly string[];
}

export function translatePermission(
  policy: KilnPermissionPolicy,
  backend: "claude" | "codex" | "opencode",
): BackendConfig {
  const normalized = normalizePermissionPolicy(policy);
  const approval = normalized.approval ?? "on-request";
  const sandbox = normalized.sandbox ?? "read-only";
  const granularRules = collectTranslationRules(normalized);
  const representableRules = granularRules.filter((rule) => isRepresentableByBackend(rule, backend));
  const unsupportedRules = granularRules.filter((rule) => !isRepresentableByBackend(rule, backend));
  const constraintInstructions = buildConstraintInstructions(backend, unsupportedRules);
  const warnings: string[] = [];
  if (unsupportedRules.length > 0) {
    warnings.push(
      `${unsupportedRules.length} granular permission rule(s) are not natively supported by ${backend} and require Kiln-side constraints`,
    );
  }
  if (backend === "opencode") {
    warnings.push(OPENCODE_SANDBOX_WARNING);
  }

  if (approval === "never") {
    if (sandbox === "read-only") {
      if (backend === "claude") {
        return {
          backend: "claude",
          config: { permissionMode: "acceptEdits", allowDangerouslySkipPermissions: false },
          nativeRules: buildClaudeNativeRules(representableRules),
          representableRules,
          unsupportedRules,
          constraintInstructions,
          warnings,
        };
      }
      if (backend === "codex") {
        return {
          backend: "codex",
          config: { approvalMode: "never", sandboxMode: "read-only" },
          nativeRules: { coarseOnly: true },
          representableRules,
          unsupportedRules,
          constraintInstructions,
          warnings,
        };
      }
      return {
        backend: "opencode",
        config: { permissionDefault: "ask" },
        nativeRules: buildOpenCodeNativeRules(normalized),
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }

    if (sandbox === "workspace-write") {
      if (backend === "claude") {
        return {
          backend: "claude",
          config: { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true },
          nativeRules: buildClaudeNativeRules(representableRules),
          representableRules,
          unsupportedRules,
          constraintInstructions,
          warnings,
        };
      }
      if (backend === "codex") {
        return {
          backend: "codex",
          config: { approvalMode: "never", sandboxMode: "workspace-write" },
          nativeRules: { coarseOnly: true },
          representableRules,
          unsupportedRules,
          constraintInstructions,
          warnings,
        };
      }
      return {
        backend: "opencode",
        config: { permissionDefault: "allow" },
        nativeRules: buildOpenCodeNativeRules(normalized),
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }

    if (sandbox === "danger-full-access") {
      if (backend === "claude") {
        return {
          backend: "claude",
          config: { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true },
          nativeRules: buildClaudeNativeRules(representableRules),
          representableRules,
          unsupportedRules,
          constraintInstructions,
          warnings,
        };
      }
      if (backend === "codex") {
        return {
          backend: "codex",
          config: { approvalMode: "never", sandboxMode: "danger-full-access" },
          nativeRules: { coarseOnly: true },
          representableRules,
          unsupportedRules,
          constraintInstructions,
          warnings,
        };
      }
      return {
        backend: "opencode",
        config: { permissionDefault: "allow" },
        nativeRules: buildOpenCodeNativeRules(normalized),
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }
  }

  if (approval === "on-request") {
    if (backend === "claude") {
      return {
        backend: "claude",
        config: { permissionMode: "default", allowDangerouslySkipPermissions: false },
        nativeRules: buildClaudeNativeRules(representableRules),
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }
    if (backend === "codex") {
      return {
        backend: "codex",
        config: { approvalMode: "on-request", sandboxMode: sandbox },
        nativeRules: { coarseOnly: true },
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }
    return {
      backend: "opencode",
      config: { permissionDefault: "ask" },
      nativeRules: buildOpenCodeNativeRules(normalized),
      representableRules,
      unsupportedRules,
      constraintInstructions,
      warnings,
    };
  }

  if (approval === "on-failure") {
    if (backend === "claude") {
      return {
        backend: "claude",
        config: { permissionMode: "default", allowDangerouslySkipPermissions: false },
        nativeRules: buildClaudeNativeRules(representableRules),
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }
    if (backend === "codex") {
      return {
        backend: "codex",
        config: { approvalMode: "on-failure", sandboxMode: sandbox },
        nativeRules: { coarseOnly: true },
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }
    return {
      backend: "opencode",
      config: { permissionDefault: "ask" },
      nativeRules: buildOpenCodeNativeRules(normalized),
      representableRules,
      unsupportedRules,
      constraintInstructions,
      warnings,
    };
  }

  if (approval === "untrusted") {
    if (backend === "claude") {
      return {
        backend: "claude",
        config: { permissionMode: "plan", allowDangerouslySkipPermissions: false },
        nativeRules: buildClaudeNativeRules(representableRules),
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }
    if (backend === "codex") {
      return {
        backend: "codex",
        config: { approvalMode: "untrusted", sandboxMode: sandbox },
        nativeRules: { coarseOnly: true },
        representableRules,
        unsupportedRules,
        constraintInstructions,
        warnings,
      };
    }
    return {
      backend: "opencode",
      config: { permissionDefault: "deny" },
      nativeRules: buildOpenCodeNativeRules(normalized),
      representableRules,
      unsupportedRules,
      constraintInstructions,
      warnings,
    };
  }

  if (backend === "claude") {
    return {
      backend: "claude",
      config: { permissionMode: "default", allowDangerouslySkipPermissions: false },
      nativeRules: buildClaudeNativeRules(representableRules),
      representableRules,
      unsupportedRules,
      constraintInstructions,
      warnings,
    };
  }
  if (backend === "codex") {
    return {
      backend: "codex",
      config: { approvalMode: approval, sandboxMode: sandbox },
      nativeRules: { coarseOnly: true },
      representableRules,
      unsupportedRules,
      constraintInstructions,
      warnings,
    };
  }
  return {
    backend: "opencode",
    config: { permissionDefault: "ask" },
    nativeRules: buildOpenCodeNativeRules(normalized),
    representableRules,
    unsupportedRules,
    constraintInstructions,
    warnings,
  };
}

export function translatePermissionForProvider(
  policy: KilnPermissionPolicy,
  provider: DirectApiProviderId,
): ProviderPermissionTranslation {
  const normalized = normalizePermissionPolicy(policy);
  const granularRules = collectTranslationRules(normalized);
  const unsupportedRules = granularRules;
  const constraintInstructions = buildConstraintInstructions(provider, unsupportedRules);
  const warnings: string[] = [DIRECT_PROVIDER_POLICY_WARNING];
  if (unsupportedRules.length > 0) {
    warnings.push(
      `${unsupportedRules.length} granular permission rule(s) are not natively supported by ${provider} and require Kiln-side constraints`,
    );
  }
  return {
    provider,
    unsupportedRules,
    constraintInstructions,
    warnings,
  };
}

function collectTranslationRules(
  policy: ReturnType<typeof normalizePermissionPolicy>,
): PermissionTranslationRule[] {
  const rules: PermissionTranslationRule[] = [];

  for (const toolRule of policy.tools) {
    rules.push({
      category: "tool",
      selector: toolRule.tool,
      action: toolRule.action,
      reason: toolRule.reason,
    });
  }

  for (const commandRule of policy.commands) {
    const shell = commandRule.shell ?? "any";
    rules.push({
      category: "command",
      selector: `${shell}:${commandRule.pattern}`,
      action: commandRule.action,
      reason: commandRule.reason,
    });
  }

  for (const glob of policy.fileGovernance.denyGlobs ?? []) {
    rules.push({
      category: "file-governance",
      selector: `deny:${glob}`,
      action: "deny",
    });
  }

  for (const glob of policy.fileGovernance.askGlobs ?? []) {
    rules.push({
      category: "file-governance",
      selector: `ask:${glob}`,
      action: "ask",
    });
  }

  for (const glob of policy.fileGovernance.allowGlobs ?? []) {
    rules.push({
      category: "file-governance",
      selector: `allow:${glob}`,
      action: "allow",
    });
  }

  for (const dataFirewallRule of policy.dataFirewall) {
    const classes = dataFirewallRule.classifications?.length
      ? `[${dataFirewallRule.classifications.join(",")}]`
      : "";
    rules.push({
      category: "data-firewall",
      selector: `${dataFirewallRule.destination}${classes}`,
      action: dataFirewallRule.action,
      reason: dataFirewallRule.reason,
    });
  }

  for (const agentScope of policy.agentScopes) {
    const hasScopedRestriction = agentScope.tools !== undefined
      || agentScope.commands !== undefined
      || agentScope.fileGovernance !== undefined
      || agentScope.memory !== undefined
      || agentScope.mcpTools !== undefined;
    const mode = agentScope.inherit === false
      ? "replace"
      : hasScopedRestriction
        ? "restrict"
        : "inherit";
    rules.push({
      category: "agent-scope",
      selector: `${agentScope.agent}:${mode}`,
      action: mode,
    });
  }

  return rules;
}

/** `collectTranslationRules` encodes a command rule as `<shell>:<pattern>`. */
function commandPattern(selector: string): string {
  return selector.slice(selector.indexOf(":") + 1);
}

/**
 * Neither Claude nor OpenCode models shell selection in a permission rule, so a
 * rule scoped to one shell cannot be lowered without widening it to every
 * shell. Those stay unsupported and reach the agent as a stated constraint.
 */
function isShellAgnosticCommand(rule: PermissionTranslationRule): boolean {
  return rule.selector.startsWith("any:");
}

function isRepresentableByBackend(
  rule: PermissionTranslationRule,
  backend: ProviderId,
): boolean {
  if (backend === "codex") return false;
  if (rule.category === "command") {
    return isShellAgnosticCommand(rule);
  }
  if (rule.category === "tool") {
    return nativeToolName(rule.selector, backend) !== undefined;
  }
  return backend === "opencode" && rule.category === "file-governance";
}

function buildConstraintInstructions(
  backend: ProviderId,
  unsupportedRules: readonly PermissionTranslationRule[],
): string[] {
  if (unsupportedRules.length === 0) return [];
  const lines: string[] = [`Kiln policy constraints for ${backend}:`];
  for (const rule of unsupportedRules) {
    lines.push(
      `[${rule.category}] ${rule.action.toUpperCase()} ${rule.selector}${rule.reason ? ` -- ${rule.reason}` : ""}`,
    );
  }
  return lines;
}

function buildClaudeNativeRules(
  representableRules: readonly PermissionTranslationRule[],
): ClaudeNativeRules {
  const allow: string[] = [];
  const deny: string[] = [];
  const ask: string[] = [];

  for (const rule of representableRules) {
    const target = rule.category === "command"
      ? `Bash(${commandPattern(rule.selector)})`
      : nativeToolName(rule.selector, "claude");
    if (target === undefined) {
      continue;
    }
    if (rule.action === "allow") {
      allow.push(target);
      continue;
    }
    if (rule.action === "deny") {
      deny.push(target);
      continue;
    }
    ask.push(target);
  }

  return { allow, deny, ask };
}

function buildOpenCodeNativeRules(
  policy: ReturnType<typeof normalizePermissionPolicy>,
): OpenCodeNativeRules {
  const tools = policy.tools.flatMap((rule) => {
    const tool = nativeToolName(rule.tool, "opencode");
    return tool === undefined ? [] : [{ tool, action: rule.action }];
  });

  // Shell-scoped rules are excluded for the same reason as Claude: OpenCode
  // matches a bash pattern with no shell dimension, so lowering one would widen
  // it to every shell.
  const commands = policy.commands
    .filter((rule) => (rule.shell ?? "any") === "any")
    .map((rule) => ({
      pattern: rule.pattern,
      shell: "any" as const,
      action: rule.action,
    }));

  return {
    tools,
    commands,
    fileGovernance: {
      denyGlobs: [...(policy.fileGovernance.denyGlobs ?? [])],
      askGlobs: [...(policy.fileGovernance.askGlobs ?? [])],
      allowGlobs: [...(policy.fileGovernance.allowGlobs ?? [])],
    },
  };
}

interface CircuitBreakerState {
  state: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailureAt: number | null;
  suppressUntil: number | null;
}

export interface CandidateScore {
  readonly id: ProviderId;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly excluded: boolean;
  readonly exclusionReason?: string;
}

export interface SelectionResult {
  readonly primary: ProviderId;
  readonly orderedFallbacks: readonly ProviderId[];
  readonly scores: readonly CandidateScore[];
}

const COST_TIER_RANK: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export class SessionUnavailableError extends Error {
  constructor(
    public readonly requirements: SessionRequirements,
    public readonly scores: readonly CandidateScore[],
  ) {
    super("No available session provider matches requirements");
    this.name = "SessionUnavailableError";
  }
}

export class SessionRegistry {
  private readonly providers = new Map<ProviderId, SessionProviderDescriptor>();
  private readonly circuitBreakers = new Map<ProviderId, CircuitBreakerState>();
  private readonly suppressionWindowMs = 30_000;
  private readonly failureThreshold = 3;

  constructor(providers: readonly SessionProviderDescriptor[]) {
    for (const p of providers) {
      this.providers.set(p.id, p);
      this.circuitBreakers.set(p.id, {
        state: "closed",
        failureCount: 0,
        lastFailureAt: null,
        suppressUntil: null,
      });
    }
  }

  selectBest(requirements: SessionRequirements = {}): SelectionResult {
    const allIds: ProviderId[] = [...this.providers.keys()];
    const scores: CandidateScore[] = [];
    const candidates: ProviderId[] = [];

    for (const id of allIds) {
      const descriptor = this.providers.get(id);
      if (!descriptor) continue;

      const score = this._score(descriptor, requirements);
      scores.push(score);

      if (!score.excluded && this._isAvailable(id)) {
        candidates.push(id);
      }
    }

    if (candidates.length === 0) {
      throw new SessionUnavailableError(requirements, scores);
    }

    candidates.sort((a, b) => {
      const sa = scores.find((s) => s.id === a)!;
      const sb = scores.find((s) => s.id === b)!;
      return sb.score - sa.score;
    });

    const primary = candidates[0]!;
    const orderedFallbacks = candidates.slice(1);

    return { primary, orderedFallbacks, scores };
  }

  createSession(id: ProviderId, config: ProviderCreateConfig): IKilnSession {
    const descriptor = this.providers.get(id);
    if (!descriptor) {
      throw new Error(`Unknown provider: ${id}`);
    }
    if (!this._isAvailable(id)) {
      throw new Error(`Provider unavailable: ${id}`);
    }
    assertPreventiveSessionRoute(id, config);
    return descriptor.create(config);
  }

  reportSuccess(id: ProviderId): void {
    const cb = this.circuitBreakers.get(id);
    if (!cb) return;

    if (cb.state === "half-open") {
      cb.state = "closed";
      cb.failureCount = 0;
      cb.lastFailureAt = null;
      cb.suppressUntil = null;
    } else if (cb.state === "closed") {
      cb.failureCount = 0;
    }
  }

  reportFailure(id: ProviderId, _isPreflightCrash: boolean): void {
    const cb = this.circuitBreakers.get(id);
    if (!cb) return;

    cb.lastFailureAt = Date.now();

    if (cb.state === "half-open") {
      cb.state = "open";
      cb.suppressUntil = Date.now() + this.suppressionWindowMs;
    } else {
      cb.failureCount += 1;
      if (cb.failureCount >= this.failureThreshold) {
        cb.state = "open";
        cb.suppressUntil = Date.now() + this.suppressionWindowMs;
      }
    }
  }

  getHealth(id: ProviderId): "healthy" | "suppressed" | "half-open" {
    const cb = this.circuitBreakers.get(id);
    if (!cb) return "healthy";

    if (cb.state === "half-open") return "half-open";
    if (cb.state === "open") {
      if (cb.suppressUntil !== null && Date.now() >= cb.suppressUntil) {
        cb.state = "half-open";
        return "half-open";
      }
      return "suppressed";
    }
    return "healthy";
  }

  list(): readonly (SessionProviderDescriptor & {
    health: "healthy" | "suppressed" | "half-open";
  })[] {
    const ids: ProviderId[] = [...this.providers.keys()];
    return ids
      .map((id) => {
        const descriptor = this.providers.get(id);
        if (!descriptor) return null;
        return { ...descriptor, health: this.getHealth(id) };
      })
      .filter((x): x is SessionProviderDescriptor & { health: "healthy" | "suppressed" | "half-open" } => x !== null);
  }

  private _isAvailable(id: ProviderId): boolean {
    const descriptor = this.providers.get(id);
    if (!descriptor) return false;
    if (descriptor.isAvailable && !descriptor.isAvailable()) return false;

    const cb = this.circuitBreakers.get(id);
    if (!cb) return true;

    if (cb.state === "closed") return true;

    if (cb.state === "half-open") return true;

    if (cb.state === "open") {
      if (cb.suppressUntil !== null && Date.now() >= cb.suppressUntil) {
        cb.state = "half-open";
        return true;
      }
      return false;
    }

    return true;
  }

  private _score(
    descriptor: SessionProviderDescriptor,
    requirements: SessionRequirements,
  ): CandidateScore {
    const reasons: string[] = [];
    let score = 0;
    let excluded = false;
    let exclusionReason: string | undefined;

    if (requirements.preferredProvider === descriptor.id) {
      score += 100;
      reasons.push(`preferred provider: ${descriptor.id}`);
    }

    if (requirements.requiresMcp && !descriptor.capabilities.mcp) {
      excluded = true;
      exclusionReason = `requires MCP but ${descriptor.id} does not support it`;
    }
    if (requirements.requiresStreaming && !descriptor.capabilities.streaming) {
      excluded = true;
      exclusionReason = `requires streaming but ${descriptor.id} does not support it`;
    }
    if (requirements.requiresResume && !descriptor.capabilities.resume) {
      excluded = true;
      exclusionReason = `requires resume but ${descriptor.id} does not support it`;
    }

    if (!excluded && requirements.maxCostTier !== undefined) {
      const maxRank = COST_TIER_RANK[requirements.maxCostTier];
      const descRank = COST_TIER_RANK[descriptor.costTier];
      if (descRank <= maxRank) {
        score += 50;
        reasons.push(`cost tier ${descriptor.costTier} within limit`);
      }
    }

    if (!excluded) {
      score += (4 - descriptor.capabilities.priority) * 10;
      reasons.push(`priority ${descriptor.capabilities.priority}`);
    }

    if (!excluded) {
      const fieldPressure = getFieldStrength(`provider:${descriptor.id}`);
      if (fieldPressure > 0) {
        const bonus = Math.min(fieldPressure * 15, 15);
        score += bonus;
        reasons.push(`field pressure +${bonus.toFixed(2)}`);
      }
    }

    if (!excluded) {
      reasons.push(`${descriptor.id} is available`);
    }

    return {
      id: descriptor.id,
      score,
      reasons: reasons as readonly string[],
      excluded,
      exclusionReason,
    };
  }
}

function assertPreventiveSessionRoute(id: ProviderId, config: ProviderCreateConfig): void {
  const direct = isDirectApiProvider(id);
  const directProfile = direct
    ? resolveDirectProviderExecutionProfile({ provider: id, model: config.model })
    : undefined;
  const directExecutesTools = directProfile?.executionMode === "kiln-executable";
  const translated = direct
    ? translatePermissionForProvider(config.permissionPolicy, id)
    : translatePermission(config.permissionPolicy, id);
  const hostEnforced = directExecutesTools ? assertHostEnforcementIfPresent(config) : false;
  const admission = admitPreventiveRoute({
    route: direct ? "direct-provider" : id,
    // Text-only direct routes cannot perform tool effects, so no tool-route
    // prohibition or sandbox claim is required. Kiln-executable direct
    // routes are gated by the actual Runtime authorizer below.
    approval: directExecutesTools && !hostEnforced ? config.permissionPolicy.approval : undefined,
    sandbox: directExecutesTools && !hostEnforced ? config.permissionPolicy.sandbox : undefined,
    representableRules: !direct && "representableRules" in translated ? translated.representableRules : [],
    unsupportedRules: direct && !directExecutesTools
      ? []
      : hostEnforced
        ? translated.unsupportedRules.filter((rule) => !isHostInvocationEnforcedRule(rule))
        : translated.unsupportedRules,
  });
  if (!admission.admitted) {
    throw new OperatorSessionPreProviderLaunchRejectionError(
      `Session route '${id}' rejected before provider launch: ${admission.reason}`,
    );
  }
}

function isHostInvocationEnforcedRule(rule: PermissionTranslationRule): boolean {
  if (rule.category === "agent-scope") return false;
  if (rule.category === "data-firewall") return true;
  return rule.category === "tool"
    || rule.category === "command"
    || rule.category === "file-governance";
}

function assertHostEnforcementIfPresent(config: ProviderCreateConfig): boolean {
  const context = config.authorityAdmissionContext;
  const perCallConfig = context?.perCallConfig;
  const admitted = context?.bundle.turn.tools.hostEnforcement;
  if (!admitted && !perCallConfig?.runtimeHostToolEnforcement) return false;
  if (!context || !perCallConfig || !admitted) {
    throw new OperatorSessionPreProviderLaunchRejectionError(
      "Session route rejected before provider launch: incomplete Runtime host enforcement evidence.",
    );
  }
  if (admitted.permissionPolicyDigest !== digestKilnPermissionPolicy(config.permissionPolicy)) {
    throw new OperatorSessionPreProviderLaunchRejectionError(
      "Session route rejected before provider launch: host enforcement permission policy is stale or contradictory.",
    );
  }
  try {
    assertConfiguredInvocationAdmission(perCallConfig.toolInvocationAdmission, config.permissionPolicy);
    assertRuntimeHostToolEnforcement(perCallConfig.runtimeHostToolEnforcement, {
      bundle: context.bundle,
      sandbox: perCallConfig.sandbox,
      invocationAdmission: perCallConfig.toolInvocationAdmission,
    });
  } catch (error) {
    throw new OperatorSessionPreProviderLaunchRejectionError(
      `Session route rejected before provider launch: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return true;
}

const HARNESS_PROVIDER_HOME_ENV: Record<HarnessPoolProviderId, string> = {
  "claude-code": "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
  opencode: "OPENCODE_CONFIG_DIR",
};

function withHarnessHomeEnv(
  provider: HarnessPoolProviderId,
  env: Record<string, string> | undefined,
  auth: HarnessHomeAuth,
): Record<string, string> {
  return {
    ...(env ?? {}),
    [HARNESS_PROVIDER_HOME_ENV[provider]]: auth.homeDir,
  };
}

function withDefaultHarnessHomeEnv(
  provider: HarnessPoolProviderId,
  env: Record<string, string> | undefined,
): Record<string, string> {
  const envName = HARNESS_PROVIDER_HOME_ENV[provider];
  const configured = env?.[envName]?.trim();
  const harness = provider === "claude-code" ? "claude" : provider;
  return {
    ...(env ?? {}),
    [envName]: configured || resolveNativeHarnessDir(harness),
  };
}

function createPooledHarnessSession(
  provider: HarnessPoolProviderId,
  createSession: (auth: HarnessHomeAuth) => IKilnSession,
  createDefaultSession: () => IKilnSession,
  runtimeSessionId?: string,
  kilnHome?: string,
): IKilnSession {
  return new PooledHarnessSession({
    ...(runtimeSessionId ? { runtimeSessionId } : {}),
    provider,
    pool: new HarnessCredentialPoolService({ kilnHome }).createPool(provider),
    createSession,
    createDefaultSession,
  });
}

function projectCanonicalMcpServers(
  harness: NativeMcpHarness,
  servers: readonly import("@kilnai/core").ResolvedMcpServer[] | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!servers || servers.length === 0) return undefined;
  const projected: Record<string, Record<string, unknown>> = {};
  for (const server of servers) {
    const result = projectMcpServer(harness, server);
    if (result.status === "disabled") continue;
    if (result.status === "incompatible") {
      throw new Error(`${harness} cannot represent canonical MCP server '${server.id}': ${result.reason}`);
    }
    projected[server.id] = result.entry;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function buildDirectProviderCapabilities(provider: DirectApiProviderId): SessionCapabilities {
  return {
    mcp: true,
    streaming: true,
    resumable: false,
    resume: false,
    costTrackingMode: "computed",
    supportedTools: [],
    maxContextTokens: null,
    priority: DIRECT_PROVIDER_PRIORITIES[provider],
    fallbackTo: null,
    permissionPolicy: MODEL_FACING_DEFAULT_PERMISSION_POLICY,
  };
}

function createDirectProviderSession(
  provider: DirectApiProviderId,
  config: ProviderCreateConfig,
): ProviderSession {
  const translated = translatePermissionForProvider(config.permissionPolicy, provider);
  for (const warning of translated.warnings) {
    debug(`[provider:${provider}]`, warning);
  }

  const profile = resolveDirectProviderExecutionProfile({
    provider,
    model: config.model,
  });
  if (!profile) {
    throw new Error(`Direct provider '${provider}' requires a non-empty configured model`);
  }

  return new ProviderSession({
    provider,
    ...(config.kilnHome ? { kilnHome: config.kilnHome } : {}),
    ...(config.runtimeSessionId ? { runtimeSessionId: config.runtimeSessionId } : {}),
    model: config.model,
    ...(config.credentialBinding ? { credentialBinding: config.credentialBinding } : {}),
    ...(config.executionCredential ? { executionCredential: config.executionCredential } : {}),
    requestedAuthority: config.requestedAuthority,
    task: config.task,
    systemPrompt: config.systemPrompt,
    cwd: config.cwd,
    env: config.env,
    permissionPolicy: config.permissionPolicy,
    constraintInstructions: translated.constraintInstructions,
    executionProfile: profile,
    ...(config.operatorSurface ? { operatorSurface: config.operatorSurface } : {}),
    ...(config.builtinToolOptions ? { builtinToolOptions: config.builtinToolOptions } : {}),
    ...(config.managedInvocation ? { managedInvocation: config.managedInvocation } : {}),
    ...(config.operatorAdoption ? { operatorAdoption: config.operatorAdoption } : {}),
    ...(config.authorityAdmissionContext ? { authorityAdmissionContext: config.authorityAdmissionContext } : {}),
    ...(config.runtimeExecutionMode ? { runtimeExecutionMode: config.runtimeExecutionMode } : {}),
    // Canonical authority admission owns the single pre-fence budget decision;
    // do not wire its source back into either ProviderSession execution mode.
    ...(!config.authorityAdmissionContext && config.sessionTurnBudget
      ? { sessionTurnBudget: config.sessionTurnBudget }
      : {}),
    ...(config.executionEnvelope ? { executionEnvelope: config.executionEnvelope } : {}),
    ...(config.communicationIntent ? { communicationIntent: config.communicationIntent } : {}),
    ...(config.authorityAdmissionContext ? {
      mcpClients: config.authorityAdmissionContext.mcpClients,
    } : config.canonicalMcpServers ? {
      mcpClients: config.canonicalMcpServers.map((server) => createCanonicalMcpClient(server, config.kilnHome)),
    } : {}),
    ...(config.mcpToolAllowlist ? { mcpToolAllowlist: config.mcpToolAllowlist } : {}),
  });
}

function createDirectProviderDescriptor(
  provider: DirectApiProviderId,
  isAvailable?: () => boolean,
  canonicalMcpServers?: readonly import("@kilnai/core").ResolvedMcpServer[],
  kilnHome?: string,
): SessionProviderDescriptor {
  return {
    id: provider,
    deliberationTransport: provider === "codex-oauth" || provider === "anthropic" || provider === "openai"
      ? "native-level"
      : "none",
    costTier: DIRECT_PROVIDER_COST_TIERS[provider],
    capabilities: buildDirectProviderCapabilities(provider),
    ...(isAvailable ? { isAvailable } : {}),
    create: (config) => createDirectProviderSession(provider, {
      ...config,
      kilnHome: config.kilnHome ?? kilnHome,
      canonicalMcpServers: config.canonicalMcpServers ?? canonicalMcpServers,
    }),
  };
}

export function createDefaultRegistry(options: CreateDefaultRegistryOptions = {}): {
  registry: SessionRegistry;
  worktreeManager: WorktreeManager;
} {
  const worktreeConfigured = options.worktreeRepoRoot !== undefined
    || options.worktreeBaseDir !== undefined
    || options.privateStateRoot !== undefined;
  if (worktreeConfigured && (
    typeof options.worktreeRepoRoot !== "string"
    || options.worktreeRepoRoot.trim().length === 0
    || typeof options.worktreeBaseDir !== "string"
    || options.worktreeBaseDir.trim().length === 0
    || typeof options.privateStateRoot !== "string"
    || options.privateStateRoot.trim().length === 0
  )) {
    throw new WorktreeError(
      "Configured private worktrees require worktreeRepoRoot, worktreeBaseDir, and canonical privateStateRoot.",
    );
  }
  const worktreeManager = new WorktreeManager(
    options.worktreeRepoRoot,
    options.worktreeBaseDir,
    undefined,
    options.privateStateRoot,
  );
  const runtimePermissionObservationSink = options.runtimePermissionObservationProjectPath
    ? createRuntimePermissionObservationStore({ projectPath: options.runtimePermissionObservationProjectPath })
    : undefined;
  if (options.worktreeRepoRoot !== undefined && options.worktreeBaseDir !== undefined) {
    worktreeManager.pruneStale().catch((err: unknown) => {
      debug("pruneStale error:", err instanceof Error ? err.message : String(err));
    });
  }

  const codexOauthProvider = createDirectProviderDescriptor("codex-oauth", undefined, options.canonicalMcpServers, options.kilnHome);
  const opencodeGoProvider = createDirectProviderDescriptor("opencode-go", undefined, options.canonicalMcpServers, options.kilnHome);
  const opencodeZenProvider = createDirectProviderDescriptor("opencode-zen", undefined, options.canonicalMcpServers, options.kilnHome);
  const directProviders: SessionProviderDescriptor[] = [
    createDirectProviderDescriptor("anthropic", () => hasNonEmptyEnv("ANTHROPIC_API_KEY"), options.canonicalMcpServers, options.kilnHome),
    createDirectProviderDescriptor("openai", () => hasNonEmptyEnv("OPENAI_API_KEY"), options.canonicalMcpServers, options.kilnHome),
    createDirectProviderDescriptor("deepseek", () => hasNonEmptyEnv("DEEPSEEK_API_KEY"), options.canonicalMcpServers, options.kilnHome),
    createDirectProviderDescriptor("openrouter", () => hasNonEmptyEnv("OPENROUTER_API_KEY"), options.canonicalMcpServers, options.kilnHome),
    createDirectProviderDescriptor("ollama", undefined, options.canonicalMcpServers, options.kilnHome),
    createDirectProviderDescriptor("lmstudio", undefined, options.canonicalMcpServers, options.kilnHome),
  ];

  const providers: SessionProviderDescriptor[] = [
    codexOauthProvider,
    opencodeGoProvider,
    opencodeZenProvider,
    {
      id: "claude",
      deliberationTransport: "native-level",
      costTier: "high",
      capabilities: {
        mcp: true,
        streaming: true,
        resumable: false,
        resume: false,
        costTrackingMode: "native",
        supportedTools: [],
        maxContextTokens: null,
        priority: 1,
        fallbackTo: null,
        permissionPolicy: MODEL_FACING_DEFAULT_PERMISSION_POLICY,
      },
      create: (config) => {
        const translated = translatePermission(config.permissionPolicy, "claude") as ClaudeTranslationEnvelope;
        const cfg = translated.config;
        const createSession = (env: Record<string, string> | undefined) => new ClaudeSession({
          ...(config.runtimeSessionId ? { runtimeSessionId: config.runtimeSessionId } : {}),
          task: config.task,
          systemPrompt: config.systemPrompt ?? "",
          mcpServers: projectCanonicalMcpServers(
            "claude",
            config.canonicalMcpServers ?? options.canonicalMcpServers,
          ) as ClaudeSessionConfig["mcpServers"],
          cwd: config.cwd ?? process.cwd(),
          env,
          permissionMode: cfg.permissionMode,
          allowDangerouslySkipPermissions: cfg.allowDangerouslySkipPermissions,
          nativeRules: translated.nativeRules,
          representableRules: translated.representableRules,
          unsupportedRules: translated.unsupportedRules,
          constraintInstructions: translated.constraintInstructions,
          translationWarnings: translated.warnings,
          continuationSessionId: config.continuationSessionId,
          sessionLedgerOwner: config.sessionLedgerOwner,
          model: config.model,
          deliberationResolution: config.deliberationResolution,
          communicationIntent: config.communicationIntent,
          structuredOutputSchema: config.structuredOutputSchema,
          harnessExecutable: config.harnessExecutable,
          harnessEvidence: config.harnessEvidence,
          privatePlanArtifactCapability: config.privatePlanArtifactCapability,
          runtimePermissionObservationSink,
        });
        return createPooledHarnessSession(
          "claude-code",
          (auth) => createSession(withHarnessHomeEnv("claude-code", config.env, auth)),
          () => createSession(withDefaultHarnessHomeEnv("claude-code", config.env)),
          config.runtimeSessionId,
          options.kilnHome,
        );
      },
    },
    {
      id: "codex",
      deliberationTransport: "native-level",
      costTier: "low",
      capabilities: {
        mcp: true,
        streaming: true,
        resumable: false,
        resume: false,
        costTrackingMode: "computed",
        supportedTools: [],
        maxContextTokens: null,
        priority: 3,
        fallbackTo: null,
        permissionPolicy: MODEL_FACING_DEFAULT_PERMISSION_POLICY,
      },
      create: (config) => {
        const canonicalMcpServers = config.canonicalMcpServers ?? options.canonicalMcpServers ?? [];
        if (canonicalMcpServers.length > 0) {
          assertNativeMcpProjectionCurrent(
            { servers: Object.fromEntries(canonicalMcpServers.map((server) => [server.id, server])), diagnostics: [] },
            options.canonicalMcpProjectPath ?? process.cwd(),
            "codex",
          );
        }
        const translated = translatePermission(config.permissionPolicy, "codex") as CodexTranslationEnvelope;
        const cfg = translated.config;
        const createSession = (env: Record<string, string> | undefined) => new CodexSession({
          ...(config.runtimeSessionId ? { runtimeSessionId: config.runtimeSessionId } : {}),
          task: config.task,
          model: config.model,
          cwd: config.cwd,
          env,
          approvalMode: cfg.approvalMode,
          sandboxMode: cfg.sandboxMode,
          ephemeral: config.ephemeral,
          profile: config.profile,
          skipGitRepoCheck: config.skipGitRepoCheck,
          outputSchema: config.outputSchema,
          addDir: config.addDir,
          localProvider: config.localProvider,
          deliberationResolution: config.deliberationResolution,
          communicationIntent: config.communicationIntent,
          nativeRules: translated.nativeRules,
          representableRules: translated.representableRules,
          unsupportedRules: translated.unsupportedRules,
          constraintInstructions: translated.constraintInstructions,
          translationWarnings: translated.warnings,
          continuationSessionId: config.continuationSessionId,
          sessionLedgerOwner: config.sessionLedgerOwner,
          runtimePermissionObservationSink,
        });
        return createPooledHarnessSession(
          "codex",
          (auth) => createSession(withHarnessHomeEnv("codex", config.env, auth)),
          () => createSession(config.env),
          config.runtimeSessionId,
          options.kilnHome,
        );
      },
    },
    {
      id: "opencode",
      // The execution boundary still sends a variant only after Core admits
      // exact model-scoped evidence; this advertises the verified transport.
      deliberationTransport: "native-level",
      costTier: "medium",
      capabilities: {
        mcp: true,
        streaming: true,
        resumable: false,
        resume: false,
        costTrackingMode: "native",
        supportedTools: [],
        maxContextTokens: null,
        priority: 2,
        fallbackTo: null,
        permissionPolicy: MODEL_FACING_DEFAULT_PERMISSION_POLICY,
      },
      create: (config) => {
        const translated = translatePermission(config.permissionPolicy, "opencode") as OpenCodeTranslationEnvelope;
        const cfg = translated.config;
        const mcpServers = projectCanonicalMcpServers("opencode", config.canonicalMcpServers ?? options.canonicalMcpServers);
        const createSession = (env: Record<string, string> | undefined) => new OpenCodeSession({
          ...(config.runtimeSessionId ? { runtimeSessionId: config.runtimeSessionId } : {}),
          task: config.task,
          model: config.model,
          cwd: config.cwd ?? process.cwd(),
          env,
          mcpServers,
          permissionDefault: cfg.permissionDefault,
          sandboxMode: config.permissionPolicy.sandbox,
          nativeRules: translated.nativeRules,
          representableRules: translated.representableRules,
          unsupportedRules: translated.unsupportedRules,
          constraintInstructions: translated.constraintInstructions,
          translationWarnings: translated.warnings,
          continuationSessionId: (config as { continuationSessionId?: string }).continuationSessionId,
          sessionLedgerOwner: config.sessionLedgerOwner,
          deliberationResolution: config.deliberationResolution,
          communicationIntent: config.communicationIntent,
          harnessExecutable: config.harnessExecutable,
          harnessEvidence: config.harnessEvidence,
          runtimePermissionObservationSink,
        });
        // The admitted variant belongs to the ambient accountless catalog.
        // Do not substitute a pooled credential home after admission.
        if (config.deliberationResolution) return createSession(config.env);
        return createPooledHarnessSession(
          "opencode",
          (auth) => createSession(withHarnessHomeEnv("opencode", config.env, auth)),
          () => createSession(config.env),
          config.runtimeSessionId,
          options.kilnHome,
        );
      },
    },
    ...directProviders,
  ];

  const registry = new SessionRegistry(providers);
  return { registry, worktreeManager };
}
