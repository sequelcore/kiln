/**
 * @fileoverview TUI Gateway session implementation.
 * @module @kilnai/tui
 */

import { randomUUID } from "node:crypto";
import {
  formatVoiceAudioOutputForTerminal,
  formatPresentationIntentAsText,
  operatorEventTargetsSurface,
  projectOperatorSessionEvents,
  projectVoiceAudioOutputParts,
  type ModelCatalog,
  type ExecutionTargetSelectionIntent,
  type GuiProviderDiscoveryResult,
  type GuiProviderCatalogStatus,
  type GuiProviderModelDiscoveryProjection,
  type OperatorTurnRequestedAuthority,
  type OperatorSessionEvent,
} from "@kilnai/gateway-contracts";
import type { SessionLike } from "./types.js";
import type { SessionEventInternal } from "./types.js";
import { applyTuiOperatorThemeRequest } from "./operator-theme-handler.js";
import { formatVerificationPresentationAsText } from "./verification-presentation.js";
import { TuiWsClient } from "./ws-client.js";
import type { TuiInboundFrame } from "./ws-client.js";

const CONNECT_TIMEOUT_MS = 10_000;
const SEND_CONNECTED_TIMEOUT_MS = 5_000;
const CLEAR_TIMEOUT_MS = 5_000;
const MODEL_CATALOG_REFRESH_TIMEOUT_MS = 5_000;
const PROVIDER_AUTH_TIMEOUT_MS = 15 * 60 * 1000;

const STOP = Symbol("STOP");
let executionTargetRequestOrdinal = 0;
let modelCatalogRefreshRequestOrdinal = 0;
let providerAuthRequestOrdinal = 0;

type QueueItem = SessionEventInternal | typeof STOP;

function nextExecutionTargetRequestId(): string {
  executionTargetRequestOrdinal += 1;
  return `execution-target:${Date.now()}:${executionTargetRequestOrdinal}`;
}

function nextModelCatalogRefreshRequestId(): string {
  modelCatalogRefreshRequestOrdinal += 1;
  return `model-catalog-refresh:${Date.now()}:${modelCatalogRefreshRequestOrdinal}`;
}

function nextProviderAuthRequestId(): string {
  providerAuthRequestOrdinal += 1;
  return `provider-auth:${Date.now()}:${providerAuthRequestOrdinal}`;
}

