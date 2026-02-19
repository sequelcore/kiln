import { randomUUID } from "node:crypto";
import type {
  OrchestratorConfig,
  OrchestratorStatus,
  Phase,
  PhaseGateResult,
  PhaseContext,
  PhaseResult,
} from "./index.js";
import { PhaseMachine } from "./phase-machine.js";
import { EventBus } from "../events/event-bus.js";
import { CostTracker } from "../cost/cost-tracker.js";
import type { PhaseChangedEvent } from "../events/index.js";
import type { CostSummary } from "../cost/index.js";
import { TaskTree, BatchExecutor } from "../tree/index.js";
import type { TaskNode, TreeAction, TreeConfig } from "../tree/index.js";
import type { BatchResult } from "../tree/index.js";
import { GateRunner, VerificationLoop } from "../verification/index.js";
import type { VerificationResult, VerificationConfig } from "../verification/index.js";
import type { FixHandler } from "../verification/index.js";
import type { QualityGate } from "../engine/composites/team.js";
import { createPolicy } from "../sandbox/index.js";
import type { SandboxPolicy } from "../sandbox/index.js";
import { ProviderRegistry } from "../agents/provider-registry.js";
import type { ProviderAdapter, AgentRole } from "../agents/index.js";
import { GitSyncManager } from "../memory/git-sync-manager.js";
import type { SyncStatus } from "../memory/git-sync-manager.js";
import type { ProjectMemoryStore } from "../memory/project-store.js";

const DEFAULT_CONFIG: OrchestratorConfig = {
  requireApproval: true,
  maxDepth: 3,
  parallelWorkers: 2,
  phases: ["analyze", "research", "architect", "implement", "verify", "synthesize"],
  maxIterations: 3,
};

/** Derive display name from a phase string: "analyze" -> "Analyze" */
function phaseMeta(phase: string): { name: string; description: string } {
  const name = phase.charAt(0).toUpperCase() + phase.slice(1);
  return { name, description: `${name} phase` };
}

type PhaseHandler = (ctx: PhaseContext) => Promise<PhaseResult>;

/** Architect's structured plan output */
export interface ArchitectPlan {
  readonly tasks: readonly {
    readonly id: string;
    readonly statement: string;
    readonly priority: number;
    readonly parentId: string | null;
  }[];
  readonly approach: string;
  readonly risks: readonly string[];
  readonly estimatedComplexity: string;
}

/** Architect's evaluation of a completed task */
export interface TaskEvaluation {
  readonly action: TreeAction;
  readonly newTask?: { readonly statement: string; readonly priority: number };
}

/**
 * Top-level orchestrator that drives PhaseMachine + EventBus + CostTracker.
 * Manages session lifecycle and provides the public API for CLI/MCP consumers.
 */
export class Orchestrator {
  private readonly _eventBus: EventBus;
  private readonly _phaseMachine: PhaseMachine;
  private readonly _costTracker: CostTracker;
  private readonly _config: OrchestratorConfig;
  private readonly _phaseHandlers = new Map<Phase, PhaseHandler>();
  private readonly _tree: TaskTree;
  private readonly _batchExecutor: BatchExecutor;
  private readonly _providerRegistry: ProviderRegistry;
  private readonly _sandboxPolicies = new Map<string, SandboxPolicy>();
  private _sessionId: string | null = null;
  private _task: string | null = null;
  private _lastVerificationResult: VerificationResult | null = null;
  private _gitSync: GitSyncManager | null = null;

  constructor(config?: Partial<OrchestratorConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._eventBus = new EventBus();
    this._phaseMachine = new PhaseMachine(this._eventBus, this._config);
    this._costTracker = new CostTracker(this._eventBus);
    this._providerRegistry = new ProviderRegistry();

    const treeConfig: TreeConfig = {
      maxDepth: this._config.maxDepth,
      batchSize: this._config.parallelWorkers,
      depthDiscount: 0.8,
    };
    this._tree = new TaskTree({ config: treeConfig, eventBus: this._eventBus });
    this._batchExecutor = new BatchExecutor({
      concurrency: this._config.parallelWorkers,
      eventBus: this._eventBus,
    });
  }

