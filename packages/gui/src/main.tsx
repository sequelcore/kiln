import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DEFAULT_OPERATOR_THEME_NAME,
  isOperatorThemeName,
  type OperatorThemeName,
} from "@kilnai/gateway-contracts";
import { routeTree } from "./routeTree.gen.js";
import { GuiErrorBoundary } from "./components/gui-error-boundary.js";
import { applyOperatorTheme } from "./lib/operator-theme-projection.js";
import { KILN_GUI_UI_STORAGE_KEY, KILN_GUI_UI_STORAGE_VERSION } from "./lib/ui-preferences.js";
import "./styles.css";

const KILN_LOGO_URL = new URL("../../../docs/assets/logo.svg", import.meta.url).href;

// ── Pre-render theme guard (prevents flash of wrong theme) ──────────
// Reads persisted store synchronously before first paint so the correct
// data-theme attribute is set on <html> before CSS is applied.
(function applyPersistedTheme() {
  const urlTheme = new URLSearchParams(window.location.search).get("theme");
  try {
    let theme: OperatorThemeName = DEFAULT_OPERATOR_THEME_NAME;
    if (isOperatorThemeName(urlTheme)) {
      theme = urlTheme;
      localStorage.setItem(KILN_GUI_UI_STORAGE_KEY, JSON.stringify({
        state: { theme },
        version: KILN_GUI_UI_STORAGE_VERSION,
      }));
    } else {
      const raw = localStorage.getItem(KILN_GUI_UI_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
        if (isOperatorThemeName(parsed.state?.theme)) {
          theme = parsed.state.theme;
        }
      }
    }
    applyOperatorTheme(theme, window.matchMedia("(prefers-color-scheme: dark)").matches);
  } catch {
    applyOperatorTheme(DEFAULT_OPERATOR_THEME_NAME, true);
  }
})();

function applyKilnWindowIcon(): void {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const icon = existing ?? document.createElement("link");
  icon.rel = "icon";
  icon.type = "image/svg+xml";
  icon.href = KILN_LOGO_URL;
  if (!existing) {
    document.head.appendChild(icon);
  }

  const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    ?? document.createElement("link");
  appleIcon.rel = "apple-touch-icon";
  appleIcon.href = KILN_LOGO_URL;
  if (!appleIcon.parentElement) {
    document.head.appendChild(appleIcon);
  }
}

applyKilnWindowIcon();

const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  basepath: "/gui",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("GUI root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <GuiErrorBoundary>
        <RouterProvider router={router} />
      </GuiErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