function providerAuthDebug(message: string, context?: Record<string, unknown>): void {
  if (!/^(1|true|yes)$/i.test(process.env.KILN_PROVIDER_AUTH_DEBUG?.trim() ?? "")) {
    return;
  }
  console.warn(`[tui-gateway-session:provider-auth][debug] ${message}`, context ?? {});
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeChangeType(value: unknown): "created" | "modified" | "deleted" | undefined {
  if (value === "created" || value === "deleted") return value;
  if (value === "modified" || value === "updated" || value === "renamed") return "modified";
  return undefined;
}

function workItemActivityInput(payload: Record<string, unknown>): unknown {
  const workItem = asRecord(payload.workItem);
  if (!workItem) {
    return payload.workItem;
  }
  const attempt = asRecord(payload.attempt);
  return {
    ...workItem,
    ...(readString(attempt?.status) ? { latestAttemptStatus: readString(attempt?.status) } : {}),
    ...(readString(attempt?.executionMode) ? { latestAttemptMode: readString(attempt?.executionMode) } : {}),
    ...(readString(attempt?.managedInvocationId) ? { latestManagedInvocationId: readString(attempt?.managedInvocationId) } : {}),
  };
}

function mapCanonicalSessionEvent(event: OperatorSessionEvent): SessionEventInternal | null {
  const payload = asRecord(event.payload) ?? {};
  const presentation = projectOperatorSessionEvents([event]).presentedEvents[0]?.presentation;
  if (!presentation) return null;
  if (!operatorEventTargetsSurface(presentation, "activity_panel")) {
    return null;
  }
  const scoped = {
    sessionId: event.kilnSessionId,
    ...(event.turnId ? { turnId: event.turnId } : {}),
  };

  if (event.kind === "assistant_delta") {
    const content = readString(payload.delta) ?? readString(payload.content);
    return content ? { type: "text_delta", content, ...scoped } : null;
  }
  if (event.kind === "tool_call_started") {
    const toolName = readString(payload.toolName) ?? "tool";
    return {
      type: "activity",
      activity: "tool_use",
      toolName,
      toolCallId: readString(payload.toolCallId) ?? undefined,
      input: payload.input,
      surfaces: presentation.surfaces,
      ...scoped,
    };
  }
  if (event.kind === "tool_call_output_delta") {
    const toolCallId = readString(payload.toolCallId);
    const output = readString(payload.delta);
    if (!toolCallId || output === null) return null;
    return {
      type: "activity",
      activity: "tool_output",
      toolCallId,
      toolName: readString(payload.toolName) ?? "tool",
      stream: payload.stream === "stderr" ? "stderr" : "stdout",
      output,
      chunkIndex: readNumber(payload.chunkIndex),
      surfaces: presentation.surfaces,
      ...scoped,
    };
  }
  if (event.kind === "tool_call_completed") {
    const toolName = readString(payload.toolName) ?? "tool";
    const metadata = asRecord(payload.metadata) ?? undefined;
    return {
      type: "activity",
      activity: "tool_result",
      toolName,
      toolCallId: readString(payload.toolCallId) ?? undefined,
      output: presentation.toolPresentation?.verification
        ? formatVerificationPresentationAsText(presentation.toolPresentation.verification)
        : presentation.toolPresentation?.presentationIntent
          ? formatPresentationIntentAsText(presentation.toolPresentation.presentationIntent)
          : presentation.toolPresentation?.summary ?? readString(payload.outputSummary) ?? readString(payload.output) ?? "",
      metadata,
      resourceLinks: presentation.toolPresentation?.resourceLinks,
      toolUsage: payload.toolUsage,
      toolPresentation: presentation.toolPresentation,
      surfaces: presentation.surfaces,
      ...scoped,
    };
  }
  if (event.kind === "file_changed") {
    const change = asRecord(payload.change);
    const path = readString(change?.path);
    const changeType = normalizeChangeType(change?.changeType);
    if (!path || !changeType) return null;
    return {
      type: "activity",
      activity: "file_changed",
      path,
      changeType,
      linesAdded: readNumber(change?.linesAdded),
      linesRemoved: readNumber(change?.linesRemoved),
      surfaces: presentation.surfaces,
      ...scoped,
    };
  }
  if (event.kind === "cost_updated") {
    const cost = asRecord(payload.cost);
    const usage = asRecord(payload.usage);
    return {
      type: "activity",
      activity: "cost_update",
      usd: readNumber(cost?.deltaUsd) ?? 0,
      inputTokens: readNumber(usage?.inputTokens),
      outputTokens: readNumber(usage?.outputTokens),
      surfaces: presentation.surfaces,
      ...scoped,
    };
  }
  if (event.kind === "context_usage_observed") {
    return {
      type: "activity",
      activity: "context_usage",
      metadata: { contextUsage: payload.contextUsage },
      surfaces: presentation.surfaces,
      ...scoped,
    };
  }
  if (event.kind === "effective_prompt_observed") {
    return {
      type: "activity",
      activity: event.kind,
      details: presentation.compactText,
      metadata: { effectivePrompt: payload.effectivePrompt },
      surfaces: presentation.surfaces,
      sessionEvent: event,
      ...scoped,
    };
  }
  if (event.kind === "lifecycle_attribution_recorded") {
    return {
      type: "activity",
      activity: event.kind,
      details: presentation.compactText,
      surfaces: presentation.surfaces,
      sessionEvent: event,
      ...scoped,
    };
  }
  if (event.kind === "approval_requested") {
    const approvalId = readString(payload.approvalId);
    return {
      type: "activity",
      activity: "approval_requested",
      details: presentation.compactText,
      approvalId,
      surfaces: presentation.surfaces,
      ...scoped,
    };
  }
  if (event.kind === "approval_resolved") {
    const resolution = asRecord(payload.resolution);
    const decision = readString(resolution?.decision);
    const approvalId = readString(payload.approvalId);
    return {
      type: "activity",
      activity: decision === "approved" ? "approval_approved" : "approval_rejected",
      details: presentation.compactText,
      approvalId,
      surfaces: presentation.surfaces,
      ...scoped,
    };
  }
  if (
    event.kind === "work_item_updated"
    || event.kind === "work_item_execution_started"
    || event.kind === "work_item_execution_finished"
  ) {
    return {
      type: "activity",
      activity: event.kind,
      details: presentation.compactText,
      output: presentation.summary,
      input: workItemActivityInput(payload),
      surfaces: presentation.surfaces,
      sessionEvent: event,
      ...scoped,
    };
  }
  if (event.kind.startsWith("agent_invocation_")) {
    return {
      type: "activity",
      activity: event.kind,
      details: presentation.compactText,
      input: payload,
      surfaces: presentation.surfaces,
      sessionEvent: event,
      ...scoped,
    };
  }
  return null;
}

/**
 * GatewaySession — TUI's SessionLike implementation backed by the local gateway WS.
 *
 * One GatewaySession maps to one user conversation.
 * Session history lives in the gateway's RuntimeSession; this class is stateless.
 */
export class GatewaySession implements SessionLike {
  private readonly client: TuiWsClient;
  private readonly userId: string;
  private _planMode = false;
  private _modelCatalog: ModelCatalog = { observedAt: new Date(0).toISOString(), models: [] };

  get planMode(): boolean {
    return this._planMode;
  }

  /** Callback invoked when the gateway publishes a route catalog or discovery evidence. */
  private onWelcome: ((
    modelCatalog: ModelCatalog,
    models?: Record<string, string[]>,
    providerDiscovery?: readonly GuiProviderDiscoveryResult[],
    providerModelDiscovery?: GuiProviderModelDiscoveryProjection,
    providerCatalogState?: { readonly status: GuiProviderCatalogStatus; readonly error?: string },
  ) => void) | null = null;

  /** Pending queue items for the current turn. Set while a turn is in flight. */
  private queue: QueueItem[] = [];
  private resolve: (() => void) | null = null;
  private connected = false;

  /** Pending clear callbacks — set while waiting for "cleared" frame. */
  private clearCallbacks: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private lastAssistantSourceMessageId: string | null = null;

  /** Pending route selection callbacks — set while waiting for route acknowledgement. */
  private executionTargetCallbacks: {
    targetId: string;
    requestId: string;
    resolve: (targetId: string) => void;
    reject: (err: Error) => void;
  } | null = null;

  /** Pending route catalog refresh callbacks — set while waiting for route refresh. */
  private modelCatalogRefreshCallbacks: { requestId: string; resolve: () => void; reject: (err: Error) => void } | null = null;

  /** Pending provider auth callbacks — set while waiting for provider_auth_completed. */
  private providerAuthCallbacks: {
    provider: string;
    requestId: string;
    resolve: () => void;
    reject: (err: Error) => void;
    onStarted?: (details: { verificationUri: string; userCode: string; message?: string }) => void;
  } | null = null;

  constructor(
    wsUrl: string,
    onWelcome?: (
      modelCatalog: ModelCatalog,
      models?: Record<string, string[]>,
      providerDiscovery?: readonly GuiProviderDiscoveryResult[],
      providerModelDiscovery?: GuiProviderModelDiscoveryProjection,
      providerCatalogState?: { readonly status: GuiProviderCatalogStatus; readonly error?: string },
    ) => void,
  ) {
    this.userId = `kiln-tui-${randomUUID()}`;
    this.onWelcome = onWelcome ?? null;

    this.client = new TuiWsClient({
      url: wsUrl,
      userId: this.userId,
      onMessage: (frame) => this.handleFrame(frame),
      onOpen: () => {
        this.connected = true;
      },
      onClose: () => {
        this.connected = false;
      },
    });

    this.client.connect();
  }

  get modelCatalog(): ModelCatalog {
    return this._modelCatalog;
  }

  async *run(opts: {
    prompt: string;
    cwd?: string;
    executionMode?: "execute" | "plan";
    requestedAuthority?: OperatorTurnRequestedAuthority;
    deliberationIntent?: import("@kilnai/gateway-contracts").GuiDeliberationIntent;
    communicationIntent?: import("@kilnai/gateway-contracts").GuiCommunicationIntent;
  }): AsyncGenerator<SessionEventInternal> {
    // Wait for connection to be established
    await this.waitForConnection();

    // Reset queue for this turn
    this.queue = [];
    this.resolve = null;
    if (opts.executionMode) {
      this._planMode = opts.executionMode === "plan";
    }

    // Send the user message
    this.client.send({
      type: "message",
      content: opts.prompt,
      executionMode: opts.executionMode ?? (this._planMode ? "plan" : "execute"),
      ...(opts.requestedAuthority ? { requestedAuthority: opts.requestedAuthority } : {}),
      ...(opts.deliberationIntent ? { deliberationIntent: opts.deliberationIntent } : {}),
      ...(opts.communicationIntent ? { communicationIntent: opts.communicationIntent } : {}),
    });

    yield* this.drainQueue();
  }

  /**
   * Send a clear frame to the gateway and wait for the cleared acknowledgement.
   * Resolves when the gateway confirms. Rejects after CLEAR_TIMEOUT_MS.
   * Not part of SessionLike — duck-typed in app.tsx.
   */
  async clear(): Promise<void> {
    await this.waitForConnection();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.clearCallbacks = null;
        reject(new Error("Clear timed out"));
      }, CLEAR_TIMEOUT_MS);

      this.clearCallbacks = {
        resolve: () => {
          clearTimeout(timeout);
          this.clearCallbacks = null;
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.clearCallbacks = null;
          reject(err);
        },
      };

      this.client.send({ type: "clear" });
    });
  }

  async requestLastVoiceSynthesis(): Promise<boolean> {
    await this.waitForConnection();
    if (!this.lastAssistantSourceMessageId) {
      return false;
    }
    this.client.send({
      type: "voice_synthesis_request",
      requestId: randomUUID(),
      sourceMessageId: this.lastAssistantSourceMessageId,
    });
    return true;
  }

  /**
   * Send route selection intent to the gateway and wait for its acknowledgement.
   * Resolves with the selected route id. Provider/model remain derived evidence.
   */
  async switchExecutionTarget(targetId: string, accountOverrideId?: string): Promise<string> {
    if (!this.connected || !this.client.isConnected) {
      throw new Error("Execution target selection requires an active TUI gateway connection");
    }
    const normalizedTargetId = targetId.trim();
    if (!normalizedTargetId) {
      throw new Error("Execution target selection requires a target id");
    }
    const intent: ExecutionTargetSelectionIntent = {
      targetId: normalizedTargetId,
      ...(accountOverrideId?.trim() ? { accountOverrideId: accountOverrideId.trim() } : {}),
    };
    return new Promise<string>((resolve, reject) => {
      const requestId = nextExecutionTargetRequestId();
      const timeout = setTimeout(() => {
        this.executionTargetCallbacks = null;
        reject(new Error("Execution target selection timed out"));
      }, MODEL_CATALOG_REFRESH_TIMEOUT_MS);

      this.executionTargetCallbacks = {
        targetId: intent.targetId,
        requestId,
        resolve: (selectedTargetId: string) => {
          clearTimeout(timeout);
          this.executionTargetCallbacks = null;
          resolve(selectedTargetId);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          this.executionTargetCallbacks = null;
          reject(err);
        },
      };

      this.client.send({ type: "execution_target", requestId, ...intent });
    });
  }

  /**
   * Refresh the execution target catalog without reconnecting the gateway session.
   * Not part of SessionLike — duck-typed in app.tsx.
   */
  async refreshModelCatalog(): Promise<void> {
    await this.waitForConnection();
    return new Promise<void>((resolve, reject) => {
      const requestId = nextModelCatalogRefreshRequestId();
      const timeout = setTimeout(() => {
        this.modelCatalogRefreshCallbacks = null;
        reject(new Error("Execution target refresh timed out"));
      }, MODEL_CATALOG_REFRESH_TIMEOUT_MS);

      this.modelCatalogRefreshCallbacks = {
        requestId,
        resolve: () => {
          clearTimeout(timeout);
          this.modelCatalogRefreshCallbacks = null;
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.modelCatalogRefreshCallbacks = null;
          reject(err);
        },
      };

      this.client.send({ type: "refresh_model_catalog", requestId });
    });
  }

  async authenticateProvider(
    provider: string,
    options: {
      readonly apiKey?: string;
      readonly tier?: "go" | "zen";
      readonly onStarted?: (details: { verificationUri: string; userCode: string; message?: string }) => void;
    } = {},
  ): Promise<void> {
    await this.waitForConnection();
    return new Promise<void>((resolve, reject) => {
      const requestId = nextProviderAuthRequestId();
      const timeout = setTimeout(() => {
        this.providerAuthCallbacks = null;
        providerAuthDebug("timed out waiting for provider auth completion", {
          provider,
          requestId,
        });
        reject(new Error("Provider authentication timed out"));
      }, PROVIDER_AUTH_TIMEOUT_MS);

      this.providerAuthCallbacks = {
        provider,
        requestId,
        onStarted: options.onStarted,
        resolve: () => {
          clearTimeout(timeout);
          this.providerAuthCallbacks = null;
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.providerAuthCallbacks = null;
          reject(err);
        },
      };

      providerAuthDebug("sending provider_auth frame", {
        provider,
        requestId,
        hasApiKey: Boolean(options.apiKey),
        tier: options.tier,
      });
      this.client.send({
        type: "provider_auth",
        provider,
        requestId,
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.tier ? { tier: options.tier } : {}),
      });
    });
  }

  /**
   * Send an approval response to the gateway.
   */
  approve(approvalId: string): void {
    this.client.send({ type: "approve", approvalId });
  }

  /**
   * Send a rejection response to the gateway.
   */
  reject(reason: string, approvalId: string): void {
    this.client.send({ type: "reject", reason, approvalId });
  }

  executePlanMode(): void {
    this.client.send({ type: "execution_mode_transition", toMode: "execute" });
  }

  async dispose(): Promise<void> {
    this.client.disconnect();
    // Unblock any waiting iterator
    this.pushStop();
  }

  private handleFrame(frame: TuiInboundFrame): void {
    if (frame.type === "thinking") {
      this.push({ type: "thinking" });
    } else if (frame.type === "operator_theme_set") {
      void this.handleOperatorThemeSet(frame);
    } else if (frame.type === "activity") {
      this.push({
        type: "activity",
        activity: frame.activity,
        toolName: frame.toolName,
        output: frame.output,
        usd: frame.usd,
        input: frame.input,
        inputTokens: frame.inputTokens,
        outputTokens: frame.outputTokens,
        details: frame.details,
        sessionId: frame.sessionId,
        path: frame.path,
        changeType: frame.changeType,
        linesAdded: frame.linesAdded,
        linesRemoved: frame.linesRemoved,
      });
    } else if (frame.type === "done") {
      this.lastAssistantSourceMessageId = frame.sourceMessageId ?? null;
      if (frame.content) {
        this.push({ type: "text_delta", content: frame.content });
      }
      for (const part of projectVoiceAudioOutputParts(frame.parts ?? [])) {
        this.push({ type: "text_delta", content: `\n${formatVoiceAudioOutputForTerminal(part)}` });
      }
      this.push({
        type: "completed",
        totalUsd: 0,
        outcome: frame.outcome,
        inputTokens: frame.inputTokens,
        outputTokens: frame.outputTokens,
        routedProvider: frame.routedProvider,
        routedModel: frame.routedModel,
        runtimeContinuity: frame.runtimeContinuity,
      });
      this.pushStop();
    } else if (frame.type === "voice_synthesis_completed") {
      for (const part of projectVoiceAudioOutputParts(frame.parts ?? [])) {
        this.push({ type: "text_delta", content: `\n${formatVoiceAudioOutputForTerminal(part)}` });
      }
    } else if (frame.type === "voice_synthesis_failed") {
      this.push({ type: "error", message: frame.message });
    } else if (frame.type === "error") {
      const pendingRouteSelection = this.executionTargetCallbacks;
      if (pendingRouteSelection) {
        this.executionTargetCallbacks = null;
        pendingRouteSelection.reject(new Error(frame.message));
      }
      const pendingProviderAuth = this.providerAuthCallbacks;
      if (pendingProviderAuth) {
        this.providerAuthCallbacks = null;
        pendingProviderAuth.reject(new Error(frame.message));
      }
      this.push({ type: "error", message: frame.message });
      this.pushStop();
    } else if (frame.type === "session_event") {
      const event = mapCanonicalSessionEvent(frame.event);
      if (event) {
        this.push(event);
      }
    } else if (frame.type === "activity_phase") {
      this.push({
        type: "activity",
        activity: frame.phase === "thinking" ? "reasoning" : frame.phase,
        toolName: frame.toolName,
        details: frame.details,
        sessionId: frame.kilnSessionId,
        turnId: frame.turnId,
      });
    } else if (frame.type === "approval_requested") {
      this.push({
        type: "activity",
        activity: "approval_requested",
        approvalId: frame.approvalId,
        details: frame.description,
        sessionId: frame.sessionId,
      });
    } else if (frame.type === "approval_received") {
      this.push({
        type: "activity",
        activity: frame.approved ? "approval_approved" : "approval_rejected",
        approvalId: frame.approvalId,
        details: frame.reason,
        sessionId: frame.sessionId,
      });
    } else if (frame.type === "welcome") {
      this._modelCatalog = frame.modelCatalog;
      this.onWelcome?.(frame.modelCatalog);
      if ("executionMode" in frame) {
        this._planMode = frame.executionMode === "plan";
      }
    } else if (frame.type === "provider_catalog_state") {
      if (frame.status === "ready") {
        this._modelCatalog = frame.modelCatalog;
        this.onWelcome?.(
          frame.modelCatalog,
          frame.models,
          frame.providerDiscovery,
          frame.providerModelDiscovery,
          { status: "ready" },
        );
      } else {
        this.onWelcome?.(
          this._modelCatalog,
          undefined,
          undefined,
          undefined,
          frame.status === "error"
            ? { status: "error", error: frame.message }
            : { status: frame.status },
        );
      }
    } else if (frame.type === "model_catalog_refreshed") {
      const pending = this.modelCatalogRefreshCallbacks;
      if (pending?.requestId === frame.requestId) {
        this._modelCatalog = frame.modelCatalog;
        this.onWelcome?.(frame.modelCatalog);
        pending.resolve();
      }
    } else if (frame.type === "model_catalog_refresh_failed") {
      const pending = this.modelCatalogRefreshCallbacks;
      if (pending?.requestId === frame.requestId) {
        pending.reject(new Error(frame.message));
      }
    } else if (frame.type === "provider_auth_started") {
      const pending = this.providerAuthCallbacks;
      if (pending && frame.provider === pending.provider && frame.requestId === pending.requestId) {
        providerAuthDebug("started frame accepted", {
          provider: frame.provider,
          requestId: frame.requestId,
          method: frame.method,
          verificationUri: frame.verificationUri,
          hasUserCode: frame.userCode.trim().length > 0,
          message: frame.message,
        });
        pending.onStarted?.({
          verificationUri: frame.verificationUri,
          userCode: frame.userCode,
          message: frame.message,
        });
      } else {
        providerAuthDebug("ignored started frame without matching pending request", {
          provider: frame.provider,
          requestId: frame.requestId,
          pendingProvider: pending?.provider,
          pendingRequestId: pending?.requestId,
        });
      }
    } else if (frame.type === "provider_auth_completed") {
      providerAuthDebug("completed frame received", {
        provider: frame.provider,
        requestId: frame.requestId,
        modelCount: frame.models[frame.provider]?.length,
        discovery: frame.providerDiscovery.find((entry) => entry.provider === frame.provider),
      });
      this._modelCatalog = frame.modelCatalog;
      this.onWelcome?.(
        frame.modelCatalog,
        frame.models,
        frame.providerDiscovery,
        frame.providerModelDiscovery,
      );
      const pending = this.providerAuthCallbacks;
      if (pending && frame.provider === pending.provider && frame.requestId === pending.requestId) {
        pending.resolve();
      } else {
        providerAuthDebug("ignored completed frame without matching pending request", {
          provider: frame.provider,
          requestId: frame.requestId,
          pendingProvider: pending?.provider,
          pendingRequestId: pending?.requestId,
        });
      }
    } else if (frame.type === "provider_auth_failed") {
      const pending = this.providerAuthCallbacks;
      if (pending && frame.provider === pending.provider && frame.requestId === pending.requestId) {
        providerAuthDebug("failed frame accepted", {
          provider: frame.provider,
          requestId: frame.requestId,
          message: frame.message,
        });
        pending.reject(new Error(frame.message));
      } else {
        providerAuthDebug("ignored failed frame without matching pending request", {
          provider: frame.provider,
          requestId: frame.requestId,
          pendingProvider: pending?.provider,
          pendingRequestId: pending?.requestId,
          message: frame.message,
        });
      }
    } else if (frame.type === "execution_mode_transitioned") {
      this._planMode = frame.executionMode === "plan";
    } else if (frame.type === "cleared") {
      this.clearCallbacks?.resolve();
    } else if (frame.type === "execution_target_changed") {
      const pending = this.executionTargetCallbacks;
      if (
        pending
        && frame.targetId === pending.targetId
        && frame.requestId === pending.requestId
      ) {
        pending.resolve(frame.targetId);
      } else if (pending) {
        pending.reject(new Error("Execution target change acknowledgement did not match the pending request"));
      }
    } else if (frame.type === "execution_target_change_failed") {
      const pending = this.executionTargetCallbacks;
      if (pending && frame.targetId === pending.targetId && frame.requestId === pending.requestId) {
        pending.reject(new Error(frame.reason));
      } else if (pending) {
        pending.reject(new Error("Execution target failure did not match the pending request"));
      }
    }
  }

  private async handleOperatorThemeSet(
    frame: Extract<TuiInboundFrame, { type: "operator_theme_set" }>,
  ): Promise<void> {
    try {
      const result = await applyTuiOperatorThemeRequest({
        theme: frame.theme,
        ...(frame.reason ? { reason: frame.reason } : {}),
      });
      this.client.send({
        type: "operator_theme_set_result",
        requestId: frame.requestId,
        ok: result.ok,
        ...(result.appliedTheme ? { appliedTheme: result.appliedTheme } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
    } catch (error) {
      this.client.send({
        type: "operator_theme_set_result",
        requestId: frame.requestId,
        ok: false,
        error: error instanceof Error ? error.message : "TUI theme control failed.",
      });
    }
  }

  private push(event: SessionEventInternal): void {
    this.queue.push(event);
    this.resolveQueue();
  }

  private pushStop(): void {
    this.queue.push(STOP);
    this.resolveQueue();
  }

  private resolveQueue(): void {
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  private async *drainQueue(): AsyncIterable<SessionEventInternal> {
    while (true) {
      if (this.queue.length > 0) {
        const item = this.queue.shift()!;
        if (item === STOP) return;
        yield item;
        // After yielding, check if more items arrived before waiting
        if (this.queue.length > 0) continue;
      }
      // Wait for next push
      await new Promise<void>((res) => {
        this.resolve = res;
      });
    }
  }

  private waitForConnection(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error("TUI gateway connection timed out"));
      }, CONNECT_TIMEOUT_MS);

      const poll = setInterval(() => {
        if (this.connected) {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve();
        }
      }, 50);
    });
  }
}

/**
 * Wait until the gateway is reachable on the given health URL.
 * Used by the CLI command to confirm startTuiGateway() is ready before connecting.
 */
export async function waitForGateway(healthUrl: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(SEND_CONNECTED_TIMEOUT_MS) });
      if (res.ok) return;
    } catch {
      // Not ready yet — retry
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`TUI gateway did not become ready within ${timeoutMs}ms`);
}
