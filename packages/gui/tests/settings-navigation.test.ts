import { describe, expect, it } from "vitest";
import { resolveSettingsSection, SETTINGS_PATHS, SETTINGS_SECTIONS } from "../src/components/settings-navigation.js";

describe("settings navigation", () => {
  it("owns the exact admitted settings presentation catalog and routes", () => {
    expect(SETTINGS_SECTIONS.map(({ id, path, label }) => ({ id, path, label }))).toEqual([
      { id: "general", path: "/settings/general", label: "General" },
      { id: "appearance", path: "/settings/appearance", label: "Appearance" },
      { id: "providers", path: "/settings/providers", label: "Providers" },
      { id: "models", path: "/settings/models", label: "Models" },
      { id: "permissions", path: "/settings/permissions", label: "Permissions" },
      { id: "tools", path: "/settings/tools", label: "Tools" },
      { id: "usage-and-limits", path: "/settings/usage-and-limits", label: "Usage & limits" },
      { id: "agents", path: "/settings/agents", label: "Agents" },
      { id: "health", path: "/settings/health", label: "Health" },
      { id: "advanced", path: "/settings/advanced", label: "Advanced" },
    ]);
    expect(SETTINGS_PATHS).toEqual({
      general: "/settings/general",
      appearance: "/settings/appearance",
      providers: "/settings/providers",
      models: "/settings/models",
      permissions: "/settings/permissions",
      tools: "/settings/tools",
      "usage-and-limits": "/settings/usage-and-limits",
      agents: "/settings/agents",
      health: "/settings/health",
      advanced: "/settings/advanced",
    });

    for (const section of SETTINGS_SECTIONS) {
      expect(section.description.length).toBeGreaterThan(0);
      expect(section.aliases.length).toBeGreaterThan(0);
      expect(section.icon).toBeTypeOf("object");
      expect(resolveSettingsSection(section.path)).toBe(section.id);
    }
  });

  it("rejects legacy and unknown settings routes without aliases", () => {
    expect(resolveSettingsSection("/settings/appearance")).toBe("appearance");
    expect(resolveSettingsSection("/settings/configuration")).toBeNull();
    expect(resolveSettingsSection("/settings/available-models")).toBeNull();
    expect(resolveSettingsSection("/settings/general/extra")).toBeNull();
    expect(resolveSettingsSection("/")).toBeNull();
    expect(resolveSettingsSection("/settings/unknown")).toBeNull();
  });
});
