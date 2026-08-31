import {
  canReplayPortableInvocation,
  preparePortableInvocationInput,
  preparePortableInvocationOutput,
  portableInvocationReplayKey,
  sanitizeTerminalText,
  settlePortableInvocation,
  PortableInvocationReplayCache,
  type PortableInvocationAgentExecutionKind,
  type PortableInvocationAgentProvenance,
  type PortableInvocationBinding,
  type PortableInvocationContext,
  type PortableInvocationDiagnosticCode,
  type PortableInvocationOutputEvent,
  type PortableInvocationRequest,
  type PortableInvocationResult,
  type PortableInvocationSettlement,
  type PortableInvocationSettlementStatus,
} from "./portable-execution.js";

const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const RUNTIME_OWNED_AGENT_PORTS = new WeakSet<object>();
const RUNTIME_OWNED_AGENT_SETTLEMENTS = new WeakSet<object>();

export type AgentBackedCapabilityExecutionKind = PortableInvocationAgentExecutionKind;

export type AgentBackedCapabilityExecutorResult<Output = unknown> =
  | { readonly status: "completed"; readonly output: Output }
  | { readonly status: "failed"; readonly diagnosticCode?: PortableInvocationDiagnosticCode }
  | { readonly status: "timed_out"; readonly diagnosticCode?: PortableInvocationDiagnosticCode }
  | { readonly status: "cancelled"; readonly diagnosticCode?: PortableInvocationDiagnosticCode }
  | { readonly status: "outcome-unknown"; readonly diagnosticCode?: PortableInvocationDiagnosticCode };

export interface AgentBackedCapabilityExecutorInput {
  /** The exact Runtime binding; schemas and authority stay process-local. */
  readonly binding: PortableInvocationBinding;
  /** Candidate input parsed and frozen by Runtime's portable boundary. */
  readonly input: Readonly<Record<string, unknown>>;
  /** Owner-facing signal that combines caller cancellation and Runtime bounds. */
  readonly signal: AbortSignal;
  /** The effective bounded timeout for this invocation. */
  readonly timeoutMs: number;
  /** Trusted process-local context; never serialized into settlement evidence. */
  readonly trustedContext?: unknown;
  /** Bounded, sanitized progress observer. */
  readonly onOutput: (event: PortableInvocationOutputEvent) => void;
}

/** Named handoff implemented by the existing Agent Task or managed-invocation owner. */
export interface AgentBackedCapabilityExecutor<Output = unknown> {
  execute(input: AgentBackedCapabilityExecutorInput): Promise<AgentBackedCapabilityExecutorResult<Output>>;
}

export interface AgentBackedInvocationPort<Output = unknown> {
  readonly kind: AgentBackedCapabilityExecutionKind;
  readonly implementationIdentityDigest: PortableInvocationBinding["implementationIdentityDigest"];
  invoke(request: PortableInvocationRequest): Promise<AgentBackedCapabilityInvocationResult<Output>>;
}

/** Agent settlement variant; its portable shape remains session-ledger compatible. */
export interface AgentBackedCapabilitySettlement extends PortableInvocationSettlement {
  readonly agentBacked: PortableInvocationAgentProvenance;
}

export interface AgentBackedCapabilityInvocationResult<Output = unknown> {
  readonly settlement: AgentBackedCapabilitySettlement;
  readonly output?: Output;
  readonly replayed: boolean;
}

export interface AgentBackedCapabilityInvocationPortOptions<Output = unknown> {
  /** Agent Task or managed invocation execution owner. */
  readonly executor: AgentBackedCapabilityExecutor<Output>;
  /** Stable owner kind recorded in every terminal settlement. */
  readonly kind: AgentBackedCapabilityExecutionKind;
  /** Exact child/task or child/invocation identity supplied by the owner. */
  readonly childId: string;
  /** Explicit executor identity supplied by the owner. */
  readonly executorId: string;
  /** Optional implementation identity pin checked before dispatch. */
  readonly implementationIdentityDigest: PortableInvocationBinding["implementationIdentityDigest"];
  readonly maxReplayEntries?: number;
  readonly now?: () => string;
  readonly monotonicNow?: () => number;
}