  /** Expose EventBus for external subscribers (TUI, MCP) */
  get eventBus(): EventBus {
    return this._eventBus;
  }

  /** Current orchestrator status -- delegates to PhaseMachine */
  get status(): OrchestratorStatus {
    return this._phaseMachine.status;
  }

  /** Current phase -- delegates to PhaseMachine */
  get currentPhase(): Phase {
    return this._phaseMachine.currentPhase;
  }

  /** Cost summary -- delegates to CostTracker */
  get costSummary(): CostSummary {
    return this._costTracker.summary;
  }

  /** Orchestrator configuration */
  get config(): OrchestratorConfig {
    return this._config;
  }

  /** Current session ID (null if not started) */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Current task string (null if not started) */
  get task(): string | null {
    return this._task;
  }

  /** Last verification result (null if no run yet) */
  get verificationResult(): VerificationResult | null {
    return this._lastVerificationResult;
  }

  /**
   * Run the verification loop with the given quality gates.
   * Creates a GateRunner + VerificationLoop, executes, and stores the result.
   */
  async runVerification(
    gates: readonly QualityGate[],
    cwd: string,
    fixHandler?: FixHandler,
  ): Promise<VerificationResult> {
    const gateRunner = new GateRunner({ cwd });
    const verificationConfig: VerificationConfig = {
      maxIterations: this._config.maxIterations ?? 3,
      checks: [],
      screenshotEnabled: false,
      coverageThreshold: 0,
    };
    const loop = new VerificationLoop({
      gateRunner,
      eventBus: this._eventBus,
      config: verificationConfig,
      gates,
    });
    const result = await loop.run(fixHandler);
    this._lastVerificationResult = result;
    return result;
  }

  /**
   * Begin orchestration for a task.
   * Generates a session ID, starts the phase machine, and emits the initial phase_changed event.
   * Returns the session ID.
   */
  start(task: string): string {
    const sessionId = randomUUID();
    this._sessionId = sessionId;
    this._task = task;

    // Reset and reinitialize PhaseMachine with new session ID
    this._phaseMachine.reset();
    // Create a new PhaseMachine with the session ID -- PhaseMachine constructor requires it
    // Instead, we start the existing one and emit the initial event manually
    this._phaseMachine.start();

    // Emit phase_changed for the initial phase
    const meta = phaseMeta(this._phaseMachine.currentPhase);
    const phaseEvent: PhaseChangedEvent = {
      type: "phase_changed",
      phase: this._phaseMachine.currentPhase,
      phaseName: meta.name,
      phaseDescription: meta.description,
      timestamp: new Date(),
      sessionId,
    };
    this._eventBus.emit(phaseEvent);

    return sessionId;
  }

  /** Advance to the next phase -- delegates to PhaseMachine */
  advancePhase(gateResult?: PhaseGateResult): Phase | Promise<Phase | null> | null {
    return this._phaseMachine.advance(gateResult);
  }

  /** Approve the architect plan -- delegates to PhaseMachine */
  approve(): void {
    this._phaseMachine.approve();
  }

  /** Reject the architect plan -- delegates to PhaseMachine */
  reject(reason: string): void {
    this._phaseMachine.reject(reason);
  }

  /** Cancel the current session -- delegates to PhaseMachine */
  cancel(): void {
    this._phaseMachine.cancel();
  }

  /**
   * Register a phase-specific handler.
   * Handlers are `async (ctx: PhaseContext) => PhaseResult`.
   * Not invoked in Phase 1 -- placeholder for Phase 2 agent integration.
   */
  onPhaseEnter(phase: Phase, handler: PhaseHandler): void {
    this._phaseHandlers.set(phase, handler);
  }

  /** Initialize sandbox policies for the given project directory */
  initSandbox(projectPath: string): void {
    for (const role of ["architect", "worker", "optimizer"]) {
      this._sandboxPolicies.set(role, createPolicy(role, projectPath));
    }
  }

  /** Get sandbox policy for a specific role */
  getSandboxPolicy(role: string): SandboxPolicy | undefined {
    return this._sandboxPolicies.get(role);
  }

