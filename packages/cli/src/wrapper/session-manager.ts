import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Orchestrator, GateRunner, VerificationLoop, EventBus } from "@kilnai/core";
import type { DomainConfig, RoleUsage, QualityGate, VerificationResult } from "@kilnai/core";
import { MODEL_PRICING } from "@kilnai/core";
import type { WrapperConfig, SessionContext, SessionReport } from "./index.js";
import type { KilnAppConfig } from "../config.js";
import { defaultBuildSystemPrompt } from "../config.js";
import type { WorktreeManager } from "./worktree-manager.js";

/**
 * Manages the full session lifecycle: prepare -> cleanup.
 *
 * The `launch` step is handled by `ClaudeSession` (SDK-based),
 * so this class only handles pre-session setup and post-session reporting.
 */
export class SessionManager {
  private readonly wrapperConfig: WrapperConfig;
  private readonly appConfig: KilnAppConfig;
  private readonly worktreeManager?: WorktreeManager;
  private orchestrator: Orchestrator | null = null;
  private domain: DomainConfig | null = null;
  private sessionStartTime: number | null = null;
  private activeSessionId: string | null = null;

  get sessionStartTimeMs(): number | null {
    return this.sessionStartTime;
  }

  constructor(
    wrapperConfig: WrapperConfig,
    appConfig: KilnAppConfig,
    worktreeManager?: WorktreeManager,
  ) {
    this.wrapperConfig = wrapperConfig;
    this.appConfig = appConfig;
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
  ): Promise<SessionContext> {
    const registry = this.appConfig.createRegistry();
    registry.loadInstalledDomains(projectPath);
    this.domain = registry.detectAndMerge(projectPath);

    const systemPrompt = (this.appConfig.buildSystemPrompt ?? defaultBuildSystemPrompt)({
      task,
      domain: this.domain,
      memorySnapshot,
      projectPath,
    });

    const mcpServerEntryPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..", "mcp", "index.js",
    );

    this.orchestrator = new Orchestrator();
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

    return {
      mode: this.wrapperConfig.mode,
      domain: this.domain,
      systemPrompt,
      memorySnapshot,
      mcpServerEntryPath,
      workingDirectory,
      task,
      worktreePath,
    };
  }

  /**
   * Post-session cleanup: build report.
   * @param totalCostUsd Cost reported directly from the session (ClaudeSession.total_cost_usd).
   *                       Falls back to Orchestrator costSummary when session cost is unavailable.
   */
  cleanup(
    sessionId: string,
    totalCostUsd?: number,
    verificationResult?: VerificationResult,
    evalScore?: SessionReport["evalScore"],
  ): SessionReport {
    const duration = this.sessionStartTime
      ? Date.now() - this.sessionStartTime
      : 0;

    const costSummary = this.orchestrator?.costSummary;
    const byRoleModel: Record<string, number> = {};
    if (costSummary) {
      for (const [key, usage] of Object.entries(costSummary.byRoleModel)) {
        byRoleModel[key] = computeRoleCostUsd(usage);
      }
    }

    return {
      sessionId,
      task: this.orchestrator?.task ?? "",
      domain: this.domain?.displayName ?? "Unknown",
      phaseReached: this.orchestrator?.currentPhase ?? "analyze",
      cost: {
        total: totalCostUsd ?? costSummary?.totalCostUsd ?? 0,
        byRoleModel,
      },
      duration,
      verificationResult: verificationResult
        ? { passed: verificationResult.passed, checks: verificationResult.checks }
        : undefined,
      evalScore,
    };
  }

  async cleanupWorktree(context: SessionContext): Promise<void> {
    if (context.worktreePath && this.worktreeManager && this.activeSessionId) {
      await this.worktreeManager.release(this.activeSessionId);
      this.activeSessionId = null;
    }
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


/** Compute USD cost for a single role usage entry */
function computeRoleCostUsd(usage: RoleUsage): number {
  const pricing = MODEL_PRICING.get(usage.model);
  if (!pricing) return 0;

  const uncachedInput = Math.max(
    0,
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens,
  );

  return (
    (uncachedInput * pricing.inputRate +
      usage.outputTokens * pricing.outputRate +
      usage.cacheReadTokens * pricing.inputRate * pricing.cacheReadMultiplier +
      usage.cacheWriteTokens * pricing.inputRate * pricing.cacheWriteMultiplier) /
    1_000_000
  );
}
