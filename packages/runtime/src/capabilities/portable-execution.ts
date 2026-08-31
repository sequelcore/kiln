import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST,
  CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
  compileNormalizedCapabilityJsonSchema,
  normalizeAndDigestCapabilityJsonSchema,
  type CompiledCapabilityJsonSchema,
  type CapabilityLimits,
  type Sha256Digest,
} from "@kilnai/core/capabilities";
import type { IdempotencyType } from "@kilnai/core/engine";
import type { CommandOutputStream } from "@kilnai/core/tools";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_VALUE_DEPTH = 64;
const MAX_REPLAY_ENTRIES = 256;
const RUNTIME_OWNED_PORTS = new WeakSet<object>();
const RUNTIME_OWNED_SETTLEMENTS = new WeakSet<object>();

export const PORTABLE_INVOCATION_SETTLEMENT_SCHEMA = "kiln.portable-invocation-settlement/v1" as const;

/** Admitted transport vocabulary; concrete factories are added per slice. */
export type PortableInvocationPortKind =
  | "mcp"
  | "openapi"
  | "graphql"
  | "approved-service"
  | "code-mode"
  | "cli"
  | "local-function"
  /** Agent-backed execution remains a Runtime-owned invocation port. */
  | "agent-task"
  | "managed-invocation";

export type PortableInvocationAgentExecutionKind = "agent-task" | "managed-invocation";

/**
 * Sanitized provenance attached to an agent-backed invocation settlement.
 * Child output is evidence only; it never becomes Runtime authority.
 */
export interface PortableInvocationAgentProvenance {
  readonly kind: PortableInvocationAgentExecutionKind;
  readonly childId: string;
  readonly executorId: string;
  readonly trust: "untrusted-child-output";
}

export type PortableInvocationSettlementStatus =
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "output_limit_exceeded"
  | "invalid_input"
  | "invalid_output"
  | "replay_conflict";

export type PortableInvocationDispatchDisposition =
  | "known-not-dispatched"
  | "terminally-observed"
  | "outcome-unknown";

export type PortableInvocationDiagnosticCode =
  | "invalid_input"
  | "invalid_output"
  | "missing_context"
  | "unavailable"
  | "process_error"
  | "nonzero_exit"
  | "signal"
  | "cancelled"
  | "timed_out"
  | "output_limit_exceeded"
  | "idempotency_conflict"
  | "implementation_mismatch"
  | "local_function_error"
  | "agent_execution_error"
  | "agent_outcome_unknown"
  | "agent_executor_result_invalid";

export interface PortableInvocationOutputEvent {
  readonly stream: CommandOutputStream;
  readonly text: string;
}

export interface PortableInvocationContext {
  /** Cancellation is an execution input after the caller has been admitted. */
  readonly signal?: AbortSignal;
  /** Optional bounded, already-sanitized progress observer. */
  readonly onOutput?: (event: PortableInvocationOutputEvent) => void;
  /** A caller may request less time, never more than the capability limit. */
  readonly timeoutMs?: number;
}

export interface PortableInvocationBindingInput {
  readonly generationId: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptorDigest: Sha256Digest;
  readonly toolName: string;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
  readonly input: Record<string, unknown>;
  readonly limits: CapabilityLimits;
  readonly idempotency: IdempotencyType;
  /** Explicit replay key required for conditionally-idempotent work. */
  readonly idempotencyKey?: string;
  /** A caller may explicitly forbid even an idempotent local replay. */
  readonly replayPosture?: "allow" | "deny";
}

/**
 * The process-local identity of one admitted invocation. Schemas are retained
 * only in this private Runtime value; settlements carry their digests.
 */
export interface PortableInvocationBinding {
  readonly generationId: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptorDigest: Sha256Digest;
  readonly toolName: string;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
  readonly inputDigest: Sha256Digest;
  readonly limits: Readonly<CapabilityLimits>;
  readonly idempotency: IdempotencyType;
  readonly idempotencyKey?: string;
  readonly replayPosture?: "allow" | "deny";
  readonly inputValidator: CompiledCapabilityJsonSchema;
  readonly outputValidator?: CompiledCapabilityJsonSchema;
}

