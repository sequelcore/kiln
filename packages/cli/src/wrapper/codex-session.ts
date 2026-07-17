import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import {
  CODEX_DEFAULT_MODEL,
  appendExecutionIdentity,
  resolveExecutionIdentity,
  type ExecutionSessionEvent,
  type ReasoningEffort,
} from "@kilnai/core";
import type {
  SessionCapabilities,
  SessionRunOptions,
  IKilnSession,
  KilnPermissionPolicy,
} from "./session.js";
import { normalizeMcpSelector } from "./mcp-selector.js";
import { SessionStore } from "./session-store.js";
import { deriveSessionMetadata } from "../application/session-metadata.js";
import { resolveNativeCliExecutable } from "./native-cli-executable.js";

interface TranslationRuleMetadata {
  readonly category: string;
  readonly selector: string;
  readonly action: string;
  readonly reason?: string;
}

export interface CodexSessionConfig {
  readonly runtimeSessionId?: string;
  readonly task: string;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly approvalMode?: "never" | "on-request" | "on-failure" | "untrusted";
  readonly sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  readonly ephemeral?: boolean;
  readonly profile?: string;
  readonly skipGitRepoCheck?: boolean;
  readonly outputSchema?: string;
  readonly addDir?: string;
  readonly localProvider?: string;
  readonly nativeRules?: { readonly coarseOnly: true };
  readonly representableRules?: readonly TranslationRuleMetadata[];
  readonly unsupportedRules?: readonly TranslationRuleMetadata[];
  readonly constraintInstructions?: readonly string[];
  readonly translationWarnings?: readonly string[];
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly continuationSessionId?: string;
  readonly sessionLedgerOwner?: "wrapper" | "host";
}

