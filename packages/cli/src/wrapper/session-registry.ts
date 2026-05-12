import type {
  SessionCapabilities,
  IKilnSession,
  KilnCommandPermissionRule,
  KilnFileGovernancePolicy,
  KilnPermissionPolicy,
  KilnToolPermissionRule,
} from "./session.js";
import { debug } from "./debug.js";
import {
  getFieldStrength,
  isDirectProviderId,
  resolveDirectProviderExecutionProfile,
  type DefaultBuiltinToolRegistryOptions,
  type ReasoningEffort,
} from "@kilnai/core";
import {
  HarnessCredentialPoolService,
  type HarnessHomeAuth,
  type HarnessPoolProviderId,
  type ManagedInvocationToolOptions,
  type OperatorSurfaceController,
} from "@kilnai/runtime";
import { ClaudeSession } from "./claude-code-process.js";
import { CodexSession } from "./codex-session.js";
import { OpenCodeSession } from "./opencode-session.js";
import { PooledHarnessSession } from "./pooled-harness-session.js";
import { ProviderSession } from "./provider-session.js";
import { WorktreeManager } from "./worktree-manager.js";
import { normalizePermissionPolicy } from "./permission-normalizer.js";
import { getGuiProviderMetadata } from "@kilnai/gateway-contracts";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";

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
  readonly capabilities: SessionCapabilities;
  readonly costTier: "low" | "medium" | "high";
  readonly isAvailable?: () => boolean;
  readonly create: (config: ProviderCreateConfig) => IKilnSession;
}

export interface ProviderCreateConfig {
  readonly task: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly mcpServers?: Record<string, { command: string; args: string[] }>;
  readonly permissionPolicy: KilnPermissionPolicy;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly resumeSessionId?: string;
  readonly sessionLedgerOwner?: "wrapper" | "host";
  readonly ephemeral?: boolean;
  readonly profile?: string;
  readonly skipGitRepoCheck?: boolean;
  readonly outputSchema?: string;
  readonly addDir?: string;
  readonly localProvider?: string;
  readonly operatorSurface?: OperatorSurfaceController;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly managedInvocation?: ManagedInvocationToolOptions;
}

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
    const mode = agentScope.inherit === false ? "replace" : "inherit";
    rules.push({
      category: "agent-scope",
      selector: `${agentScope.agent}:${mode}`,
      action: mode,
    });
  }

  return rules;
}