export interface PortableInvocationRequest {
  readonly binding: PortableInvocationBinding;
  readonly input: Record<string, unknown>;
  readonly context?: PortableInvocationContext;
  /** Process-local trusted context; never serialized or copied into evidence. */
  readonly trustedContext?: unknown;
  /** Convenience aliases for callers that already carry a flat execution context. */
  readonly signal?: AbortSignal;
  readonly onOutput?: (event: PortableInvocationOutputEvent) => void;
  readonly timeoutMs?: number;
}

export interface PortableInvocationSettlement {
  readonly schema: typeof PORTABLE_INVOCATION_SETTLEMENT_SCHEMA;
  readonly settlementId: Sha256Digest;
  readonly port: PortableInvocationPortKind;
  readonly status: PortableInvocationSettlementStatus;
  readonly dispatch: PortableInvocationDispatchDisposition;
  readonly generationId: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptorDigest: Sha256Digest;
  readonly toolName: string;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
  readonly inputDigest: Sha256Digest;
  readonly outputDigest: Sha256Digest | null;
  readonly limits: Readonly<CapabilityLimits>;
  readonly idempotency: IdempotencyType;
  readonly idempotencyKey?: string;
  readonly replayPosture?: "allow" | "deny";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly outputBytes: number;
  readonly outputTruncated: boolean;
  /** Present only for Runtime-owned agent-backed execution ports. */
  readonly agentBacked?: PortableInvocationAgentProvenance;
  readonly diagnosticCode?: PortableInvocationDiagnosticCode;
  readonly startedAt: string;
  readonly settledAt: string;
  readonly durationMs: number;
  readonly sanitized: true;
}

export interface PortableInvocationResult<Output = unknown> {
  readonly settlement: PortableInvocationSettlement;
  readonly output?: Output;
  /** True only when an immutable prior terminal result was returned. */
  readonly replayed: boolean;
}

export interface PortableInvocationPort<Output = unknown> {
  readonly kind: PortableInvocationPortKind;
  invoke(request: PortableInvocationRequest): Promise<PortableInvocationResult<Output>>;
}

/** Package-private ownership brand used by concrete Runtime port factories. */
export function registerRuntimeOwnedPortableInvocationPort<T extends object>(port: T): T {
  RUNTIME_OWNED_PORTS.add(port);
  return port;
}

export function isRuntimeOwnedPortableInvocationPort(value: unknown): boolean {
  return value !== null && typeof value === "object" && RUNTIME_OWNED_PORTS.has(value);
}

export interface PortableInvocationInputPreparation {
  readonly input: Readonly<Record<string, unknown>>;
  readonly canonicalInput: string;
  readonly inputDigest: Sha256Digest;
}

export type PortableInvocationInputValidation =
  | { readonly ok: true; readonly value: PortableInvocationInputPreparation }
  | { readonly ok: false; readonly code: PortableInvocationDiagnosticCode };

export interface PortableInvocationSettlementInput {
  readonly binding: PortableInvocationBinding;
  readonly port: PortableInvocationPortKind;
  readonly status: PortableInvocationSettlementStatus;
  readonly dispatch: PortableInvocationDispatchDisposition;
  readonly startedAt: string;
  readonly settledAt: string;
  readonly durationMs: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
  readonly outputTruncated?: boolean;
  readonly outputDigest?: Sha256Digest | null;
  readonly agentBacked?: PortableInvocationAgentProvenance;
  readonly diagnosticCode?: PortableInvocationDiagnosticCode;
}

/**
 * Normalizes the exact schema and candidate input once, then content-addresses
 * the input used by the invocation. No input object is retained by the port.
 */
