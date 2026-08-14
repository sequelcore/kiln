import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { Codex, type ModelReasoningEffort, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";
import {
  CODEX_DEFAULT_MODEL,
  admitCommunicationForExecution,
  admitDeliberationForExecution,
  appendExecutionIdentity,
  observeStandaloneEffectivePrompt,
  renderCommunicationPromptProjection,
  resolveExecutionIdentity,
  type CommunicationResolution,
  type DeliberationResolution,
  type EffectivePromptObservation,
  type ExecutionSessionEvent,
  type ResolvedCommunicationIntent,
} from "@kilnai/core";
import type { IKilnSession, KilnPermissionPolicy, SessionCapabilities, SessionRunOptions } from "./session.js";
import { NativeToolEventIdentity } from "./session.js";
import { normalizeMcpSelector } from "./mcp-selector.js";
import { SessionStore } from "./session-store.js";
import { deriveSessionMetadata } from "../application/session-metadata.js";
import { resolveNativeCommunication } from "../config/native-communication-capabilities.js";
import { deriveCodexRuntimePermissionRequest, type RuntimePermissionObservationWriter } from "./runtime-permission-observation.js";

export interface CodexSdkThread {
  readonly id: string | null;
  runStreamed(input: string, options?: { readonly outputSchema?: unknown; readonly signal?: AbortSignal }): Promise<{ readonly events: AsyncIterable<ThreadEvent> }>;
}

export interface CodexSdkPort {
  startThread(options: ThreadOptions): CodexSdkThread;
  resumeThread(id: string, options: ThreadOptions): CodexSdkThread;
}

export interface CodexSdkSessionConfig {
  readonly runtimeSessionId?: string;
  readonly task: string;
  readonly model?: string;
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationIntent?: ResolvedCommunicationIntent;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly approvalMode?: "never" | "on-request" | "on-failure" | "untrusted";
  readonly sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  readonly skipGitRepoCheck?: boolean;
  readonly outputSchema?: string;
  readonly addDir?: string;
  readonly constraintInstructions?: readonly string[];
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly continuationSessionId?: string;
  readonly sessionLedgerOwner?: "wrapper" | "host";
  readonly runtimePermissionObservationSink?: RuntimePermissionObservationWriter;
  readonly sdkPort?: CodexSdkPort;
}

export function requiresCodexCliProcessTransport(config: Pick<CodexSdkSessionConfig, "outputSchema"> & { readonly ephemeral?: boolean; readonly profile?: string; readonly localProvider?: string }): boolean {
  // SDK 0.147.0 has no equivalent for these CLI switches. Do not silently weaken them.
  return config.ephemeral === true || config.profile !== undefined || config.localProvider !== undefined;
}

export class CodexSdkSession implements IKilnSession {
  readonly sessionId: string;
  private _threadId: string | null = null;
  private _disposed = false;
  private _abortController: AbortController | null = null;
  private readonly injectedPort: CodexSdkPort | undefined;
  private _communicationResolution: CommunicationResolution | undefined;
  private _effectivePromptObservation: EffectivePromptObservation | undefined;
  readonly capabilities: SessionCapabilities;

  constructor(private readonly config: CodexSdkSessionConfig) {
    this.sessionId = config.runtimeSessionId ?? randomUUID();
    this.injectedPort = config.sdkPort;
    this.capabilities = {
      mcp: false, streaming: true, resumable: config.continuationSessionId !== undefined,
      resume: config.continuationSessionId !== undefined, costTrackingMode: "computed",
      supportedTools: [], maxContextTokens: null, priority: 3, fallbackTo: null,
      permissionPolicy: { approval: config.approvalMode ?? config.permissionPolicy?.approval ?? "on-request", sandbox: config.sandboxMode ?? config.permissionPolicy?.sandbox ?? "read-only" },
    };
  }

  get providerSessionId(): string | undefined { return this._threadId ?? undefined; }
  get communicationResolution(): CommunicationResolution | undefined { return this._communicationResolution; }
  get effectivePromptObservation(): EffectivePromptObservation | undefined { return this._effectivePromptObservation; }

  async *run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> {
    if (this._disposed) return;
    if (options.abortSignal?.aborted) { yield aborted(); return; }
    const model = (options.env as Record<string, string> | undefined)?.CODEX_MODEL ?? this.config.model ?? CODEX_DEFAULT_MODEL;
    const cwd = options.cwd ?? this.config.cwd ?? process.cwd();
    const communicationIntent = options.communicationIntent ?? this.config.communicationIntent;
    this._communicationResolution = communicationIntent
      ? resolveNativeCommunication({
          intent: communicationIntent,
          harness: "codex",
          model,
          surface: "cli",
          projection: "invocation",
        })
      : undefined;
    const communication = admitCommunicationForExecution(this._communicationResolution);
    const communicationPromptProjection = renderCommunicationPromptProjection(this._communicationResolution);
    const prompt = withConstraints(
      appendExecutionIdentity(`${options.system ? `${options.prompt}\n\n--- Kiln Prepared System Context ---\n${options.system}` : options.prompt}${communicationPromptProjection ?? ""}`, resolveExecutionIdentity({ configuredProvider: "codex", configuredModel: model, configuredCanonicalModel: model, configuredBillingMode: "unknown" })),
      this.config.constraintInstructions,
    );
    this._effectivePromptObservation = observeStandaloneEffectivePrompt({
      providerId: "codex",
      modelId: model,
      finalPrompt: prompt,
      communicationProjection: communicationPromptProjection,
      communicationResolution: this._communicationResolution,
    });
    const threadOptions: ThreadOptions = {
      model, sandboxMode: this.config.sandboxMode ?? "read-only", workingDirectory: cwd,
      approvalPolicy: this.config.approvalMode ?? "on-request",
      ...(this.config.skipGitRepoCheck ? { skipGitRepoCheck: true } : {}),
      ...(this.config.addDir ? { additionalDirectories: [this.config.addDir] } : {}),
      ...(sdkReasoningEffort(options.deliberationResolution ?? this.config.deliberationResolution) ? { modelReasoningEffort: sdkReasoningEffort(options.deliberationResolution ?? this.config.deliberationResolution) } : {}),
    };
    const resumeId = await this.resumeId(cwd);
    const port = this.injectedPort ?? officialPort(this.config.env, communication);
    // This is the last await before the SDK starts its child process.
    const permissionRequest = this.config.runtimePermissionObservationSink
      ? await this.config.runtimePermissionObservationSink.recordRequested(deriveCodexRuntimePermissionRequest({ sessionId: this.sessionId, approvalMode: threadOptions.approvalPolicy ?? "on-request", sandboxMode: threadOptions.sandboxMode ?? "read-only", requestedAt: new Date(), runtimeVersion: { kind: "sdk", version: "0.147.0" } }))
      : undefined;
    const controller = new AbortController(); this._abortController = controller;
    const relayAbort = () => controller.abort(); options.abortSignal?.addEventListener("abort", relayAbort, { once: true });
    const startedAt = Date.now(); let started = false; let completed = false; let lastError: string | undefined;
    const toolIdentity = new NativeToolEventIdentity({ providerId: "codex", kilnSessionId: options.kilnSessionId ?? this.sessionId, turnId: options.turnId ?? "turn:1" });
    try {
      const thread = resumeId ? port.resumeThread(resumeId, threadOptions) : port.startThread(threadOptions);
      const streamed = await thread.runStreamed(prompt, { signal: controller.signal, ...(this.config.outputSchema ? { outputSchema: await readOutputSchema(this.config.outputSchema, cwd) } : {}) });
      for await (const event of streamed.events) {
        if (event.type === "thread.started") {
          this._threadId = event.thread_id;
          if (permissionRequest) await this.config.runtimePermissionObservationSink!.recordObserved(permissionRequest, { observedAt: new Date(), proof: "inferred", runtimeVersion: { kind: "sdk", version: "0.147.0" } });
        }
        if (event.type === "turn.started") started = true;
        for (const mapped of mapSdkEvent(event, toolIdentity, cwd, model)) {
          if (mapped.type === "error") lastError = mapped.message;
          if (mapped.type === "completed") completed = true;
          yield mapped;
        }
      }
    } catch (error) {
      lastError = boundedError(error);
      yield { type: "error", code: options.abortSignal?.aborted ? "ABORTED" : "CODEX_SDK_ERROR", message: lastError, isRetryable: false };
    } finally { options.abortSignal?.removeEventListener("abort", relayAbort); this._abortController = null; }
    if (!completed) {
      yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, outcome: options.abortSignal?.aborted ? "cancelled" : lastError ? "failed" : "completed", isPreflightCrash: !started };
    }
    // Both provider terminal events and Kiln's synthetic terminal event settle
    // through this single point, preserving the thread for the next turn.
    await this.appendLedger(cwd, model, Boolean(lastError));
  }

  async dispose(): Promise<void> { this._disposed = true; this._abortController?.abort(); }
  private async resumeId(cwd: string): Promise<string | undefined> { if (!this.config.continuationSessionId) return undefined; try { return (await new SessionStore(cwd).findProviderThread(this.config.continuationSessionId, "codex"))?.nativeSessionId; } catch { return undefined; } }
  private async appendLedger(cwd: string, model: string, hasError: boolean): Promise<void> { if (this.config.sessionLedgerOwner === "host") return; try { const metadata = deriveSessionMetadata({ task: this.config.task, provider: "codex", model, hasError }); await new SessionStore(cwd).append({ sessionId: this.sessionId, provider: "codex", task: this.config.task, title: metadata.title, summary: metadata.summary, tags: metadata.tags, completedAt: new Date().toISOString(), cost: 0, projectPath: cwd, ...(this._threadId ? { providerThread: { provider: "codex", nativeSessionId: this._threadId } } : {}) }); } catch { /* ledger failure must not alter an already-settled turn */ } }
}

