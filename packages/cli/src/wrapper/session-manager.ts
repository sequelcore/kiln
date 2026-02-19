import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Orchestrator } from "@kiln/core";
import type { DomainConfig } from "@kiln/core";
import type { WrapperConfig, SessionContext, SessionReport } from "./index.js";
import type { KilnAppConfig } from "../config.js";
import { buildSystemPrompt } from "./context-builder.js";

/**
 * Manages the full session lifecycle: prepare -> cleanup.
 *
 * The `launch` step is handled by `ClaudeSession` (SDK-based),
 * so this class only handles pre-session setup and post-session reporting.
 */
export class SessionManager {
  private readonly wrapperConfig: WrapperConfig;
  private readonly appConfig: KilnAppConfig;
  private orchestrator: Orchestrator | null = null;
  private domain: DomainConfig | null = null;
  private sessionStartTime: number | null = null;

  constructor(wrapperConfig: WrapperConfig, appConfig: KilnAppConfig) {
    this.wrapperConfig = wrapperConfig;
    this.appConfig = appConfig;
  }

  /**
   * Pre-session setup: detect domain, build system prompt, resolve MCP entry path.
   * Returns a SessionContext with all fields populated.
   */
  prepare(task: string, projectPath: string, memorySnapshot?: string): SessionContext {
    const registry = this.appConfig.createRegistry();
    registry.loadInstalledDomains(projectPath);
    this.domain = registry.detectAndMerge(projectPath);

    const systemPrompt = buildSystemPrompt(this.appConfig, {
      task,
      domain: this.domain,
      memorySnapshot,
      projectPath,
    });

    // Resolve the MCP server entry script path (for SDK stdio transport)
    const mcpServerEntryPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..", "mcp", "index.ts",
    );

    this.orchestrator = new Orchestrator();
    this.sessionStartTime = Date.now();

    return {
      mode: this.wrapperConfig.mode,
      domain: this.domain,
      systemPrompt,
      mcpServerEntryPath,
      memorySnapshot: memorySnapshot ?? "",
      workingDirectory: projectPath,
      task,
    };
  }

  /**
   * Post-session cleanup: build report.
   */
  cleanup(sessionId: string): SessionReport {
    const duration = this.sessionStartTime
      ? Date.now() - this.sessionStartTime
      : 0;

    const costSummary = this.orchestrator?.costSummary;
    const byRole: Record<string, number> = {};
    if (costSummary) {
      for (const [role, usage] of Object.entries(costSummary.byRole)) {
        byRole[role] = usage.calls;
      }
    }

    return {
      sessionId,
      task: this.orchestrator?.task ?? "",
      domain: this.domain?.displayName ?? "Unknown",
      phaseReached: this.orchestrator?.currentPhase ?? "analyze",
      phasesCompleted: 0,
      totalPhases: 6,
      tasksCompleted: 0,
      tasksPruned: 0,
      filesModified: 0,
      cost: {
        total: costSummary?.totalCostUsd ?? 0,
        byRole,
      },
      memory: {
        recalled: 0,
        saved: 0,
      },
      qualityGates: {
        passed: 0,
        failed: 0,
        violations: [],
      },
      duration,
    };
  }
}
