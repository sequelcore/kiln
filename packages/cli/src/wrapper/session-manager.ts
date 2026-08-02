import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultContextGovernor, GateRunner, VerificationLoop, EventBus } from "@kilnai/core";
import type { ContextArtifactCache, DomainConfig, QualityGate, VerificationResult } from "@kilnai/core";
import type { ResumeFeedback, ResumeStrategy, WrapperConfig, SessionContext, SessionReport } from "./index.js";
import type { KilnAppConfig } from "../config.js";
import { defaultBuildSystemPrompt } from "../config.js";
import {
  buildCliPlanSummaryArtifactKey,
  buildCliProjectSummaryArtifactKey,
  buildCliSessionSummaryArtifactKey,
} from "../application/context-artifact-keys.js";
import { buildModuleArtifactKey, extractTouchedFilePaths } from "../application/repo-summary-cache.js";
import {
  collectResumeSignals,
  decideResumeStrategy,
} from "../application/resume-strategy-policy.js";
import type { SessionLedger } from "../application/session-ledger.js";
import { renderSessionLedger } from "../application/session-ledger.js";
import type { PersistedSessionMeta } from "./session-store.js";
import type { ProviderId } from "./session-registry.js";
import type { WorktreeManager } from "./worktree-manager.js";
import type {
  KilnContextGovernanceAggressiveness,
  KilnContextGovernanceSource,
} from "../kiln-yaml-types.js";

function resolveContextGovernancePolicy(appConfig: KilnAppConfig): {
  tokenBudget?: number;
  useCache: boolean;
  preferredSources?: readonly KilnContextGovernanceSource[];
  summaryAggressiveness?: KilnContextGovernanceAggressiveness;
  contextAllocationMode?: "whole-block" | "segmented" | "retrieval-on-demand";
} {
  const config = appConfig.kilnYaml?.contextGovernance;
  return {
    tokenBudget: config?.turnBudget,
    useCache: config?.cachePolicy !== "off",
    preferredSources: config?.preferredSources,
    summaryAggressiveness: config?.summaryAggressiveness ?? "medium",
    contextAllocationMode: config?.allocationMode,
  };
}

const CLI_CONTEXT_AGGRESSIVENESS_POLICY: Record<
  KilnContextGovernanceAggressiveness,
  { readonly summaryBonus: number; readonly artifactPenalty: number }
> = {
  low: { summaryBonus: -0.08, artifactPenalty: 0 },
  medium: { summaryBonus: 0, artifactPenalty: 0 },
  high: { summaryBonus: 0.12, artifactPenalty: 0.08 },
};

function buildResumeProjectionState(input: {
  cache: ContextArtifactCache;
  projectPath: string;
  task: string;
  worktreePath?: string;
  continuationSessionId?: string;
  continuedMeta?: PersistedSessionMeta;
  moduleArtifactKeys: readonly string[];
  preferredProvider?: ProviderId;
  feedback?: ResumeFeedback;
  projectHistoricalContext: boolean;
}): {
  hasCachedResumeContext: boolean;
  cachedResumeSignalCount: number;
  resumeStrategy: ResumeStrategy;
  resumeFeedback?: ResumeFeedback;
  sessionLedger: SessionLedger;
  exactArtifacts: readonly string[];
  shouldUseProviderNativeResume: boolean;
} {
  const { cache, projectPath, task, worktreePath, continuationSessionId, continuedMeta, moduleArtifactKeys } = input;
  const sessionArtifactKey = input.projectHistoricalContext && continuationSessionId
    ? buildCliSessionSummaryArtifactKey(continuationSessionId)
    : undefined;
  const projectArtifactKey = input.projectHistoricalContext
    ? buildCliProjectSummaryArtifactKey(projectPath)
    : undefined;
  const planArtifactKey = input.projectHistoricalContext
    ? buildCliPlanSummaryArtifactKey(projectPath, task, 80)
    : undefined;
  const signals = collectResumeSignals({
    cache,
    keys: [sessionArtifactKey, projectArtifactKey, planArtifactKey],
    includeModules: input.projectHistoricalContext && moduleArtifactKeys.length > 0,
  });
  const { cachedResumeSignalCount, hasCachedResumeContext } = signals;

  const sessionLedger: SessionLedger = {
    currentPhase: continuedMeta?.sessionLedger?.currentPhase ?? "prepare",
    resumedFrom: continuationSessionId,
    workingDirectory: projectPath,
    worktreePath,
    lastError: hasCachedResumeContext ? undefined : continuedMeta?.sessionLedger?.lastError,
    lastProvider: continuedMeta?.sessionLedger?.lastProvider,
    toolCallCount: continuedMeta?.sessionLedger?.toolCallCount,
    turnDepth: continuedMeta?.sessionLedger?.turnDepth,
  };

  const fallbackArtifacts = input.projectHistoricalContext && !hasCachedResumeContext
    ? (continuedMeta?.exactArtifacts ?? []).slice(0, 10)
    : [];
  const exactArtifacts = [
    ...fallbackArtifacts,
    ...(worktreePath ? [`Active isolated worktree path: ${worktreePath}`] : []),
  ];

  const decision = decideResumeStrategy({
    continuationSessionId,
    preferredProvider: input.preferredProvider,
    signals,
    feedback: input.feedback,
  });

  return {
    hasCachedResumeContext,
    cachedResumeSignalCount,
    resumeStrategy: decision.resumeStrategy,
    resumeFeedback: decision.resumeFeedback,
    sessionLedger,
    exactArtifacts,
    shouldUseProviderNativeResume: decision.shouldUseProviderNativeResume,
  };
}

