import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  persistSidebarCollapsedPreference,
  persistSidebarWidthPreference,
  readSidebarCollapsedPreference,
  readSidebarWidthPreference,
} from "../src/components/sidebar-layout.js";

describe("sidebar layout preferences", () => {
  beforeEach(() => localStorage.clear());

  it("persists collapsed state independently from the shell", () => {
    expect(readSidebarCollapsedPreference()).toBe(false);

    persistSidebarCollapsedPreference(true);
    expect(readSidebarCollapsedPreference()).toBe(true);

    persistSidebarCollapsedPreference(false);
    expect(readSidebarCollapsedPreference()).toBe(false);
  });

  it("bounds and persists expanded width", () => {
    expect(readSidebarWidthPreference()).toBe(DEFAULT_SIDEBAR_WIDTH);

    persistSidebarWidthPreference(336);
    expect(readSidebarWidthPreference()).toBe(336);

    localStorage.setItem("kiln.gui.sidebarWidth", "1");
    expect(readSidebarWidthPreference()).toBe(MIN_SIDEBAR_WIDTH);
    localStorage.setItem("kiln.gui.sidebarWidth", "9999");
    expect(readSidebarWidthPreference()).toBe(MAX_SIDEBAR_WIDTH);
  });
});