export function createPortableInvocationBinding(input: PortableInvocationBindingInput): PortableInvocationBinding {
  const identity = normalizeBindingIdentity(input);
  const inputSchema = normalizeSchema(input.inputSchema, "input");
  if (!inputSchema.present) throw new TypeError("Portable invocation input schema is required.");
  const outputSchema = normalizeSchema(input.outputSchema, "output");
  if (inputSchema.digest !== input.inputSchemaDigest) {
    throw new TypeError("Portable invocation input schema digest does not match the admitted schema.");
  }
  if (outputSchema.digest !== input.outputSchemaDigest) {
    throw new TypeError("Portable invocation output schema digest does not match the admitted schema.");
  }
  const limits = normalizeLimits(input.limits);
  const inputValidator = compileNormalizedCapabilityJsonSchema(inputSchema.value, "input", inputSchema.digest);
  const outputValidator = outputSchema.present
    ? compileNormalizedCapabilityJsonSchema(outputSchema.value, "output", outputSchema.digest)
    : undefined;
  // Binding admits an inert candidate and its digest first. Exact schema
  // validation belongs to preparePortableInvocationInput so malformed tool
  // calls can settle as invalid_input rather than escaping as a throw.
  const prepared = prepareInputCandidate(input.input, limits);
  if (!prepared.ok) throw new TypeError("Portable invocation input is invalid for the admitted schema.");
  const idempotency = normalizeIdempotency(input.idempotency);
  const idempotencyKey = normalizeOptionalIdentifier(input.idempotencyKey, "idempotencyKey");
  const replayPosture = normalizeReplayPosture(input.replayPosture);
  if (idempotency === "conditionally-idempotent" && replayPosture === "allow" && idempotencyKey === undefined) {
    throw new TypeError("Conditionally-idempotent portable invocations require an explicit replay key.");
  }
  return Object.freeze({
    ...identity,
    inputSchema: deepFreeze(inputSchema.value),
    ...(outputSchema.present ? { outputSchema: deepFreeze(outputSchema.value) } : {}),
    inputDigest: prepared.value.inputDigest,
    limits: Object.freeze(limits),
    idempotency,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(replayPosture === undefined ? {} : { replayPosture }),
    inputValidator,
    ...(outputValidator === undefined ? {} : { outputValidator }),
  });
}

/** Validates a later request against the immutable binding without retaining its input. */
export function preparePortableInvocationInput(
  binding: PortableInvocationBinding,
  input: Record<string, unknown>,
): PortableInvocationInputValidation {
  try {
    const prepared = prepareInputValue(input, binding.inputValidator, binding.limits);
    if (!prepared.ok || prepared.value.inputDigest !== binding.inputDigest) {
      return { ok: false, code: "invalid_input" };
    }
    return prepared;
  } catch {
    return { ok: false, code: "invalid_input" };
  }
}

export function portableInvocationReplayKey(binding: PortableInvocationBinding): Sha256Digest {
  return digestPortable({
    generationId: binding.generationId,
    catalogDigest: binding.catalogDigest,
    capabilityId: binding.capabilityId,
    revision: binding.revision,
    descriptorDigest: binding.descriptorDigest,
    toolName: binding.toolName,
    implementationIdentityDigest: binding.implementationIdentityDigest,
    inputSchemaDigest: binding.inputSchemaDigest,
    outputSchemaDigest: binding.outputSchemaDigest,
    toolCallScopeId: binding.toolCallScopeId,
    toolCallId: binding.toolCallId,
    inputDigest: binding.inputDigest,
    limits: binding.limits,
    idempotency: binding.idempotency,
    ...(binding.idempotencyKey === undefined ? {} : { idempotencyKey: binding.idempotencyKey }),
    ...(binding.replayPosture === undefined ? {} : { replayPosture: binding.replayPosture }),
  });
}

export function canReplayPortableInvocation(binding: PortableInvocationBinding): boolean {
  if (binding.replayPosture === "deny") return false;
  if (binding.idempotency === "idempotent") return true;
  return binding.idempotency === "conditionally-idempotent"
    && binding.replayPosture === "allow"
    && binding.idempotencyKey !== undefined;
}

/** Process-local replay memory; it never claims durable replay authority. */
export class PortableInvocationReplayCache<Output = unknown> {
  private readonly entries = new Map<Sha256Digest, PortableInvocationResult<Output>>();
  private readonly maxEntries: number;

