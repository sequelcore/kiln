/**
 * @fileoverview Event handlers for TUI session events.
 * @module @kilnai/tui
 */

import {
  BoxRenderable,
  TextRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  t,
  fg,
  type CliRenderer,
  type ScrollBoxRenderable,
} from "@opentui/core";
import {
  formatOperatorEventValue,
  operatorIdentityInitials,
  projectAgentProfileIdentity,
  projectManagedAgentIdentity,
  type OperatorSessionEvent,
} from "@kilnai/gateway-contracts";
import type { SessionLike } from "./types.js";
import type { ReactiveState, Message, ContinuationSidebarInfo, PendingApproval, WorkItem } from "./state.js";
import { update, createMessage } from "./state.js";
import {
  EMPTY_TUI_MANAGED_AGENT_VIEW_STATE,
  appendManagedAgentSessionEvent,
  projectTuiManagedAgentViewState,
  selectTuiManagedAgentDrilldownTarget,
} from "./managed-agent-cockpit.js";
import type { KilnTheme } from "./theme.js";
import type { UIComponents } from "./ui.js";

/**
 * Context object passed to all handlers.
 */
export interface HandlerContext {
  renderer: CliRenderer;
  state: ReactiveState;
  theme: KilnTheme;
  ui: UIComponents;
  chatScrollBox: ScrollBoxRenderable;
  sidebarToolsBox: ScrollBoxRenderable;
  sidebarToolNode: TextRenderable | null;
  messageNodes: { msg: Message; node: TextRenderable | MarkdownRenderable; toolInput?: unknown }[];
  createSession: () => Promise<SessionLike>;
  refreshContinuationInfo?: () => Promise<Record<string, ContinuationSidebarInfo>>;
  provider: string;
  domain: string;
  renderSidebarApprovals?: () => void;
  renderSidebarChanges?: () => void;
  renderSidebarWork?: () => void;
  renderSidebarManagedAgents?: () => void;
}

/**
 * Assistant data holder for streaming response.
 */
export interface AssistantData {
  msg: Message | null;
  node: TextRenderable | MarkdownRenderable | null;
  headerNode: TextRenderable | null;
  content: string;
  markdown: MarkdownRenderable | null;
  provider: string;
  model: string;
}

function bindOrRejectSessionScopedEvent(
  ctx: HandlerContext,
  sessionId: string | undefined,
  turnId: string | undefined,
): boolean {
  if (!sessionId) {
    return true;
  }
  if (ctx.state.currentSessionId && ctx.state.currentSessionId !== sessionId) {
    return false;
  }
  if (!ctx.state.currentSessionId) {
    update(ctx.state, "currentSessionId", sessionId);
  }
  if (turnId && !ctx.state.currentTurnId) {
    update(ctx.state, "currentTurnId", turnId);
  }
  return true;
}

/**
 * Handles text_delta events, both thinking and assistant content.
 */
export async function handleTextDelta(
  ctx: HandlerContext,
  content: string,
  isThinking: boolean,
  assistantData: AssistantData
): Promise<void> {
  if (isThinking) {
    assistantData.content += content;
    update(ctx.state, "thinking", assistantData.content);
    update(ctx.state, "thinkingVisible", true);
    update(ctx.state, "currentActivity", {
      phase: "reasoning",
      details: content.slice(-100),
    });
  } else {
    update(ctx.state, "thinkingVisible", false);
    update(ctx.state, "thinking", "");
    update(ctx.state, "currentActivity", { phase: "responding" });

    if (!assistantData.msg || !assistantData.node) {
      assistantData.msg = { role: "assistant", content };
      const assistantBox = new BoxRenderable(ctx.renderer, {
        id: `msg-${ctx.messageNodes.length}`,
        flexDirection: "column",
        width: "100%",
        paddingTop: 1,
        paddingBottom: 1,
        paddingLeft: 2,
        paddingRight: 2,
        backgroundColor: ctx.theme.assistantBg,
      });
      ctx.chatScrollBox.content.add(assistantBox);

      // Routing header — shows which provider (+ model if known) handled this response
      const provider = assistantData.provider;
      const model = assistantData.model;
      const routeLabel = model ? `${provider} · ${model}` : provider;
      const headerNode = new TextRenderable(ctx.renderer, {
        content: t`${fg(ctx.theme.textMuted)("[" + routeLabel + "]")}`,
        width: "100%",
      });
      assistantBox.add(headerNode);
      assistantData.headerNode = headerNode;

      assistantData.markdown = new MarkdownRenderable(ctx.renderer, {
        content,
        width: "100%",
        streaming: true,
        fg: ctx.theme.text,
        conceal: true,
        syntaxStyle: SyntaxStyle.create(),
      });
      assistantBox.add(assistantData.markdown);
      assistantData.node = assistantData.markdown;
      ctx.messageNodes.push({ msg: assistantData.msg, node: assistantData.markdown });
      update(ctx.state, "messages", [...ctx.state.messages, assistantData.msg]);
    } else {
      assistantData.msg.content += content;
      if (assistantData.markdown) {
        assistantData.markdown.content = assistantData.msg.content;
      }
      update(ctx.state, "messages", [...ctx.state.messages]);
    }
  }
}

