import { beforeEach, describe, expect, it } from "vitest";
import {
  persistCollapsedSessionGroupIds,
  readCollapsedSessionGroupIds,
} from "../src/lib/session-list-preferences.js";

describe("Session list preferences", () => {
  beforeEach(() => localStorage.clear());

  it("persists only admitted Session group identifiers", () => {
    persistCollapsedSessionGroupIds(new Set(["active", "older"]));
    expect([...readCollapsedSessionGroupIds()]).toEqual(["older"]);

    localStorage.setItem(
      "kiln.gui.sessionHistory.collapsedGroups:v1",
      JSON.stringify(["today", "obsolete-copy-label", 42]),
    );
    expect([...readCollapsedSessionGroupIds()]).toEqual(["today"]);
  });

  it("fails open when stored presentation state is malformed", () => {
    localStorage.setItem("kiln.gui.sessionHistory.collapsedGroups:v1", "not-json");
    expect([...readCollapsedSessionGroupIds()]).toEqual([]);
  });
});
