/**
 * @fileoverview Render helper functions for TUI UI updates.
 * @module @kilnai/tui
 */

import { t, fg } from "@opentui/core";
import { formatContextUsageProjection, operatorIdentityInitials, projectAgentProfileIdentity } from "@kilnai/gateway-contracts";
import type { ReactiveState, Message, SessionListItem, PendingApproval, WorkItem } from "./state.js";
import { formatManagedAgentCockpitLines } from "./managed-agent-cockpit.js";
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
    `turns: ${state.turns}  tok: ${inTok}/${outTok}  ${state.contextUsage ? formatContextUsageProjection(state.contextUsage) : "Context usage unavailable"}`
  )}`;

}

/**
 * Renders the sidebar continuation strategy and feedback display for the current provider.
 */
export function renderSidebarContinuation(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  const continuationInfo = state.continuationInfoByProvider[state.currentProvider];
  const runtimeInfo = state.runtimeContinuityByProvider[state.currentProvider];
  const continuationLine = continuationInfo?.strategy
    ? `cont: ${continuationInfo.strategy}${continuationInfo.feedbackLabel ? ` · ${continuationInfo.feedbackLabel}` : ""}`
    : "cont: --";
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
  ui.sidebarContinuationText.content = t`${fg(theme.textMuted)(`${continuationLine}\n${runtimeLine}\n${pressureLine}\n${sourceLine}\n${fallbackLine}\n${usedLine}\n${selectionLine}`)}`;
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
 * Format: "[provider] domain · model  via user" or "[provider] PLAN · model"
 */
export function renderSidebarProvider(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents,
  domain: string
): void {
  const isResponding = state.status === "running" && !!state.respondingProvider;
  const provider = isResponding ? (state.respondingProvider ?? state.currentProvider) : state.currentProvider;
  const model = isResponding ? (state.respondingModel ?? state.currentModel) : state.currentModel;
  const modelStr = model ? ` · ${model}` : "";
  const effortStr = state.currentReasoningEffort ? ` · ${state.currentReasoningEffort}` : "";
  const authorityStr = state.currentRequestedAuthority !== "auto" ? ` · ${state.currentRequestedAuthority}` : "";
  const planBadge = state.planMode ? ` ${fg(theme.warning)("PLAN")}` : "";
  const routeMode = isResponding
    ? " responding"
    : state.routeMode === "auto"
      ? " auto"
      : " via user";
  const routeStr = state.planMode ? "" : fg(theme.textMuted)(routeMode);
  ui.sidebarProviderText.content = t`${fg(theme.accent)("[" + provider + "]")}${planBadge} ${fg(theme.text)(domain + modelStr + effortStr + authorityStr)}${routeStr}`;
}

/**
 * Formats a session list item for sidebar display.
 */
function fmtSession(s: SessionListItem, selected: boolean): string {
  const date = s.completedAt.slice(0, 10);
  const costStr = `$${s.cost.toFixed(2)}`;
  const taskShort = s.task.length > 14 ? s.task.slice(0, 14) + "…" : s.task;

  let meta = "";
  if (s.turns !== undefined && s.turns > 0) {
    meta += `${s.turns}t`;
  }
  if (s.durationMs !== undefined && s.durationMs > 0) {
    const secs = Math.round(s.durationMs / 1000);
    if (meta) meta += " · ";
    meta += secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${secs % 60}s`;
  }
  if (meta) meta = ` · ${meta}`;

  const prefix = selected ? "▶ " : "  ";
  return `${prefix}[${s.provider}] ${date} ${costStr}${meta}\n    ${taskShort}`;
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

function fmtWorkItem(item: WorkItem, index: number): string {
  const prefix = index === 0 ? "> " : "  ";
  const summary = item.summary.length > 22 ? item.summary.slice(0, 19) + "..." : item.summary;
  const evidence = item.expectedEvidence.length > 0
    ? `${item.providedEvidence.length}/${item.expectedEvidence.length}`
    : "--";
  const identity = projectAgentProfileIdentity(item.assignedAgentProfile);
  const agent = identity ? `[${operatorIdentityInitials(identity.label)}] ` : "";
  const attempt = item.latestAttemptStatus && item.latestAttemptMode
    ? ` ${item.latestAttemptMode.replace(/_/g, " ")}:${item.latestAttemptStatus}`
    : "";
  const paused = item.pendingPauseRequirementCount && item.pendingPauseRequirementCount > 0
    ? ` pause:${item.pendingPauseRequirementCount}`
    : "";
  const lines = [`${prefix}${agent}${item.status} ${evidence}${attempt}${paused} ${summary}`];
  if (item.authorityProfile) {
    lines.push(`  auth:${item.authorityProfile}`);
  }
  if (item.missingEvidence.length > 0) lines.push(`  missing:${item.missingEvidence.join(",")}`);
  if (item.missingGoalEvidence.length > 0) lines.push(`  missing-goal:${item.missingGoalEvidence.join(",")}`);
  if (item.missingVerificationGates.length > 0) lines.push(`  missing-gates:${item.missingVerificationGates.join(",")}`);
  if (item.failedVerificationGates.length > 0) lines.push(`  failed-gates:${item.failedVerificationGates.join(",")}`);
  if (item.missingResidualRisk) lines.push("  missing:residual-risk");
  if (item.resourceUri) {
    lines.push(`  res:${item.resourceUri}`);
  }
  return lines.join("\n");
}

/**
 * Renders governed work items in the sidebar.
 */
export function renderSidebarWork(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  if (state.workItems.length === 0) {
    ui.sidebarWorkText.content = t`${fg(theme.textMuted)("(none)")}`;
    return;
  }

  const items = [...state.workItems]
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 5);
  ui.sidebarWorkText.content = t`${fg(theme.text)(items.map(fmtWorkItem).join("\n"))}`;
}

/**
 * Renders managed child invocations in the sidebar using shared cockpit state.
 */
export function renderSidebarManagedAgents(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  const lines = formatManagedAgentCockpitLines(state.managedAgents);
  const color = state.managedAgents.attentionCount > 0 ? theme.warning : theme.textMuted;
  ui.sidebarManagedAgentsText.content = t`${fg(color)(lines.join("\n"))}`;
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
 * Renders the slash command popover.
 */
export function renderSlashPopover(
  state: ReactiveState,
  theme: KilnTheme,
  ui: import("./ui.js").UIComponents
): void {
  if (!state.slashPopoverOpen || state.slashCommands.length === 0) {
    ui.slashPopover.visible = false;
    ui.slashPopoverText.content = t`${fg(theme.text)("")}`;
    return;
  }

  ui.slashPopover.visible = true;
  const lines: string[] = [];
  const maxItems = Math.min(state.slashCommands.length, 6);

  for (let i = 0; i < maxItems; i++) {
    const cmd = state.slashCommands[i]!;
    const isSelected = i === state.slashCommandIndex;
    const prefix = isSelected ? "▶ " : "  ";
    const desc = cmd.description ? ` - ${cmd.description}` : "";
    lines.push(`${prefix}/${cmd.trigger}${desc}`);
  }

  ui.slashPopoverText.content = t`${fg(theme.text)(lines.join("\n"))}`;
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