/**
 * Handles tool_use events - displays tool in chat with input preview and updates sidebar count.
 */
export function handleToolUse(
  ctx: HandlerContext,
  toolName: string,
  input?: unknown
): void {
  // Format input as inline preview: [key=value, ...]
  let inputPreview = "";
  if (input && typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>).slice(0, 3);
    inputPreview = entries
      .map(([k, v]) => {
        const vStr = formatOperatorEventValue(v) ?? "";
        return vStr.length > 20 ? `${k}=${vStr.slice(0, 17)}...` : `${k}=${vStr}`;
      })
      .join(", ");
    if (inputPreview) inputPreview = " [" + inputPreview + "]";
  }

  const toolMsg = createMessage("tool", "", toolName);
  const msgBox = new BoxRenderable(ctx.renderer, {
    id: `msg-${ctx.messageNodes.length}`,
    flexDirection: "row",
    width: "100%",
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
    backgroundColor: ctx.theme.background,
  });
  ctx.chatScrollBox.content.add(msgBox);
  const node = new TextRenderable(ctx.renderer, {
    content: t`${fg(ctx.theme.toolFg)("⟳ " + (toolName ?? "tool"))}${fg(ctx.theme.textMuted)(inputPreview)}`,
    width: "100%",
  });
  msgBox.add(node);
  ctx.messageNodes.push({ msg: toolMsg, node, toolInput: input });
  update(ctx.state, "messages", [...ctx.state.messages, toolMsg]);

  update(ctx.state, "currentActivity", {
    phase: "executing",
    toolName,
    details: "running",
  });

  ctx.state.toolCallCounts[toolName] = (ctx.state.toolCallCounts[toolName] ?? 0) + 1;
  const count = ctx.state.toolCallCounts[toolName];
  const countStr = count > 1 ? ` ×${count}` : "";

  if (ctx.sidebarToolNode) {
    ctx.sidebarToolNode.content = t`${fg(ctx.theme.toolFg)("⟳ ")}${fg(ctx.theme.text)(toolName)}${fg(ctx.theme.textMuted)(countStr)}`;
  } else {
    const sidebarToolNode = new TextRenderable(ctx.renderer, {
      content: t`${fg(ctx.theme.toolFg)("⟳ ")}${fg(ctx.theme.text)(toolName)}${fg(ctx.theme.textMuted)(countStr)}`,
      width: "100%",
    });
    ctx.sidebarToolsBox.content.add(sidebarToolNode);
    ctx.sidebarToolNode = sidebarToolNode;
  }
}

/**
 * Handles tool_result events - updates existing tool message.
 */
