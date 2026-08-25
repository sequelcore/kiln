import pkg from "../../package.json" with { type: "json" };

const DEFAULT_MAX_PAGES = 8;
const DEFAULT_MAX_ITEMS = 500;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_PAGE_SIZE = 100;
const CLEANUP_TIMEOUT_MS = 250;

export interface CodexThreadContinuityTransport {
  /** Send one JSONL payload without a trailing newline. */
  readonly sendLine: (line: string) => void | Promise<void>;
  /** Read one JSONL payload, or null/undefined when the stream closes. */
  readonly readLine: (signal: AbortSignal) => string | null | undefined | Promise<string | null | undefined>;
  readonly abort?: () => void | Promise<void>;
  readonly kill?: () => void | Promise<void>;
  readonly close?: () => void | Promise<void>;
}

export type CodexThreadContinuityErrorCode =
  | "aborted"
  | "invalid_input"
  | "protocol"
  | "server"
  | "timeout"
  | "transport";

export class CodexThreadContinuityError extends Error {
  readonly code: CodexThreadContinuityErrorCode;

  constructor(code: CodexThreadContinuityErrorCode, message: string) {
    super(message);
    this.name = "CodexThreadContinuityError";
    this.code = code;
  }
}

export interface CodexThreadContinuityProofInput {
  readonly transport: CodexThreadContinuityTransport;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly timeoutMs?: number;
  readonly resumeThreadId?: string;
  readonly signal?: AbortSignal;
}

export interface CodexThreadContinuityResumeProof {
  readonly threadId: string;
  readonly modelProvider: "kiln";
  readonly exactThreadId: true;
}

export interface CodexThreadContinuityProof {
  readonly protocol: "codex-app-server-v2";
  readonly pagesRead: number;
  readonly itemsRead: number;
  readonly providerCounts: Readonly<Record<string, number>>;
  readonly truncated: boolean;
  readonly resume: CodexThreadContinuityResumeProof | null;
}

export interface CodexRuntimePermissionAttestationProofInput {
  readonly transport: CodexThreadContinuityTransport;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CodexRuntimePermissionAttestationProof {
  readonly protocol: "codex-app-server-v2";
  readonly threadId: string;
  readonly approvalMode: "never" | "on-request" | "untrusted";
  readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  readonly networkAccess: "restricted" | "enabled";
}

interface JsonObject {
  readonly [key: string]: unknown;
}

interface ThreadSummary {
  readonly id: string;
  readonly modelProvider: string;
}

interface ThreadListPage {
  readonly data: readonly ThreadSummary[];
  readonly nextCursor: string | null;
}

/**
 * Run a bounded, content-free proof against one Codex app-server connection.
 *
 * The caller owns construction of the process/stream transport. This function
 * only speaks the app-server JSONL protocol and always attempts to abort, kill,
 * and close the one-shot transport before returning.
 */
export async function runCodexThreadContinuityProof(
  input: CodexThreadContinuityProofInput,
): Promise<CodexThreadContinuityProof> {
  const maxPages = boundedInteger(input.maxPages ?? DEFAULT_MAX_PAGES, "maxPages", 1, 10_000);
  const maxItems = boundedInteger(input.maxItems ?? DEFAULT_MAX_ITEMS, "maxItems", 1, 100_000);
  const timeoutMs = boundedInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 1, MAX_TIMEOUT_MS);
  const resumeThreadId = validateResumeThreadId(input.resumeThreadId);
  if (
    !input.transport ||
    typeof input.transport.sendLine !== "function" ||
    typeof input.transport.readLine !== "function"
  ) {
    throw new CodexThreadContinuityError("invalid_input", "Codex thread continuity transport is invalid.");
  }

  const controller = new AbortController();
  let abortedByCaller = false;
  const onCallerAbort = (): void => {
    abortedByCaller = true;
    controller.abort();
  };
  if (input.signal?.aborted) {
    onCallerAbort();
  } else {
    input.signal?.addEventListener("abort", onCallerAbort, { once: true });
  }

