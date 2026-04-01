import type {
  SessionCapabilities,
  IKilnSession,
  KilnPermissionPolicy,
} from "./session.js";
import { debug } from "./debug.js";
import { ClaudeSession } from "./claude-code-process.js";
import { CodexSession } from "./codex-session.js";
import { OpenCodeSession } from "./opencode-session.js";
import { WorktreeManager } from "./worktree-manager.js";

export type ProviderId = "claude" | "codex" | "opencode";

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
  readonly resumeSessionId?: string;
}

export interface ClaudeBackendConfig {
  readonly permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  readonly allowDangerouslySkipPermissions: boolean;
}

export interface CodexBackendConfig {
  readonly approvalMode: "never" | "on-request" | "untrusted";
  readonly sandboxMode: "workspace-write" | "danger-full-access";
}

export interface OpenCodeBackendConfig {
  readonly permissionDefault: "ask" | "allow" | "deny";
}

export type BackendConfig =
  | { backend: "claude"; config: ClaudeBackendConfig }
  | { backend: "codex"; config: CodexBackendConfig }
  | { backend: "opencode"; config: OpenCodeBackendConfig };

export function translatePermission(
  policy: KilnPermissionPolicy,
  backend: "claude" | "codex" | "opencode",
): BackendConfig {
  const { approval, sandbox } = policy;

  if (approval === "auto-approve") {
    if (sandbox === "none") {
      if (backend === "claude") {
        return { backend: "claude", config: { permissionMode: "acceptEdits", allowDangerouslySkipPermissions: false } };
      }
      if (backend === "codex") {
        return { backend: "codex", config: { approvalMode: "on-request", sandboxMode: "workspace-write" } };
      }
      return { backend: "opencode", config: { permissionDefault: "ask" } };
    }

    if (sandbox === "workspace-write") {
      if (backend === "claude") {
        return { backend: "claude", config: { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true } };
      }
      if (backend === "codex") {
        return { backend: "codex", config: { approvalMode: "never", sandboxMode: "workspace-write" } };
      }
      return { backend: "opencode", config: { permissionDefault: "allow" } };
    }

    if (sandbox === "full") {
      if (backend === "claude") {
        return { backend: "claude", config: { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true } };
      }
      if (backend === "codex") {
        return { backend: "codex", config: { approvalMode: "never", sandboxMode: "danger-full-access" } };
      }
      return { backend: "opencode", config: { permissionDefault: "allow" } };
    }
  }

  if (approval === "ask") {
    if (backend === "claude") {
      return { backend: "claude", config: { permissionMode: "default", allowDangerouslySkipPermissions: false } };
    }
    if (backend === "codex") {
      return { backend: "codex", config: { approvalMode: "on-request", sandboxMode: "workspace-write" } };
    }
    return { backend: "opencode", config: { permissionDefault: "ask" } };
  }

  if (approval === "deny") {
    if (backend === "claude") {
      return { backend: "claude", config: { permissionMode: "plan", allowDangerouslySkipPermissions: false } };
    }
    if (backend === "codex") {
      return { backend: "codex", config: { approvalMode: "untrusted", sandboxMode: "workspace-write" } };
    }
    return { backend: "opencode", config: { permissionDefault: "deny" } };
  }

  if (backend === "claude") {
    return { backend: "claude", config: { permissionMode: "default", allowDangerouslySkipPermissions: false } };
  }
  if (backend === "codex") {
    return { backend: "codex", config: { approvalMode: "on-request", sandboxMode: "workspace-write" } };
  }
  return { backend: "opencode", config: { permissionDefault: "ask" } };
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
    const allIds: ProviderId[] = ["claude", "codex", "opencode"];
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
    const ids: ProviderId[] = ["claude", "codex", "opencode"];
    return ids
      .map((id) => {
        const descriptor = this.providers.get(id);
        if (!descriptor) return null;
        return { ...descriptor, health: this.getHealth(id) };
      })
      .filter((x): x is SessionProviderDescriptor & { health: "healthy" | "suppressed" | "half-open" } => x !== null);
  }

  private _isAvailable(id: ProviderId): boolean {
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

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "ask", sandbox: "none" };

export function createDefaultRegistry(): {
  registry: SessionRegistry;
  worktreeManager: WorktreeManager;
} {
  const worktreeManager = new WorktreeManager(process.cwd());
  worktreeManager.pruneStale().catch((err: unknown) => {
    debug("pruneStale error:", err instanceof Error ? err.message : String(err));
  });

  const providers: SessionProviderDescriptor[] = [
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
        const translated = translatePermission(config.permissionPolicy, "claude");
        const cfg = translated.config as ClaudeBackendConfig;
        return new ClaudeSession({
          task: config.task,
          systemPrompt: config.systemPrompt ?? "",
          mcpServers: config.mcpServers,
          cwd: config.cwd ?? process.cwd(),
          env: config.env,
          permissionMode: cfg.permissionMode,
          allowDangerouslySkipPermissions: cfg.allowDangerouslySkipPermissions,
          resumeSessionId: config.resumeSessionId,
        });
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
        const translated = translatePermission(config.permissionPolicy, "codex");
        const cfg = translated.config as CodexBackendConfig;
        return new CodexSession({
          task: config.task,
          model: config.model,
          cwd: config.cwd,
          env: config.env,
          approvalMode: cfg.approvalMode,
          sandboxMode: cfg.sandboxMode,
          resumeSessionId: config.resumeSessionId,
        });
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
        const translated = translatePermission(config.permissionPolicy, "opencode");
        const cfg = translated.config as OpenCodeBackendConfig;
        return new OpenCodeSession({
          task: config.task,
          cwd: config.cwd ?? process.cwd(),
          env: config.env,
          mcpServers: config.mcpServers
            ? Object.entries(config.mcpServers).map(([name, v]) => ({
                name,
                url: v.command,
              }))
            : [],
          permissionDefault: cfg.permissionDefault,
          sandboxMode: config.permissionPolicy.sandbox,
          resumeSessionId: (config as { resumeSessionId?: string }).resumeSessionId,
        });
      },
    },
  ];

  const registry = new SessionRegistry(providers);
  return { registry, worktreeManager };
}
