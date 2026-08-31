import type { RuntimeBuiltinToolExecutionContext, RuntimeBuiltinToolExecutor } from "../session/runtime-session-orchestrator.types.js";
import type { RuntimeCapabilityToolResult } from "./runtime-capability-composition.js";
import {
  canReplayPortableInvocation,
  preparePortableInvocationInput,
  preparePortableInvocationOutput,
  registerRuntimeOwnedPortableInvocationPort,
  PortableInvocationReplayCache,
  portableInvocationReplayKey,
  sanitizeTerminalText,
  settlePortableInvocation,
  type PortableInvocationBinding,
  type PortableInvocationContext,
  type PortableInvocationOutputEvent,
  type PortableInvocationPort,
  type PortableInvocationRequest,
  type PortableInvocationResult,
  type PortableInvocationSettlement,
} from "./portable-execution.js";

export type PortableTrustedHandlerPortKind = "cli" | "local-function";

export interface PortableLocalFunctionContext {
  readonly binding: PortableInvocationBinding;
  readonly signal: AbortSignal;
  readonly trustedContext?: unknown;
  readonly onOutput: (event: PortableInvocationOutputEvent) => void;
}

export type PortableLocalFunction<Output = unknown> = (
  input: Readonly<Record<string, unknown>>,
  context: PortableLocalFunctionContext,
) => Output | Promise<Output>;

export interface PortableLocalFunctionInvocationPortOptions<Output = unknown> {
  /** Trusted process-local handler. It is never projected or persisted. */
  readonly handler?: PortableLocalFunction<Output>;
  /** Alias for callers whose adapter names the trusted function invoke. */
  readonly invoke?: PortableLocalFunction<Output>;
  /** Runtime builtin executor bridge; requires a trusted context at invoke time. */
  readonly executor?: RuntimeBuiltinToolExecutor;
  /** Semantic transport for the trusted implementation (explicit for bridges). */
  readonly kind?: PortableTrustedHandlerPortKind;
  readonly implementationIdentityDigest?: PortableInvocationBinding["implementationIdentityDigest"];
  readonly maxReplayEntries?: number;
  readonly now?: () => string;
  readonly monotonicNow?: () => number;
  /** Defaults to true for the Runtime builtin executor bridge. */
  readonly requireTrustedContext?: boolean;
}

export interface PortableRuntimeBuiltinInvocationPortOptions
  extends Omit<PortableLocalFunctionInvocationPortOptions<RuntimeCapabilityToolResult>, "handler" | "invoke" | "executor" | "kind"> {
  readonly executor: RuntimeBuiltinToolExecutor;
  readonly kind: PortableTrustedHandlerPortKind;
}

/**
 * A provider-neutral local transport for trusted Runtime handlers. The
 * optional Runtime builtin bridge keeps the full host context process-local;
 * only the portable settlement crosses the invocation boundary.
 */
export class PortableLocalFunctionInvocationPort<Output = unknown> implements PortableInvocationPort<Output> {
  public readonly kind: PortableTrustedHandlerPortKind;
  private readonly handler: PortableLocalFunction<Output>;
  private readonly implementationIdentityDigest: PortableInvocationBinding["implementationIdentityDigest"] | undefined;
  private readonly replayCache: PortableInvocationReplayCache<Output>;
  private readonly inFlight = new Map<string, Promise<PortableInvocationResult<Output>>>();
  private readonly now: () => string;
  private readonly monotonicNow: () => number;
  private readonly requireTrustedContext: boolean;