  const deadline = Date.now() + timeoutMs;
  let nextRequestId = 1;
  try {
    await request(
      input.transport,
      controller,
      deadline,
      "initialize",
      {
        clientInfo: { name: "kiln", title: "Kiln", version: pkg.version },
        capabilities: null,
      },
      () => abortedByCaller,
      () => nextRequestId++,
    );
    await sendNotification(input.transport, controller, deadline, "initialized", () => abortedByCaller);

    const counts = new Map<string, number>();
    let pagesRead = 0;
    let itemsRead = 0;
    let cursor: string | null = null;
    let truncated = false;

    while (pagesRead < maxPages && itemsRead < maxItems) {
      const remaining = maxItems - itemsRead;
      const page: ThreadListPage = await request(
        input.transport,
        controller,
        deadline,
        "thread/list",
        {
          cursor,
          limit: Math.min(MAX_PAGE_SIZE, remaining),
        },
        () => abortedByCaller,
        () => nextRequestId++,
      ).then((result) => parseThreadListPage(result));
      pagesRead += 1;

      const acceptedItems = Math.min(page.data.length, remaining);
      for (let index = 0; index < acceptedItems; index += 1) {
        const thread = page.data[index]!;
        counts.set(thread.modelProvider, (counts.get(thread.modelProvider) ?? 0) + 1);
      }
      itemsRead += acceptedItems;

      const hasMore = page.nextCursor !== null;
      if (!hasMore) {
        truncated = page.data.length > acceptedItems;
        break;
      }
      if (page.data.length > acceptedItems || pagesRead >= maxPages || itemsRead >= maxItems) {
        truncated = true;
        break;
      }
      if (page.nextCursor === cursor) {
        throw protocolError();
      }
      cursor = page.nextCursor;
    }

    let resume: CodexThreadContinuityResumeProof | null = null;
    if (resumeThreadId !== undefined) {
      const result = await request(
        input.transport,
        controller,
        deadline,
        "thread/resume",
        {
          threadId: resumeThreadId,
          modelProvider: "kiln",
          excludeTurns: true,
        },
        () => abortedByCaller,
        () => nextRequestId++,
      );
      resume = parseResumeProof(result, resumeThreadId);
    }

    return {
      protocol: "codex-app-server-v2",
      pagesRead,
      itemsRead,
      providerCounts: Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))),
      truncated,
      resume,
    };
  } catch (error) {
    if (error instanceof CodexThreadContinuityError) {
      throw error;
    }
    if (abortedByCaller) {
      throw new CodexThreadContinuityError("aborted", "Codex thread continuity proof was aborted.");
    }
    throw new CodexThreadContinuityError("transport", "Codex app-server transport failed.");
  } finally {
    input.signal?.removeEventListener("abort", onCallerAbort);
    controller.abort();
    await cleanupTransport(input.transport);
  }
}

/**
 * Start one ephemeral thread without a turn and read back the policy applied by
 * that exact app-server connection. No prompt, thread content, or provider
 * response is requested or returned.
 */