export function handleToolResult(
  ctx: HandlerContext,
  toolName: string,
  output: string
): void {
  const truncated = output && output.length > 60
    ? output.slice(0, 57) + "..."
    : output;
  const entry = ctx.messageNodes.findLast(
    (n) => n.msg.role === "tool" && n.msg.toolName === toolName
  );
  if (entry) {
    entry.msg.content = truncated;
    entry.node.content = t`${fg(ctx.theme.toolFg)("⟳ " + (entry.msg.toolName ?? "tool"))}`;
  }

  update(ctx.state, "currentActivity", {
    phase: "executing",
    toolName,
    details: truncated,
  });
}

/**
 * Handles cost_update events - accumulates and displays cost.
 */
export function handleCostUpdate(
  ctx: HandlerContext,
  usd: number,
  renderSidebarCost: () => void,
  inputTokens?: number,
  outputTokens?: number
): void {
  update(ctx.state, "cost", ctx.state.cost + usd);
  // Accumulate token counts from cost_update events (subscription sessions send these per-turn)
  if (inputTokens !== undefined) update(ctx.state, "inputTokens", ctx.state.inputTokens + inputTokens);
  if (outputTokens !== undefined) update(ctx.state, "outputTokens", ctx.state.outputTokens + outputTokens);

  // Per-provider attribution
  const provider = ctx.state.respondingProvider ?? ctx.state.currentProvider;
  ctx.state.perProviderCost[provider] = (ctx.state.perProviderCost[provider] ?? 0) + usd;
  const prev = ctx.state.perProviderTokens[provider] ?? { input: 0, output: 0 };
  ctx.state.perProviderTokens[provider] = {
    input: prev.input + (inputTokens ?? 0),
    output: prev.output + (outputTokens ?? 0),
  };

  renderSidebarCost();
}

/**
 * Handles thinking status event.
 */
export function handleThinking(
  ctx: HandlerContext,
  renderSidebarCost: () => void
): void {
  update(ctx.state, "status", "running");
  renderSidebarCost();
}

/**
 * Handles activity events from gateway streaming.
 */
export function handleActivity(
  ctx: HandlerContext,
  activity: string,
  toolName: string | undefined,
  output: string | undefined,
  details: string | undefined,
  usd: number | undefined,
  input: unknown | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  renderSidebarCost: () => void,
  renderSidebarApprovals?: () => void,
  event?: { sessionId?: string; turnId?: string; approvalId?: string; path?: string; changeType?: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number; sessionEvent?: OperatorSessionEvent }
): void {
  // Ignore late-arriving frames after the turn has completed.
  if (ctx.state.status !== "running") return;
  if (!bindOrRejectSessionScopedEvent(ctx, event?.sessionId, event?.turnId)) {
    return;
  }

  if (activity === "approval_requested" && (details !== undefined || output !== undefined)) {
    handleApprovalRequested(ctx, event?.approvalId ?? "", details ?? output ?? "", event?.sessionId ?? "");
    renderSidebarApprovals?.();
  } else if (activity === "approval_approved" || activity === "approval_rejected") {
    const approvalId = event?.approvalId;
    if (approvalId) {
      update(
        ctx.state,
        "pendingApprovals",
        ctx.state.pendingApprovals.filter((pending) => pending.approvalId !== approvalId),
      );
      renderSidebarApprovals?.();
    }
  } else if (activity === "cost_update" && usd !== undefined) {
    handleCostUpdate(ctx, usd, renderSidebarCost, inputTokens, outputTokens);
  } else if (activity === "tool_use" && toolName) {
    handleToolUse(ctx, toolName, input);
  } else if (activity === "tool_result" && toolName && output) {
    handleToolResult(ctx, toolName, output);
  } else if (activity === "file_changed") {
    const path = (event as { path?: string }).path;
    const changeType = (event as { changeType?: "created" | "modified" | "deleted" }).changeType;
    const linesAdded = (event as { linesAdded?: number }).linesAdded;
    const linesRemoved = (event as { linesRemoved?: number }).linesRemoved;
    if (path && changeType) {
      update(ctx.state, "changedFiles", [
        ...ctx.state.changedFiles,
        {
          sessionId: event?.sessionId,
          turnId: event?.turnId,
          path,
          changeType,
          linesAdded,
          linesRemoved,
          timestamp: new Date(),
        },
      ]);
      ctx.renderSidebarChanges?.();
    }
  } else if (
    activity === "work_item_updated"
    || activity === "work_item_execution_started"
    || activity === "work_item_execution_finished"
  ) {
    const item = toWorkItem(input, event?.sessionId, event?.turnId);
    if (item) {
      update(ctx.state, "workItems", [
        item,
        ...ctx.state.workItems.filter((candidate) => candidate.id !== item.id),
      ]);
      ctx.renderSidebarWork?.();
    }
    appendManagedAgentProjectionEvent(ctx, event?.sessionEvent);
    update(ctx.state, "currentActivity", {
      phase: "planning",
      details: output ?? details ?? "work item updated",
    });
  } else if (activity.startsWith("agent_invocation_")) {
    appendManagedAgentProjectionEvent(ctx, event?.sessionEvent);
    const identity = projectManagedAgentIdentity(input as Parameters<typeof projectManagedAgentIdentity>[0]);
    const identityLabel = identity ? `[${operatorIdentityInitials(identity.label)} ${identity.label}]` : null;
    update(ctx.state, "currentActivity", {
      phase: activity === "agent_invocation_started" ? "executing" : "reasoning",
      toolName: "managed_agent.invoke",
      details: identity ? `${identityLabel} ${details ?? identity.subtitle ?? ""}`.trim() : details,
    });
  }
}

