import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SettingsSection } from "../src/components/settings-navigation.js";

let mountCount = 0;

vi.mock("../src/components/app-shell.js", () => ({
  AppShell: (props: {
    readonly settingsSection: SettingsSection | null;
    readonly onOpenSettings: (section: SettingsSection) => void;
    readonly onCloseSettings: () => void;
  }) => {
    const [instance] = useState(() => ++mountCount);
    return (
      <div>
        <p>Shell instance {instance}</p>
        <p>Section {props.settingsSection ?? "workbench"}</p>
        <button type="button" onClick={() => props.onOpenSettings("providers")}>
          Open providers
        </button>
        <button type="button" onClick={() => props.onOpenSettings("models")}>
          Open models
        </button>
        <button type="button" onClick={props.onCloseSettings}>
          Close settings
        </button>
      </div>
    );
  },
}));

import { routeTree } from "../src/routeTree.gen.js";

function routePath(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || !("options" in value)) return undefined;
  const options = value.options;
  if (options === null || typeof options !== "object" || !("path" in options)) return undefined;
  return typeof options.path === "string" ? options.path : undefined;
}

function routeChildren(value: unknown): readonly unknown[] {
  if (value === null || typeof value !== "object" || !("children" in value)) return [];
  const children = value.children;
  return children !== null && typeof children === "object" ? Object.values(children) : [];
}

describe("routed application shell", () => {
  it("generates only the replacement settings routes", () => {
    const settingsRoute = routeChildren(routeTree).find((route) => routePath(route) === "/settings");
    expect(routeChildren(settingsRoute).map(routePath)).toEqual([
      "/advanced",
      "/agents",
      "/appearance",
      "/general",
      "/health",
      "/models",
      "/permissions",
      "/providers",
      "/tools",
      "/usage-and-limits",
    ]);
  });

  it("keeps one shell instance mounted while replacement settings routes change", async () => {
    mountCount = 0;
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createRouter({ routeTree, history });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("Section workbench")).toBeVisible();
    expect(screen.getByText("Shell instance 1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open providers" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/providers"));
    expect(screen.getByText("Section providers")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open models" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/models"));
    expect(screen.getByText("Section models")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(screen.getByText("Section workbench")).toBeVisible();
    expect(mountCount).toBe(1);
  });

  it("redirects the settings index to general", async () => {
    mountCount = 0;
    const history = createMemoryHistory({ initialEntries: ["/settings"] });
    const router = createRouter({ routeTree, history });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/general"));
    expect(await screen.findByText("Section general")).toBeVisible();
  });
});