/** A Runtime-owned port for one already-admitted agent-backed materialization. */
export class AgentBackedCapabilityInvocationPort<Output = unknown> implements AgentBackedInvocationPort<Output> {
  private readonly identity: Readonly<{
    kind: AgentBackedCapabilityExecutionKind;
    childId: string;
    executorId: string;
    implementationIdentityDigest: PortableInvocationBinding["implementationIdentityDigest"];
  }>;
  private readonly executor: AgentBackedCapabilityExecutor<Output>;
  private readonly replayCache: PortableInvocationReplayCache<Output>;
  private readonly uncertain = new Set<string>();
  private readonly inFlight = new Map<string, Promise<AgentBackedCapabilityInvocationResult<Output>>>();
  private readonly now: () => string;
  private readonly monotonicNow: () => number;

  public constructor(options: AgentBackedCapabilityInvocationPortOptions<Output>) {
    if (!options || typeof options !== "object" || typeof options.executor?.execute !== "function") {
      throw new TypeError("Agent-backed capability execution requires a named executor.");
    }
    const kind = options.kind;
    if (kind !== "agent-task" && kind !== "managed-invocation") {
      throw new TypeError("Agent-backed capability execution kind is invalid.");
    }
    requireIdentifier(options.childId, "childId");
    requireIdentifier(options.executorId, "executorId");
    if (!/^sha256:[a-f0-9]{64}$/u.test(options.implementationIdentityDigest)) {
      throw new TypeError("Agent-backed capability implementation identity digest is invalid.");
    }
    this.identity = Object.freeze({
      kind,
      childId: options.childId,
      executorId: options.executorId,
      implementationIdentityDigest: options.implementationIdentityDigest,
    });
    this.executor = options.executor;
    this.replayCache = new PortableInvocationReplayCache<Output>(options.maxReplayEntries);
    this.now = options.now ?? (() => new Date().toISOString());
    this.monotonicNow = options.monotonicNow ?? (() => Date.now());
    RUNTIME_OWNED_AGENT_PORTS.add(this);
  }

  public get kind(): AgentBackedCapabilityExecutionKind { return this.identity.kind; }
  public get childId(): string { return this.identity.childId; }
  public get executorId(): string { return this.identity.executorId; }
  public get implementationIdentityDigest(): PortableInvocationBinding["implementationIdentityDigest"] {
    return this.identity.implementationIdentityDigest;
  }

  public invoke(request: PortableInvocationRequest): Promise<AgentBackedCapabilityInvocationResult<Output>> {
    const preparedInput = preparePortableInvocationInput(request.binding, request.input);
    if (!preparedInput.ok) {
      return Promise.resolve(this.resultWithoutDispatch(request.binding, "invalid_input", "invalid_input"));
    }
    if (request.binding.implementationIdentityDigest !== this.implementationIdentityDigest) {
      return Promise.resolve(this.resultWithoutDispatch(request.binding, "failed", "implementation_mismatch"));
    }
    if (request.trustedContext === undefined || request.trustedContext === null) {
      return Promise.resolve(this.resultWithoutDispatch(request.binding, "failed", "missing_context"));
    }
    const replayKey = String(portableInvocationReplayKey(request.binding));
    if (this.uncertain.has(replayKey)) return Promise.resolve(this.replayConflict(request.binding));
    const cached = this.replayCache.get(request.binding);
    if (cached !== undefined) {
      if (canReplayPortableInvocation(request.binding)) {
        const agentResult = this.agentResult(cached);
        return Promise.resolve(Object.freeze({ ...agentResult, replayed: true }));
      }
      return Promise.resolve(this.replayConflict(request.binding));
    }
    const active = this.inFlight.get(replayKey);
    if (active !== undefined) {
      if (canReplayPortableInvocation(request.binding)) return active.then((result) => this.replayedResult(result));
      return Promise.resolve(this.replayConflict(request.binding));
    }
    const operation = this.dispatch(request, preparedInput.value.input, replayKey).then((result) => this.remember(request.binding, result, replayKey));
    this.inFlight.set(replayKey, operation);
    return operation.finally(() => {
      if (this.inFlight.get(replayKey) === operation) this.inFlight.delete(replayKey);
    });
  }