  /** Whether sandbox policies have been initialized */
  get sandboxEnabled(): boolean {
    return this._sandboxPolicies.size > 0;
  }

  /** Expose ProviderRegistry for CLI/MCP configuration */
  get providerRegistry(): ProviderRegistry {
    return this._providerRegistry;
  }

  /** Register a provider adapter by name */
  registerProvider(name: string, adapter: ProviderAdapter): void {
    this._providerRegistry.register(name, adapter);
  }

  /** Assign a specific provider to an agent role */
  setRoleProvider(role: AgentRole, providerName: string): void {
    this._providerRegistry.setRoleProvider(role, providerName);
  }

  /** Get the provider for a given role (role-specific -> default -> first registered) */
  getProviderForRole(role: AgentRole): ProviderAdapter {
    return this._providerRegistry.getForRole(role);
  }

  /** Initialize git-synced memory and run auto-import */
  initMemorySync(projectPath: string): void {
    this._gitSync = new GitSyncManager({
      projectPath,
      eventBus: this._eventBus,
    });
    this._gitSync.autoImport();
  }

  /** Get memory sync status (null if not initialized) */
  memorySyncStatus(): SyncStatus | null {
    return this._gitSync?.syncStatus() ?? null;
  }

  /** Flush project memory with developer attribution */
  async flushMemory(store: ProjectMemoryStore): Promise<void> {
    if (!this._gitSync) {
      throw new Error("Memory sync not initialized. Call initMemorySync() first.");
    }
    await this._gitSync.flush(store);
  }

  /** Expose TaskTree for TUI/MCP consumers */
  get tree(): TaskTree {
    return this._tree;
  }

  /** Expose BatchExecutor for TUI/MCP consumers */
  get batchExecutor(): BatchExecutor {
    return this._batchExecutor;
  }

  /**
   * Populate the tree from the Architect's structured plan.
   * Returns a mapping from plan task IDs to tree-assigned task IDs.
   */
  loadPlan(plan: ArchitectPlan): Map<string, string> {
    const idMapping = new Map<string, string>();

    // First pass: add root tasks (parentId === null)
    for (const task of plan.tasks) {
      if (task.parentId === null) {
        const treeId = this._tree.addRoot(task.statement, task.priority);
        idMapping.set(task.id, treeId);
      }
    }

    // Second pass: add child tasks (parentId !== null)
    for (const task of plan.tasks) {
      if (task.parentId !== null) {
        const parentTreeId = idMapping.get(task.parentId);
        if (parentTreeId === undefined) {
          throw new Error(
            `Parent task "${task.parentId}" not found in plan for task "${task.id}"`,
          );
        }
        const childTreeId = this._tree.applyAction(
          parentTreeId,
          "deepen",
          task.statement,
        );
        if (childTreeId !== null) {
          idMapping.set(task.id, childTreeId);
        }
      }
    }

    return idMapping;
  }

  /**
   * Main implement phase loop.
   * Selects batches from the tree, executes them via BatchExecutor,
   * and records evidence + status updates.
   * Returns all task nodes in their final state.
   */
  async runImplementLoop(
    handler: (task: TaskNode, workerIndex: number) => Promise<BatchResult>,
  ): Promise<TaskNode[]> {
    while (!this._tree.isComplete) {
      const batch = this._tree.selectBatch();
      if (batch.length === 0) break;

      const results = await this._batchExecutor.execute(batch, handler);

      for (const result of results) {
        for (const evidence of result.evidence) {
          this._tree.addEvidence(result.taskId, evidence);
        }
        this._tree.updateStatus(
          result.taskId,
          result.success ? "supported" : "refuted",
        );
      }
    }

    return this._tree.allNodes;
  }

  /**
   * Process the Architect's tree action on a completed task.
   * Returns the new task's tree ID (for deepen/branch) or null (for prune).
   */
  evaluateResult(
    taskId: string,
    evaluation: TaskEvaluation,
  ): string | null {
    const statement = evaluation.newTask?.statement ?? "";
    return this._tree.applyAction(taskId, evaluation.action, statement);
  }
}
