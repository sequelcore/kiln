import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen.js";
import "./styles.css";

// ── Pre-render theme guard (prevents flash of wrong theme) ──────────
// Reads persisted store synchronously before first paint so the correct
// data-theme attribute is set on <html> before CSS is applied.
(function applyPersistedTheme() {
  const urlTheme = new URLSearchParams(window.location.search).get("theme");
  try {
    if (urlTheme === "kiln-dark" || urlTheme === "kiln-light" || urlTheme === "system-follow") {
      localStorage.setItem("kiln.gui.ui", JSON.stringify({
        state: { theme: urlTheme },
        version: 0,
      }));
      document.documentElement.dataset.theme = urlTheme === "kiln-light"
        ? "light"
        : urlTheme === "kiln-dark"
          ? "dark"
          : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      return;
    }
    const raw = localStorage.getItem("kiln.gui.ui");
    if (!raw) {
      document.documentElement.dataset.theme = "dark";
      return;
    }
    const parsed = JSON.parse(raw) as { state?: { theme?: string } };
    const theme = parsed?.state?.theme;
    if (theme === "kiln-dark") {
      document.documentElement.dataset.theme = "dark";
    } else if (theme === "kiln-light") {
      document.documentElement.dataset.theme = "light";
    } else {
      // system-follow or unrecognised
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
    }
  } catch {
    // If localStorage read fails, default to kiln-dark
    document.documentElement.dataset.theme = "dark";
  }
})();

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
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