  private async dispatch(
    request: PortableInvocationRequest,
    input: Readonly<Record<string, unknown>>,
    replayKey: string,
  ): Promise<AgentBackedCapabilityInvocationResult<Output>> {
    const binding = request.binding;
    const context = effectiveContext(request);
    const startedAt = this.readNow();
    const startedTick = this.readMonotonicNow();
    const controller = new AbortController();
    const externalSignal = context.signal;
    let settled = false;
    let dispatched = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveInterrupt: ((kind: "cancelled" | "timed_out" | "output_limit_exceeded") => void) | undefined;
    const interrupt = new Promise<"cancelled" | "timed_out" | "output_limit_exceeded">((resolve) => {
      resolveInterrupt = resolve;
    });
    const abort = (): void => {
      if (settled) return;
      controller.abort();
      resolveInterrupt?.("cancelled");
    };
    if (externalSignal?.aborted) {
      this.uncertain.delete(replayKey);
      return this.resultWithoutDispatch(binding, "cancelled", "cancelled");
    }
    if (externalSignal !== undefined) externalSignal.addEventListener("abort", abort, { once: true });
    const timeoutMs = boundedTimeout(context.timeoutMs, binding.limits.maxDurationMs);
    timer = setTimeout(() => {
      if (settled) return;
      controller.abort();
      resolveInterrupt?.("timed_out");
    }, timeoutMs);
    const eventOutput = createBoundedEventOutput(
      binding.limits.maxOutputBytes,
      context.onOutput,
      () => {
        if (settled) return;
        controller.abort();
        resolveInterrupt?.("output_limit_exceeded");
      },
    );
    const executorPromise = Promise.resolve().then(() => {
      dispatched = true;
      return this.executor.execute({
        binding,
        input,
        signal: controller.signal,
        timeoutMs,
        ...(request.trustedContext === undefined ? {} : { trustedContext: request.trustedContext }),
        onOutput: eventOutput,
      });
    });
    try {
      const winner = await Promise.race([
        executorPromise.then((value) => ({ kind: "value" as const, value })),
        interrupt.then((kind) => ({ kind })),
      ]);
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
      if (winner.kind !== "value") {
        const dispatch = dispatched ? "outcome-unknown" : "known-not-dispatched";
        if (dispatch === "outcome-unknown") this.uncertain.add(replayKey);
        return this.resultFromSettlement(settlePortableInvocation({
          binding,
          port: this.kind,
          status: winner.kind,
          dispatch,
          startedAt,
          settledAt: this.readNow(),
          durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
          outputTruncated: eventOutput.truncated,
          agentBacked: this.provenance(),
          diagnosticCode: winner.kind,
        }));
      }
      const execution = normalizeExecutorResult(winner.value);
      if (execution.status !== "completed") {
        const dispatch = execution.status === "outcome-unknown" ? "outcome-unknown" : "terminally-observed";
        if (dispatch === "outcome-unknown") this.uncertain.add(replayKey);
        const status: PortableInvocationSettlementStatus = execution.status === "outcome-unknown"
          ? "failed"
          : execution.status;
        return this.resultFromSettlement(settlePortableInvocation({
          binding,
          port: this.kind,
          status,
          dispatch,
          startedAt,
          settledAt: this.readNow(),
          durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
          outputTruncated: eventOutput.truncated,
          agentBacked: this.provenance(),
          ...(execution.diagnosticCode === undefined ? {} : { diagnosticCode: execution.diagnosticCode }),
        }));
      }
      const preparedOutput = preparePortableInvocationOutput(binding, execution.output);
      if (!preparedOutput.ok) {
        return this.resultFromSettlement(settlePortableInvocation({
          binding,
          port: this.kind,
          status: preparedOutput.code,
          dispatch: "terminally-observed",
          startedAt,
          settledAt: this.readNow(),
          durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
          outputTruncated: eventOutput.truncated,
          agentBacked: this.provenance(),
          diagnosticCode: preparedOutput.code === "output_limit_exceeded" ? "output_limit_exceeded" : "invalid_output",
        }));
      }
      return this.resultFromSettlement(settlePortableInvocation({
          binding,
          port: this.kind,
          status: "completed",
          dispatch: "terminally-observed",
          startedAt,
          settledAt: this.readNow(),
          durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
          outputTruncated: eventOutput.truncated,
          agentBacked: this.provenance(),
          outputDigest: preparedOutput.outputDigest,
        }), preparedOutput.value as Output);
    } catch {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
      if (dispatched) this.uncertain.add(replayKey);
      return this.resultFromSettlement(settlePortableInvocation({
        binding,
        port: this.kind,
        status: "failed",
        dispatch: dispatched ? "outcome-unknown" : "known-not-dispatched",
        startedAt,
        settledAt: this.readNow(),
        durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
        outputTruncated: eventOutput.truncated,
        agentBacked: this.provenance(),
        diagnosticCode: "agent_execution_error",
      }));
    }
  }

