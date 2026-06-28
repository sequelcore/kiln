import { describe, expect, it, vi } from "vitest";
import { createAppShellCommandExecutor } from "../src/components/app-shell-command-actions.js";

function createInput(overrides: Partial<Parameters<typeof createAppShellCommandExecutor>[0]> = {}) {
  return {
    closeComposerCommands: vi.fn(),
    closePalette: vi.fn(),
    startNewSession: vi.fn(),
    setPaletteMode: vi.fn(),
    setPaletteQuery: vi.fn(),
    setPaletteOpen: vi.fn(),
    setProviderPickerOpen: vi.fn(),
    reasoningEffortOptions: ["low", "medium", "high"] as const,
    resolvedReasoningEffort: "medium" as const,
    setReasoningEffort: vi.fn(),
    requestedAuthority: "auto" as const,
    setRequestedAuthority: vi.fn(),
    setSessionPopoverOpen: vi.fn(),
    setTargetedPlanMode: vi.fn(),
    setWorkbenchSurface: vi.fn(),
    setTheme: vi.fn(),
    persistThemePreference: vi.fn(),
    ...overrides,
  };
}

describe("createAppShellCommandExecutor", () => {
  it("starts a clean session for clear commands", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute({ id: "clear", label: "New session" });

    expect(input.closeComposerCommands).toHaveBeenCalledTimes(1);
    expect(input.startNewSession).toHaveBeenCalledTimes(1);
    expect(input.closePalette).toHaveBeenCalledTimes(1);
  });

  it("opens the nested theme command palette", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute({ id: "theme", label: "Theme" });

    expect(input.setPaletteMode).toHaveBeenCalledWith("theme");
    expect(input.setPaletteQuery).toHaveBeenCalledWith("");
    expect(input.setPaletteOpen).toHaveBeenCalledWith(true);
    expect(input.closePalette).not.toHaveBeenCalled();
  });

  it("cycles reasoning effort and requested authority", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute({ id: "effort", label: "Reasoning" });
    execute({ id: "authority", label: "Authority" });

    expect(input.setReasoningEffort).toHaveBeenCalledWith("high");
    expect(input.setRequestedAuthority).toHaveBeenCalledWith("read_only");
    expect(input.closePalette).toHaveBeenCalledTimes(2);
  });

  it("routes plan and setup commands to the correct workbench surfaces", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute({ id: "plan", label: "Plan mode" });
    execute({ id: "setup", label: "Setup" });

    expect(input.setTargetedPlanMode).toHaveBeenCalledWith(true);
    expect(input.setWorkbenchSurface).toHaveBeenNthCalledWith(1, "chat");
    expect(input.setWorkbenchSurface).toHaveBeenNthCalledWith(2, "setup");
  });

  it("applies recognized theme commands and ignores unknown command ids", () => {
    const input = createInput();
    const execute = createAppShellCommandExecutor(input);

    execute({ id: "theme:system-follow", label: "System" });
    execute({ id: "theme:unknown", label: "Unknown" });

    expect(input.setTheme).toHaveBeenCalledTimes(1);
    expect(input.setTheme).toHaveBeenCalledWith("system-follow");
    expect(input.persistThemePreference).toHaveBeenCalledWith("system-follow");
    expect(input.closePalette).toHaveBeenCalledTimes(2);
  });
});
