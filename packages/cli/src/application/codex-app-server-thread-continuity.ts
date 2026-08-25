import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  type CodexRuntimePermissionAttestationProof,
  type CodexThreadContinuityProof,
  type CodexThreadContinuityTransport,
  runCodexRuntimePermissionAttestationProof,
  runCodexThreadContinuityProof,
} from "./codex-thread-continuity.js";

const APP_SERVER_PROOF_TIMEOUT_MS = 30_000;
const APP_SERVER_EXIT_TIMEOUT_MS = 2_000;

interface LineWaiter {
  readonly resolve: (line: string | null) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export interface CodexAppServerThreadContinuityInput {
  readonly executable: string;
  readonly timeoutMs?: number;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly resumeThreadId?: string;
  readonly spawnProcess?: (executable: string) => ChildProcessWithoutNullStreams;
  readonly exitTimeoutMs?: number;
}

export interface CodexAppServerRuntimePermissionAttestationInput {
  readonly executable: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly spawnProcess?: (executable: string) => ChildProcessWithoutNullStreams;
  readonly exitTimeoutMs?: number;
}

export interface CodexAppServerRuntimePermissionAttestation {
  readonly processId: number;
  readonly proof: CodexRuntimePermissionAttestationProof;
}

export async function runCodexAppServerRuntimePermissionAttestation(
  input: CodexAppServerRuntimePermissionAttestationInput,
): Promise<CodexAppServerRuntimePermissionAttestation> {
  assertExecutable(input.executable);
  const child = (input.spawnProcess ?? spawnCodexAppServer)(input.executable);
  if (child.pid === undefined || !Number.isSafeInteger(child.pid) || child.pid <= 0) {
    if ((child.exitCode ?? null) === null && (child.signalCode ?? null) === null) child.kill("SIGKILL");
    throw new Error("Codex app-server process identity is unavailable.");
  }
  const exited = observeExit(child);
  const transport = createProcessTransport(child);
  let proof: CodexRuntimePermissionAttestationProof | undefined;
  let proofFailure: unknown;
  try {
    proof = await runCodexRuntimePermissionAttestationProof({
      transport,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? APP_SERVER_PROOF_TIMEOUT_MS,
    });
  } catch (error) {
    proofFailure = error;
  }
  await terminateAndConfirm(child, exited, input.exitTimeoutMs);
  if (proofFailure !== undefined) throw proofFailure;
  if (proof === undefined) throw new Error("Codex runtime permission attestation produced no result.");
  return { processId: child.pid, proof };
}

export async function runCodexAppServerThreadContinuity(
  input: CodexAppServerThreadContinuityInput,
): Promise<CodexThreadContinuityProof> {
  assertExecutable(input.executable);
  const child = (input.spawnProcess ?? spawnCodexAppServer)(input.executable);
  const exited = observeExit(child);
  const transport = createProcessTransport(child);
  let proof: CodexThreadContinuityProof | undefined;
  let proofFailure: unknown;
  try {
    proof = await runCodexThreadContinuityProof({
      transport,
      timeoutMs: input.timeoutMs ?? APP_SERVER_PROOF_TIMEOUT_MS,
      ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
      ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
      ...(input.resumeThreadId === undefined ? {} : { resumeThreadId: input.resumeThreadId }),
    });
  } catch (error) {
    proofFailure = error;
  }
  await terminateAndConfirm(child, exited, input.exitTimeoutMs);
  if (proofFailure !== undefined) throw proofFailure;
  if (proof === undefined) throw new Error("Codex thread continuity proof produced no result.");
  return proof;
}

function assertExecutable(executable: string): void {
  if (!executable.trim() || /[\0\r\n]/u.test(executable)) {
    throw new Error("Codex app-server executable is invalid.");
  }
}

function observeExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => {
      if (child.pid === undefined) resolve();
    });
  });
}

async function terminateAndConfirm(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<void>,
  exitTimeoutMs = APP_SERVER_EXIT_TIMEOUT_MS,
): Promise<void> {
  if ((child.exitCode ?? null) === null && (child.signalCode ?? null) === null) child.kill("SIGKILL");
  const exitConfirmed = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), exitTimeoutMs)),
  ]);
  if (!exitConfirmed) throw new Error("Codex app-server process did not terminate after the proof.");
}

function spawnCodexAppServer(executable: string): ChildProcessWithoutNullStreams {
  return spawn(executable, ["app-server"], {
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function createProcessTransport(child: ChildProcessWithoutNullStreams): CodexThreadContinuityTransport {
  const lines: string[] = [];
  const waiters: LineWaiter[] = [];
  let closed = false;
  let buffer = "";

  const settleClosed = (): void => {
    if (closed) return;
    closed = true;
    for (const waiter of waiters.splice(0)) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(null);
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const complete = buffer.split("\n");
    buffer = complete.pop() ?? "";
    for (const rawLine of complete) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const waiter = waiters.shift();
      if (!waiter) {
        lines.push(line);
        continue;
      }
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(line);
    }
  });
  child.stdout.once("end", settleClosed);
  child.once("close", settleClosed);
  child.once("error", () => {
    if (closed) return;
    closed = true;
    for (const waiter of waiters.splice(0)) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(new Error("Codex app-server process failed."));
    }
  });

  return {
    sendLine: (line) =>
      new Promise<void>((resolve, reject) => {
        if (closed || !child.stdin.writable) {
          reject(new Error("Codex app-server stdin is unavailable."));
          return;
        }
        child.stdin.write(`${line}\n`, (error) =>
          error ? reject(new Error("Codex app-server write failed.")) : resolve(),
        );
      }),
    readLine: (signal) => {
      const line = lines.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (closed) return Promise.resolve(null);
      return new Promise<string | null>((resolve, reject) => {
        const waiter: LineWaiter = {
          resolve,
          reject,
          signal,
          onAbort: () => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error("Codex app-server read aborted."));
          },
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
        waiters.push(waiter);
      });
    },
    abort: () => {
      if ((child.exitCode ?? null) === null && (child.signalCode ?? null) === null) child.kill();
    },
    kill: () => {
      if ((child.exitCode ?? null) === null && (child.signalCode ?? null) === null) child.kill("SIGKILL");
    },
    close: () => {
      if (child.stdin.writable) child.stdin.end();
    },
  };
}
