import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type {
  CommandProcessRequest,
  CommandProcessResult,
  CommandProcessRunner,
  CommandProcessSink,
} from "@kilnai/core/tools";
import {
  assertPortableCliArguments,
  canReplayPortableInvocation,
  clipPortableOutput,
  normalizePortableEnvironment,
  preparePortableInvocationInput,
  preparePortableInvocationOutput,
  registerRuntimeOwnedPortableInvocationPort,
  PortableInvocationReplayCache,
  portableInvocationReplayKey,
  sanitizeTerminalText,
  settlePortableInvocation,
  type PortableInvocationBinding,
  type PortableInvocationContext,
  type PortableInvocationPort,
  type PortableInvocationRequest,
  type PortableInvocationResult,
  type PortableInvocationSettlement,
  type PortableInvocationSettlementStatus,
  type PortableInvocationDiagnosticCode,
} from "./portable-execution.js";
import { SpawnCommandProcessRunner } from "../tools/spawn-command-process-runner.js";

export type PortableCliArgumentBuilder = (
  input: Readonly<Record<string, unknown>>,
  binding: PortableInvocationBinding,
) => readonly string[];

export type PortableCliOutputParser<Output = unknown> = (
  stdout: string,
  stderr: string,
) => Output;

export interface PortableCliInvocationPortOptions<Output = unknown> {
  /** Absolute, host-configured executable path; PATH lookup is never used. */
  readonly executable: string;
  /** Absolute, canonical project working directory. */
  readonly cwd: string;
  /** Explicit environment allowlist. An omitted ambient environment is invalid. */
  readonly env: Readonly<Record<string, string>>;
  /** Static argv suffix. Values are passed as argv entries without a shell. */
  readonly args?: readonly string[];
  /** Optional input-aware argv builder. It cannot return credential-looking values. */
  readonly argumentBuilder?: PortableCliArgumentBuilder;
  readonly runner?: CommandProcessRunner;
  readonly acceptedExitCodes?: readonly number[];
  /** Defaults to JSON parsing when an output schema is present. */
  readonly outputParser?: PortableCliOutputParser<Output>;
  readonly maxReplayEntries?: number;
  /** Wall-clock instant used for deterministic settlement evidence. */
  readonly now?: () => string;
  /** Monotonic milliseconds used only for duration evidence. */
  readonly monotonicNow?: () => number;
  /** Optional implementation pin checked before dispatch. */
  readonly implementationIdentityDigest?: PortableInvocationBinding["implementationIdentityDigest"];
}

/**
 * Provider-neutral CLI transport. It owns process transport only; capability
 * identity, schemas, limits, and replay posture come from the binding.
 */
export class PortableCliInvocationPort<Output = unknown> implements PortableInvocationPort<Output> {
  public readonly kind = "cli" as const;
  private readonly executable: string;
  private readonly cwd: string;
  private readonly env: Readonly<Record<string, string>>;
  private readonly staticArgs: readonly string[];
  private readonly argumentBuilder: PortableCliArgumentBuilder | undefined;
  private readonly runner: CommandProcessRunner;
  private readonly acceptedExitCodes: ReadonlySet<number>;
  private readonly outputParser: PortableCliOutputParser<Output> | undefined;
  private readonly replayCache: PortableInvocationReplayCache<Output>;
  private readonly inFlight = new Map<string, Promise<PortableInvocationResult<Output>>>();
  private readonly now: () => string;
  private readonly monotonicNow: () => number;
  private readonly implementationIdentityDigest: PortableInvocationBinding["implementationIdentityDigest"] | undefined;