function officialPort(
  env: Record<string, string> | undefined,
  communication: { readonly responseDetail?: string; readonly interactionProfile?: string },
): CodexSdkPort {
  const merged = { ...process.env, ...env };
  delete merged.CODEX_MODEL;
  return new Codex({
    env: merged as Record<string, string>,
    ...((communication.responseDetail || communication.interactionProfile)
      ? {
          config: {
            ...(communication.responseDetail ? { model_verbosity: communication.responseDetail } : {}),
            ...(communication.interactionProfile ? { personality: communication.interactionProfile } : {}),
          },
        }
      : {}),
  });
}
function sdkReasoningEffort(resolution?: DeliberationResolution): ModelReasoningEffort | undefined { const value = admitDeliberationForExecution(resolution); return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value as ModelReasoningEffort : undefined; }
async function readOutputSchema(path: string, cwd: string): Promise<unknown> { const candidate = isAbsolute(path) ? path : resolve(cwd, path); let parsed: unknown; try { parsed = JSON.parse(await readFile(candidate, "utf8")); } catch { throw new Error(`Codex output schema must be readable JSON: ${candidate}`); } if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Codex output schema must be a JSON object: ${candidate}`); return parsed; }
function withConstraints(prompt: string, constraints?: readonly string[]): string { return constraints && constraints.length > 0 ? `${prompt}\n\n${constraints.join("\n")}` : prompt; }
function aborted(): Extract<ExecutionSessionEvent, { type: "error" }> { return { type: "error", code: "ABORTED", message: "Aborted before start", isRetryable: false }; }
function boundedError(value: unknown): string { const message = value instanceof Error ? value.message : String(value); return message.length > 4096 ? `${message.slice(0, 4093)}...` : message; }

function mapSdkEvent(event: ThreadEvent, identities: NativeToolEventIdentity, cwd: string, model: string): ExecutionSessionEvent[] {
  if (event.type === "turn.completed") return [{ type: "cost_update", usd: 0, mode: "computed", provider: "codex", model, canonicalModel: model, inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens, cacheReadTokens: event.usage.cached_input_tokens }, { type: "completed", totalUsd: 0, durationMs: 0, outcome: "completed", isPreflightCrash: false }];
  if (event.type === "turn.failed") return [{ type: "error", code: "CODEX_TURN_ERROR", message: boundedError(event.error.message), isRetryable: false }];
  if (event.type === "error") return [{ type: "error", code: "CODEX_TURN_ERROR", message: boundedError(event.message), isRetryable: false }];
  if (event.type !== "item.started" && event.type !== "item.completed") return [];
  const item = event.item;
  if (item.type === "agent_message") return event.type === "item.completed" ? [{ type: "text_delta", content: item.text }] : [];
  if (item.type === "reasoning") return event.type === "item.completed" ? [{ type: "text_delta", content: item.text, isThinking: true }] : [];
  if (item.type === "file_change" && event.type === "item.completed") return item.status === "failed" ? [{ type: "write_decision", status: "denied", providerRequestId: item.id, actor: "codex-policy", reason: "Codex file change was not applied" }] : item.changes.map((change) => ({ type: "file_changed" as const, path: isAbsolute(change.path) ? change.path : resolve(cwd, change.path), changeType: change.kind === "add" ? "created" as const : change.kind === "delete" ? "deleted" as const : "modified" as const, diffTruncated: true }));
  const tool = item.type === "command_execution" ? "bash" : item.type === "mcp_tool_call" ? item.tool : item.type === "web_search" ? "web_search" : item.type === "todo_list" ? "todo_list" : undefined;
  // Codex defines error items as non-fatal notices. A failed turn is reported
  // separately through turn.failed or the top-level error event.
  if (!tool) return [];
  const input = item.type === "command_execution" ? { command: item.command } : item.type === "mcp_tool_call" ? item.arguments as Record<string, unknown> : item.type === "web_search" ? { query: item.query } : {};
  if (event.type === "item.started") {
    const identity = identities.start(tool, item.id);
    return identity.emit ? [{ type: "tool_use", toolCallId: identity.toolCallId, toolCallScopeId: identity.toolCallScopeId, toolName: tool, input, ...(item.type === "mcp_tool_call" ? { source: "mcp" as const, mcpSelector: normalizeMcpSelector(tool) } : {}) }] : [];
  }
  const identity = identities.complete(tool, item.id);
  const start = identity.startRequired;
  const events: ExecutionSessionEvent[] = start ? [{ type: "tool_use", toolCallId: identity.toolCallId, toolCallScopeId: identity.toolCallScopeId, toolName: tool, input, ...(item.type === "mcp_tool_call" ? { source: "mcp" as const, mcpSelector: normalizeMcpSelector(tool) } : {}) }] : [];
  if (identity.emit) events.push({ type: "tool_result", toolCallId: identity.toolCallId, toolCallScopeId: identity.toolCallScopeId, toolName: tool, output: item.type === "command_execution" ? item.aggregated_output : item.type === "mcp_tool_call" ? JSON.stringify(item.result ?? item.error ?? "") : "" });
  return events;
}