function derivePermissionPolicy(
  approvalMode?: CodexSessionConfig["approvalMode"],
  sandboxMode?: CodexSessionConfig["sandboxMode"],
  fallback?: KilnPermissionPolicy,
): KilnPermissionPolicy {
  return {
    approval: approvalMode ?? fallback?.approval ?? "on-request",
    sandbox: sandboxMode ?? fallback?.sandbox ?? "read-only",
  };
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

function appendPreparedSystemContext(prompt: string, systemPrompt?: string): string {
  const system = systemPrompt?.trim();
  if (!system) {
    return prompt;
  }
  return `${prompt}\n\n--- Kiln Prepared System Context ---\n${system}`;
}

function appendTaskReminder(prompt: string, governedPrompt: string): string {
  const task = extractPreambleTask(governedPrompt);
  if (!task) {
    return prompt;
  }
  return `${prompt}\n\n--- Kiln Task To Execute Now ---\n${task}\n\nExecute the task above in this turn. Do not ask the operator for another task unless required information is genuinely missing.`;
}

function extractPreambleTask(prompt: string): string | undefined {
  const match = prompt.match(/<task>([\s\S]*?)<\/task>/u);
  const task = match?.[1]?.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
  return task && task.length > 0 ? task : undefined;
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
    changes?: Array<{
      path?: string;
      kind?: string;
    }>;
    status?: string;
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
    this.sessionId = config.runtimeSessionId ?? randomUUID();
    this._constraintInstructions = resolveConstraintInstructions(config);
    this._capabilities = {
      mcp: false,
      streaming: true,
      resumable: config.continuationSessionId !== undefined,
      resume: config.continuationSessionId !== undefined,
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

  get providerSessionId(): string | undefined {
    return this._threadId ?? undefined;
  }

  async *run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> {
    if (this._disposed) return;

    const model =
      (options.env as Record<string, string> | undefined)?.CODEX_MODEL ??
      this.config.model ??
      CODEX_DEFAULT_MODEL;

    const cwd = options.cwd ?? this.config.cwd ?? process.cwd();

    let resumeThreadId: string | undefined;
    if (this.config.continuationSessionId !== undefined) {
      try {
        const store = new SessionStore(cwd);
        const providerThread = await store.findProviderThread(this.config.continuationSessionId, "codex");
        if (providerThread) {
          resumeThreadId = providerThread.nativeSessionId;
        }
      } catch {
        console.error("[SessionStore] Resume lookup failed, continuing without resume");
      }
    }

    const args = [
      "exec",
      "--json",
      "-c",
      `approval_policy=${this.config.approvalMode ?? "on-request"}`,
      "--sandbox",
      this.config.sandboxMode ?? "read-only",
    ];
    if (this.config.model) {
      args.push("-m", this.config.model);
    }
    const reasoningEffort = options.reasoningEffort ?? this.config.reasoningEffort;
    if (reasoningEffort) {
      args.push("-c", `model_reasoning_effort=${reasoningEffort}`);
    }
    if (this.config.profile) {
      args.push("--profile", this.config.profile);
    }
    if (this.config.skipGitRepoCheck) {
      args.push("--skip-git-repo-check");
    }
    if (this.config.outputSchema) {
      args.push("--output-schema", this.config.outputSchema);
    }
    if (this.config.addDir) {
      args.push("--add-dir", this.config.addDir);
    }
    if (this.config.localProvider) {
      args.push("--local-provider", this.config.localProvider);
    }
    if (resumeThreadId) {
      args.push("--resume", resumeThreadId);
    }
    if (this.config.ephemeral) {
      args.push("--ephemeral");
    }
    const promptWithExecutionIdentity = appendExecutionIdentity(
      appendPreparedSystemContext(options.prompt, options.system),
      resolveExecutionIdentity({
        configuredProvider: this.config.localProvider ?? "codex",
        configuredModel: model,
        configuredCanonicalModel: model,
        configuredBillingMode: "unknown",
      }),
    );
    const promptWithTaskReminder = appendTaskReminder(promptWithExecutionIdentity, options.prompt);
    const promptWithConstraints = appendConstraintInstructions(
      promptWithTaskReminder,
      this._constraintInstructions,
    );
    args.push("-C", cwd, "-");

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
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });
    this._process = proc;
    proc.stdin?.end(promptWithConstraints);

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
    const stderrChunks: string[] = [];
    let buf = "";
    const onStdoutData = (chunk: Buffer): void => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) stdoutLines.push(line.trim());
      }
    };
    const onStderrData = (chunk: Buffer): void => {
      stderrChunks.push(chunk.toString());
    };

    try {
      proc.stdout?.on("data", onStdoutData);
      proc.stderr?.on("data", onStderrData);

      exitCode = await new Promise<number | null>((resolve) => {
        proc.once("close", (code: number | null) => resolve(code));
        proc.once("error", () => resolve(-1));
      });

      if (buf.trim()) stdoutLines.push(buf.trim());
    } catch {
      // stream error — continue to parse what we have
    } finally {
      proc.stdout?.off("data", onStdoutData);
      proc.stderr?.off("data", onStderrData);
      this._process = null;
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
              if (item.text !== undefined) {
                yield { type: "text_delta", content: item.text, isThinking: true };
              }
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

            case "mcp_tool_call": {
              const mcpToolName = item.tool ?? item.title ?? "mcp_tool";
              yield {
                type: "tool_use",
                toolName: mcpToolName,
                input: item.arguments ?? {},
                source: "mcp",
                mcpSelector: normalizeMcpSelector(mcpToolName),
              };
              break;
            }

            case "error":
              if (isBenignCodexItemError(item.message)) {
                break;
              }
              lastError = item.message ?? "Unknown item error";
              yield {
                type: "error",
                code: codexErrorCodeForMessage(lastError, "CODEX_ITEM_ERROR"),
                message: lastError,
                isRetryable: false,
              };
              break;

            case "file_change":
              for (const fileChange of normalizeCodexFileChanges(item, cwd)) {
                yield fileChange;
              }
              if (item.status === "failed") {
                yield {
                  type: "write_decision",
                  status: "denied",
                  providerRequestId: item.id,
                  actor: "codex-policy",
                  reason: "Codex file change was not applied",
                };
              }
              yield {
                type: "tool_result",
                toolName: "file_change",
                output: summarizeCodexFileChange(item),
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
          const computedUsd = 0;

          yield {
            type: "cost_update",
            usd: computedUsd,
            mode: "computed" as const,
            provider: this.config.localProvider ?? "codex",
            model,
            canonicalModel: model,
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
          if (this.config.sessionLedgerOwner !== "host") try {
            const store = new SessionStore(cwd);
            const completedAt = new Date().toISOString();
            const metadata = deriveSessionMetadata({ task: this.config.task, provider: "codex", model });
            await store.append({
              sessionId: this._threadId ?? this.sessionId,
              provider: "codex",
              task: this.config.task,
              title: metadata.title,
              summary: metadata.summary,
              tags: metadata.tags,
              completedAt,
              cost: computedUsd,
              projectPath: cwd,
              providerThread: this._threadId
                ? { provider: "codex", nativeSessionId: this._threadId }
                : undefined,
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
          lastError = line.message ?? line.error?.message ?? "Unknown error";
          yield {
            type: "error",
            code: codexErrorCodeForMessage(lastError, "CODEX_TURN_ERROR"),
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
            code: codexErrorCodeForMessage(lastError, "CODEX_TURN_FAILED"),
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
            if (this.config.sessionLedgerOwner !== "host") try {
              const store = new SessionStore(cwd);
              const completedAt = new Date().toISOString();
              const metadata = deriveSessionMetadata({ task: this.config.task, provider: "codex", model, hasError: true });
              await store.append({
                sessionId: this._threadId ?? this.sessionId,
                provider: "codex",
                task: this.config.task,
                title: metadata.title,
                summary: metadata.summary,
                tags: metadata.tags,
                completedAt,
                cost: 0,
                projectPath: cwd,
                providerThread: this._threadId
                  ? { provider: "codex", nativeSessionId: this._threadId }
                  : undefined,
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
      const stderrText = stderrChunks.join("").trim();
      const msg = lastError ?? (stderrText.length > 0 ? stderrText : `codex exited with code ${exitCode}`);
      yield {
        type: "error",
        code: codexErrorCodeForMessage(msg, "CODEX_EXIT_ERROR"),
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
        if (this.config.sessionLedgerOwner !== "host") try {
          const store = new SessionStore(cwd);
          const completedAt = new Date().toISOString();
          const metadata = deriveSessionMetadata({ task: this.config.task, provider: "codex", model, hasError: true });
          await store.append({
            sessionId: this._threadId ?? this.sessionId,
            provider: "codex",
            task: this.config.task,
            title: metadata.title,
            summary: metadata.summary,
            tags: metadata.tags,
            completedAt,
            cost: 0,
            projectPath: cwd,
            providerThread: this._threadId
              ? { provider: "codex", nativeSessionId: this._threadId }
              : undefined,
          });
        } catch (err) {
          console.error("[SessionStore] Failed to append session record:", err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  private _findCodexBinary(): string {
    const homedir = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return resolveNativeCliExecutable({
      command: "codex",
      fallbackPaths: [`${homedir}\\.codex\\.sandbox-bin\\codex.exe`],
    });
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

function normalizeCodexFileChanges(
  item: NonNullable<CodexJsonlLine["item"]>,
  cwd: string,
): Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>[] {
  if (Array.isArray(item.changes)) {
    if (item.status === "failed") return [];
    return item.changes.flatMap((change) => {
      if (typeof change.path !== "string" || change.path.trim().length === 0) return [];
      return [{
        type: "file_changed",
        path: normalizeCodexPath(cwd, change.path),
        changeType: mapCodexChangeKind(change.kind),
        diffTruncated: true,
      }];
    });
  }

  if (typeof item.path !== "string" || item.path.trim().length === 0) return [];
  return [{
    type: "file_changed",
    path: normalizeCodexPath(cwd, item.path),
    changeType: mapCodexChangeKind(item.change_type),
    diffTruncated: true,
  }];
}

function normalizeCodexPath(cwd: string, path: string): string {
  const trimmed = path.trim();
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

function mapCodexChangeKind(kind: string | undefined): "created" | "modified" | "deleted" {
  if (kind === "add" || kind === "created") return "created";
  if (kind === "delete" || kind === "deleted") return "deleted";
  return "modified";
}

function summarizeCodexFileChange(item: NonNullable<CodexJsonlLine["item"]>): string {
  if (Array.isArray(item.changes)) {
    const changes = item.changes
      .map((change) => `${change.kind ?? "update"} ${change.path ?? "unknown"}`)
      .join(", ");
    return `File changes ${item.status ?? "completed"}: ${changes}`;
  }
  return `File ${item.path ?? "unknown"}: ${item.change_type ?? "modified"}`;
}

function isBenignCodexItemError(message: string | undefined): boolean {
  return message?.startsWith("Skill descriptions were shortened to fit the 2% skills context budget.") ?? false;
}

function codexErrorCodeForMessage(message: string | undefined, fallback: string): string {
  return isCodexModelVersionUnsupportedMessage(message)
    ? "CODEX_MODEL_VERSION_UNSUPPORTED"
    : fallback;
}

function isCodexModelVersionUnsupportedMessage(message: string | undefined): boolean {
  return /model requires a newer version of Codex/i.test(message ?? "");
}
