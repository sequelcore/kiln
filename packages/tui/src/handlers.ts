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
import type { SessionLike } from "./types.js";
import type { ReactiveState, Message } from "./state.js";
import { update, createMessage } from "./state.js";
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
  messageNodes: { msg: Message; node: TextRenderable | MarkdownRenderable }[];
  createSession: () => Promise<SessionLike>;
  provider: string;
  domain: string;
}

/**
 * Assistant data holder for streaming response.
 */
export interface AssistantData {
  msg: Message | null;
  node: TextRenderable | MarkdownRenderable | null;
  content: string;
  markdown: MarkdownRenderable | null;
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
        flexDirection: "row",
        width: "100%",
        paddingTop: 1,
        paddingBottom: 1,
        paddingLeft: 2,
        paddingRight: 2,
        backgroundColor: ctx.theme.assistantBg,
      });
      ctx.chatScrollBox.content.add(assistantBox);

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
 * Handles tool_use events - displays tool in chat and updates sidebar count.
 */
export function handleToolUse(
  ctx: HandlerContext,
  toolName: string
): void {
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
    content: t`${fg(ctx.theme.toolFg)("⟳ " + (toolName ?? "tool"))}`,
    width: "100%",
  });
  msgBox.add(node);
  ctx.messageNodes.push({ msg: toolMsg, node });
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
  renderSidebarCost: () => void
): void {
  update(ctx.state, "cost", ctx.state.cost + usd);
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
  usd: number | undefined,
  renderSidebarCost: () => void
): void {
  if (activity === "tool_use" && toolName) {
    handleToolUse(ctx, toolName);
  } else if (activity === "tool_result" && toolName && output !== undefined) {
    handleToolResult(ctx, toolName, output);
  } else if (activity === "cost_update" && usd !== undefined) {
    handleCostUpdate(ctx, usd, renderSidebarCost);
  }
}

/**
 * Handles completed event - finalizes session state.
 */
export function handleCompleted(
  ctx: HandlerContext,
  totalUsd: number,
  spinner: { interval: ReturnType<typeof setInterval> | null },
  thinkingNodeRef: { node: TextRenderable | null },
  renderSidebarCost: () => void,
  renderSidebarTurns: () => void
): void {
  if (totalUsd) update(ctx.state, "cost", totalUsd);
  update(ctx.state, "status", "idle");
  update(ctx.state, "thinkingVisible", false);
  update(ctx.state, "thinking", "");
  update(ctx.state, "turns", ctx.state.turns + 1);

  if (spinner.interval) {
    clearInterval(spinner.interval);
    spinner.interval = null;
  }

  if (thinkingNodeRef.node) {
    thinkingNodeRef.node.destroy();
    thinkingNodeRef.node = null;
  }

  renderSidebarCost();
  renderSidebarTurns();
}

/**
 * Handles error event - displays error message.
 */
export function handleError(
  ctx: HandlerContext,
  message: string
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
  update(ctx.state, "thinking", "");
  update(ctx.state, "thinkingVisible", false);
  renderSidebarCost();
  startSpinner();
  renderCommandBarStatus();

  const session = await ctx.createSession();
  const assistantData: AssistantData = { msg: null, node: null, content: "", markdown: null };

  try {
    for await (const event of session.run({ prompt: text })) {
      switch (event.type) {
        case "text_delta":
          if (event.content) {
            await handleTextDelta(ctx, event.content, !!event.isThinking, assistantData);
          }
          break;
        case "tool_use":
          if (event.toolName) handleToolUse(ctx, event.toolName);
          break;
        case "tool_result":
          if (event.toolName && event.output) handleToolResult(ctx, event.toolName, event.output);
          break;
        case "cost_update":
          if (event.usd) handleCostUpdate(ctx, event.usd, renderSidebarCost);
          break;
        case "activity":
          handleActivity(ctx, event.activity, event.toolName, event.output, event.usd, renderSidebarCost);
          break;
        case "thinking":
          handleThinking(ctx, renderSidebarCost);
          break;
        case "completed":
          handleCompleted(ctx, event.totalUsd, spinnerRef, thinkingNodeRef, renderSidebarCost, renderSidebarTurns);
          break;
        case "error":
          if (event.message) handleError(ctx, event.message);
          break;
      }
    }
  } catch (err) {
    handleError(ctx, err instanceof Error ? err.message : String(err));
  }
}
