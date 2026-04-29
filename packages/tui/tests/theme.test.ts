import { describe, expect, it } from "vitest";
import { OPERATOR_THEME_NAMES } from "@kilnai/gateway-contracts";
import { themeNames, themes } from "../src/theme.js";

describe("TUI themes", () => {
  it("uses the shared operator theme catalog", () => {
    expect(themeNames()).toEqual([...OPERATOR_THEME_NAMES]);
    for (const name of OPERATOR_THEME_NAMES) {
      expect(themes[name]).toBeDefined();
    }
  });
});