function appendManagedAgentProjectionEvent(
  ctx: HandlerContext,
  sessionEvent: OperatorSessionEvent | undefined,
): void {
  if (!sessionEvent) {
    return;
  }
  const managedAgentSessionEvents = appendManagedAgentSessionEvent(
    ctx.state.managedAgentSessionEvents,
    sessionEvent,
  );
  if (managedAgentSessionEvents === ctx.state.managedAgentSessionEvents) {
    return;
  }
  update(ctx.state, "managedAgentSessionEvents", managedAgentSessionEvents);
  update(ctx.state, "managedAgents", projectTuiManagedAgentViewState(managedAgentSessionEvents, {
    drilldownTarget: selectTuiManagedAgentDrilldownTarget(managedAgentSessionEvents),
  }));
  ctx.renderSidebarManagedAgents?.();
}

function toWorkItem(input: unknown, sessionId?: string, turnId?: string): WorkItem | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const id = readText(record.id);
  const summary = readText(record.summary);
  const status = readText(record.status);
  const workflowProfile = readText(record.workflowProfile);
  const agentIdentity = projectAgentProfileIdentity(readText(record.assignedAgentProfile));
  if (!id || !summary || !status || !workflowProfile) {
    return null;
  }
  return {
    sessionId,
    turnId,
    id,
    resourceUri: readText(record.resourceUri) ?? `kiln://session/work-items/${encodeURIComponent(id)}`,
    summary,
    status,
    workflowProfile,
    authorityProfile: readText(record.authorityProfile),
    ...(agentIdentity ? { assignedAgentProfile: agentIdentity.label } : {}),
    expectedEvidence: readTextArray(record.expectedEvidence),
    providedEvidence: readTextArray(record.providedEvidence),
    latestAttemptStatus: readText(record.latestAttemptStatus),
    latestAttemptMode: readText(record.latestAttemptMode),
    latestManagedInvocationId: readText(record.latestManagedInvocationId),
    pendingPauseRequirementCount: readPendingPauseRequirementCount(record.pauseRequirements),
    missingEvidence: readTextArray(record.missingEvidence),
    missingResidualRisk: record.missingResidualRisk === true,
    updatedAt: readDate(record.updatedAt) ?? new Date(),
  };
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => readText(entry) ? [readText(entry)!] : [])
    : [];
}

function readPendingPauseRequirementCount(value: unknown): number | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    return (entry as Record<string, unknown>).status === "pending";
  }).length;
}

