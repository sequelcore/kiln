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
import { NativeToolEventIdentity } from "./session.js";
import { resolveTurnPrompt } from "./preamble-builder.js";
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
  /** Managed-child result schema, enforced by the Agent SDK when present. */
  readonly structuredOutputSchema?: Readonly<Record<string, unknown>>;
  /**
   * Operator-resolved Claude Code executable.  Absent, the Agent SDK runs its
   * own bundled build, which can differ from the one whose catalog was
   * discovered.  Managed routes resolve this and fail closed without it.
   */
  readonly harnessExecutable?: string;
  /** Durable, portable identity for the executable bound above. */
  readonly harnessEvidence?: {
    readonly executable: string;
    readonly version: string;
  };
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

const CLAUDE_RESULT_ERROR_CODE = "claude_result_error";

/** Declared SDK failure subtypes, so an operator reads a cause instead of an absent handoff. */
const CLAUDE_RESULT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  error_max_structured_output_retries:
    "Claude Code exhausted its structured-output retries without producing a schema-valid result.",
  error_max_turns: "Claude Code reached its maximum turn limit before completing the request.",
  error_max_budget_usd: "Claude Code reached its configured maximum budget before completing the request.",
  error_during_execution: "Claude Code failed during execution.",
};

function claudeResultErrorMessage(subtype: string | undefined, errors: readonly string[] | undefined): string {
  const reported = (errors ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (reported.length > 0) return reported.join("; ");
  return (subtype ? CLAUDE_RESULT_ERROR_MESSAGES[subtype] : undefined)
    ?? "Claude Code returned an error result without a declared cause.";
}

interface MutableCapabilities {
  supportedTools: readonly string[];
}

export class ClaudeSession implements IKilnSession {
  readonly sessionId: string;

  private readonly _capabilities: MutableCapabilities & Omit<SessionCapabilities, "supportedTools">;
  private abortController: AbortController | null = null;
  private activeQuery: Query | null = null;
  private readonly queryClosures = new WeakMap<Query, Promise<void>>();

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

    const { systemPrompt: baseSystemPrompt, userPrompt } = resolveTurnPrompt(
      options.prompt,
      this.config.task,
      this.config.systemPrompt,
    );

    const sdkOptions: Options = {
      abortController,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: appendExecutionIdentity(
          appendConstraintMetadataToSystemPrompt(
            baseSystemPrompt,
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
      ...(this.config.sessionLedgerOwner === "host" ? { persistSession: false } : {}),
      ...(this.config.structuredOutputSchema ? {
        outputFormat: {
          type: "json_schema" as const,
          schema: this.config.structuredOutputSchema,
        },
      } : {}),
      ...(this.config.harnessExecutable ? { pathToClaudeCodeExecutable: this.config.harnessExecutable } : {}),
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
      prompt: userPrompt,
      options: sdkOptions,
    });
    this.activeQuery = queryInstance;

    let initReceived = false;
    let initializedModel: string | undefined;
    let initializedHarnessVersion: string | undefined;
    let totalCostUsd = 0;
    const startTime = Date.now();
    const toolIdentity = new NativeToolEventIdentity({
      providerId: "claude-code",
      kilnSessionId: options.kilnSessionId ?? this.sessionId,
      turnId: options.turnId ?? "turn:1",
    });

    try {
      for await (const message of queryInstance) {
        if (message.type === "system" && message.subtype === "init") {
          initReceived = true;
          initializedModel = normalizedOptionalText(message.model);
          initializedHarnessVersion = normalizedOptionalText(message.claude_code_version);
          if (Array.isArray(message.tools)) {
            this._capabilities.supportedTools = [...message.tools];
          }
          continue;
        }

        if (message.type === "assistant") {
          const assMsg = message as {
            message?: {
              content?: Array<{
                type: string;
                id?: string;
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
              const identity = toolIdentity.start(block.name, block.id);
              if (!identity.emit) continue;
              if (block.type === "mcp_tool_use") {
                yield {
                  type: "tool_use",
                  toolCallId: identity.toolCallId,
                  toolCallScopeId: identity.toolCallScopeId,
                  toolName: block.name,
                  input: block.input,
                  source: "mcp",
                  mcpSelector: normalizeMcpSelector(block.name),
                };
              } else {
                yield {
                  type: "tool_use",
                  toolCallId: identity.toolCallId,
                  toolCallScopeId: identity.toolCallScopeId,
                  toolName: block.name,
                  input: block.input,
                };
              }
            }
          }
          continue;
        }

        if (message.type === "user") {
          const userMessage = message as {
            message?: {
              content?: string | Array<{
                type: string;
                tool_use_id?: string;
                content?: unknown;
                is_error?: boolean;
              }>;
            };
          };
          const blocks = Array.isArray(userMessage.message?.content) ? userMessage.message.content : [];
          for (const block of blocks) {
            if (block.type !== "tool_result") continue;
            const completion = toolIdentity.complete(
              block.tool_use_id === undefined ? "claude_tool" : undefined,
              block.tool_use_id,
            );
            if (!completion.emit) continue;
            if (completion.startRequired) {
              yield {
                type: "tool_use",
                toolCallId: completion.toolCallId,
                toolCallScopeId: completion.toolCallScopeId,
                toolName: completion.toolName,
                input: {},
              };
            }
            yield {
              type: "tool_result",
              toolCallId: completion.toolCallId,
              toolCallScopeId: completion.toolCallScopeId,
              toolName: completion.toolName,
              output: stringifyClaudeToolResult(block.content),
              ...(block.is_error === true ? { isError: true } : {}),
            };
          }
          continue;
        }

        if (message.type === "result") {
          const resultMsg = message as {
            subtype?: string;
            total_cost_usd?: number;
            is_error?: boolean;
            errors?: readonly string[];
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
            };
            structured_output?: unknown;
            modelUsage?: Readonly<Record<string, unknown>>;
          };
          totalCostUsd = resultMsg.total_cost_usd ?? 0;
          if (this.config.structuredOutputSchema !== undefined && resultMsg.structured_output !== undefined) {
            const providerModelIds = Object.keys(resultMsg.modelUsage ?? {})
              .map((modelId) => modelId.trim())
              .filter((modelId) => modelId.length > 0);
            if (initializedModel !== undefined && !providerModelIds.includes(initializedModel)) {
              providerModelIds.push(initializedModel);
            }
            const observedVersion = initializedHarnessVersion ?? this.config.harnessEvidence?.version;
            yield {
              type: "structured_output",
              value: resultMsg.structured_output,
              ...(initializedModel !== undefined ? { primaryProviderModelId: initializedModel } : {}),
              ...(providerModelIds.length > 0 ? { providerModelIds } : {}),
              ...(this.config.harnessEvidence && observedVersion
                ? {
                    harness: {
                      id: "claude-code",
                      executable: this.config.harnessEvidence.executable,
                      version: observedVersion,
                    },
                  }
                : {}),
            };
          }
          if (
            initializedHarnessVersion !== undefined
            && this.config.harnessEvidence !== undefined
            && initializedHarnessVersion !== this.config.harnessEvidence.version
            && options.abortSignal?.aborted !== true
          ) {
            yield {
              type: "error",
              code: "claude_harness_version_mismatch",
              message: `Claude Code initialized as version ${initializedHarnessVersion}, but route admission resolved ${this.config.harnessEvidence.version}.`,
              isRetryable: false,
            };
          }
          // The SDK carries structured_output only on a success result, and reports why a
          // run ended through its error subtype.  Without this the managed harness sees an
          // absent handoff and cannot distinguish schema-retry exhaustion from silence.
          // A cancelled run keeps its cancellation terminal state and is not reclassified.
          if (resultMsg.is_error === true && options.abortSignal?.aborted !== true) {
            yield {
              type: "error",
              code: resultMsg.subtype ?? CLAUDE_RESULT_ERROR_CODE,
              message: claudeResultErrorMessage(resultMsg.subtype, resultMsg.errors),
              // Every declared subtype is bound exhaustion or an unclassified failure;
              // replaying the identical request reproduces it.  Fail closed.
              isRetryable: false,
            };
          }
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
      await this.closeQuery(queryInstance);
      if (this.activeQuery === queryInstance) {
        this.activeQuery = null;
      }
      this.abortController = null;
    }
  }

  async dispose(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    await this.closeQuery(this.activeQuery);
  }

  private closeQuery(query: Query | null): Promise<void> {
    if (query === null) return Promise.resolve();
    const existing = this.queryClosures.get(query);
    if (existing !== undefined) return existing;
    const closure = Promise.resolve()
      .then(() => query.return(undefined))
      .then(() => undefined);
    this.queryClosures.set(query, closure);
    return closure;
  }
}

function normalizedOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function stringifyClaudeToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}
