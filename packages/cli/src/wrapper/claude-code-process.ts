/**
 * ClaudeSession using the official Agent SDK.
 * Implements IKilnSession — async generator returning ExecutionSessionEvent.
 *
 * Replaces the previous callback-based (start/onMessage/onExit) API.
 * See: https://github.com/anthropic-ai/claude-code/issues/771
 */

import { randomUUID } from "node:crypto";
import { appendExecutionIdentity, resolveExecutionIdentity, type ExecutionSessionEvent } from "@kilnai/core";
import type {
  SessionCapabilities,
  SessionRunOptions,
  IKilnSession,
  KilnPermissionPolicy,
} from "./session.js";
import { normalizeMcpSelector } from "./mcp-selector.js";
import { SessionStore } from "./session-store.js";
import { deriveSessionMetadata } from "../application/session-metadata.js";

type Options = import("@anthropic-ai/claude-agent-sdk").Options;
type Query = import("@anthropic-ai/claude-agent-sdk").Query;

interface TranslationRuleMetadata {
  readonly category: string;
  readonly selector: string;
  readonly action: string;
  readonly reason?: string;
}

interface ClaudeNativeRuleMetadata {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly ask: readonly string[];
}

export interface ClaudeSessionConfig {
  readonly runtimeSessionId?: string;
  readonly task: string;
  readonly systemPrompt: string;
  readonly mcpServers?: Options["mcpServers"];
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  readonly allowDangerouslySkipPermissions?: boolean;
  readonly nativeRules?: ClaudeNativeRuleMetadata;
  readonly representableRules?: readonly TranslationRuleMetadata[];
  readonly unsupportedRules?: readonly TranslationRuleMetadata[];
  readonly constraintInstructions?: readonly string[];
  readonly translationWarnings?: readonly string[];
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly continuationSessionId?: string;
  readonly sessionLedgerOwner?: "wrapper" | "host";
  readonly model?: string;
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

function appendConstraintMetadataToSystemPrompt(
  systemPrompt: string,
  nativeRules?: ClaudeNativeRuleMetadata,
  constraintInstructions?: readonly string[],
): string {
  const sections: string[] = [systemPrompt];

  if (nativeRules) {
    const nativeLines: string[] = [];
    if (nativeRules.allow.length > 0) nativeLines.push(`ALLOW: ${nativeRules.allow.join(", ")}`);
    if (nativeRules.ask.length > 0) nativeLines.push(`ASK: ${nativeRules.ask.join(", ")}`);
    if (nativeRules.deny.length > 0) nativeLines.push(`DENY: ${nativeRules.deny.join(", ")}`);
    if (nativeLines.length > 0) {
      sections.push(`Kiln translated native permissions:\n${nativeLines.map((line) => `- ${line}`).join("\n")}`);
    }
  }

  if (constraintInstructions && constraintInstructions.length > 0) {
    sections.push(constraintInstructions.join("\n"));
  }

  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

interface MutableCapabilities {
  supportedTools: readonly string[];
}

export class ClaudeSession implements IKilnSession {
  readonly sessionId: string;

  private readonly _capabilities: MutableCapabilities & Omit<SessionCapabilities, "supportedTools">;
  private abortController: AbortController | null = null;

  constructor(private readonly config: ClaudeSessionConfig) {
    this.sessionId = config.runtimeSessionId ?? randomUUID();
    this._capabilities = {
      mcp: true,
      streaming: true,
      resumable: config.continuationSessionId !== undefined,
      resume: config.continuationSessionId !== undefined,
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

  get providerSessionId(): string | undefined {
    return this.sessionId;
  }

  async *run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> {
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
        append: appendExecutionIdentity(
          appendConstraintMetadataToSystemPrompt(
            this.config.systemPrompt,
            this.config.nativeRules,
            this.config.constraintInstructions,
          ),
          resolveExecutionIdentity({
            configuredProvider: "claude-code",
            configuredModel: this.config.model,
          }),
        ),
      },
      mcpServers: this.config.mcpServers,
      cwd: options.cwd ?? this.config.cwd,
      env,
      includePartialMessages: false,
      permissionMode: this.config.permissionMode ?? "default",
      allowDangerouslySkipPermissions: this.config.allowDangerouslySkipPermissions ?? false,
      settingSources: ["project"],
      model: this.config.model,
      stderr: (data: string) => {
        process.stderr.write(data);
      },
    };

    let continuationSessionId: string | undefined;
    if (this.config.continuationSessionId !== undefined) {
      try {
        const store = new SessionStore(this.config.cwd);
        const providerThread = await store.findProviderThread(this.config.continuationSessionId, "claude");
        if (providerThread) {
          continuationSessionId = providerThread.nativeSessionId;
          const resumeOptions: Options = { ...sdkOptions, sessionId: continuationSessionId };
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
            if (block.type === "thinking") {
              const thinking = (block as unknown as { thinking?: string }).thinking;
              if (thinking !== undefined) {
                yield { type: "text_delta", content: thinking, isThinking: true };
              }
            } else if (block.type === "text" && block.text !== undefined) {
              yield { type: "text_delta", content: block.text };
            } else if ((block.type === "tool_use" || block.type === "mcp_tool_use") && block.name) {
              if (block.type === "mcp_tool_use") {
                yield {
                  type: "tool_use",
                  toolName: block.name,
                  input: block.input,
                  source: "mcp",
                  mcpSelector: normalizeMcpSelector(block.name),
                };
              } else {
                yield { type: "tool_use", toolName: block.name, input: block.input };
              }
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
            outcome: options.abortSignal?.aborted
              ? "cancelled"
              : resultMsg.is_error
                ? "failed"
                : "completed",
            isPreflightCrash: !initReceived && totalCostUsd === 0,
          };
          if (this.config.sessionLedgerOwner !== "host") try {
            const store = new SessionStore(this.config.cwd);
            const completedAt = new Date().toISOString();
            const metadata = deriveSessionMetadata({
              task: this.config.task,
              provider: "claude-code",
              model: this.config.model,
              hasError: resultMsg.is_error ?? false,
            });
            await store.append({
              sessionId: continuationSessionId ?? this.sessionId,
              provider: "claude-code",
              task: this.config.task,
              title: metadata.title,
              summary: metadata.summary,
              tags: metadata.tags,
              completedAt,
              cost: totalCostUsd,
              projectPath: this.config.cwd,
              providerThread: this.providerSessionId
                ? { provider: "claude-code", nativeSessionId: this.providerSessionId }
                : undefined,
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
