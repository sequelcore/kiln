import { beforeEach, describe, expect, it } from "vitest";
import {
  readOperatorToken,
  resolveGatewayHttpBaseUrl,
  toWsUrl,
} from "../src/components/app-shell-runtime.js";

describe("app shell runtime helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/gui/");
  });

  it("resolves gateway URLs from the active browser location", () => {
    const expectedHttpBase = window.location.origin;
    const expectedWsBase = expectedHttpBase.replace(/^http/, "ws");

    expect(resolveGatewayHttpBaseUrl()).toBe(expectedHttpBase);
    expect(readOperatorToken()).toBeUndefined();
    expect(toWsUrl("/gui/ws")).toBe(`${expectedWsBase}/gui/ws`);

    window.history.replaceState(null, "", "/gui/#operatorToken=ephemeral-secret");
    expect(readOperatorToken()).toBe("ephemeral-secret");
    expect(toWsUrl("/gui/ws")).toBe(`${expectedWsBase}/gui/ws?operatorToken=ephemeral-secret`);
  });
});