  public constructor(options: PortableCliInvocationPortOptions<Output>) {
    this.executable = canonicalFilePath(options.executable, "executable");
    this.cwd = canonicalDirectoryPath(options.cwd);
    this.env = normalizeExplicitEnvironment(options.env);
    if (options.args !== undefined && options.argumentBuilder !== undefined) {
      throw new TypeError("Portable CLI cannot combine static args and an argument builder.");
    }
    this.staticArgs = options.args === undefined ? Object.freeze([]) : assertPortableCliArguments(options.args);
    this.argumentBuilder = options.argumentBuilder;
    if (this.argumentBuilder !== undefined && typeof this.argumentBuilder !== "function") {
      throw new TypeError("Portable CLI argument builder must be a function.");
    }
    this.runner = options.runner ?? new SpawnCommandProcessRunner();
    if (options.acceptedExitCodes === undefined) {
      this.acceptedExitCodes = new Set([0]);
    } else {
      if (options.acceptedExitCodes.length === 0 || options.acceptedExitCodes.length > 16
        || options.acceptedExitCodes.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 255)) {
        throw new TypeError("Portable CLI accepted exit codes are invalid.");
      }
      this.acceptedExitCodes = new Set(options.acceptedExitCodes);
    }
    this.outputParser = options.outputParser;
    this.replayCache = new PortableInvocationReplayCache<Output>(options.maxReplayEntries);
    this.now = options.now ?? (() => new Date().toISOString());
    this.monotonicNow = options.monotonicNow ?? (() => Date.now());
    this.implementationIdentityDigest = options.implementationIdentityDigest;
    registerRuntimeOwnedPortableInvocationPort(this);
  }

  public invoke(request: PortableInvocationRequest): Promise<PortableInvocationResult<Output>> {
    const preparedInput = preparePortableInvocationInput(request.binding, request.input);
    if (!preparedInput.ok) {
      return Promise.resolve(this.resultWithoutDispatch(request.binding, "invalid_input", "invalid_input"));
    }
    if (this.implementationIdentityDigest !== undefined
      && request.binding.implementationIdentityDigest !== this.implementationIdentityDigest) {
      return Promise.resolve(this.resultWithoutDispatch(request.binding, "failed", "implementation_mismatch"));
    }
    const context = effectiveContext(request);
    if (context.signal?.aborted) {
      return Promise.resolve(this.resultWithoutDispatch(request.binding, "cancelled", "cancelled"));
    }

    const replayKey = String(this.replayKey(request.binding));
    const cached = this.replayCache.get(request.binding);
    if (cached !== undefined) {
      if (canReplayPortableInvocation(request.binding)) {
        return Promise.resolve(Object.freeze({ ...cached, replayed: true }));
      }
      return Promise.resolve(this.replayConflict(request.binding));
    }
    const active = this.inFlight.get(replayKey);
    if (active !== undefined) {
      if (canReplayPortableInvocation(request.binding)) {
        return active.then((result) => Object.freeze({ ...result, replayed: true }));
      }
      return Promise.resolve(this.replayConflict(request.binding));
    }

    const operation = this.dispatch(request, preparedInput.value.input);
    this.inFlight.set(replayKey, operation);
    return operation.finally(() => {
      if (this.inFlight.get(replayKey) === operation) this.inFlight.delete(replayKey);
    });
  }

  private async dispatch(
    request: PortableInvocationRequest,
    input: Readonly<Record<string, unknown>>,
  ): Promise<PortableInvocationResult<Output>> {
    const binding = request.binding;
    const context = effectiveContext(request);
    const startedAt = this.readNow();
    const startedTick = this.readMonotonicNow();
    const timeoutMs = boundedTimeout(context.timeoutMs, binding.limits.maxDurationMs);
    let args: readonly string[];
    try {
      args = assertPortableCliArguments(this.argumentBuilder?.(input, binding) ?? this.staticArgs);
    } catch {
      return this.remember(binding, this.resultFromSettlement(settlePortableInvocation({
        binding,
        port: "cli",
        status: "failed",
        dispatch: "known-not-dispatched",
        startedAt,
        settledAt: this.readNow(),
        durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
        diagnosticCode: "unavailable",
      })));
    }

    const output = createOutputAccumulator(binding.limits.maxOutputBytes, context.onOutput);
    let handle: { stop(reason: "cancelled" | "timeout" | "stopped"): Promise<void> } | undefined;
    let finished = false;
    let resolveResult: (result: PortableInvocationResult<Output>) => void = () => undefined;
    const resultPromise = new Promise<PortableInvocationResult<Output>>((resolve) => { resolveResult = resolve; });
    const finish = (processResult: CommandProcessResult): void => {
      if (finished) return;
      finished = true;
      void this.finishProcess({
        binding,
        startedAt,
        startedTick,
        output,
        processResult,
      }).then((result) => resolveResult(this.remember(binding, result)));
    };
    const sink: CommandProcessSink = {
      output: (chunk) => output.append(chunk.stream, chunk.text),
      finish,
    };
    const processRequest: CommandProcessRequest = {
      executable: this.executable,
      args,
      cwd: this.cwd,
      env: this.env,
      shell: false,
      timeoutMs,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    };
    try {
      handle = this.runner.start(processRequest, sink);
      output.setOverflowHandler(() => { void handle?.stop("stopped"); });
      if (context.signal?.aborted) void handle.stop("cancelled");
    } catch {
      finish({ error: new Error("process unavailable") });
    }
    return resultPromise;
  }

  private async finishProcess(input: {
    readonly binding: PortableInvocationBinding;
    readonly startedAt: string;
    readonly startedTick: number;
    readonly output: OutputAccumulator;
    readonly processResult: CommandProcessResult;
  }): Promise<PortableInvocationResult<Output>> {
    const { binding, startedAt, startedTick, output, processResult } = input;
    const status = classifyProcessResult(processResult, output.overflowed, this.acceptedExitCodes);
    const settledAt = this.readNow();
    if (status.status !== "completed") {
      return this.resultFromSettlement(settlePortableInvocation({
        binding,
        port: "cli",
        status: status.status,
        dispatch: status.dispatch,
        startedAt,
        settledAt,
        durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
        exitCode: normalizeExitCode(processResult.exitCode),
        signal: normalizeSignal(processResult.signal),
        stdout: output.stdout,
        stderr: output.stderr,
        stdoutBytes: output.stdoutBytes,
        stderrBytes: output.stderrBytes,
        outputTruncated: output.overflowed,
        diagnosticCode: status.diagnosticCode,
      }));
    }

    let parsed: unknown;
    try {
      parsed = this.outputParser === undefined
        ? (binding.outputValidator === undefined ? output.stdout : JSON.parse(output.stdout))
        : this.outputParser(output.stdout, output.stderr);
    } catch {
      return this.resultFromSettlement(settlePortableInvocation({
        binding,
        port: "cli",
        status: "invalid_output",
        dispatch: "terminally-observed",
        startedAt,
        settledAt,
        durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
        exitCode: normalizeExitCode(processResult.exitCode),
        signal: normalizeSignal(processResult.signal),
        stdout: output.stdout,
        stderr: output.stderr,
        stdoutBytes: output.stdoutBytes,
        stderrBytes: output.stderrBytes,
        outputTruncated: output.overflowed,
        diagnosticCode: "invalid_output",
      }));
    }
    const preparedOutput = preparePortableInvocationOutput(binding, parsed);
    if (!preparedOutput.ok) {
      const outputStatus: PortableInvocationSettlementStatus = preparedOutput.code;
      return this.resultFromSettlement(settlePortableInvocation({
        binding,
        port: "cli",
        status: outputStatus,
        dispatch: "terminally-observed",
        startedAt,
        settledAt,
        durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
        exitCode: normalizeExitCode(processResult.exitCode),
        signal: normalizeSignal(processResult.signal),
        stdout: output.stdout,
        stderr: output.stderr,
        stdoutBytes: output.stdoutBytes,
        stderrBytes: output.stderrBytes,
        outputTruncated: output.overflowed,
        diagnosticCode: preparedOutput.code === "output_limit_exceeded" ? "output_limit_exceeded" : "invalid_output",
      }));
    }
    return {
      settlement: settlePortableInvocation({
        binding,
        port: "cli",
        status: "completed",
        dispatch: "terminally-observed",
        startedAt,
        settledAt,
        durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
        exitCode: normalizeExitCode(processResult.exitCode),
        signal: normalizeSignal(processResult.signal),
        stdout: output.stdout,
        stderr: output.stderr,
        stdoutBytes: output.stdoutBytes,
        stderrBytes: output.stderrBytes,
        outputTruncated: output.overflowed,
        outputDigest: preparedOutput.outputDigest,
      }),
      output: preparedOutput.value as Output,
      replayed: false,
    };
  }

  private resultWithoutDispatch(
    binding: PortableInvocationBinding,
    status: "invalid_input" | "failed" | "cancelled",
    diagnosticCode: PortableInvocationDiagnosticCode,
  ): PortableInvocationResult<Output> {
    return this.resultFromSettlement(settlePortableInvocation({
      binding,
      port: "cli",
      status,
      dispatch: "known-not-dispatched",
      startedAt: this.readNow(),
      settledAt: this.readNow(),
      durationMs: 0,
      diagnosticCode,
    }));
  }

  private replayConflict(binding: PortableInvocationBinding): PortableInvocationResult<Output> {
    return this.resultFromSettlement(settlePortableInvocation({
      binding,
      port: "cli",
      status: "replay_conflict",
      dispatch: "known-not-dispatched",
      startedAt: this.readNow(),
      settledAt: this.readNow(),
      durationMs: 0,
      diagnosticCode: "idempotency_conflict",
    }));
  }

  private resultFromSettlement(settlement: PortableInvocationSettlement): PortableInvocationResult<Output> {
    return Object.freeze({ settlement, replayed: false });
  }

  private remember(binding: PortableInvocationBinding, result: PortableInvocationResult<Output>): PortableInvocationResult<Output> {
    const immutable = Object.freeze(result);
    this.replayCache.set(binding, immutable);
    return immutable;
  }

  private replayKey(binding: PortableInvocationBinding): string {
    return String(portableInvocationReplayKey(binding));
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

export function createCliPortableInvocationPort<Output = unknown>(
  options: PortableCliInvocationPortOptions<Output>,
): PortableCliInvocationPort<Output> {
  return new PortableCliInvocationPort(options);
}

/** Naming aligned with the capability vocabulary used by callers. */
export const createPortableCliInvocationPort = createCliPortableInvocationPort;

function canonicalFilePath(value: string, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\u0000")) {
    throw new TypeError(`Portable CLI ${label} must be an absolute path.`);
  }
  let resolved: string;
  try { resolved = realpathSync.native(value); } catch { throw new TypeError(`Portable CLI ${label} is unavailable.`); }
  try {
    if (!statSync(resolved).isFile()) throw new TypeError(`Portable CLI ${label} is not a file.`);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`Portable CLI ${label} is unavailable.`);
  }
  return resolved;
}

