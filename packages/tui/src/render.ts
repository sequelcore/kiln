/**
 * @fileoverview Render helper functions for TUI UI updates.
 * @module @kilnai/tui
 */

import { t, fg } from "@opentui/core";
import type { ReactiveState, Message, SessionListItem, PendingApproval } from "./state.js";
import type { KilnTheme } from "./theme.js";
import type { UIComponents } from "./ui.js";

export function renderSidebarField(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  const f = state.fieldSnapshot;
  const statusEmoji = f.status === "runaway" ? "!" : f.status === "starvation" ? "~" : f.status === "stable" ? "=" : "?";
  const dominant = f.dominantRegions.length > 0
    ? f.dominantRegions.slice(0, 3).join(", ")
    : "--";
  const satPct = (f.saturation * 100).toFixed(0);
  const entropyStr = f.entropy.toFixed(2);
  const lines = [
    `field [${statusEmoji}]`,
    `dom: ${dominant}`,
    `sat: ${satPct}%  H: ${entropyStr}`,
  ].join("\n");
  ui.sidebarFieldText.content = t`${fg(theme.textMuted)(lines)}`;
}

/**
 * Formats a token count as a compact string (e.g. 12345 → "12.3k").
 */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Renders the sidebar cost display.
 * Single provider: shows total cost or "thinking...".
 * Multi-provider: shows one abbreviated line per provider with cost + tokens.
 */
export function renderSidebarCost(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  if (state.status === "running") {
    ui.sidebarCostText.content = t`${fg(theme.textMuted)("thinking...")}`;
    return;
  }

  const providers = Object.keys(state.perProviderCost);
  if (providers.length <= 1) {
    ui.sidebarCostText.content = t`${fg(theme.textMuted)(`$${state.cost.toFixed(4)}`)}`;
    return;
  }

  // Multi-provider: one line per provider — "claude   $0.1234 12.3k↑34.5k↓"
  const lines = providers.map((p) => {
    const cost = state.perProviderCost[p] ?? 0;
    const tok = state.perProviderTokens[p] ?? { input: 0, output: 0 };
    const tokStr = tok.input || tok.output
      ? ` ${fmtTokens(tok.input)}↑${fmtTokens(tok.output)}↓`
      : "";
    return `${p.slice(0, 8).padEnd(8)} $${cost.toFixed(4)}${tokStr}`;
  });
  ui.sidebarCostText.content = t`${fg(theme.textMuted)(lines.join("\n"))}`;
}

/**
 * Renders the sidebar turns and tokens display.
 */
export function renderSidebarTurns(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  const inTok = fmtTokens(state.inputTokens);
  const outTok = fmtTokens(state.outputTokens);
  ui.sidebarTurnsText.content = t`${fg(theme.textMuted)(
    `turns: ${state.turns}  tok: ${inTok}/${outTok}`
  )}`;

}

/**
 * Renders the sidebar resume strategy and feedback display for the current provider.
 */
export function renderSidebarResume(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  const resumeInfo = state.resumeInfoByProvider[state.currentProvider];
  const runtimeInfo = state.runtimeContinuityByProvider[state.currentProvider];
  const resumeLine = resumeInfo?.strategy
    ? `resume: ${resumeInfo.strategy}${resumeInfo.feedbackLabel ? ` · ${resumeInfo.feedbackLabel}` : ""}`
    : "resume: --";
  const runtimeLine = runtimeInfo?.strategy
    ? `runtime: ${runtimeInfo.strategy}${runtimeInfo.feedbackLabel ? ` · ${runtimeInfo.feedbackLabel}` : ""}`
    : "runtime: --";
  const pressureLine = runtimeInfo?.pressure
    ? `ctx: ${runtimeInfo.pressure}${runtimeInfo.supportArtifactCount !== undefined ? ` · src ${runtimeInfo.supportArtifactCount}` : ""}`
    : "ctx: --";
  const sourceLine = runtimeInfo?.supportArtifactSources?.length
    ? `srcs: ${runtimeInfo.supportArtifactSources.join(", ")}`
    : "srcs: --";
  const fallbackLine = runtimeInfo?.fallbackLabel
    ? `why: ${runtimeInfo.fallbackLabel}`
    : "why: --";
  const usedLine = runtimeInfo?.supportArtifactSources?.length
    ? `used: ${runtimeInfo.usedCachedSupport ? "selected" : "available-only"}`
    : "used: --";
  const selectionLine = runtimeInfo?.selectionReason
    ? `sel: ${runtimeInfo.selectionReason}`
    : "sel: --";
  ui.sidebarResumeText.content = t`${fg(theme.textMuted)(`${resumeLine}\n${runtimeLine}\n${pressureLine}\n${sourceLine}\n${fallbackLine}\n${usedLine}\n${selectionLine}`)}`;
}

/**
 * Renders the input field colors.
 */
