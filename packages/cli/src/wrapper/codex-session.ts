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
import { SessionStore } from "./session-store.js";

interface TranslationRuleMetadata {
  readonly category: string;
  readonly selector: string;
  readonly action: string;
  readonly reason?: string;
}

export interface CodexSessionConfig {
  readonly task: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly approvalMode?: "never" | "on-request" | "on-failure" | "untrusted";
  readonly sandboxMode?: "workspace-write" | "danger-full-access";
  readonly nativeRules?: { readonly coarseOnly: true };
  readonly representableRules?: readonly TranslationRuleMetadata[];
  readonly unsupportedRules?: readonly TranslationRuleMetadata[];
  readonly constraintInstructions?: readonly string[];
  readonly translationWarnings?: readonly string[];
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly resumeSessionId?: string;
}

function derivePermissionPolicy(
  approvalMode?: CodexSessionConfig["approvalMode"],
  sandboxMode?: CodexSessionConfig["sandboxMode"],
  fallback?: KilnPermissionPolicy,
): KilnPermissionPolicy {
  if (approvalMode === "never") {
    return { approval: "never", sandbox: sandboxMode === "danger-full-access" ? "danger-full-access" : "workspace-write" };
  }
  if (approvalMode === "on-request") {
    return { approval: "on-request", sandbox: sandboxMode === "danger-full-access" ? "danger-full-access" : sandboxMode ?? "read-only" };
  }
  if (approvalMode === "on-failure") {
    return { approval: "on-failure", sandbox: sandboxMode === "danger-full-access" ? "danger-full-access" : sandboxMode ?? "read-only" };
  }
  if (approvalMode === "untrusted") {
    return { approval: "untrusted", sandbox: "read-only" };
  }
  return fallback ?? { approval: "on-request", sandbox: "read-only" };
}

function buildFallbackConstraintInstructions(
  unsupportedRules?: readonly TranslationRuleMetadata[],
): string[] {
  if (!unsupportedRules || unsupportedRules.length === 0) return [];
  const lines: string[] = ["Kiln policy constraints for codex:"];
  for (const rule of unsupportedRules) {
    lines.push(
      `[${rule.category}] ${rule.action.toUpperCase()} ${rule.selector}${rule.reason ? ` -- ${rule.reason}` : ""}`,
    );
  }
  return lines;
}

function resolveConstraintInstructions(config: CodexSessionConfig): string[] {
  if (config.constraintInstructions && config.constraintInstructions.length > 0) {
    return [...config.constraintInstructions];
  }
  return buildFallbackConstraintInstructions(config.unsupportedRules);
}

function appendConstraintInstructions(
  prompt: string,
  constraintInstructions: readonly string[],
): string {
  if (constraintInstructions.length === 0) return prompt;
  return `${prompt}\n\n${constraintInstructions.join("\n")}`;
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
  private _threadId: string | null = null;
  private readonly _constraintInstructions: readonly string[];

  constructor(private readonly config: CodexSessionConfig) {
    this.sessionId = randomUUID();
    this._constraintInstructions = resolveConstraintInstructions(config);
    this._capabilities = {
      mcp: false,
      streaming: true,
      resumable: config.resumeSessionId !== undefined,
      resume: config.resumeSessionId !== undefined,
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

    let resumeThreadId: string | undefined;
    if (this.config.resumeSessionId !== undefined) {
      try {
        const store = new SessionStore(cwd);
        const record = await store.find(this.config.resumeSessionId);
        if (record?.threadId) {
          resumeThreadId = record.threadId;
        }
      } catch {
        console.error("[SessionStore] Resume lookup failed, continuing without resume");
      }
    }

    const args = [
      "exec",
      "--json",
      "--full-auto",
      "--ask-for-approval",
      this.config.approvalMode ?? "on-request",
    ];
    if (resumeThreadId) {
      args.push("--resume", resumeThreadId);
    }
    const promptWithConstraints = appendConstraintInstructions(
      options.prompt,
      this._constraintInstructions,
    );
    args.push("--cd", cwd, promptWithConstraints);

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
          this._threadId = line.thread_id ?? null;
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

          yield {
            type: "cost_update",
            usd: computedUsd,
            mode: "computed" as const,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cached_input_tokens,
          };
          yield {
            type: "completed",
            totalUsd: computedUsd,
            durationMs: Date.now() - startTime,
            isError: lastError !== null,
            isPreflightCrash: !initReceived && computedUsd === 0,
          };
          try {
            const store = new SessionStore(cwd);
            const completedAt = new Date().toISOString();
            await store.append({
              sessionId: this._threadId ?? this.sessionId,
              provider: "codex",
              task: this.config.task,
              completedAt,
              cost: computedUsd,
              projectPath: cwd,
              threadId: this._threadId ?? undefined,
            });
          } catch (err) {
            console.error("[SessionStore] Failed to append session record:", err instanceof Error ? err.message : String(err));
          }
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
            try {
              const store = new SessionStore(cwd);
              const completedAt = new Date().toISOString();
              await store.append({
                sessionId: this._threadId ?? this.sessionId,
                provider: "codex",
                task: this.config.task,
                completedAt,
                cost: 0,
                projectPath: cwd,
                threadId: this._threadId ?? undefined,
              });
            } catch (err) {
              console.error("[SessionStore] Failed to append session record:", err instanceof Error ? err.message : String(err));
            }
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
        try {
          const store = new SessionStore(cwd);
          const completedAt = new Date().toISOString();
          await store.append({
            sessionId: this._threadId ?? this.sessionId,
            provider: "codex",
            task: this.config.task,
            completedAt,
            cost: 0,
            projectPath: cwd,
            threadId: this._threadId ?? undefined,
          });
        } catch (err) {
          console.error("[SessionStore] Failed to append session record:", err instanceof Error ? err.message : String(err));
        }
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
