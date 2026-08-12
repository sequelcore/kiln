import { describe, expect, it, vi } from "vitest";
import {
  persistGuiProviderSelectionPreference,
  resolveGuiProviderSelectionPreference,
} from "./operator-provider-preferences.js";
import type { KilnGlobalConfig } from "../config/global-config.js";

const writeGlobalConfig = vi.hoisted(() => vi.fn());
const readGlobalConfig = vi.hoisted(() => vi.fn());

vi.mock("../config/global-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/global-config.js")>();
  return {
    ...actual,
    readGlobalConfig,
    writeGlobalConfig,
  };
});

describe("operator provider preferences", () => {
  it("resolves a trimmed GUI provider/model preference from global config", () => {
    const config: KilnGlobalConfig = {
      version: "1",
      ui: {
        providerSelection: {
          provider: " codex-oauth ",
          model: " gpt-5.5 ",
        },
      },
    };

    expect(resolveGuiProviderSelectionPreference(config)).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
    });
  });

  it("persists the accepted GUI provider/model selection in global config", () => {
    readGlobalConfig.mockReturnValue({
      version: "1",
      ui: {
        theme: "phosphor",
      },
    } satisfies KilnGlobalConfig);

    persistGuiProviderSelectionPreference("codex-oauth", "gpt-5.5");

    expect(writeGlobalConfig).toHaveBeenCalledWith({
      version: "1",
      ui: {
        theme: "phosphor",
        providerSelection: {
          provider: "codex-oauth",
          model: "gpt-5.5",
        },
      },
    });
  });
});