export function renderInput(
  theme: KilnTheme,
  ui: UIComponents
): void {
  if (ui.inputTextarea) {
    ui.inputTextarea.textColor = theme.text;
  }
}

/**
 * Renders provider and model info in sidebar.
 * Format: "[provider] domain · model  via user"
 */
export function renderSidebarProvider(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents,
  domain: string
): void {
  const model = state.currentModel;
  const modelStr = model ? ` · ${model}` : "";
  const routeMode = state.routeMode === "auto" ? " auto" : " via user";
  ui.sidebarProviderText.content = t`${fg(theme.accent)("[" + state.currentProvider + "]")} ${fg(theme.text)(domain + modelStr)}${fg(theme.textMuted)(routeMode)}`;
}

/**
 * Formats a session list item for sidebar display.
 */
function fmtSession(s: SessionListItem, selected: boolean): string {
  const date = s.completedAt.slice(0, 10);
  const costStr = `$${s.cost.toFixed(2)}`;
  const taskShort = s.task.length > 18 ? s.task.slice(0, 18) + "…" : s.task;
  const prefix = selected ? "▶ " : "  ";
  return `${prefix}[${s.provider}] ${date} ${costStr} ${taskShort}`;
}

/**
 * Formats an approval request for sidebar display.
 */
function fmtApproval(a: PendingApproval, index: number): string {
  const descShort = a.description.length > 22 
    ? a.description.slice(0, 22) + "…" 
    : a.description;
  const prefix = index === 0 ? "▶ " : "  ";
  return `${prefix}${descShort}`;
}

/**
 * Renders the changed files list in the sidebar.
 */
export function renderSidebarChanges(
  state: ReactiveState,
  theme: KilnTheme,
  ui: import("./ui.js").UIComponents
): void {
  if (state.changedFiles.length === 0) {
    ui.sidebarChangesText.content = t`${fg(theme.textMuted)("(none)")}`;
    return;
  }

  const lines: string[] = [];
  const maxItems = Math.min(state.changedFiles.length, 8);
  for (let i = 0; i < maxItems; i++) {
    const f = state.changedFiles[i]!;
    lines.push(fmtChange(f, i));
  }
  ui.sidebarChangesText.content = t`${fg(theme.text)(lines.join("\n"))}`;
}

/**
 * Formats a file change for sidebar display.
 */
function fmtChange(f: import("./state.js").ChangedFile, index: number): string {
  const icon = f.changeType === "created" ? "+" : f.changeType === "deleted" ? "-" : "~";
  const base = f.path.split("/").pop() ?? f.path;
  const prefix = index === 0 ? "▶ " : "  ";
  
  if (f.linesAdded !== undefined || f.linesRemoved !== undefined) {
    const added = f.linesAdded ? `+${f.linesAdded}` : "";
    const removed = f.linesRemoved ? `-${f.linesRemoved}` : "";
    return `${prefix}${icon} ${base} ${added}${removed}`;
  }
  
  return `${prefix}${icon} ${base}`;
}

/**
 * Renders the approval queue in the sidebar.
 */
export function renderSidebarApprovals(
  state: ReactiveState,
  theme: KilnTheme,
  ui: import("./ui.js").UIComponents
): void {
  if (state.pendingApprovals.length === 0) {
    ui.sidebarApprovalsText.content = t`${fg(theme.textMuted)("(none)")}`;
    return;
  }

  const lines: string[] = [];
  const maxItems = Math.min(state.pendingApprovals.length, 5);
  for (let i = 0; i < maxItems; i++) {
    const a = state.pendingApprovals[i]!;
    lines.push(fmtApproval(a, i));
  }
  ui.sidebarApprovalsText.content = t`${fg(theme.text)(lines.join("\n"))}`;
}

/**
 * Renders the session history list in the sidebar.
 */
export function renderSidebarSessions(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  if (state.sessions.length === 0) {
    ui.sidebarSessionsText.content = t`${fg(theme.textMuted)("(no sessions)")}`;
    return;
  }

  const lines: string[] = [];
  const maxItems = Math.min(state.sessions.length, 8);
  for (let i = 0; i < maxItems; i++) {
    const s = state.sessions[i]!;
    const isSelected = i === state.selectedSessionIndex;
    lines.push(fmtSession(s, isSelected));
  }
  ui.sidebarSessionsText.content = t`${fg(theme.text)(lines.join("\n"))}`;
}

/**
 * Generates content for a message based on its role.
 */
export function msgContent(
  m: Message,
  theme: KilnTheme
): ReturnType<typeof t> | string {
  if (m.role === "user") return t`${fg(theme.userFg)("you")}: ${m.content}`;
  if (m.role === "tool") return t`${fg(theme.toolFg)(`⟳ ${m.toolName ?? "tool"}`)}`;
  if (m.role === "error") return t`${fg(theme.error)("error")}: ${m.content}`;
  return m.content;
}
