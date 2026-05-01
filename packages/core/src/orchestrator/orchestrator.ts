import { randomUUID } from "node:crypto";
import type {
  OrchestratorConfig,
  OrchestratorStatus,
  Phase,
  PhaseGateResult,
} from "./index.js";
import { PhaseMachine, phaseMeta } from "./phase-machine.js";
import { EventBus } from "../events/event-bus.js";
import { CostTracker } from "../cost/cost-tracker.js";
import type {
  PhaseChangedEvent,
  TraceSpanEvent,
} from "../events/index.js";
import { createTraceContext, startSpan } from "../events/trace.js";
import type { TraceSpan } from "../events/trace.js";
import type { CostSummary } from "../cost/index.js";
import { TaskTree, BatchExecutor } from "../tree/index.js";
import type { TaskNode, TreeAction, TreeConfig } from "../tree/index.js";
import type { VerificationResult } from "../verification/index.js";
import type { FixHandler } from "../verification/index.js";
import type { QualityGate } from "../engine/composites/team.js";
import type { Team } from "../engine/composites/team.js";
import { createStrategy } from "./strategies/index.js";
import type { StrategyHandler } from "./strategies/index.js";
import { ProviderRegistry } from "../agents/provider-registry.js";
import type { ProviderAdapter, AgentRole } from "../agents/index.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { CheckpointOptions, ReplayOverrides } from "./checkpoint-types.js";
import type { InterruptRequest, ResumeCommand } from "./interrupt.js";
import { attachFieldUpdater, startFieldPropagator, startFieldInhibitor, startStabilityMonitor } from "../field/field-service.js";
import type { DevTool } from "../tools/domain/tool.js";
import type { DevToolExecutionRequest, DevToolExecutionResult } from "../tools/tool-executor.js";
import { OrchestratorCheckpointSupport } from "./orchestrator-checkpoint-support.js";
import { OrchestratorInterruptSupport } from "./orchestrator-interrupt-support.js";
import { OrchestratorDevToolSupport } from "./orchestrator-dev-tool-support.js";
import { OrchestratorVerificationSupport } from "./orchestrator-verification-support.js";

