import { beforeEach, describe, expect, it } from "vitest";
import {
  persistOperatorTerminalHeightPreference,
  readOperatorTerminalHeightPreference,
  resolveGatewayHttpBaseUrl,
  toWsUrl,
} from "../src/components/app-shell-runtime.js";

describe("app shell runtime helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/gui/");
  });

  it("bounds and persists terminal panel height without restoring an open shell", () => {
    expect(readOperatorTerminalHeightPreference("C:/workspace/one")).toBe(280);

    persistOperatorTerminalHeightPreference("C:/workspace/one", 344);
    expect(readOperatorTerminalHeightPreference("C:/workspace/one")).toBe(344);
    expect(readOperatorTerminalHeightPreference("C:/workspace/two")).toBe(280);

    localStorage.setItem("kiln.gui.operatorTerminalHeight:C%3A%2Fworkspace%2Fone", "9999");
    expect(readOperatorTerminalHeightPreference("C:/workspace/one")).toBe(720);
  });

  it("resolves gateway URLs from the active browser location", () => {
    const expectedHttpBase = window.location.origin;
    const expectedWsBase = expectedHttpBase.replace(/^http/, "ws");

    expect(resolveGatewayHttpBaseUrl()).toBe(expectedHttpBase);
    expect(toWsUrl("/gui/ws")).toBe(`${expectedWsBase}/gui/ws`);

    window.history.replaceState(null, "", "/gui/#operatorToken=ephemeral-secret");
    expect(toWsUrl("/gui/ws")).toBe(`${expectedWsBase}/gui/ws?operatorToken=ephemeral-secret`);
  });
});
