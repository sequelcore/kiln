import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const MIN_COLS = 2;
const MAX_COLS = 500;
const MIN_ROWS = 1;
const MAX_ROWS = 200;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_CHUNK_BYTES = 64 * 1024;

export interface OperatorPtySpawnInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface OperatorPtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): () => void;
  onExit(listener: (event: { readonly exitCode: number; readonly signal?: number }) => void): () => void;
}

export interface OperatorPtyAdapter {
  spawn(input: OperatorPtySpawnInput): Promise<OperatorPtyProcess>;
}

export type OperatorTerminalEvent =
  | { readonly type: "output"; readonly terminalId: string; readonly data: string }
  | { readonly type: "exit"; readonly terminalId: string; readonly exitCode: number; readonly signal?: number };

export class OperatorTerminalError extends Error {
  constructor(
    readonly code:
      | "cwd_not_found"
      | "cwd_not_directory"
      | "cwd_outside_workspace"
      | "input_too_large"
      | "invalid_request"
      | "invalid_dimensions"
      | "terminal_not_found"
      | "terminal_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "OperatorTerminalError";
  }
}

interface TerminalSession {
  readonly ownerId: string;
  readonly terminalId: string;
  readonly process: OperatorPtyProcess;
  readonly onEvent: (event: OperatorTerminalEvent) => void;
  unsubscribeData: () => void;
  unsubscribeExit: () => void;
  exited: boolean;
}

export interface OperatorTerminalServiceOptions {
  readonly workspaceRoot: string;
  readonly adapter: OperatorPtyAdapter;
  readonly resolveShell?: () => { readonly executable: string; readonly args: readonly string[] };
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export class OperatorTerminalService {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly workspaceRootPromise: Promise<string>;

  constructor(private readonly options: OperatorTerminalServiceOptions) {
    this.workspaceRootPromise = realpath(resolve(options.workspaceRoot));
  }

  async open(input: {
    readonly ownerId: string;
    readonly cwd?: string;
    readonly cols: number;
    readonly rows: number;
    readonly onEvent: (event: OperatorTerminalEvent) => void;
  }): Promise<{ readonly terminalId: string; readonly cwd: string }> {
    assertDimensions(input.cols, input.rows);
    const cwd = await this.resolveWorkingDirectory(input.cwd);
    const shell = (this.options.resolveShell ?? resolveDefaultShell)();
    const terminalId = crypto.randomUUID();
    const process = await this.options.adapter.spawn({
      executable: shell.executable,
      args: shell.args,
      cwd,
      cols: input.cols,
      rows: input.rows,
      env: definedEnvironment(this.options.environment ?? globalThis.process.env),
    });

    const session: TerminalSession = {
      ownerId: input.ownerId,
      terminalId,
      process,
      onEvent: input.onEvent,
      unsubscribeData: () => undefined,
      unsubscribeExit: () => undefined,
      exited: false,
    };
    session.unsubscribeData = process.onData((data) => {
      for (const chunk of splitUtf8(data, MAX_OUTPUT_CHUNK_BYTES)) {
        input.onEvent({ type: "output", terminalId, data: chunk });
      }
    });
    session.unsubscribeExit = process.onExit((event) => {
      if (session.exited) return;
      session.exited = true;
      this.sessions.delete(terminalId);
      session.unsubscribeData();
      session.unsubscribeExit();
      input.onEvent({
        type: "exit",
        terminalId,
        exitCode: event.exitCode,
        ...(event.signal === undefined ? {} : { signal: event.signal }),
      });
    });
    if (session.exited) session.unsubscribeExit();
    else this.sessions.set(terminalId, session);
    return { terminalId, cwd };
  }

  write(ownerId: string, terminalId: string, data: string): void {
    if (Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) {
      throw new OperatorTerminalError("input_too_large", "Terminal input exceeds 64 KiB.");
    }
    this.ownedSession(ownerId, terminalId).process.write(data);
  }

  resize(ownerId: string, terminalId: string, cols: number, rows: number): void {
    assertDimensions(cols, rows);
    this.ownedSession(ownerId, terminalId).process.resize(cols, rows);
  }

  close(ownerId: string, terminalId: string): void {
    this.ownedSession(ownerId, terminalId).process.kill();
  }

  closeOwner(ownerId: string): void {
    for (const session of this.sessions.values()) {
      if (session.ownerId === ownerId && !session.exited) {
        session.process.kill();
      }
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      if (!session.exited) session.process.kill();
    }
  }

  private ownedSession(ownerId: string, terminalId: string): TerminalSession {
    const session = this.sessions.get(terminalId);
    if (!session || session.ownerId !== ownerId || session.exited) {
      throw new OperatorTerminalError("terminal_not_found", "Terminal session was not found.");
    }
    return session;
  }

  private async resolveWorkingDirectory(requestedCwd: string | undefined): Promise<string> {
    const workspaceRoot = await this.workspaceRootPromise;
    const candidate = resolve(workspaceRoot, requestedCwd?.trim() || ".");
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch {
      throw new OperatorTerminalError("cwd_not_found", "Terminal working directory does not exist.");
    }
    const workspaceRelativePath = relative(workspaceRoot, canonical);
    if (workspaceRelativePath.startsWith("..") || isAbsolute(workspaceRelativePath)) {
      throw new OperatorTerminalError("cwd_outside_workspace", "Terminal working directory must remain inside the workspace.");
    }
    if (!(await stat(canonical)).isDirectory()) {
      throw new OperatorTerminalError("cwd_not_directory", "Terminal working directory must be a directory.");
    }
    return canonical;
  }
}

function assertDimensions(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || cols < MIN_COLS || cols > MAX_COLS
    || !Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    throw new OperatorTerminalError(
      "invalid_dimensions",
      `Terminal dimensions must be ${MIN_COLS}-${MAX_COLS} columns and ${MIN_ROWS}-${MAX_ROWS} rows.`,
    );
  }
}

function resolveDefaultShell(): { readonly executable: string; readonly args: readonly string[] } {
  if (process.platform === "win32") {
    return { executable: process.env.COMSPEC?.trim() || "powershell.exe", args: [] };
  }
  return { executable: process.env.SHELL?.trim() || "/bin/sh", args: ["-l"] };
}

function definedEnvironment(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function splitUtf8(value: string, maxBytes: number): readonly string[] {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return [value];
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (currentBytes + size > maxBytes && current.length > 0) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
