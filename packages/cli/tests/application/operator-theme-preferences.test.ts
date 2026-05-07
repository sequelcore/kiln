import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: vi.fn(),
  writeGlobalConfig: vi.fn(),
  defaultGlobalConfig: () => ({
    version: "1",
    routing: { defaultWorker: "claude", budgetAware: false },
    components: { include: ["baseline:core"] },
  }),
  resolveGlobalUiTheme: (config: { ui?: { theme?: string } } | null) => config?.ui?.theme,
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
    expect(resolveGuiThemePreference("dracula", { version: "1", ui: { theme: "night-owl" } })).toBe("dracula");
    expect(resolveGuiThemePreference(undefined, { version: "1", ui: { theme: "night-owl" } })).toBe("night-owl");
    expect(resolveGuiThemePreference(undefined, null)).toBe("kiln-dark");
  });

  it("persists operator theme defaults into neutral UI config", () => {
    readGlobalConfigMock.mockReturnValue({ version: "1", ui: { theme: "kiln-dark" } });

    persistOperatorThemePreference("night-owl");

    expect(writeGlobalConfigMock).toHaveBeenCalledWith({
      version: "1",
      ui: { theme: "night-owl" },
    });
  });

  it("lets CLI operator theme tool persist defaults but rejects live session changes", async () => {
    readGlobalConfigMock.mockReturnValue(null);
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
      version: "1",
      routing: { defaultWorker: "claude", budgetAware: false },
      components: { include: ["baseline:core"] },
      ui: { theme: "dracula" },
    });
  });
});