export async function runCodexRuntimePermissionAttestationProof(
  input: CodexRuntimePermissionAttestationProofInput,
): Promise<CodexRuntimePermissionAttestationProof> {
  const timeoutMs = boundedInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 1, MAX_TIMEOUT_MS);
  if (!input.transport || typeof input.transport.sendLine !== "function" || typeof input.transport.readLine !== "function") {
    throw new CodexThreadContinuityError("invalid_input", "Codex runtime attestation transport is invalid.");
  }
  if (!isSafeText(input.cwd, 32_768) || input.cwd.trim() !== input.cwd) {
    throw new CodexThreadContinuityError("invalid_input", "Codex runtime attestation cwd is invalid.");
  }

  const controller = new AbortController();
  let abortedByCaller = false;
  const onCallerAbort = (): void => {
    abortedByCaller = true;
    controller.abort();
  };
  if (input.signal?.aborted) onCallerAbort();
  else input.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const deadline = Date.now() + timeoutMs;
  let nextRequestId = 1;
  try {
    await request(
      input.transport,
      controller,
      deadline,
      "initialize",
      { clientInfo: { name: "kiln", title: "Kiln", version: pkg.version }, capabilities: null },
      () => abortedByCaller,
      () => nextRequestId++,
    );
    await sendNotification(input.transport, controller, deadline, "initialized", () => abortedByCaller);
    const result = await request(
      input.transport,
      controller,
      deadline,
      "thread/start",
      { cwd: input.cwd, ephemeral: true },
      () => abortedByCaller,
      () => nextRequestId++,
    );
    return parseRuntimePermissionAttestation(result);
  } catch (error) {
    if (error instanceof CodexThreadContinuityError) throw error;
    if (abortedByCaller) {
      throw new CodexThreadContinuityError("aborted", "Codex runtime permission attestation was aborted.");
    }
    throw new CodexThreadContinuityError("transport", "Codex app-server transport failed.");
  } finally {
    input.signal?.removeEventListener("abort", onCallerAbort);
    controller.abort();
    await cleanupTransport(input.transport);
  }
}

async function request(
  transport: CodexThreadContinuityTransport,
  controller: AbortController,
  deadline: number,
  method: string,
  params: JsonObject,
  wasAbortedByCaller: () => boolean,
  nextId: () => number,
): Promise<unknown> {
  const id = nextId();
  const requestMessage: JsonObject = { method, id, params };
  await boundedCall(() => transport.sendLine(JSON.stringify(requestMessage)), controller, deadline, wasAbortedByCaller);

  while (true) {
    const line = await boundedCall(
      () => transport.readLine(controller.signal),
      controller,
      deadline,
      wasAbortedByCaller,
    );
    if (line === null || line === undefined) {
      throw new CodexThreadContinuityError("transport", "Codex app-server stream closed unexpectedly.");
    }
    const message = parseJsonObject(line);
    if (!("id" in message)) {
      if (
        typeof message.method !== "string" ||
        message.method.length === 0 ||
        !("params" in message || Object.keys(message).length === 1)
      ) {
        throw protocolError();
      }
      continue;
    }
    if (!Number.isSafeInteger(message.id) || message.id !== id) {
      throw protocolError();
    }
    const hasResult = Object.hasOwn(message, "result");
    const hasError = Object.hasOwn(message, "error");
    if (hasResult === hasError) {
      throw protocolError();
    }
    if (hasError) {
      throw new CodexThreadContinuityError("server", "Codex app-server rejected a continuity proof request.");
    }
    return message.result;
  }
}

async function sendNotification(
  transport: CodexThreadContinuityTransport,
  controller: AbortController,
  deadline: number,
  method: string,
  wasAbortedByCaller: () => boolean,
): Promise<void> {
  await boundedCall(() => transport.sendLine(JSON.stringify({ method })), controller, deadline, wasAbortedByCaller);
}

function parseThreadListPage(value: unknown): ThreadListPage {
  const result = asRecord(value);
  if (!Array.isArray(result.data) || !("nextCursor" in result)) {
    throw protocolError();
  }
  if (result.nextCursor !== null && !isSafeText(result.nextCursor, 512)) {
    throw protocolError();
  }
  const data: ThreadSummary[] = [];
  for (const item of result.data) {
    const thread = asRecord(item);
    if (!isSafeText(thread.id, 512) || !isSafeText(thread.modelProvider, 128)) {
      throw protocolError();
    }
    data.push({ id: thread.id, modelProvider: thread.modelProvider });
  }
  return { data, nextCursor: result.nextCursor as string | null };
}

function parseResumeProof(value: unknown, expectedThreadId: string): CodexThreadContinuityResumeProof {
  const result = asRecord(value);
  const thread = asRecord(result.thread);
  if (!isSafeText(thread.id, 512) || thread.id !== expectedThreadId || thread.modelProvider !== "kiln") {
    throw protocolError();
  }
  return {
    threadId: expectedThreadId,
    modelProvider: "kiln",
    exactThreadId: true,
  };
}

