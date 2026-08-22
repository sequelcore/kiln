import { describe, expect, it } from "vitest";
import { isLocallyHandledTuiInput } from "../src/local-command-routing.js";

describe("TUI local command routing", () => {
  it("keeps settings queries out of model submissions", () => {
    expect(isLocallyHandledTuiInput("/settings")).toBe(true);
    expect(isLocallyHandledTuiInput("/settings permissions")).toBe(true);
    expect(isLocallyHandledTuiInput("/settingsx")).toBe(false);
    expect(isLocallyHandledTuiInput("explain settings")).toBe(false);
  });
});