const DEFAULT_CONFIG: OrchestratorConfig = {
  requireApproval: true,
  maxDepth: 3,
  parallelWorkers: 2,
  phases: ["analyze", "research", "architect", "implement", "verify", "synthesize"],
  maxIterations: 3,
};

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
  private readonly _config: OrchestratorConfig;
  private _costTracker: CostTracker;
  private readonly _tree: TaskTree;
  private readonly _batchExecutor: BatchExecutor;
  private readonly _providerRegistry: ProviderRegistry;
  private readonly _devToolSupport: OrchestratorDevToolSupport;
  private readonly _verificationSupport: OrchestratorVerificationSupport;
  private readonly _checkpointSupport: OrchestratorCheckpointSupport;
  private readonly _interruptSupport: OrchestratorInterruptSupport;
  private _sessionId: string | null = null;
  private _task: string | null = null;
  private _team: Team | null = null;

  constructor(config?: Partial<OrchestratorConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._eventBus = new EventBus();
    attachFieldUpdater(this._eventBus);
    startFieldPropagator();
    startFieldInhibitor();
    startStabilityMonitor();
    this._costTracker = new CostTracker();
    // PhaseMachine is constructed without a sessionId; it gets set in start()
    this._phaseMachine = new PhaseMachine(this._eventBus, this._config);
    this._providerRegistry = new ProviderRegistry();

    const parallelWorkers = this._config.parallelWorkers;
    const treeConfig: TreeConfig = {
      maxDepth: this._config.maxDepth,
      batchSize: parallelWorkers,
      depthDiscount: 0.8,
    };
    this._tree = new TaskTree({ config: treeConfig, eventBus: this._eventBus });
    this._batchExecutor = new BatchExecutor({
      concurrency: parallelWorkers,
      eventBus: this._eventBus,
    });
    this._devToolSupport = new OrchestratorDevToolSupport({
      eventBus: this._eventBus,
      getSessionContext: () => ({
        sessionId: this._sessionId ?? "",
        taskId: this._task ?? undefined,
      }),
    });
    this._verificationSupport = new OrchestratorVerificationSupport({
      eventBus: this._eventBus,
      getSessionId: () => this._sessionId ?? "",
      getMaxIterations: () => this._config.maxIterations ?? 3,
    });
    this._checkpointSupport = new OrchestratorCheckpointSupport({
      phaseMachine: this._phaseMachine,
      config: this._config,
      tree: this._tree,
      batchExecutor: this._batchExecutor,
      eventBus: this._eventBus,
      getSessionState: () => ({
        sessionId: this._sessionId,
        task: this._task,
      }),
      setSessionState: ({ sessionId, task }) => {
        this._sessionId = sessionId;
        this._task = task;
      },
      getCostSummary: () => this._costTracker.summary,
      resetCostTrackerFromSummary: (summary) => {
        this._costTracker = new CostTracker();
        for (const key of Object.keys(summary.byRoleModel)) {
          const usage = summary.byRoleModel[key];
          if (usage) {
            this._costTracker.record(usage.role, {
              provider: usage.provider,
              model: usage.model,
              canonicalModel: usage.canonicalModel,
              billingMode: usage.billingMode,
            }, {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheWriteTokens: usage.cacheWriteTokens,
            });
          }
        }
      },
    });
    this._interruptSupport = new OrchestratorInterruptSupport({
      eventBus: this._eventBus,
      getSessionId: () => this._sessionId,
      getCurrentPhase: () => this._phaseMachine.currentPhase,
      hasCheckpointStore: () => this._checkpointSupport.checkpointStore !== null,
      checkpoint: (options) => this.checkpoint(options),
      loadCheckpointMetadata: (checkpointId) => this._checkpointSupport.loadCheckpointMetadata(checkpointId),
      resume: (checkpointId) => this.resume(checkpointId),
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

  /** Record token usage for a specific role and model -- public API for MCP/CLI */
  recordUsage(
    role: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  ): void {
    this._costTracker.record(role, model, usage);
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
    return this._verificationSupport.verificationResult;
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
    return this._verificationSupport.runVerification(gates, cwd, fixHandler);
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

    const traceContext = createTraceContext(sessionId);
    const { span: sessionSpan } = startSpan(traceContext, "session", "phase", { task });
    this.emitTraceSpan(sessionSpan);

    this._phaseMachine.reset();
    this._phaseMachine.setSessionId(sessionId);
    this._tree.setSessionId(sessionId);
    this._batchExecutor.setSessionId(sessionId);
    this._phaseMachine.start();

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

  /** Set the team for strategy-based execution */
  setTeam(team: Team): void {
    this._team = team;
  }

  /** Current team (null if not configured) */
  get team(): Team | null {
    return this._team;
  }

  /** Initialize sandbox policies for the given project directory */
  initSandbox(projectPath: string): void {
    this._devToolSupport.initSandbox(projectPath);
  }

  /** Get sandbox policy for a specific role */
  getSandboxPolicy(role: string) {
    return this._devToolSupport.getSandboxPolicy(role);
  }

  /** Whether sandbox policies have been initialized */
  get sandboxEnabled(): boolean {
    return this._devToolSupport.sandboxEnabled;
  }

  /** Expose ProviderRegistry for CLI/MCP configuration */
  get providerRegistry(): ProviderRegistry {
    return this._providerRegistry;
  }

  /** Expose native dev tool registry for setup/configuration */
  get devToolRegistry() {
    return this._devToolSupport.devToolRegistry;
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

  /** Register a native developer tool by name */
  registerDevTool(tool: DevTool): void {
    this._devToolSupport.registerDevTool(tool);
  }

  /**
   * Execute a native developer tool through the shared bridge.
   * If no explicit sandbox is provided and a role is present, use the role sandbox policy.
   */
  async executeDevTool(
    request: DevToolExecutionRequest & { readonly role?: string; readonly cwd?: string },
  ): Promise<DevToolExecutionResult> {
    return this._devToolSupport.executeDevTool(request);
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
   * Delegates to the appropriate strategy based on team mode.
   * Defaults to sequential strategy when no team is configured.
   */
  async runImplementLoop(handler: StrategyHandler): Promise<TaskNode[]> {
    const mode = this._team?.mode ?? "sequential";
    const strategy = createStrategy(mode);
    const team = this._team ?? {
      agents: {},
      workflow: { phases: this._config.phases, gates: {} },
    } as Team;

    return strategy.execute(
      {
        team,
        eventBus: this._eventBus,
        tree: this._tree,
        batchExecutor: this._batchExecutor,
        sessionId: this._sessionId ?? "",
      },
      handler,
    );
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

  attachCheckpointStore(store: CheckpointStore): void {
    this._checkpointSupport.attachStore(store);
  }

  async checkpoint(options?: CheckpointOptions): Promise<string> {
    return this._checkpointSupport.checkpoint(options);
  }

  async resume(checkpointId: string): Promise<string> {
    return this._checkpointSupport.resume(checkpointId);
  }

  async fork(checkpointId: string, options?: CheckpointOptions): Promise<string> {
    return this._checkpointSupport.fork(checkpointId, options);
  }

  async replay(checkpointId: string, overrides?: ReplayOverrides): Promise<string> {
    return this._checkpointSupport.replay(checkpointId, overrides);
  }

  /** Current interrupt state (null if not interrupted) */
  get interruptState() {
    return this._interruptSupport.state;
  }

  /**
   * Interrupt execution. Creates a checkpoint with interrupt state in metadata.
   * Returns the checkpoint ID that must be used to resume.
   */
  async interrupt(request: InterruptRequest): Promise<string> {
    return this._interruptSupport.interrupt(request);
  }

  /**
   * Resume from an interrupt with a value.
   * Loads the checkpoint, validates resume value if schema exists, resumes execution.
   * Returns the new session ID.
   */
  async resumeInterrupt(command: ResumeCommand): Promise<string> {
    return this._interruptSupport.resumeInterrupt(command);
  }

  private emitTraceSpan(span: TraceSpan): void {
    if (!this._sessionId) return;

    const traceEvent: TraceSpanEvent = {
      type: "trace_span",
      span,
      timestamp: new Date(),
      sessionId: this._sessionId,
    };
    this._eventBus.emit(traceEvent);
  }
}
