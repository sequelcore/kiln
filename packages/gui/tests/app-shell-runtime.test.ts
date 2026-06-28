import { beforeEach, describe, expect, it } from "vitest";
import {
  persistSidebarCollapsedPreference,
  readSidebarCollapsedPreference,
  resolveGatewayHttpBaseUrl,
  toWsUrl,
} from "../src/components/app-shell-runtime.js";

describe("app shell runtime helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/gui/");
  });

  it("persists the sidebar collapsed preference without coupling it to AppShell", () => {
    expect(readSidebarCollapsedPreference()).toBe(false);

    persistSidebarCollapsedPreference(true);
    expect(readSidebarCollapsedPreference()).toBe(true);

    persistSidebarCollapsedPreference(false);
    expect(readSidebarCollapsedPreference()).toBe(false);
  });

  it("resolves gateway URLs from the active browser location", () => {
    const expectedHttpBase = window.location.origin;
    const expectedWsBase = expectedHttpBase.replace(/^http/, "ws");

    expect(resolveGatewayHttpBaseUrl()).toBe(expectedHttpBase);
    expect(toWsUrl("/gui/ws")).toBe(`${expectedWsBase}/gui/ws`);
  });
});