function isRepresentableByBackend(
  rule: PermissionTranslationRule,
  backend: ProviderId,
): boolean {
  if (backend === "codex") return false;
  if (backend === "claude") {
    return rule.category === "tool" || rule.category === "command";
  }
  return rule.category === "tool"
    || rule.category === "command"
    || rule.category === "file-governance";
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
      ? `Bash(${rule.selector})`
      : rule.selector;
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
  const tools = policy.tools.map((rule) => ({
    tool: rule.tool,
    action: rule.action,
  }));

  const commands = policy.commands.map((rule) => ({
    pattern: rule.pattern,
    shell: rule.shell ?? "any",
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

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "on-request", sandbox: "read-only" };

const HARNESS_PROVIDER_HOME_ENV: Record<HarnessPoolProviderId, string> = {
  "claude-code": "CLAUDE_HOME",
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

function createPooledHarnessSession(
  provider: HarnessPoolProviderId,
  createSession: (auth: HarnessHomeAuth) => IKilnSession,
  createDefaultSession: () => IKilnSession,
): IKilnSession {
  return new PooledHarnessSession({
    provider,
    pool: new HarnessCredentialPoolService().createPool(provider),
    createSession,
    createDefaultSession,
  });
}

function buildDirectProviderCapabilities(provider: DirectApiProviderId): SessionCapabilities {
  return {
    mcp: false,
    streaming: true,
    resumable: false,
    resume: false,
    costTrackingMode: "computed",
    supportedTools: [],
    maxContextTokens: null,
    priority: DIRECT_PROVIDER_PRIORITIES[provider],
    fallbackTo: null,
    permissionPolicy: DEFAULT_POLICY,
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
    model: config.model,
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
  });
}

function createDirectProviderDescriptor(
  provider: DirectApiProviderId,
  isAvailable?: () => boolean,
): SessionProviderDescriptor {
  return {
    id: provider,
    costTier: DIRECT_PROVIDER_COST_TIERS[provider],
    capabilities: buildDirectProviderCapabilities(provider),
    ...(isAvailable ? { isAvailable } : {}),
    create: (config) => createDirectProviderSession(provider, config),
  };
}

export function createDefaultRegistry(): {
  registry: SessionRegistry;
  worktreeManager: WorktreeManager;
} {
  const worktreeManager = new WorktreeManager(process.cwd());
  worktreeManager.pruneStale().catch((err: unknown) => {
    debug("pruneStale error:", err instanceof Error ? err.message : String(err));
  });

  const codexOauthProvider = createDirectProviderDescriptor("codex-oauth");
  const opencodeGoProvider = createDirectProviderDescriptor("opencode-go");
  const opencodeZenProvider = createDirectProviderDescriptor("opencode-zen");
  const directProviders: SessionProviderDescriptor[] = [
    createDirectProviderDescriptor("anthropic", () => hasNonEmptyEnv("ANTHROPIC_API_KEY")),
    createDirectProviderDescriptor("openai", () => hasNonEmptyEnv("OPENAI_API_KEY")),
    createDirectProviderDescriptor("deepseek", () => hasNonEmptyEnv("DEEPSEEK_API_KEY")),
    createDirectProviderDescriptor("openrouter", () => hasNonEmptyEnv("OPENROUTER_API_KEY")),
    createDirectProviderDescriptor("ollama"),
    createDirectProviderDescriptor("lmstudio"),
  ];

  const providers: SessionProviderDescriptor[] = [
    codexOauthProvider,
    opencodeGoProvider,
    opencodeZenProvider,
    {
      id: "claude",
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
        permissionPolicy: DEFAULT_POLICY,
      },
      create: (config) => {
        const translated = translatePermission(config.permissionPolicy, "claude") as ClaudeTranslationEnvelope;
        const cfg = translated.config;
        const createSession = (env: Record<string, string> | undefined) => new ClaudeSession({
          task: config.task,
          systemPrompt: config.systemPrompt ?? "",
          mcpServers: config.mcpServers,
          cwd: config.cwd ?? process.cwd(),
          env,
          permissionMode: cfg.permissionMode,
          allowDangerouslySkipPermissions: cfg.allowDangerouslySkipPermissions,
          nativeRules: translated.nativeRules,
          representableRules: translated.representableRules,
          unsupportedRules: translated.unsupportedRules,
          constraintInstructions: translated.constraintInstructions,
          translationWarnings: translated.warnings,
          resumeSessionId: config.resumeSessionId,
          sessionLedgerOwner: config.sessionLedgerOwner,
          model: config.model,
        });
        return createPooledHarnessSession(
          "claude-code",
          (auth) => createSession(withHarnessHomeEnv("claude-code", config.env, auth)),
          () => createSession(config.env),
        );
      },
    },
    {
      id: "codex",
      costTier: "low",
      capabilities: {
        mcp: false,
        streaming: true,
        resumable: false,
        resume: false,
        costTrackingMode: "computed",
        supportedTools: [],
        maxContextTokens: null,
        priority: 3,
        fallbackTo: null,
        permissionPolicy: DEFAULT_POLICY,
      },
      create: (config) => {
        const translated = translatePermission(config.permissionPolicy, "codex") as CodexTranslationEnvelope;
        const cfg = translated.config;
        const createSession = (env: Record<string, string> | undefined) => new CodexSession({
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
          nativeRules: translated.nativeRules,
          representableRules: translated.representableRules,
          unsupportedRules: translated.unsupportedRules,
          constraintInstructions: translated.constraintInstructions,
          translationWarnings: translated.warnings,
          resumeSessionId: config.resumeSessionId,
          sessionLedgerOwner: config.sessionLedgerOwner,
        });
        return createPooledHarnessSession(
          "codex",
          (auth) => createSession(withHarnessHomeEnv("codex", config.env, auth)),
          () => createSession(config.env),
        );
      },
    },
    {
      id: "opencode",
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
        permissionPolicy: DEFAULT_POLICY,
      },
      create: (config) => {
        const translated = translatePermission(config.permissionPolicy, "opencode") as OpenCodeTranslationEnvelope;
        const cfg = translated.config;
        const mcpServers = config.mcpServers
          ? Object.entries(config.mcpServers).map(([name, v]) => ({
              name,
              url: v.command,
            }))
          : [];
        const createSession = (env: Record<string, string> | undefined) => new OpenCodeSession({
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
          resumeSessionId: (config as { resumeSessionId?: string }).resumeSessionId,
          sessionLedgerOwner: config.sessionLedgerOwner,
        });
        return createPooledHarnessSession(
          "opencode",
          (auth) => createSession(withHarnessHomeEnv("opencode", config.env, auth)),
          () => createSession(config.env),
        );
      },
    },
    ...directProviders,
  ];

  const registry = new SessionRegistry(providers);
  return { registry, worktreeManager };
}
