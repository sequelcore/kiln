import type { OperatorEventTone } from "./operator-event-presentation.js";

export type ToolActionPhase = "running" | "success" | "error";

export interface ToolActivitySummaryInput {
  readonly toolName?: string;
  readonly tone: OperatorEventTone;
}

export interface ToolActivitySummary {
  readonly actionCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly label: string;
  readonly state: "running" | "completed" | "failed";
}

type ToolActivityCategory = "inspect" | "edit" | "research" | "command" | "other";

const INSPECTION_TOOLS = new Set([
  "find", "glob", "grep", "list", "read", "read_file", "read_many",
  "resource_read", "rg", "stat", "tree",
]);
const EDIT_TOOLS = new Set(["edit", "patch", "write"]);
const RESEARCH_TOOLS = new Set(["browser_navigate", "browser_observe", "search", "web_search"]);
const COMMAND_TOOLS = new Set(["bash", "shell", "shell_command"]);

function normalizeToolName(toolName: string): string {
  const namespacedSegment = toolName.toLowerCase().split(/[.:/]/u).at(-1);
  return namespacedSegment ?? toolName.toLowerCase();
}

function toolActivityCategory(toolName: string | undefined): ToolActivityCategory {
  if (!toolName) return "other";
  const normalized = normalizeToolName(toolName);
  if (INSPECTION_TOOLS.has(normalized)) return "inspect";
  if (EDIT_TOOLS.has(normalized)) return "edit";
  if (RESEARCH_TOOLS.has(normalized)) return "research";
  if (COMMAND_TOOLS.has(normalized)) return "command";
  return "other";
}

const TOOL_TITLE_OVERRIDES = new Map<string, readonly [string, string, string]>([
  ["bash", ["Running command", "Ran command", "Command failed"]],
  ["edit", ["Editing files", "Edited files", "File edit failed"]],
  ["glob", ["Finding files", "Found files", "File discovery failed"]],
  ["grep", ["Searching files", "Searched files", "File search failed"]],
  ["list", ["Listing files", "Listed files", "File listing failed"]],
  ["patch", ["Editing files", "Edited files", "File edit failed"]],
  ["read", ["Reading files", "Read files", "Failed to read files"]],
  ["read_file", ["Reading files", "Read files", "Failed to read files"]],
  ["read_many", ["Reading files", "Read files", "Failed to read files"]],
  ["resource_read", ["Reading files", "Read files", "Failed to read files"]],
  ["rg", ["Searching files", "Searched files", "File search failed"]],
  ["search", ["Searching the web", "Searched the web", "Web search failed"]],
  ["shell", ["Running command", "Ran command", "Command failed"]],
  ["shell_command", ["Running command", "Ran command", "Command failed"]],
  ["stat", ["Inspecting file", "Inspected file", "File inspection failed"]],
  ["tree", ["Mapping repository", "Mapped repository", "Repository mapping failed"]],
  ["web_search", ["Searching the web", "Searched the web", "Web search failed"]],
  ["write", ["Editing files", "Edited files", "File edit failed"]],
  ["browser_navigate", ["Opening page", "Opened page", "Page navigation failed"]],
  ["browser_observe", ["Inspecting page", "Inspected page", "Page inspection failed"]],
]);

export function presentToolActionTitle(toolName: string, phase: ToolActionPhase): string {
  const normalized = normalizeToolName(toolName);
  const titles = TOOL_TITLE_OVERRIDES.get(normalized);
  if (titles) return titles[phase === "running" ? 0 : phase === "success" ? 1 : 2];
  return phase === "running" ? `Using ${toolName}` : `${phase === "success" ? "Completed" : "Failed"} ${toolName}`;
}

function summaryLabel(category: ToolActivityCategory, state: ToolActivitySummary["state"]): string {
  if (category === "inspect") {
    return state === "running"
      ? "Inspecting repository"
      : state === "failed"
        ? "Repository inspection needs attention"
        : "Inspected repository";
  }
  if (category === "edit") {
    return state === "running" ? "Updating files" : state === "failed" ? "File updates need attention" : "Updated files";
  }
  if (category === "research") {
    return state === "running" ? "Researching" : state === "failed" ? "Research needs attention" : "Researched sources";
  }
  if (category === "command") {
    return state === "running" ? "Running commands" : state === "failed" ? "Commands need attention" : "Ran commands";
  }
  return state === "running" ? "Working" : state === "failed" ? "Actions need attention" : "Work completed";
}

export function projectToolActivitySummary(
  entries: readonly ToolActivitySummaryInput[],
): ToolActivitySummary {
  const categories = new Set(entries.map((entry) => toolActivityCategory(entry.toolName)));
  const category = categories.size === 1 ? [...categories][0] ?? "other" : "other";
  const running = entries.some((entry) => entry.tone === "running");
  const failedCount = entries.filter((entry) => entry.tone === "error").length;
  const state = running ? "running" : failedCount > 0 ? "failed" : "completed";
  return {
    actionCount: entries.length,
    completedCount: entries.filter((entry) => entry.tone === "success").length,
    failedCount,
    label: summaryLabel(category, state),
    state,
  };
}