function shouldProjectHistoricalContext(continuationSessionId: string | undefined): boolean {
  return continuationSessionId !== undefined;
}

function buildHistoricalContextProjection(input: {
  enabled: boolean;
  useCache: boolean;
  artifactCache: ContextArtifactCache;
  moduleArtifactKeys: readonly string[];
  projectPath: string;
  task: string;
  continuationSessionId?: string;
}): {
  readonly artifactCache?: ContextArtifactCache;
  readonly moduleArtifactKeys: readonly string[];
  readonly projectArtifactKey?: string;
  readonly planArtifactKey?: string;
  readonly sessionArtifactKey?: string;
} {
  if (!input.enabled) {
    return { moduleArtifactKeys: [] };
  }

  return {
    artifactCache: input.useCache ? input.artifactCache : undefined,
    moduleArtifactKeys: input.moduleArtifactKeys,
    projectArtifactKey: buildCliProjectSummaryArtifactKey(input.projectPath),
    planArtifactKey: buildCliPlanSummaryArtifactKey(input.projectPath, input.task, 80),
    sessionArtifactKey: input.continuationSessionId
      ? buildCliSessionSummaryArtifactKey(input.continuationSessionId)
      : undefined,
  };
}

/**
 * Manages the full session lifecycle: prepare -> cleanup.
 *
 * The `launch` step is handled by `ClaudeSession` (SDK-based),
 * so this class only handles pre-session setup and post-session reporting.
 */
export class SessionManager {
  private readonly wrapperConfig: WrapperConfig;
  private readonly appConfig: KilnAppConfig;
  private readonly contextArtifactCache: ContextArtifactCache;
  private readonly worktreeManager?: WorktreeManager;
  private domain: DomainConfig | null = null;
  private task: string | null = null;
  private sessionStartTime: number | null = null;
  private activeSessionId: string | null = null;
  private costTurns: Array<{
    turn: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
  }> = [];
  private lastThreeOutputs: number[] = [];
  private turnIndex = 0;

  get sessionStartTimeMs(): number | null {
    return this.sessionStartTime;
  }

  constructor(
    wrapperConfig: WrapperConfig,
    appConfig: KilnAppConfig,
    contextArtifactCache: ContextArtifactCache,
    worktreeManager?: WorktreeManager,
  ) {
    this.wrapperConfig = wrapperConfig;
    this.appConfig = appConfig;
    this.contextArtifactCache = contextArtifactCache;
    this.worktreeManager = worktreeManager;
  }

  /**
   * Pre-session setup: detect domain, build system prompt, resolve MCP entry path.
   * Returns a SessionContext with all fields populated.
   */
  async prepare(
    task: string,
    projectPath: string,
    memorySnapshot?: string,
    isolate?: boolean,
    continuationSessionId?: string,
    continuedMeta?: PersistedSessionMeta,
    preferredProvider?: ProviderId,
    resumeStrategyFeedback?: ResumeFeedback,
  ): Promise<SessionContext> {
    const registry = this.appConfig.createRegistry();
    registry.loadInstalledDomains(projectPath);
    this.domain = registry.detectAndMerge(projectPath);

    const mcpServerEntryPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..", "mcp", "index.js",
    );

    this.task = task;
    this.sessionStartTime = Date.now();

    let workingDirectory = projectPath;
    let worktreePath: string | undefined;

    if (isolate && this.worktreeManager) {
      const sessionId = crypto.randomUUID();
      const handle = await this.worktreeManager.allocate(sessionId);
      workingDirectory = handle.path;
      worktreePath = handle.path;
      this.activeSessionId = sessionId;
    }