  public constructor(maxEntries = MAX_REPLAY_ENTRIES) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0 || maxEntries > 4_096) {
      throw new TypeError("Portable invocation replay cache size must be a positive bounded integer.");
    }
    this.maxEntries = maxEntries;
  }

  public get(binding: PortableInvocationBinding): PortableInvocationResult<Output> | undefined {
    const key = portableInvocationReplayKey(binding);
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  public set(binding: PortableInvocationBinding, result: PortableInvocationResult<Output>): void {
    const key = portableInvocationReplayKey(binding);
    this.entries.delete(key);
    this.entries.set(key, result);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as Sha256Digest | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  public clear(): void {
    this.entries.clear();
  }
}

/** Creates one immutable, sanitized terminal record. */
export function settlePortableInvocation(input: PortableInvocationSettlementInput): PortableInvocationSettlement {
  const binding = input.binding;
  const outputLimit = binding.limits.maxOutputBytes;
  const rawStdout = sanitizeTerminalText(input.stdout ?? "");
  const rawStderr = sanitizeTerminalText(input.stderr ?? "");
  const clipped = clipPortableOutput(rawStdout, rawStderr, outputLimit);
  const stdout = clipped.stdout;
  const stderr = clipped.stderr;
  const declaredStdoutBytes = boundedCount(input.stdoutBytes, byteLength(stdout));
  const declaredStderrBytes = boundedCount(input.stderrBytes, byteLength(stderr));
  const stdoutBytes = Math.min(declaredStdoutBytes, outputLimit);
  const stderrBytes = Math.min(declaredStderrBytes, outputLimit - stdoutBytes);
  const outputDigest = input.outputDigest === undefined || input.outputDigest === null
    ? null
    : (isSha256Digest(input.outputDigest) ? input.outputDigest : null);
  const agentBacked = input.agentBacked === undefined
    ? undefined
    : normalizeAgentProvenance(input.agentBacked);
  const agentPort = input.port === "agent-task" || input.port === "managed-invocation";
  if (agentPort !== (agentBacked !== undefined)
    || (agentBacked !== undefined && agentBacked.kind !== input.port)) {
    throw new TypeError("Agent-backed invocation port and provenance must agree.");
  }
  const body: Omit<PortableInvocationSettlement, "settlementId"> = {
    schema: PORTABLE_INVOCATION_SETTLEMENT_SCHEMA,
    port: input.port,
    status: input.status,
    dispatch: input.dispatch,
    generationId: binding.generationId,
    catalogDigest: binding.catalogDigest,
    capabilityId: binding.capabilityId,
    revision: binding.revision,
    descriptorDigest: binding.descriptorDigest,
    toolName: binding.toolName,
    implementationIdentityDigest: binding.implementationIdentityDigest,
    inputSchemaDigest: binding.inputSchemaDigest,
    outputSchemaDigest: binding.outputSchemaDigest,
    toolCallScopeId: binding.toolCallScopeId,
    toolCallId: binding.toolCallId,
    inputDigest: binding.inputDigest,
    outputDigest,
    limits: Object.freeze({ ...binding.limits }),
    idempotency: binding.idempotency,
    ...(binding.idempotencyKey === undefined ? {} : { idempotencyKey: binding.idempotencyKey }),
    ...(binding.replayPosture === undefined ? {} : { replayPosture: binding.replayPosture }),
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    stdout,
    stderr,
    stdoutBytes,
    stderrBytes,
    outputBytes: stdoutBytes + stderrBytes,
    outputTruncated: (input.outputTruncated ?? false)
      || clipped.truncated
      || declaredStdoutBytes > stdoutBytes
      || declaredStderrBytes > stderrBytes,
    ...(agentBacked === undefined ? {} : { agentBacked }),
    ...(input.diagnosticCode === undefined ? {} : { diagnosticCode: input.diagnosticCode }),
    startedAt: canonicalInstant(input.startedAt, "startedAt"),
    settledAt: canonicalInstant(input.settledAt, "settledAt"),
    durationMs: boundedDuration(input.durationMs),
    sanitized: true,
  };
  const settlement = Object.freeze({
    ...body,
    settlementId: digestPortable(body),
  });
  RUNTIME_OWNED_SETTLEMENTS.add(settlement);
  return settlement;
}

/** Accepts only the immutable settlement object created by this Runtime process. */
export function isRuntimeOwnedPortableInvocationSettlement(
  value: unknown,
): value is PortableInvocationSettlement {
  return value !== null
    && typeof value === "object"
    && Object.isFrozen(value)
    && RUNTIME_OWNED_SETTLEMENTS.has(value);
}

/** Sanitizes terminal text before it can reach a model, event, or evidence projection. */
export function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/-----BEGIN [^-\r\n]+ PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]+ PRIVATE KEY-----/gu, "<redacted-private-key>")
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer <redacted>")
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs]|glpat|AKIA)[A-Za-z0-9_-]{8,}\b/gu, "<redacted-secret>")
    .replace(/((?:authorization|cookie|credential|password|passwd|private[_-]?key|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*)[^\s,;}]+/giu, "$1<redacted>")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\r\n?/gu, "\n");
}