function parseRuntimePermissionAttestation(value: unknown): CodexRuntimePermissionAttestationProof {
  const result = asRecord(value);
  const thread = asRecord(result.thread);
  if (!isSafeText(thread.id, 512)) throw protocolError();
  if (result.approvalPolicy !== "never" && result.approvalPolicy !== "on-request" && result.approvalPolicy !== "untrusted") {
    throw protocolError();
  }
  const sandbox = asRecord(result.sandbox);
  if (sandbox.type === "dangerFullAccess") {
    return {
      protocol: "codex-app-server-v2",
      threadId: thread.id,
      approvalMode: result.approvalPolicy,
      sandboxMode: "danger-full-access",
      networkAccess: "enabled",
    };
  }
  if (sandbox.type === "readOnly" && (sandbox.networkAccess === undefined || typeof sandbox.networkAccess === "boolean")) {
    return {
      protocol: "codex-app-server-v2",
      threadId: thread.id,
      approvalMode: result.approvalPolicy,
      sandboxMode: "read-only",
      networkAccess: sandbox.networkAccess === true ? "enabled" : "restricted",
    };
  }
  if (sandbox.type === "workspaceWrite" && (sandbox.networkAccess === undefined || typeof sandbox.networkAccess === "boolean")) {
    return {
      protocol: "codex-app-server-v2",
      threadId: thread.id,
      approvalMode: result.approvalPolicy,
      sandboxMode: "workspace-write",
      networkAccess: sandbox.networkAccess === true ? "enabled" : "restricted",
    };
  }
  throw protocolError();
}

async function boundedCall<T>(
  operation: () => T | Promise<T>,
  controller: AbortController,
  deadline: number,
  wasAbortedByCaller: () => boolean,
): Promise<T> {
  if (controller.signal.aborted) {
    throw wasAbortedByCaller()
      ? new CodexThreadContinuityError("aborted", "Codex thread continuity proof was aborted.")
      : new CodexThreadContinuityError("timeout", "Codex thread continuity proof timed out.");
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    controller.abort();
    throw new CodexThreadContinuityError("timeout", "Codex thread continuity proof timed out.");
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      reject(new CodexThreadContinuityError("timeout", "Codex thread continuity proof timed out."));
    }, remaining);
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        wasAbortedByCaller()
          ? new CodexThreadContinuityError("aborted", "Codex thread continuity proof was aborted.")
          : new CodexThreadContinuityError("timeout", "Codex thread continuity proof timed out."),
      );
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(operation)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        reject(new CodexThreadContinuityError("transport", "Codex app-server transport failed."));
      });
  });
}

function parseJsonObject(line: string): JsonObject {
  if (line.trim().length === 0) {
    throw protocolError();
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw protocolError();
  }
  return asRecord(value);
}

function asRecord(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError();
  }
  return value as JsonObject;
}

function isSafeText(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
}

function validateResumeThreadId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isSafeText(value, 512) || value.trim() !== value) {
    throw new CodexThreadContinuityError("invalid_input", "Codex resume thread id is invalid.");
  }
  return value;
}

function boundedInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CodexThreadContinuityError("invalid_input", `Codex ${label} is outside the supported bound.`);
  }
  return value;
}

function protocolError(): CodexThreadContinuityError {
  return new CodexThreadContinuityError("protocol", "Codex app-server returned an invalid continuity response.");
}

async function cleanupTransport(transport: CodexThreadContinuityTransport): Promise<void> {
  for (const cleanup of [transport.abort, transport.kill, transport.close]) {
    if (!cleanup) continue;
    try {
      await Promise.race([
        Promise.resolve().then(cleanup),
        new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
      ]);
    } catch {
      // Cleanup is best effort; the proof result/error is already determined.
    }
  }
}
