import { describe, expect, it } from "vitest";
import { resolveSettingsSection, SETTINGS_PATHS } from "../src/components/settings-navigation.js";

describe("settings navigation", () => {
  it("maps only admitted settings routes to sections", () => {
    expect(SETTINGS_PATHS).toEqual({
      appearance: "/settings/appearance",
      configuration: "/settings/configuration",
      "available-models": "/settings/available-models",
    });
    expect(resolveSettingsSection("/settings/appearance")).toBe("appearance");
    expect(resolveSettingsSection("/settings/configuration")).toBe("configuration");
    expect(resolveSettingsSection("/settings/available-models")).toBe("available-models");
    expect(resolveSettingsSection("/")).toBeNull();
    expect(resolveSettingsSection("/settings/unknown")).toBeNull();
  });
});