export function digestPortable(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalPortableStringify(value), "utf8").digest("hex")}`;
}

export function isPortableEnvironmentName(value: string): boolean {
  return ENVIRONMENT_NAME_PATTERN.test(value);
}

export function normalizePortableEnvironment(
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (!isPlainRecord(environment)) throw new TypeError("Portable CLI environment must be a plain allowlist.");
  const entries = Object.entries(environment);
  if (entries.length > 128) throw new TypeError("Portable CLI environment allowlist is too large.");
  const normalized: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!isPortableEnvironmentName(name) || value.includes("\u0000") || value.length > 16_384) {
      throw new TypeError("Portable CLI environment contains an invalid name or value.");
    }
    normalized[name] = value;
  }
  return Object.freeze(normalized);
}

/**
 * Validates argv without changing it. Portable CLI adapters must reject a
 * credential-looking argument instead of redacting it and invoking a
 * different command than the admitted one.
 */
export function assertPortableCliArguments(args: readonly string[]): readonly string[] {
  if (!Array.isArray(args) || args.length > 256) {
    throw new TypeError("Portable CLI arguments are invalid.");
  }
  return Object.freeze(args.map((arg) => {
    if (typeof arg !== "string"
      || arg.includes("\u0000")
      || arg.length > 16_384
      || isCredentialArgumentName(arg)
      || isSecretValue(arg)) {
      throw new TypeError("Portable CLI arguments contain unsafe data.");
    }
    return arg;
  }));
}

/** Clips combined UTF-8 output without splitting a surrogate pair. */
export function clipPortableOutput(
  stdout: string,
  stderr: string,
  maxBytes: number,
): { readonly stdout: string; readonly stderr: string; readonly truncated: boolean } {
  if (!boundedInteger(maxBytes, 1, 64 * 1024 * 1024)) {
    throw new TypeError("Portable output bound is invalid.");
  }
  let remaining = maxBytes;
  const clippedStdout = clipUtf8(stdout, remaining);
  remaining -= byteLength(clippedStdout.value);
  const clippedStderr = clipUtf8(stderr, remaining);
  return {
    stdout: clippedStdout.value,
    stderr: clippedStderr.value,
    truncated: clippedStdout.truncated || clippedStderr.truncated,
  };
}

function normalizeBindingIdentity(input: PortableInvocationBindingInput): Pick<
  PortableInvocationBinding,
  | "generationId"
  | "catalogDigest"
  | "capabilityId"
  | "revision"
  | "descriptorDigest"
  | "toolName"
  | "implementationIdentityDigest"
  | "inputSchemaDigest"
  | "outputSchemaDigest"
  | "toolCallScopeId"
  | "toolCallId"
> {
  for (const [label, value] of [
    ["generationId", input.generationId],
    ["catalogDigest", input.catalogDigest],
    ["descriptorDigest", input.descriptorDigest],
    ["implementationIdentityDigest", input.implementationIdentityDigest],
    ["inputSchemaDigest", input.inputSchemaDigest],
    ["outputSchemaDigest", input.outputSchemaDigest],
  ] as const) {
    if (!isSha256Digest(value)) throw new TypeError(`Portable invocation ${label} must be a canonical digest.`);
  }
  for (const [label, value] of [
    ["capabilityId", input.capabilityId],
    ["revision", input.revision],
    ["toolName", input.toolName],
    ["toolCallScopeId", input.toolCallScopeId],
    ["toolCallId", input.toolCallId],
  ] as const) {
    requireIdentifier(value, label);
  }
  return {
    generationId: input.generationId,
    catalogDigest: input.catalogDigest,
    capabilityId: input.capabilityId,
    revision: input.revision,
    descriptorDigest: input.descriptorDigest,
    toolName: input.toolName,
    implementationIdentityDigest: input.implementationIdentityDigest,
    inputSchemaDigest: input.inputSchemaDigest,
    outputSchemaDigest: input.outputSchemaDigest,
    toolCallScopeId: input.toolCallScopeId,
    toolCallId: input.toolCallId,
  };
}

function normalizeSchema(
  value: Record<string, unknown> | undefined,
  direction: "input" | "output",
): { readonly present: true; readonly value: Readonly<Record<string, unknown>>; readonly digest: Sha256Digest } | { readonly present: false; readonly value: undefined; readonly digest: Sha256Digest } {
  const result = normalizeAndDigestCapabilityJsonSchema(value, direction, {
    present: value !== undefined,
    ...(direction === "input" ? { requireObjectType: true } : {}),
  });
  if (!result.ok) throw new TypeError(`Portable invocation ${direction} schema is not admitted.`);
  if (!result.present) {
    return {
      present: false,
      value: undefined,
      digest: direction === "input" ? CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST : CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
    };
  }
  return { present: true, value: result.value, digest: result.digest };
}

function prepareInputValue(
  input: Record<string, unknown>,
  validator: CompiledCapabilityJsonSchema,
  limits: Pick<CapabilityLimits, "maxInputBytes">,
): PortableInvocationInputValidation {
  try {
    const cloned = clonePortableJson(input, true, 0);
    if (!isPlainRecord(cloned)) return { ok: false, code: "invalid_input" };
    const canonicalInput = canonicalPortableStringify(cloned);
    if (byteLength(canonicalInput) > limits.maxInputBytes) return { ok: false, code: "invalid_input" };
    const inputDigest = digestPortableCanonical(canonicalInput);
    if (!validator.validate(cloned)) return { ok: false, code: "invalid_input" };
    return {
      ok: true,
      value: {
        input: deepFreeze(cloned),
        canonicalInput,
        inputDigest,
      },
    };
  } catch {
    return { ok: false, code: "invalid_input" };
  }
}

function prepareInputCandidate(
  input: unknown,
  limits: Pick<CapabilityLimits, "maxInputBytes">,
): PortableInvocationInputValidation {
  try {
    const cloned = clonePortableJson(input, true, 0);
    const canonicalInput = canonicalPortableStringify(cloned);
    if (byteLength(canonicalInput) > limits.maxInputBytes) return { ok: false, code: "invalid_input" };
    return {
      ok: true,
      value: {
        input: isPlainRecord(cloned) ? deepFreeze(cloned) : Object.freeze({}),
        canonicalInput,
        inputDigest: digestPortableCanonical(canonicalInput),
      },
    };
  } catch {
    return { ok: false, code: "invalid_input" };
  }
}

export type PortableInvocationOutputPreparation =
  | { readonly ok: true; readonly value: unknown; readonly outputDigest: Sha256Digest | null }
  | { readonly ok: false; readonly code: "invalid_output" | "output_limit_exceeded" };

/** Copies, validates, bounds, and content-addresses one local/CLI result. */
export function preparePortableInvocationOutput(
  binding: PortableInvocationBinding,
  value: unknown,
): PortableInvocationOutputPreparation {
  try {
    if (value === undefined && binding.outputValidator === undefined) {
      return { ok: true, value: undefined, outputDigest: null };
    }
    const cloned = clonePortableJson(value, true, 0);
    const canonical = canonicalPortableStringify(cloned);
    if (byteLength(canonical) > binding.limits.maxOutputBytes) {
      return { ok: false, code: "output_limit_exceeded" };
    }
    if (binding.outputValidator !== undefined && !binding.outputValidator.validate(cloned)) {
      return { ok: false, code: "invalid_output" };
    }
    return {
      ok: true,
      value: deepFreeze(cloned),
      outputDigest: digestPortableCanonical(canonical),
    };
  } catch {
    return { ok: false, code: "invalid_output" };
  }
}

function normalizeLimits(value: CapabilityLimits): CapabilityLimits {
  if (!isPlainRecord(value)
    || !boundedInteger(value.maxInputBytes, 1, 64 * 1024 * 1024)
    || !boundedInteger(value.maxOutputBytes, 1, 64 * 1024 * 1024)
    || !boundedInteger(value.maxDurationMs, 1, 24 * 60 * 60 * 1_000)
    || !boundedInteger(value.maxArtifacts, 0, 10_000)) {
    throw new TypeError("Portable invocation limits are invalid.");
  }
  return {
    maxInputBytes: value.maxInputBytes,
    maxOutputBytes: value.maxOutputBytes,
    maxDurationMs: value.maxDurationMs,
    maxArtifacts: value.maxArtifacts,
  };
}

function normalizeIdempotency(value: IdempotencyType): IdempotencyType {
  if (value !== "idempotent" && value !== "conditionally-idempotent" && value !== "non-idempotent" && value !== "unknown") {
    throw new TypeError("Portable invocation idempotency is invalid.");
  }
  return value;
}

function normalizeOptionalIdentifier(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  requireIdentifier(value, label);
  return value;
}

function normalizeReplayPosture(value: "allow" | "deny" | undefined): "allow" | "deny" | undefined {
  if (value !== undefined && value !== "allow" && value !== "deny") {
    throw new TypeError("Portable invocation replay posture is invalid.");
  }
  return value;
}

function normalizeAgentProvenance(value: PortableInvocationAgentProvenance): PortableInvocationAgentProvenance {
  if (!isPlainRecord(value)
    || (value.kind !== "agent-task" && value.kind !== "managed-invocation")
    || typeof value.childId !== "string"
    || typeof value.executorId !== "string"
    || value.trust !== "untrusted-child-output") {
    throw new TypeError("Agent-backed invocation provenance is invalid.");
  }
  requireIdentifier(value.childId, "agent childId");
  requireIdentifier(value.executorId, "agent executorId");
  return Object.freeze({
    kind: value.kind,
    childId: value.childId,
    executorId: value.executorId,
    trust: "untrusted-child-output" as const,
  });
}

function clonePortableJson(value: unknown, rejectSecrets: boolean, depth: number): unknown {
  if (depth > MAX_VALUE_DEPTH) throw new TypeError("Portable JSON depth exceeded.");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && isSecretValue(value)) throw new TypeError("Portable value contains a secret-like token.");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Portable JSON number is not finite.");
    return value;
  }
  if (value === undefined || typeof value !== "object" || isProxy(value)) throw new TypeError("Portable value is not inert JSON.");
  if (Array.isArray(value)) return value.map((entry) => clonePortableJson(entry, rejectSecrets, depth + 1));
  if (!isPlainRecord(value)) throw new TypeError("Portable value is not a plain record.");
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (rejectSecrets && isSecretKey(key)) throw new TypeError("Portable value contains a credential-bearing property.");
    result[key] = clonePortableJson(entry, rejectSecrets, depth + 1);
  }
  return result;
}

function canonicalPortableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPortableStringify).join(",")}]`;
  if (!isPlainRecord(value)) throw new TypeError("Portable value cannot be canonicalized.");
  return `{${Object.entries(value)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPortableStringify(entry)}`)
    .join(",")}}`;
}

function digestPortableCanonical(canonicalValue: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalValue, "utf8").digest("hex")}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function isSecretKey(value: string): boolean {
  const compact = value.replace(/[^A-Za-z]/gu, "").toLowerCase();
  return /(?:^|[_-])(authorization|cookie|credential|credentials|password|passwd|private[_-]?key|secret|token|api[_-]?key|access[_-]?key)(?:$|[_-])/iu.test(value)
    || new Set(["authorization", "cookie", "credential", "credentials", "password", "passwd", "privatekey", "secret", "token", "apikey", "accesskey"]).has(compact);
}

function isSecretValue(value: string): boolean {
  return /(?:^|[._:/+\-])Bearer\s+\S+/iu.test(value)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(value)
    || /(?:^|[._:/+\-])(?:sk|pk|ghp|github_pat|xox[baprs]|glpat|AKIA)[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u.test(value)
    || /(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/iu.test(value);
}

function isCredentialArgumentName(value: string): boolean {
  const option = /^(?:--?|\/)([^=:]+)(?:[=:].*)?$/u.exec(value)?.[1];
  if (option === undefined) return false;
  return /(?:^|[-_])(?:authorization|auth|oauth|cookie|credentials?|password|passwd|private[-_]?key|secret|token|api[-_]?key|access[-_]?(?:key|token)|refresh[-_]?token|client[-_]?secret)(?:$|[-_])/iu.test(option);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  try {
    return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
  } catch {
    return false;
  }
}

function requireIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value) || value.trim().length === 0) {
    throw new TypeError(`Portable invocation ${label} is invalid.`);
  }
}

function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function boundedCount(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function boundedDuration(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 24 * 60 * 60 * 1_000) : 0;
}

function canonicalInstant(value: string, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError(`Portable invocation ${label} is invalid.`);
  return new Date(value).toISOString();
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function clipUtf8(value: string, maxBytes: number): { readonly value: string; readonly truncated: boolean } {
  if (byteLength(value) <= maxBytes) return { value, truncated: false };
  if (maxBytes <= 0) return { value: "", truncated: true };
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) end -= 1;
  if (end > 0 && end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) {
    end -= 1;
  }
  return { value: value.slice(0, end), truncated: true };
}

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