function canonicalDirectoryPath(value: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\u0000")) {
    throw new TypeError("Portable CLI cwd must be an absolute path.");
  }
  let resolved: string;
  try { resolved = realpathSync.native(value); } catch { throw new TypeError("Portable CLI cwd is unavailable."); }
  try {
    if (!statSync(resolved).isDirectory()) throw new TypeError("Portable CLI cwd is not a directory.");
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Portable CLI cwd is unavailable.");
  }
  return resolved;
}

function normalizeExplicitEnvironment(environment: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (environment === undefined) throw new TypeError("Portable CLI requires an explicit environment allowlist.");
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== "string") throw new TypeError("Portable CLI environment values must be strings.");
    normalized[key] = value;
  }
  return normalizePortableEnvironment(normalized);
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
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value <= 0) return maximum;
  return Math.min(value, maximum);
}

function elapsedMs(now: number, started: number): number {
  return Number.isFinite(now) && Number.isFinite(started) && now >= started ? Math.min(Math.floor(now - started), 24 * 60 * 60 * 1_000) : 0;
}

function normalizeExitCode(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return Number(value);
  return null;
}

function normalizeSignal(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 32 ? sanitizeTerminalText(value) : null;
}

function classifyProcessResult(
  result: CommandProcessResult,
  overflowed: boolean,
  acceptedExitCodes: ReadonlySet<number>,
): { readonly status: PortableInvocationSettlementStatus; readonly dispatch: "known-not-dispatched" | "terminally-observed" | "outcome-unknown"; readonly diagnosticCode: PortableInvocationDiagnosticCode } {
  if (overflowed) return { status: "output_limit_exceeded", dispatch: "terminally-observed", diagnosticCode: "output_limit_exceeded" };
  if (result.cancelled) return { status: "cancelled", dispatch: "terminally-observed", diagnosticCode: "cancelled" };
  if (result.timedOut) return { status: "timed_out", dispatch: "terminally-observed", diagnosticCode: "timed_out" };
  const exitCode = normalizeExitCode(result.exitCode);
  const signal = normalizeSignal(result.signal);
  if (result.error !== undefined && exitCode === null && signal === null) {
    return { status: "failed", dispatch: "known-not-dispatched", diagnosticCode: "process_error" };
  }
  if (signal !== null) return { status: "failed", dispatch: "terminally-observed", diagnosticCode: "signal" };
  if (exitCode === null) {
    return { status: "failed", dispatch: "outcome-unknown", diagnosticCode: "process_error" };
  }
  if (!acceptedExitCodes.has(exitCode)) return { status: "failed", dispatch: "terminally-observed", diagnosticCode: "nonzero_exit" };
  return { status: "completed", dispatch: "terminally-observed", diagnosticCode: "process_error" };
}

