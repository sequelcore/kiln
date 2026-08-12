import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/global-config.js", () => ({
  mutateGlobalConfig: vi.fn(),
  defaultGlobalConfig: () => ({
    version: "2",
    workerRouting: { defaultWorker: "claude", budgetAware: false },
    components: { include: ["baseline:core"] },
  }),
  resolveGlobalUiTheme: (config: { ui?: { theme?: string } } | null) => config?.ui?.theme,
}));

import { mutateGlobalConfig } from "../../src/config/global-config.js";
import {
  createCliOperatorThemeController,
  persistOperatorThemePreference,
  resolveGuiThemePreference,
} from "../../src/application/operator-theme-preferences.js";

const mutateGlobalConfigMock = mutateGlobalConfig as unknown as ReturnType<typeof vi.fn>;

describe("operator theme preferences", () => {
  beforeEach(() => {
    mutateGlobalConfigMock.mockReset();
  });

  it("resolves GUI theme preference from request, then GUI config, then TUI config", () => {
    expect(resolveGuiThemePreference("vesper", { version: "2", ui: { theme: "automata" } })).toBe("vesper");
    expect(resolveGuiThemePreference(undefined, { version: "2", ui: { theme: "automata" } })).toBe("automata");
    expect(resolveGuiThemePreference(undefined, null)).toBe("phosphor");
  });

  it("persists operator theme defaults into neutral UI config", () => {
    mutateGlobalConfigMock.mockImplementation((mutation) => ({
      config: mutation({ version: "2", ui: { theme: "phosphor" } }),
    }));

    persistOperatorThemePreference("vesper");

    expect(mutateGlobalConfigMock.mock.calls[0]?.[0]({ version: "2", ui: { theme: "phosphor" } })).toEqual({
      version: "2",
      ui: { theme: "vesper" },
    });
  });

  it("lets CLI operator theme tool persist defaults but rejects live session changes", async () => {
    mutateGlobalConfigMock.mockImplementation((mutation) => ({ config: mutation(null) }));
    const controller = createCliOperatorThemeController();

    await expect(controller.setTheme({ theme: "vesper", scope: "session" })).resolves.toEqual({
      ok: false,
      error: "The CLI has no live visual theme surface. Use scope='persisted' to update GUI and TUI defaults.",
    });
    await expect(controller.setTheme({ theme: "vesper", scope: "persisted" })).resolves.toEqual({
      ok: true,
      appliedTheme: "vesper",
    });
    expect(mutateGlobalConfigMock.mock.calls[0]?.[0](null)).toEqual({
      version: "2",
      workerRouting: { defaultWorker: "claude", budgetAware: false },
      components: { include: ["baseline:core"] },
      ui: { theme: "vesper" },
    });
  });
});
