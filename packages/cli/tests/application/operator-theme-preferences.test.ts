import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: vi.fn(),
  writeGlobalConfig: vi.fn(),
}));

import { readGlobalConfig, writeGlobalConfig } from "../../src/config/global-config.js";
import {
  createCliOperatorThemeController,
  persistOperatorThemePreference,
  resolveGuiThemePreference,
} from "../../src/application/operator-theme-preferences.js";

const readGlobalConfigMock = readGlobalConfig as unknown as ReturnType<typeof vi.fn>;
const writeGlobalConfigMock = writeGlobalConfig as unknown as ReturnType<typeof vi.fn>;

describe("operator theme preferences", () => {
  beforeEach(() => {
    readGlobalConfigMock.mockReset();
    writeGlobalConfigMock.mockReset();
  });

  it("resolves GUI theme preference from request, then GUI config, then TUI config", () => {
    expect(resolveGuiThemePreference("dracula", { gui: { theme: "night-owl" } })).toBe("dracula");
    expect(resolveGuiThemePreference(undefined, { gui: { theme: "night-owl" }, tui: { theme: "dracula" } })).toBe("night-owl");
    expect(resolveGuiThemePreference(undefined, { tui: { theme: "dracula" } })).toBe("dracula");
    expect(resolveGuiThemePreference(undefined, null)).toBe("kiln-dark");
  });

  it("persists operator theme defaults for both GUI and TUI surfaces", () => {
    readGlobalConfigMock.mockReturnValue({ version: "1", gui: { theme: "kiln-dark" } });

    persistOperatorThemePreference("night-owl");

    expect(writeGlobalConfigMock).toHaveBeenCalledWith({
      version: "1",
      gui: { theme: "night-owl" },
      tui: { theme: "night-owl" },
    });
  });

  it("lets CLI operator theme tool persist defaults but rejects live session changes", async () => {
    readGlobalConfigMock.mockReturnValue({});
    const controller = createCliOperatorThemeController();

    await expect(controller.setTheme({ theme: "dracula", scope: "session" })).resolves.toEqual({
      ok: false,
      error: "The CLI has no live visual theme surface. Use scope='persisted' to update GUI and TUI defaults.",
    });
    await expect(controller.setTheme({ theme: "dracula", scope: "persisted" })).resolves.toEqual({
      ok: true,
      appliedTheme: "dracula",
    });
    expect(writeGlobalConfigMock).toHaveBeenCalledWith({
      gui: { theme: "dracula" },
      tui: { theme: "dracula" },
    });
  });
});
