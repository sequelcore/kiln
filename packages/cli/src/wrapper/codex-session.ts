import { randomUUID } from "node:crypto";
import { spawn, execSync } from "node:child_process";
import { MODEL_CATALOG, CODEX_DEFAULT_MODEL } from "@kilnai/core";
import type {
  SessionEvent,
  SessionCapabilities,
  SessionRunOptions,
  IKilnSession,
  KilnPermissionPolicy,
} from "./session.js";

export interface CodexSessionConfig {
  readonly task: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly approvalMode?: "never" | "on-request" | "untrusted";
  readonly sandboxMode?: "workspace-write" | "danger-full-access";
  readonly permissionPolicy?: KilnPermissionPolicy;
}

function derivePermissionPolicy(
  approvalMode?: string,
  sandboxMode?: string,
  fallback?: KilnPermissionPolicy,
): KilnPermissionPolicy {
  if (approvalMode === "never") {
    return { approval: "auto-approve", sandbox: sandboxMode === "danger-full-access" ? "full" : "workspace-write" };
  }
  if (approvalMode === "on-request") {
    return { approval: "ask", sandbox: sandboxMode === "workspace-write" || sandboxMode === "danger-full-access" ? "workspace-write" : "none" };
  }
  if (approvalMode === "untrusted") {
    return { approval: "deny", sandbox: "none" };
  }
  return fallback ?? { approval: "ask", sandbox: "none" };
}

interface MutableCapabilities {
  supportedTools: readonly string[];
}

interface CodexJsonlLine {
  type: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    exit_code?: number | null;
    aggregated_output?: string;
    tool?: string;
    title?: string;
    arguments?: Record<string, unknown>;
    message?: string;
    query?: string;
    todos?: unknown[];
    path?: string;
    change_type?: string;
  };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  message?: string;
  error?: { message?: string; type?: string };
}

export class CodexSession implements IKilnSession {
  readonly sessionId: string;

  private readonly _capabilities: MutableCapabilities & Omit<SessionCapabilities, "supportedTools">;
  private _process: import("node:child_process").ChildProcess | null = null;
  private _abortListener: (() => void) | null = null;
  private _disposed = false;

  constructor(private readonly config: CodexSessionConfig) {
    this.sessionId = randomUUID();
    this._capabilities = {
      mcp: false,
      streaming: true,
      resume: false,
      costTrackingMode: "computed",
      supportedTools: [],
      maxContextTokens: null,
      priority: 3,
      fallbackTo: null,
      permissionPolicy: derivePermissionPolicy(config.approvalMode, config.sandboxMode, config.permissionPolicy),
    };
  }

  get capabilities(): SessionCapabilities {
    return this._capabilities;
  }