  public constructor(options: PortableLocalFunctionInvocationPortOptions<Output>) {
    const candidates = [options.handler, options.invoke, options.executor].filter((value) => value !== undefined);
    if (candidates.length !== 1) throw new TypeError("Portable local function requires exactly one trusted handler.");
    const executor = options.executor;
    if (executor !== undefined) {
      this.handler = (input, context) => {
        const trustedContext = context.trustedContext as RuntimeBuiltinToolExecutionContext | undefined;
        const executionContext = trustedContext === undefined
          ? undefined
          : Object.freeze({
              ...trustedContext,
              abortSignal: trustedContext.abortSignal === undefined
                ? context.signal
                : AbortSignal.any([trustedContext.abortSignal, context.signal]),
              emitOutput: (event: { readonly stream: "stdout" | "stderr"; readonly delta: string }) => {
                context.onOutput({ stream: event.stream, text: event.delta });
              },
            });
        return executor(
          Object.freeze({ ...input }) as Record<string, unknown>,
          executionContext,
        ) as Promise<Output>;
      };
    } else {
      this.handler = (options.handler ?? options.invoke) as PortableLocalFunction<Output>;
    }
    const kind = options.kind ?? "local-function";
    if (kind !== "cli" && kind !== "local-function") {
      throw new TypeError("Portable trusted handler kind is invalid.");
    }
    this.kind = kind;
    this.implementationIdentityDigest = options.implementationIdentityDigest;
    this.replayCache = new PortableInvocationReplayCache<Output>(options.maxReplayEntries);
    this.now = options.now ?? (() => new Date().toISOString());
    this.monotonicNow = options.monotonicNow ?? (() => Date.now());
    this.requireTrustedContext = options.requireTrustedContext ?? options.executor !== undefined;
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
    if (this.requireTrustedContext && (request.trustedContext === undefined || request.trustedContext === null)) {
      return Promise.resolve(this.resultWithoutDispatch(request.binding, "failed", "missing_context"));
    }
    const replayKey = String(portableInvocationReplayKey(request.binding));
    const cached = this.replayCache.get(request.binding);
    if (cached !== undefined) {
      if (canReplayPortableInvocation(request.binding)) return Promise.resolve(Object.freeze({ ...cached, replayed: true }));
      return Promise.resolve(this.replayConflict(request.binding));
    }
    const active = this.inFlight.get(replayKey);
    if (active !== undefined) {
      if (canReplayPortableInvocation(request.binding)) return active.then((result) => Object.freeze({ ...result, replayed: true }));
      return Promise.resolve(this.replayConflict(request.binding));
    }
    const operation = this.dispatch(request, preparedInput.value.input).then((result) => this.remember(request.binding, result));
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
    const controller = new AbortController();
    const externalSignal = context.signal;
    let settled = false;
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
      return this.resultWithoutDispatch(binding, "cancelled", "cancelled");
    }
    if (externalSignal !== undefined) {
      externalSignal.addEventListener("abort", abort, { once: true });
    }
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
    let dispatched = false;
    const handlerPromise = Promise.resolve().then(() => {
      dispatched = true;
      return this.handler(input, {
        binding,
        signal: controller.signal,
        trustedContext: request.trustedContext,
        onOutput: eventOutput,
      });
    });
    try {
      const winner = await Promise.race([
        handlerPromise.then((value) => ({ kind: "value" as const, value })),
        interrupt.then((kind) => ({ kind })),
      ]);
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
      if (winner.kind !== "value") {
        return this.resultFromSettlement(settlePortableInvocation({
          binding,
          port: this.kind,
          status: winner.kind,
          dispatch: dispatched ? "outcome-unknown" : "known-not-dispatched",
          startedAt,
          settledAt: this.readNow(),
          durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
          outputTruncated: eventOutput.truncated,
          diagnosticCode: winner.kind,
        }));
      }
      const preparedOutput = preparePortableInvocationOutput(binding, winner.value);
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
          diagnosticCode: preparedOutput.code === "output_limit_exceeded" ? "output_limit_exceeded" : "invalid_output",
        }));
      }
      return {
        settlement: settlePortableInvocation({
          binding,
          port: this.kind,
          status: "completed",
          dispatch: "terminally-observed",
          startedAt,
          settledAt: this.readNow(),
          durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
          outputTruncated: eventOutput.truncated,
          outputDigest: preparedOutput.outputDigest,
        }),
        output: preparedOutput.value as Output,
        replayed: false,
      };
    } catch {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
      return this.resultFromSettlement(settlePortableInvocation({
        binding,
        port: this.kind,
        status: "failed",
        dispatch: dispatched ? "terminally-observed" : "known-not-dispatched",
        startedAt,
        settledAt: this.readNow(),
        durationMs: elapsedMs(this.readMonotonicNow(), startedTick),
        outputTruncated: eventOutput.truncated,
        diagnosticCode: "local_function_error",
      }));
    }
  }

  private resultWithoutDispatch(
    binding: PortableInvocationBinding,
    status: "invalid_input" | "failed" | "cancelled",
    diagnosticCode: "invalid_input" | "implementation_mismatch" | "missing_context" | "cancelled",
  ): PortableInvocationResult<Output> {
    return this.resultFromSettlement(settlePortableInvocation({
      binding,
      port: this.kind,
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
      port: this.kind,
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

export function createLocalFunctionPortableInvocationPort<Output = unknown>(
  options: PortableLocalFunctionInvocationPortOptions<Output>,
): PortableLocalFunctionInvocationPort<Output> {
  return new PortableLocalFunctionInvocationPort(options);
}

export const createPortableLocalFunctionInvocationPort = createLocalFunctionPortableInvocationPort;

export function createTrustedRuntimeBuiltinPortableInvocationPort(
  options: PortableRuntimeBuiltinInvocationPortOptions,
): PortableLocalFunctionInvocationPort<RuntimeCapabilityToolResult> {
  return new PortableLocalFunctionInvocationPort<RuntimeCapabilityToolResult>(options);
}

/** Alias for integrations that call the trusted bridge a handler port. */
export const createTrustedHandlerPortableInvocationPort = createLocalFunctionPortableInvocationPort;

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
  return Number.isFinite(now) && Number.isFinite(started) && now >= started ? Math.min(Math.floor(now - started), 24 * 60 * 60 * 1_000) : 0;
}

function createBoundedEventOutput(
  limit: number,
  observer: PortableInvocationContext["onOutput"],
  onOverflow: () => void,
): PortableLocalFunctionContext["onOutput"] & { readonly truncated: boolean } {
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
    try { observer?.({ stream: event.stream, text: safe }); } catch { /* observer cannot affect the handler */ }
  }) as PortableLocalFunctionContext["onOutput"] & { readonly truncated: boolean };
  Object.defineProperty(output, "truncated", { get: () => truncated });
  return output;
}
