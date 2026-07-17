import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type CommandOutputStream = "stdout" | "stderr";

export interface CommandOutputChunk {
  readonly stream: CommandOutputStream;
  readonly text: string;
}

export interface CommandProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CommandProcessResult {
  readonly exitCode?: number | string;
  readonly signal?: NodeJS.Signals | string;
  readonly error?: Error;
  readonly timedOut?: boolean;
  readonly cancelled?: boolean;
}

export interface CommandProcessSink {
  output(chunk: CommandOutputChunk): void;
  finish(result: CommandProcessResult): void;
}

export interface CommandProcessHandle {
  readonly pid?: number;
  stop(reason: "cancelled" | "timeout" | "stopped"): Promise<void>;
}

export interface CommandProcessRunner {
  start(request: CommandProcessRequest, sink: CommandProcessSink): CommandProcessHandle;
}

export class SpawnCommandProcessRunner implements CommandProcessRunner {
  start(request: CommandProcessRequest, sink: CommandProcessSink): CommandProcessHandle {
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      detached: process.platform !== "win32",
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let settled = false;
    let stopReason: "cancelled" | "timeout" | "stopped" | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: CommandProcessResult): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
      const stdoutTail = stdoutDecoder.end();
      const stderrTail = stderrDecoder.end();
      if (stdoutTail) sink.output({ stream: "stdout", text: stdoutTail });
      if (stderrTail) sink.output({ stream: "stderr", text: stderrTail });
      const terminalResult = {
        ...result,
        ...(stopReason !== undefined && result.signal === undefined ? { signal: "SIGTERM" as const } : {}),
        ...(stopReason === "timeout" ? { timedOut: true } : {}),
        ...(stopReason === "cancelled" ? { cancelled: true } : {}),
      };
      sink.finish(terminalResult);
    };

    const stop = async (reason: "cancelled" | "timeout" | "stopped"): Promise<void> => {
      if (settled) return;
      stopReason = reason;
      await terminateProcessTree(child);
    };
    const abort = (): void => {
      void stop("cancelled");
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      if (text) sink.output({ stream: "stdout", text });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (text) sink.output({ stream: "stderr", text });
    });
    child.once("error", (error) => finish({ error }));
    child.once("close", (code, signal) => finish({
      exitCode: code ?? undefined,
      signal: signal ?? undefined,
    }));

    if (request.timeoutMs !== undefined) {
      timeout = setTimeout(() => void stop("timeout"), request.timeoutMs);
    }
    if (request.signal?.aborted) {
      void stop("cancelled");
    } else {
      request.signal?.addEventListener("abort", abort, { once: true });
    }

    return { pid: child.pid, stop };
  }
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.killed || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid !== undefined) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      killer.once("error", () => {
        child.kill();
        resolve();
      });
      killer.once("close", () => resolve());
    });
    return;
  }
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // The child may have exited between the state check and the signal.
    }
  }
  child.kill("SIGTERM");
}
