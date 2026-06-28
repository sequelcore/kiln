import {
  OPERATOR_THEME_NAMES,
  type GuiProviderReasoningEffort,
  type OperatorThemeName,
} from "@kilnai/gateway-contracts";
import type { CommandPaletteItem } from "./command-palette.js";
import type { RequestableTurnAuthority } from "./app-shell-controls.js";
import { TURN_AUTHORITY_OPTIONS } from "./app-shell-controls.js";
import type { WorkbenchSurface } from "./workbench-navigation.js";

interface AppShellCommandExecutorInput {
  readonly closeComposerCommands: () => void;
  readonly closePalette: () => void;
  readonly startNewSession: () => void;
  readonly setPaletteMode: (mode: "root" | "theme") => void;
  readonly setPaletteQuery: (query: string) => void;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly setProviderPickerOpen: (open: boolean) => void;
  readonly reasoningEffortOptions: readonly GuiProviderReasoningEffort[];
  readonly resolvedReasoningEffort: GuiProviderReasoningEffort | null;
  readonly setReasoningEffort: (effort: GuiProviderReasoningEffort) => void;
  readonly requestedAuthority: RequestableTurnAuthority;
  readonly setRequestedAuthority: (authority: RequestableTurnAuthority) => void;
  readonly setSessionPopoverOpen: (open: boolean) => void;
  readonly setTargetedPlanMode: (enabled: boolean) => void;
  readonly setWorkbenchSurface: (surface: WorkbenchSurface) => void;
  readonly setTheme: (theme: OperatorThemeName) => void;
  readonly persistThemePreference: (theme: OperatorThemeName) => void;
}

function nextFromCycle<T>(items: readonly T[], current: T | null): T | null {
  if (items.length === 0) {
    return null;
  }
  const currentIndex = current === null ? -1 : items.indexOf(current);
  return items[(currentIndex + 1) % items.length] ?? null;
}

function isThemeCommand(command: CommandPaletteItem): command is CommandPaletteItem & { id: `theme:${OperatorThemeName}` } {
  if (!command.id.startsWith("theme:")) {
    return false;
  }
  const theme = command.id.slice("theme:".length);
  return (OPERATOR_THEME_NAMES as readonly string[]).includes(theme);
}

export function createAppShellCommandExecutor(input: AppShellCommandExecutorInput) {
  return (command: CommandPaletteItem): void => {
    input.closeComposerCommands();
    switch (command.id) {
      case "clear":
        input.startNewSession();
        input.closePalette();
        return;
      case "theme":
        input.setPaletteMode("theme");
        input.setPaletteQuery("");
        input.setPaletteOpen(true);
        return;
      case "provider":
        input.setProviderPickerOpen(true);
        input.closePalette();
        return;
      case "effort": {
        const next = nextFromCycle(input.reasoningEffortOptions, input.resolvedReasoningEffort);
        if (next) {
          input.setReasoningEffort(next);
        }
        input.closePalette();
        return;
      }
      case "authority": {
        const next = nextFromCycle(TURN_AUTHORITY_OPTIONS, input.requestedAuthority);
        if (next) {
          input.setRequestedAuthority(next);
        }
        input.closePalette();
        return;
      }
      case "continue":
        input.setSessionPopoverOpen(true);
        input.closePalette();
        return;
      case "plan":
        input.setTargetedPlanMode(true);
        input.setWorkbenchSurface("chat");
        input.closePalette();
        return;
      case "exec":
        input.setTargetedPlanMode(false);
        input.setWorkbenchSurface("chat");
        input.closePalette();
        return;
      case "setup":
        input.setWorkbenchSurface("setup");
        input.closePalette();
        return;
      case "goal":
        input.setWorkbenchSurface("work");
        input.closePalette();
        return;
      default:
        if (isThemeCommand(command)) {
          const theme = command.id.slice("theme:".length) as OperatorThemeName;
          input.setTheme(theme);
          input.persistThemePreference(theme);
        }
        input.closePalette();
    }
  };
}