  async *run(options: SessionRunOptions): AsyncIterable<SessionEvent> {
    if (this._disposed) return;

    const model =
      (options.env as Record<string, string> | undefined)?.CODEX_MODEL ??
      this.config.model ??
      CODEX_DEFAULT_MODEL;

    const catalogEntry = MODEL_CATALOG.find((e) => e.model === model);
    if (!catalogEntry) {
      yield {
        type: "error",
        code: "UNKNOWN_MODEL",
        message: `No pricing data for model: ${model}`,
        isRetryable: false,
      };
      return;
    }

    const cwd = options.cwd ?? this.config.cwd ?? process.cwd();
    const args = [
      "exec",
      "--json",
      "--full-auto",
      "--ask-for-approval",
      this.config.approvalMode ?? "on-request",
      "--cd",
      cwd,
      options.prompt,
    ];

    if (options.abortSignal?.aborted) {
      yield {
        type: "error",
        code: "ABORTED",
        message: "Aborted before start",
        isRetryable: false,
      };
      return;
    }

    const codexBin = this._findCodexBinary();
    const env = { ...process.env, ...this.config.env, ...options.env };
    delete (env as Record<string, unknown>).CODEX_MODEL;

    const proc: import("node:child_process").ChildProcess = spawn(codexBin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this._process = proc;

    if (options.abortSignal) {
      this._abortListener = () => {
        const proc = this._process;
        this._process = null;
        if (proc && !proc.killed) {
          proc.kill("SIGTERM");
        }
      };
      options.abortSignal.addEventListener("abort", this._abortListener, { once: true });
    }

    let initReceived = false;
    let turnCompleted = false;
    let lastError: string | null = null;
    const startTime = Date.now();
    let exitCode: number | null = null;

    const stdoutLines: string[] = [];
    let buf = "";

    try {
      proc.stdout?.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) stdoutLines.push(line.trim());
        }
      });

      exitCode = await new Promise<number | null>((resolve) => {
        proc.on("exit", (code: number | null) => resolve(code));
        proc.on("error", () => resolve(-1));
      });

      if (buf.trim()) stdoutLines.push(buf.trim());
    } catch {
      // stream error — continue to parse what we have
    } finally {
      if (this._abortListener && options.abortSignal) {
        options.abortSignal.removeEventListener("abort", this._abortListener);
        this._abortListener = null;
      }
    }

    try {
      for (const raw of stdoutLines) {
        if (options.abortSignal?.aborted) {
          this._killProcess();
          return;
        }
        let line: CodexJsonlLine;
        try {
          line = JSON.parse(raw) as CodexJsonlLine;
        } catch {
          continue;
        }

      switch (line.type) {
        case "thread.started":
          break;

        case "turn.started":
          initReceived = true;
          break;

        case "item.started": {
          const item = line.item;
          if (item?.type) {
            yield {
              type: "tool_use",
              toolName: item.type,
              input: item.arguments ?? {},
            };
          }
          break;
        }

        case "item.completed": {
          const item = line.item;
          if (!item?.type) break;

          switch (item.type) {
            case "agent_message":
              if (item.text !== undefined) {
                yield { type: "text_delta", content: item.text };
              }
              break;

            case "reasoning":
              break;

            case "command_execution":
              if (item.command !== undefined) {
                yield {
                  type: "tool_use",
                  toolName: "bash",
                  input: { command: item.command },
                };
              }
              if (item.exit_code !== null && item.exit_code !== undefined) {
                yield {
                  type: "tool_result",
                  toolName: "bash",
                  output: item.aggregated_output ?? "",
                };
              }
              break;

            case "mcp_tool_call":
              yield {
                type: "tool_use",
                toolName: item.tool ?? item.title ?? "mcp_tool",
                input: item.arguments ?? {},
              };
              break;

            case "error":
              lastError = item.message ?? "Unknown item error";
              yield {
                type: "error",
                code: "CODEX_ITEM_ERROR",
                message: lastError,
                isRetryable: false,
              };
              break;

            case "file_change":
              yield {
                type: "tool_result",
                toolName: "file_change",
                output: `File ${item.path ?? "unknown"}: ${item.change_type ?? "modified"}`,
              };
              break;

            case "collab_tool_call":
              yield {
                type: "tool_use",
                toolName: "collab_tool_call",
                input: item.arguments ?? {},
              };
              break;

            case "web_search":
              yield {
                type: "tool_use",
                toolName: "web_search",
                input: { query: item.query ?? item.message ?? "" },
              };
              break;

            case "todo_list":
              yield {
                type: "tool_result",
                toolName: "todo_list",
                output: JSON.stringify(item.todos ?? []),
              };
              break;

            default:
              break;
          }
          break;
        }

        case "turn.completed": {
          turnCompleted = true;
          const usage = line.usage ?? {};
          const uncachedInput = (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0);
          const computedUsd =
            (uncachedInput * catalogEntry.inputPer1M +
              (usage.cached_input_tokens ?? 0) *
                (catalogEntry.cachedInputRatePer1M ?? catalogEntry.inputPer1M * 0.1) +
              (usage.output_tokens ?? 0) * catalogEntry.outputPer1M) /
            1_000_000;

          yield { type: "cost_update", usd: computedUsd, mode: "computed" as const };
          yield {
            type: "completed",
            totalUsd: computedUsd,
            durationMs: Date.now() - startTime,
            isError: lastError !== null,
            isPreflightCrash: !initReceived && computedUsd === 0,
          };
          break;
        }

        case "error": {
          const errorType = line.error?.type;
          const isRetryable =
            errorType === "Stream" || errorType === "Timeout" || errorType === "ConnectionFailed";
          lastError = line.message ?? "Unknown error";
          yield {
            type: "error",
            code: "CODEX_TURN_ERROR",
            message: lastError,
            isRetryable,
          };
          break;
        }

        case "turn.failed": {
          const errorType = line.error?.type;
          const isRetryable =
            errorType === "Stream" || errorType === "Timeout" || errorType === "ConnectionFailed";
          lastError = line.error?.message ?? "Turn failed";
          yield {
            type: "error",
            code: "CODEX_TURN_FAILED",
            message: lastError,
            isRetryable,
          };
          if (!turnCompleted) {
            yield {
              type: "completed",
              totalUsd: 0,
              durationMs: Date.now() - startTime,
              isError: true,
              isPreflightCrash: !initReceived,
            };
          }
          break;
        }
      }
      }
    } catch {
      // unexpected error — rethrow
    }

    if (!turnCompleted && exitCode !== 0 && exitCode !== null) {
      const msg = lastError ?? `codex exited with code ${exitCode}`;
      yield {
        type: "error",
        code: "CODEX_EXIT_ERROR",
        message: msg,
        isRetryable: false,
      };
      if (!turnCompleted) {
        yield {
          type: "completed",
          totalUsd: 0,
          durationMs: Date.now() - startTime,
          isError: true,
          isPreflightCrash: !initReceived,
        };
      }
    }
  }

  private _findCodexBinary(): string {
    const homedir = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const fallbackPaths = [
      `${homedir}\\AppData\\Roaming\\npm\\codex.cmd`,
      `${homedir}\\.codex\\.sandbox-bin\\codex.exe`,
    ];

    const candidates = ["codex", ...fallbackPaths];

    for (const candidate of candidates) {
      try {
        execSync(`"${candidate}" --version`, { stdio: "ignore" });
        return candidate;
      } catch {
        // try next
      }
    }

    throw new Error(
      "codex binary not found. Ensure codex is installed and accessible in PATH, or ensure one of the fallback paths exists.",
    );
  }

  private _killProcess(): void {
    if (this._process && !this._process.killed) {
      this._process.kill("SIGTERM");
    }
  }

  async dispose(): Promise<void> {
    this._disposed = true;
    this._abortListener = null;
    this._killProcess();
  }
}
