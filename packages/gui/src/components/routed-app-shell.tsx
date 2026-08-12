import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { AppShell } from "./app-shell.js";
import { resolveSettingsSection, SETTINGS_PATHS, type SettingsSection } from "./settings-navigation.js";

export function RoutedAppShell() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const settingsSection = resolveSettingsSection(pathname);
  const openSettings = useCallback((section: SettingsSection) => {
    void navigate({ to: SETTINGS_PATHS[section] });
  }, [navigate]);
  const closeSettings = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);

  return (
    <AppShell
      settingsSection={settingsSection}
      onOpenSettings={openSettings}
      onCloseSettings={closeSettings}
    />
  );
}
