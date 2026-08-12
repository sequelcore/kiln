import type {
  OperatorCommandDefinition,
  OperatorThemeName,
} from "@kilnai/gateway-contracts";
import type { CommandPaletteItem } from "./command-palette.js";
import type { MobileDrawerMode, WorkbenchSurface } from "./workbench-navigation.js";
import type { OperatorSurfaceKind } from "./operator-surface-tabs.js";

export function operatorCommandToPaletteItem(command: OperatorCommandDefinition): CommandPaletteItem {
  return {
    id: command.id,
    trigger: command.trigger,
    title: command.title,
    description: command.description,
    keywords: command.keywords,
  };
}

export function themeToPaletteItem(theme: OperatorThemeName, label: string): CommandPaletteItem {
  return {
    id: `theme:${theme}`,
    trigger: `theme ${theme}`,
    title: label,
    description: `Apply ${theme}.`,
    keywords: ["theme", theme, label.toLowerCase()],
  };
}

export function resolveActiveChatWorkspaceSurface(input: {
  readonly workbenchSurface: WorkbenchSurface;
  readonly activeSurface: OperatorSurfaceKind;
  readonly hasBrowserSession: boolean;
  readonly hasBrowserSnapshot: boolean;
}): "chat" | "browser" {
  return input.workbenchSurface === "chat"
    && input.activeSurface === "browser"
    && (input.hasBrowserSession || input.hasBrowserSnapshot)
    ? "browser"
    : "chat";
}

export function resolveWorkbenchTitle(surface: WorkbenchSurface, activeChatSurface: "chat" | "browser"): string {
  if (surface === "chat") {
    return activeChatSurface === "browser" ? "Browser" : "Chat";
  }
  if (surface === "work") return "Work";
  if (surface === "agents") return "Agents";
  if (surface === "activity") return "Activity";
  return "Memory";
}

export function resolveDrawerLabels(mode: MobileDrawerMode): {
  readonly title: string;
  readonly description: string;
  readonly ariaLabel: string;
  readonly closeLabel: string;
} {
  if (mode === "sessions") {
    return {
      title: "Sessions",
      description: "Session history and continuation targets.",
      ariaLabel: "Sessions drawer",
      closeLabel: "Close session drawer",
    };
  }
  return {
    title: "Inspector",
    description: "Workspace, changes, and approvals.",
    ariaLabel: "Inspector drawer",
    closeLabel: "Close inspector drawer",
  };
}
