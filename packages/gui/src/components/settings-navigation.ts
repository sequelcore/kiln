export type SettingsSection = "appearance" | "configuration";

export const SETTINGS_PATHS: Readonly<Record<SettingsSection, string>> = {
  appearance: "/settings/appearance",
  configuration: "/settings/configuration",
};

export function resolveSettingsSection(pathname: string): SettingsSection | null {
  if (pathname === SETTINGS_PATHS.appearance) return "appearance";
  if (pathname === SETTINGS_PATHS.configuration) return "configuration";
  return null;
}
