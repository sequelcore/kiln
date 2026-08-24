import { describe, expect, it, vi } from "vitest";
import { createAppShellCommandExecutor } from "../src/components/app-shell-command-actions.js";
import type { CommandPaletteItem } from "../src/components/command-palette.js";

function command(id: string, title: string): CommandPaletteItem {
  return {
    id,
    trigger: title.toLowerCase(),
    title,
  };
}

function createInput(overrides: Partial<Parameters<typeof createAppShellCommandExecutor>[0]> = {}) {
  return {
    closeComposerCommands: vi.fn(),
    closePalette: vi.fn(),
    startNewSession: vi.fn(),
    setPaletteMode: vi.fn(),
    setPaletteQuery: vi.fn(),
    setPaletteOpen: vi.fn(),
    openExecutionRoutePicker: vi.fn(),
    openConfigurationSettings: vi.fn(),
    deliberationLevelOptions: ["low", "medium", "high"] as const,
    selectedDeliberationLevel: "medium" as const,
    setDeliberationLevel: vi.fn(),
    requestedAuthority: "auto" as const,
    setRequestedAuthority: vi.fn(),
    setSessionPopoverOpen: vi.fn(),
    setTargetedPlanMode: vi.fn(),
    setWorkbenchSurface: vi.fn(),
    persistThemePreference: vi.fn(async () => {}),
    onThemePersistenceFailed: vi.fn(),
    ...overrides,
  };
}

describe("createAppShellCommandExecutor", () => {
  it("starts a clean session for clear commands", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute(command("clear", "New session"));

    expect(input.closeComposerCommands).toHaveBeenCalledTimes(1);
    expect(input.startNewSession).toHaveBeenCalledTimes(1);
    expect(input.closePalette).toHaveBeenCalledTimes(1);
  });

  it("opens the nested theme command palette", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute(command("theme", "Theme"));

    expect(input.setPaletteMode).toHaveBeenCalledWith("theme");
    expect(input.setPaletteQuery).toHaveBeenCalledWith("");
    expect(input.setPaletteOpen).toHaveBeenCalledWith(true);
    expect(input.closePalette).not.toHaveBeenCalled();
  });

  it("cycles deliberation level and requested authority", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute(command("deliberation", "Deliberation"));
    execute(command("authority", "Authority"));

    expect(input.setDeliberationLevel).toHaveBeenCalledWith("high");
    expect(input.setRequestedAuthority).toHaveBeenCalledWith("read_only");
    expect(input.closePalette).toHaveBeenCalledTimes(2);
  });

  it("opens execution-route selection through its canonical mount-aware action", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute(command("target", "Execution target"));

    expect(input.openExecutionRoutePicker).toHaveBeenCalledOnce();
    expect(input.closePalette).toHaveBeenCalledOnce();
  });

  it("routes plan to chat and setup to configuration settings", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute(command("plan", "Plan mode"));
    execute(command("setup", "Setup"));

    expect(input.setTargetedPlanMode).toHaveBeenCalledWith(true);
    expect(input.setWorkbenchSurface).toHaveBeenNthCalledWith(1, "chat");
    expect(input.openConfigurationSettings).toHaveBeenCalledOnce();
  });

  it("applies recognized theme commands and ignores unknown command ids", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute(command("theme:system-follow", "System"));
    execute(command("theme:unknown", "Unknown"));

    expect(input.persistThemePreference).toHaveBeenCalledWith("system-follow");
    expect(input.closePalette).toHaveBeenCalledTimes(2);
  });
});