  private provenance(): PortableInvocationAgentProvenance {
    return Object.freeze({
      kind: this.kind,
      childId: this.childId,
      executorId: this.executorId,
      trust: "untrusted-child-output",
    });
  }

  private resultWithoutDispatch(
    binding: PortableInvocationBinding,
    status: "invalid_input" | "failed" | "cancelled",
    diagnosticCode: "invalid_input" | "implementation_mismatch" | "missing_context" | "cancelled",
  ): AgentBackedCapabilityInvocationResult<Output> {
    return this.resultFromSettlement(settlePortableInvocation({
      binding,
      port: this.kind,
      status,
      dispatch: "known-not-dispatched",
      startedAt: this.readNow(),
      settledAt: this.readNow(),
      durationMs: 0,
      agentBacked: this.provenance(),
      diagnosticCode,
    }));
  }

  private replayConflict(binding: PortableInvocationBinding): AgentBackedCapabilityInvocationResult<Output> {
    return this.resultFromSettlement(settlePortableInvocation({
      binding,
      port: this.kind,
      status: "replay_conflict",
      dispatch: "known-not-dispatched",
      startedAt: this.readNow(),
      settledAt: this.readNow(),
      durationMs: 0,
      agentBacked: this.provenance(),
      diagnosticCode: "idempotency_conflict",
    }));
  }

  private resultFromSettlement(
    settlement: PortableInvocationSettlement,
    output?: Output,
  ): AgentBackedCapabilityInvocationResult<Output> {
    if (!isAgentBackedCapabilitySettlement(settlement)) {
      throw new TypeError("Agent-backed invocation settlement is missing explicit provenance.");
    }
    RUNTIME_OWNED_AGENT_SETTLEMENTS.add(settlement);
    return Object.freeze({
      settlement,
      ...(output === undefined ? {} : { output }),
      replayed: false,
    });
  }

  private remember(
    binding: PortableInvocationBinding,
    result: AgentBackedCapabilityInvocationResult<Output>,
    replayKey: string,
  ): AgentBackedCapabilityInvocationResult<Output> {
    const immutable = Object.freeze(result);
    if (result.settlement.dispatch === "outcome-unknown") {
      this.uncertain.add(replayKey);
    } else {
      this.replayCache.set(binding, immutable);
    }
    return immutable;
  }

  private agentResult(result: PortableInvocationResult<Output>): AgentBackedCapabilityInvocationResult<Output> {
    if (!isAgentBackedCapabilitySettlement(result.settlement)) {
      throw new TypeError("Agent-backed invocation replay contains a non-agent settlement.");
    }
    return Object.freeze({
      settlement: result.settlement,
      ...(result.output === undefined ? {} : { output: result.output }),
      replayed: result.replayed,
    });
  }

  private replayedResult(result: AgentBackedCapabilityInvocationResult<Output>): AgentBackedCapabilityInvocationResult<Output> {
    return Object.freeze({
      settlement: result.settlement,
      ...(result.output === undefined ? {} : { output: result.output }),
      replayed: true,
    });
  }

  private readNow(): string {
    try { return this.now(); } catch { return new Date().toISOString(); }
  }

