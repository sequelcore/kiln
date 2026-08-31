export type CommandOutputStream = "stdout" | "stderr";

export interface CommandOutputChunk {
  readonly stream: CommandOutputStream;
  readonly text: string;
}

export interface CommandProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /**
   * Optional explicit environment. When omitted, a host adapter may preserve
   * the legacy inherited-environment behavior; portable callers must provide
   * an allowlist (including an empty object when no variables are admitted).
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Process execution is argv-only. The only admitted value is false. */
  readonly shell?: false;
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
