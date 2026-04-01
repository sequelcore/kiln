/**
 * ClaudeSession using the official Agent SDK.
 * Implements IKilnSession — async generator returning SessionEvent.
 *
 * Replaces the previous callback-based (start/onMessage/onExit) API.
 * See: https://github.com/anthropic-ai/claude-code/issues/771
 */

import { randomUUID } from "node:crypto";
import type {
  SessionEvent,
  SessionCapabilities,
  SessionRunOptions,
  IKilnSession,
  KilnPermissionPolicy,
} from "./session.js";
import { SessionStore } from "./session-store.js";

type Options = import("@anthropic-ai/claude-agent-sdk").Options;
type Query = import("@anthropic-ai/claude-agent-sdk").Query;

export interface ClaudeSessionConfig {
  readonly task: string;
  readonly systemPrompt: string;
  readonly mcpServers?: Options["mcpServers"];
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  readonly allowDangerouslySkipPermissions?: boolean;
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly resumeSessionId?: string;
}

function derivePermissionPolicy(
  permissionMode?: string,
  allowDangerouslySkip?: boolean,
  fallback?: KilnPermissionPolicy,
): KilnPermissionPolicy {
  if (permissionMode === "bypassPermissions") {
    return { approval: "never", sandbox: allowDangerouslySkip ? "danger-full-access" : "workspace-write" };
  }
  if (permissionMode === "acceptEdits") {
    return { approval: "never", sandbox: "read-only" };
  }
  if (permissionMode === "plan") {
    return { approval: "untrusted", sandbox: "read-only" };
  }
  return fallback ?? { approval: "on-request", sandbox: "read-only" };
}

interface MutableCapabilities {
  supportedTools: readonly string[];
}

export class ClaudeSession implements IKilnSession {
  readonly sessionId: string;

  private readonly _capabilities: MutableCapabilities & Omit<SessionCapabilities, "supportedTools">;
  private abortController: AbortController | null = null;

  constructor(private readonly config: ClaudeSessionConfig) {
    this.sessionId = randomUUID();
    this._capabilities = {
      mcp: true,
      streaming: true,
      resumable: config.resumeSessionId !== undefined,
      resume: config.resumeSessionId !== undefined,
      costTrackingMode: "native",
      supportedTools: [],
      maxContextTokens: null,
      priority: 1,
      fallbackTo: null,
      permissionPolicy: derivePermissionPolicy(
        config.permissionMode,
        config.allowDangerouslySkipPermissions,
        config.permissionPolicy,
      ),
    };
  }

  get capabilities(): SessionCapabilities {
    return this._capabilities;
  }

  async *run(options: SessionRunOptions): AsyncIterable<SessionEvent> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    const abortController = new AbortController();
    this.abortController = abortController;

    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        abortController.abort();
      } else {
        options.abortSignal.addEventListener("abort", () => abortController.abort(), { once: true });
      }
    }

    const env: Record<string, string | undefined> = { ...process.env };
    if (this.config.env) Object.assign(env, this.config.env);
    if (options.env) Object.assign(env, options.env);

    const sdkOptions: Options = {
      abortController,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: this.config.systemPrompt,
      },
      mcpServers: this.config.mcpServers,
      cwd: options.cwd ?? this.config.cwd,
      env,
      includePartialMessages: false,
      permissionMode: this.config.permissionMode ?? "default",
      allowDangerouslySkipPermissions: this.config.allowDangerouslySkipPermissions ?? false,
      settingSources: ["project"],
      stderr: (data: string) => {
        process.stderr.write(data);
      },
    };

    let resumeSessionId: string | undefined;
    if (this.config.resumeSessionId !== undefined) {
      try {
        const store = new SessionStore(this.config.cwd);
        const record = await store.find(this.config.resumeSessionId);
        if (record) {
          resumeSessionId = record.sessionId;
          const resumeOptions: Options = { ...sdkOptions, sessionId: resumeSessionId };
          Object.assign(sdkOptions, resumeOptions);
        }
      } catch {
        console.error("[SessionStore] Resume lookup failed, continuing without resume");
      }
    }

    const queryInstance: Query = query({
      prompt: options.prompt,
      options: sdkOptions,
    });

    let initReceived = false;
    let totalCostUsd = 0;
    const startTime = Date.now();

    try {
      for await (const message of queryInstance) {
        if (message.type === "system" && message.subtype === "init") {
          initReceived = true;
          const initMsg = message as { tools?: Array<{ name: string }> };
          if (initMsg.tools && Array.isArray(initMsg.tools)) {
            this._capabilities.supportedTools = initMsg.tools.map((t) => t.name);
          }
          continue;
        }

        if (message.type === "assistant") {
          const assMsg = message as {
            message?: {
              content?: Array<{
                type: string;
                text?: string;
                name?: string;
                input?: unknown;
              }>;
            };
          };
          const blocks = assMsg.message?.content ?? [];
          for (const block of blocks) {
            if (block.type === "text" && block.text !== undefined) {
              yield { type: "text_delta", content: block.text };
            } else if (block.type === "tool_use" && block.name) {
              yield { type: "tool_use", toolName: block.name, input: block.input };
            }
          }
          continue;
        }

        if (message.type === "result") {
          const resultMsg = message as {
            total_cost_usd?: number;
            is_error?: boolean;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
            };
          };
          totalCostUsd = resultMsg.total_cost_usd ?? 0;
          yield {
            type: "cost_update",
            usd: totalCostUsd,
            mode: "native",
            inputTokens: resultMsg.usage?.input_tokens,
            outputTokens: resultMsg.usage?.output_tokens,
            cacheReadTokens: resultMsg.usage?.cache_read_input_tokens,
          };
          yield {
            type: "completed",
            totalUsd: totalCostUsd,
            durationMs: Date.now() - startTime,
            isError: resultMsg.is_error ?? false,
            isPreflightCrash: !initReceived && totalCostUsd === 0,
          };
          try {
            const store = new SessionStore(this.config.cwd);
            const completedAt = new Date().toISOString();
            await store.append({
              sessionId: resumeSessionId ?? this.sessionId,
              provider: "claude-code",
              task: this.config.task,
              completedAt,
              cost: totalCostUsd,
              projectPath: this.config.cwd,
            });
          } catch (err) {
            console.error("[SessionStore] Failed to append session record:", err instanceof Error ? err.message : String(err));
          }
        }
      }
    } catch (err) {
      yield {
        type: "error",
        code: "SDK_ERROR",
        message: err instanceof Error ? err.message : String(err),
        isRetryable: false,
      };
    } finally {
      this.abortController = null;
    }
  }

  async dispose(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