function readDate(value: unknown): Date | undefined {
  const text = readText(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Handles completed event - finalizes session state.
 */
export function handleCompleted(
  ctx: HandlerContext,
  totalUsd: number,
  inputTokens: number,
  outputTokens: number,
  runtimeContinuity: { strategy: string; feedbackLabel?: string } | undefined,
  routedProvider: string | undefined,
  spinner: { interval: ReturnType<typeof setInterval> | null },
  thinkingNodeRef: { node: TextRenderable | null },
  renderSidebarCost: () => void,
  renderSidebarTurns: () => void,
  renderSidebarProvider: () => void,
  renderCommandBarStatus: () => void,
  renderSidebarContinuation?: () => void
): void {
  if (totalUsd) update(ctx.state, "cost", totalUsd);
  // Only overwrite token counts from completion if they are non-zero
  // (subscription sessions report 0 from done frame; prefer accumulated cost_update values)
  if (inputTokens > 0) update(ctx.state, "inputTokens", inputTokens);
  if (outputTokens > 0) update(ctx.state, "outputTokens", outputTokens);
  update(ctx.state, "status", "idle");
  update(ctx.state, "currentActivity", { phase: "" });
  update(ctx.state, "thinkingVisible", false);
  update(ctx.state, "thinking", "");
  update(ctx.state, "turns", ctx.state.turns + 1);
  if (runtimeContinuity?.strategy) {
    const provider = routedProvider ?? ctx.state.respondingProvider ?? ctx.state.currentProvider;
    ctx.state.runtimeContinuityByProvider[provider] = runtimeContinuity;
  }

  if (spinner.interval) {
    clearInterval(spinner.interval);
    spinner.interval = null;
  }

  if (thinkingNodeRef.node) {
    thinkingNodeRef.node.destroy();
    thinkingNodeRef.node = null;
  }

  update(ctx.state, "respondingProvider", undefined);
  update(ctx.state, "respondingModel", undefined);
  renderSidebarCost();
  renderSidebarTurns();
  renderSidebarProvider();
  renderSidebarContinuation?.();
  renderCommandBarStatus();
}

/**
 * Handles error event - displays error message.
 */
export function handleError(
  ctx: HandlerContext,
  message: string,
  renderSidebarProvider?: () => void
): void {
  const errMsg = createMessage("error", message);
  const msgBox = new BoxRenderable(ctx.renderer, {
    id: `msg-${ctx.messageNodes.length}`,
    flexDirection: "row",
    width: "100%",
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
    backgroundColor: ctx.theme.background,
  });
  ctx.chatScrollBox.content.add(msgBox);
  const node = new TextRenderable(ctx.renderer, {
    content: t`${fg(ctx.theme.error)("error")}: ${message}`,
    width: "100%",
  });
  msgBox.add(node);
  ctx.messageNodes.push({ msg: errMsg, node });
  update(ctx.state, "messages", [...ctx.state.messages, errMsg]);

  update(ctx.state, "status", "error");
  update(ctx.state, "respondingProvider", undefined);
  update(ctx.state, "respondingModel", undefined);
  renderSidebarProvider?.();
}

/**
 * Handles approval_requested events - adds to pending approvals queue.
 */
export function handleApprovalRequested(
  ctx: HandlerContext,
  approvalId: string,
  description: string,
  sessionId: string
): void {
  if (!approvalId.trim() || !sessionId.trim()) {
    return;
  }
  const approval: PendingApproval = {
    approvalId,
    sessionId,
    description,
    requestedAt: new Date(),
  };
  update(ctx.state, "pendingApprovals", [...ctx.state.pendingApprovals, approval]);
}

/**
 * Spinner animation frames.
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Sends a message to the session and processes events.
 */
export async function sendMessage(
  ctx: HandlerContext,
  text: string,
  thinkingNodeRef: { node: TextRenderable | null },
  renderSidebarCost: () => void,
  renderSidebarTurns: () => void,
  renderSidebarProvider: () => void,
  renderSidebarContinuation: () => void,
  renderCommandBarStatus: () => void,
  startSpinner: () => void,
  _stopSpinner: () => void,
  spinnerRef: { interval: ReturnType<typeof setInterval> | null }
): Promise<void> {
  const userMsg = createMessage("user", text);

  // Append user message to chat
  const msgBox = new BoxRenderable(ctx.renderer, {
    id: `msg-${ctx.messageNodes.length}`,
    flexDirection: "row",
    width: "100%",
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
    backgroundColor: ctx.theme.userBg,
  });
  ctx.chatScrollBox.content.add(msgBox);
  const userNode = new TextRenderable(ctx.renderer, {
    content: t`${fg(ctx.theme.userFg)("you")}: ${text}`,
    width: "100%",
  });
  msgBox.add(userNode);
  ctx.messageNodes.push({ msg: userMsg, node: userNode });
  update(ctx.state, "messages", [...ctx.state.messages, userMsg]);

  update(ctx.state, "status", "running");
  update(ctx.state, "currentSessionId", undefined);
  update(ctx.state, "currentTurnId", undefined);
  update(ctx.state, "managedAgentSessionEvents", []);
  update(ctx.state, "managedAgents", EMPTY_TUI_MANAGED_AGENT_VIEW_STATE);
  update(ctx.state, "thinking", "");
  update(ctx.state, "thinkingVisible", false);
  renderSidebarCost();
  ctx.renderSidebarManagedAgents?.();
  startSpinner();
  renderCommandBarStatus();

  const respondingProvider = ctx.state.currentProvider;
  const respondingModel = ctx.state.currentModel;
  update(ctx.state, "respondingProvider", respondingProvider);
  update(ctx.state, "respondingModel", respondingModel);
  renderSidebarProvider();

  const session = await ctx.createSession();
  const assistantData: AssistantData = {
    msg: null,
    node: null,
    headerNode: null,
    content: "",
    markdown: null,
    provider: respondingProvider,
    model: respondingModel,
  };

  try {
    for await (const event of session.run({
      prompt: text,
      executionMode: ctx.state.planMode ? "plan" : "execute",
      requestedAuthority: ctx.state.currentRequestedAuthority,
      reasoningEffort: ctx.state.currentReasoningEffort,
    })) {
      switch (event.type) {
        case "text_delta":
          if (event.content) {
            await handleTextDelta(ctx, event.content, !!event.isThinking, assistantData);
          }
          break;
        case "cost_update":
          if (event.usd) handleCostUpdate(ctx, event.usd, renderSidebarCost);
          break;
        case "activity":
          handleActivity(
            ctx,
            event.activity,
            event.toolName,
            event.output,
            event.details,
            event.usd,
            event.input,
            event.inputTokens,
            event.outputTokens,
            renderSidebarCost,
            ctx.renderSidebarApprovals,
            event,
          );
          break;
        case "thinking":
          handleThinking(ctx, renderSidebarCost);
          break;
        case "completed":
          if (event.routedProvider) {
            assistantData.provider = event.routedProvider;
          }
          if (event.routedModel !== undefined) {
            assistantData.model = event.routedModel;
          }
          if (assistantData.headerNode) {
            const routeLabel = assistantData.model
              ? `${assistantData.provider} · ${assistantData.model}`
              : assistantData.provider;
            assistantData.headerNode.content = t`${fg(ctx.theme.textMuted)("[" + routeLabel + "]")}`;
          }
          handleCompleted(
            ctx,
            event.totalUsd,
            event.inputTokens ?? 0,
            event.outputTokens ?? 0,
            event.runtimeContinuity,
            event.routedProvider,
            spinnerRef,
            thinkingNodeRef,
            renderSidebarCost,
            renderSidebarTurns,
            renderSidebarProvider,
            renderCommandBarStatus,
            renderSidebarContinuation,
          );
          if (ctx.refreshContinuationInfo) {
            void ctx.refreshContinuationInfo().then((info) => {
              update(ctx.state, "continuationInfoByProvider", info);
              renderSidebarContinuation();
            }).catch(() => {
              // fail-open
            });
          }
          break;
        case "error":
          if (event.message) handleError(ctx, event.message, renderSidebarProvider);
          break;
      }
    }
  } catch (err) {
    handleError(ctx, err instanceof Error ? err.message : String(err), renderSidebarProvider);
  }
}