interface OutputAccumulator {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly overflowed: boolean;
  append(stream: "stdout" | "stderr", text: string): void;
  setOverflowHandler(handler: () => void): void;
}

function createOutputAccumulator(
  limit: number,
  onOutput: PortableInvocationContext["onOutput"],
): OutputAccumulator {
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overflowed = false;
  let overflowHandler: (() => void) | undefined;
  const accumulator: OutputAccumulator = {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get stdoutBytes() { return stdoutBytes; },
    get stderrBytes() { return stderrBytes; },
    get overflowed() { return overflowed; },
    append(stream, text) {
      if (typeof text !== "string" || overflowed) return;
      const remaining = limit - stdoutBytes - stderrBytes;
      if (remaining <= 0) {
        overflowed = true;
        try { overflowHandler?.(); } catch { /* stop remains best-effort */ }
        return;
      }
      const clipped = clipPortableOutput(stream === "stdout" ? text : "", stream === "stderr" ? text : "", remaining);
      const safeText = sanitizeTerminalText(stream === "stdout" ? clipped.stdout : clipped.stderr);
      const safeBytes = Buffer.byteLength(safeText, "utf8");
      if (stream === "stdout") { stdout += safeText; stdoutBytes += safeBytes; }
      else { stderr += safeText; stderrBytes += safeBytes; }
      try { if (safeText) onOutput?.({ stream, text: safeText }); } catch { /* observers cannot change settlement */ }
      if (clipped.truncated) {
        overflowed = true;
        try { overflowHandler?.(); } catch { /* stop remains best-effort */ }
      }
    },
    setOverflowHandler(handler) { overflowHandler = handler; if (overflowed) handler(); },
  };
  return accumulator;
}