  private readMonotonicNow(): number {
    try {
      const value = this.monotonicNow();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  }
}

export function createAgentBackedCapabilityInvocationPort<Output = unknown>(
  options: AgentBackedCapabilityInvocationPortOptions<Output>,
): AgentBackedCapabilityInvocationPort<Output> {
  return new AgentBackedCapabilityInvocationPort(options);
}

export function isRuntimeOwnedAgentBackedCapabilityInvocationPort(
  value: unknown,
): value is AgentBackedInvocationPort<unknown> {
  return value !== null && typeof value === "object" && RUNTIME_OWNED_AGENT_PORTS.has(value);
}

export function isRuntimeOwnedAgentBackedCapabilityInvocationSettlement(
  value: unknown,
): value is AgentBackedCapabilitySettlement {
  return value !== null
    && typeof value === "object"
    && Object.isFrozen(value)
    && RUNTIME_OWNED_AGENT_SETTLEMENTS.has(value)
    && isAgentBackedCapabilitySettlement(value);
}

function normalizeExecutorResult<Output>(value: AgentBackedCapabilityExecutorResult<Output>): AgentBackedCapabilityExecutorResult<Output> {
  if (value === null || typeof value !== "object") return { status: "outcome-unknown", diagnosticCode: "agent_executor_result_invalid" };
  if (value.status === "completed" && "output" in value) return value;
  if (value.status === "failed" || value.status === "timed_out" || value.status === "cancelled" || value.status === "outcome-unknown") {
    const diagnosticCode = normalizeDiagnosticCode(value.diagnosticCode);
    return {
      status: value.status,
      ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
    };
  }
  return { status: "outcome-unknown", diagnosticCode: "agent_executor_result_invalid" };
}

function normalizeDiagnosticCode(value: unknown): PortableInvocationDiagnosticCode | undefined {
  if (value === undefined) return undefined;
  return value === "invalid_input"
    || value === "invalid_output"
    || value === "missing_context"
    || value === "unavailable"
    || value === "process_error"
    || value === "nonzero_exit"
    || value === "signal"
    || value === "cancelled"
    || value === "timed_out"
    || value === "output_limit_exceeded"
    || value === "idempotency_conflict"
    || value === "implementation_mismatch"
    || value === "local_function_error"
    || value === "agent_execution_error"
    || value === "agent_outcome_unknown"
    || value === "agent_executor_result_invalid"
    ? value
    : undefined;
}

function isAgentBackedCapabilitySettlement(value: unknown): value is AgentBackedCapabilitySettlement {
  if (value === null || typeof value !== "object" || !("agentBacked" in value) || !("port" in value)) return false;
  const agentBacked = value.agentBacked;
  return agentBacked !== null
    && typeof agentBacked === "object"
    && "kind" in agentBacked
    && "childId" in agentBacked
    && "executorId" in agentBacked
    && "trust" in agentBacked
    && (value.port === "agent-task" || value.port === "managed-invocation")
    && agentBacked.kind === value.port
    && agentBacked.trust === "untrusted-child-output";
}

function effectiveContext(request: PortableInvocationRequest): PortableInvocationContext {
  const nested = request.context;
  return {
    ...(nested?.signal === undefined && request.signal === undefined ? {} : { signal: nested?.signal ?? request.signal }),
    ...(nested?.onOutput === undefined && request.onOutput === undefined ? {} : { onOutput: nested?.onOutput ?? request.onOutput }),
    ...(nested?.timeoutMs === undefined && request.timeoutMs === undefined ? {} : { timeoutMs: nested?.timeoutMs ?? request.timeoutMs }),
  };
}

function boundedTimeout(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return maximum;
  return Math.min(value, maximum);
}

function elapsedMs(now: number, started: number): number {
  return Number.isFinite(now) && Number.isFinite(started) && now >= started
    ? Math.min(Math.floor(now - started), 24 * 60 * 60 * 1_000)
    : 0;
}

function requireIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value) || value.trim().length === 0) {
    throw new TypeError(`Agent-backed capability ${label} is invalid.`);
  }
}

function createBoundedEventOutput(
  limit: number,
  observer: PortableInvocationContext["onOutput"],
  onOverflow: () => void,
): ((event: PortableInvocationOutputEvent) => void) & { readonly truncated: boolean } {
  let used = 0;
  let truncated = false;
  const output = ((event: PortableInvocationOutputEvent): void => {
    if (truncated) return;
    const safe = sanitizeTerminalText(event.text);
    const bytes = Buffer.byteLength(safe, "utf8");
    if (used + bytes > limit) {
      truncated = true;
      onOverflow();
      return;
    }
    used += bytes;
    try { observer?.({ stream: event.stream, text: safe }); } catch { /* observers cannot affect child execution */ }
  }) as ((event: PortableInvocationOutputEvent) => void) & { readonly truncated: boolean };
  Object.defineProperty(output, "truncated", { get: () => truncated });
  return output;
}
