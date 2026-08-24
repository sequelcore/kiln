import { DEFAULT_OPERATOR_APPEARANCE_PREFERENCE } from "@kilnai/operator-appearance";
import { afterEach, describe, expect, it } from "vitest";
import { useUiStore } from "../src/lib/ui-store.js";

describe("GUI appearance precedence", () => {
  afterEach(() => {
    useUiStore.getState().setAppearancePreference(DEFAULT_OPERATOR_APPEARANCE_PREFERENCE);
  });

  it("keeps a session override above a refreshed canonical snapshot", () => {
    useUiStore.getState().setTheme("vesper");
    useUiStore.getState().syncAppearancePreference({
      mode: "light",
      themeByScheme: { light: "automata", dark: "phosphor" },
    });

    expect(useUiStore.getState()).toMatchObject({
      theme: "vesper",
      sessionTheme: "vesper",
      preference: {
        mode: "light",
        themeByScheme: { light: "automata", dark: "phosphor" },
      },
    });
  });

  it("clears the session override after an explicit durable choice", () => {
    useUiStore.getState().setTheme("vesper");
    useUiStore.getState().setAppearancePreference({
      mode: "light",
      themeByScheme: { light: "automata", dark: "phosphor" },
    });

    expect(useUiStore.getState()).toMatchObject({ theme: "automata", sessionTheme: null });
  });
});
