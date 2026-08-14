export type SettingsSection = "appearance" | "configuration" | "available-models";

export const SETTINGS_PATHS: Readonly<Record<SettingsSection, string>> = {
  appearance: "/settings/appearance",
  configuration: "/settings/configuration",
  "available-models": "/settings/available-models",
};

export function resolveSettingsSection(pathname: string): SettingsSection | null {
  if (pathname === SETTINGS_PATHS.appearance) return "appearance";
  if (pathname === SETTINGS_PATHS.configuration) return "configuration";
  if (pathname === SETTINGS_PATHS["available-models"]) return "available-models";
  return null;
}
