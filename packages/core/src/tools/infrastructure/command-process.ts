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