    const historicalContextEnabled = shouldProjectHistoricalContext(continuationSessionId);
    const touchedFiles = historicalContextEnabled
      ? extractTouchedFilePaths(continuedMeta?.exactArtifacts ?? [])
      : [];
    const moduleArtifactKeys = (
      await Promise.all(touchedFiles.slice(0, 5).map((filePath) => buildModuleArtifactKey(projectPath, filePath)))
    ).filter((key): key is string => key !== undefined);
    const {
      resumeStrategy,
      resumeFeedback,
      sessionLedger,
      exactArtifacts,
      shouldUseProviderNativeResume,
    } = buildResumeProjectionState({
      cache: this.contextArtifactCache,
      projectPath,
      task,
      worktreePath,
      continuationSessionId,
      continuedMeta,
      moduleArtifactKeys,
      preferredProvider,
      feedback: resumeStrategyFeedback,
      projectHistoricalContext: historicalContextEnabled,
    });
    const governancePolicy = resolveContextGovernancePolicy(this.appConfig);
    const historicalContextProjection = buildHistoricalContextProjection({
      enabled: historicalContextEnabled,
      useCache: governancePolicy.useCache,
      artifactCache: this.contextArtifactCache,
      moduleArtifactKeys,
      projectPath,
      task,
      continuationSessionId,
    });
    const providerResumeSessionId = shouldUseProviderNativeResume ? continuationSessionId : undefined;
    const projectedContext = new DefaultContextGovernor<
      SessionLedger,
      KilnContextGovernanceSource,
      KilnContextGovernanceAggressiveness
    >().project({
      memorySnapshot,
      sessionLedger,
      renderLedger: renderSessionLedger,
      artifacts: this.appConfig.contextCandidates,
      exactArtifacts,
      artifactCache: historicalContextProjection.artifactCache,
      moduleArtifactKeys: historicalContextProjection.moduleArtifactKeys,
      projectArtifactKey: historicalContextProjection.projectArtifactKey,
      planArtifactKey: historicalContextProjection.planArtifactKey,
      sessionArtifactKey: historicalContextProjection.sessionArtifactKey,
      tokenBudget: governancePolicy.tokenBudget,
      preferredSources: governancePolicy.preferredSources,
      summaryAggressiveness: governancePolicy.summaryAggressiveness,
      aggressivenessPolicy: CLI_CONTEXT_AGGRESSIVENESS_POLICY,
      contextAllocationMode: governancePolicy.contextAllocationMode,
    });

    const systemPrompt = (this.appConfig.buildSystemPrompt ?? defaultBuildSystemPrompt)({
      task,
      domain: this.domain,
      projectedContext,
      projectPath,
    });

    return {
      mode: this.wrapperConfig.mode,
      domain: this.domain,
      systemPrompt,
      projectedContext,
      mcpServerEntryPath,
      workingDirectory,
      task,
      worktreePath,
      continuationSessionId: providerResumeSessionId,
      resumeStrategy,
      resumeFeedback,
    };
  }

  /**
   * Post-session cleanup: build report.
   * Builds a report from the same explicit terminal projection persisted by the run command.
   */
  cleanup(input: {
    readonly sessionId: string;
    readonly terminalPhase: "completed" | "failed" | "verification_failed";
    readonly totalCostUsd?: number;
    readonly verificationResult?: VerificationResult;
    readonly evalScore?: SessionReport["evalScore"];
  }): SessionReport {
    const duration = this.sessionStartTime
      ? Date.now() - this.sessionStartTime
      : 0;

    const report: SessionReport = {
      sessionId: input.sessionId,
      task: this.task ?? "",
      domain: this.domain?.displayName ?? "Unknown",
      phaseReached: input.terminalPhase,
      cost: {
        total: input.totalCostUsd ?? 0,
        byRoleModel: {},
        breakdown: this.costTurns,
      },
      duration,
      verificationResult: input.verificationResult
        ? { passed: input.verificationResult.passed, checks: input.verificationResult.checks }
        : undefined,
      evalScore: input.evalScore,
    };
    this.task = null;
    return report;
  }

  async cleanupWorktree(context: SessionContext): Promise<void> {
    if (context.worktreePath && this.worktreeManager && this.activeSessionId) {
      await this.worktreeManager.release(this.activeSessionId);
      this.activeSessionId = null;
    }
  }

  trackCostUpdate(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    costUsd: number,
  ): void {
    this.costTurns.push({
      turn: this.turnIndex++,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd,
    });

    this.lastThreeOutputs.push(outputTokens);
    if (this.lastThreeOutputs.length > 3) {
      this.lastThreeOutputs.shift();
    }

    if (this.lastThreeOutputs.length === 3) {
      if (this.lastThreeOutputs.every((v) => v < 500)) {
        console.error("[kiln] warning: token budget diminishing returns detected");
      }
    }
  }

  resetCostTracking(): void {
    this.costTurns = [];
    this.lastThreeOutputs = [];
    this.turnIndex = 0;
  }

  async runVerification(
    gates: readonly QualityGate[],
    cwd: string,
  ): Promise<VerificationResult> {
    const eventBus = new EventBus();
    const gateRunner = new GateRunner({ cwd, timeoutMs: 60_000 });
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: { maxIterations: 1, coverageThreshold: 0 },
      gates,
      sessionId: this.activeSessionId ?? "",
    });
    return loop.run();
  }
}
