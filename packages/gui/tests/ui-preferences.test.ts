import { describe, expect, it } from "vitest";
import { readGuiLaunchTheme } from "../src/lib/ui-preferences.js";

describe("GUI launch appearance", () => {
  it("admits only an explicit built-in session override", () => {
    expect(readGuiLaunchTheme("?theme=vesper")).toBe("vesper");
    expect(readGuiLaunchTheme("?theme=unknown")).toBeNull();
    expect(readGuiLaunchTheme("")).toBeNull();
  });
});
