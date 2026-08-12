import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

let mountCount = 0;

vi.mock("../src/components/app-shell.js", () => ({
  AppShell: (props: {
    readonly settingsSection: "appearance" | "configuration" | null;
    readonly onOpenSettings: (section: "appearance" | "configuration") => void;
    readonly onCloseSettings: () => void;
  }) => {
    const [instance] = useState(() => ++mountCount);
    return (
      <div>
        <p>Shell instance {instance}</p>
        <p>Section {props.settingsSection ?? "workbench"}</p>
        <button type="button" onClick={() => props.onOpenSettings("configuration")}>Open configuration</button>
        <button type="button" onClick={() => props.onOpenSettings("appearance")}>Open appearance</button>
        <button type="button" onClick={props.onCloseSettings}>Close settings</button>
      </div>
    );
  },
}));

import { routeTree } from "../src/routeTree.gen.js";

describe("routed application shell", () => {
  it("keeps one shell instance mounted while settings routes change", async () => {
    mountCount = 0;
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createRouter({ routeTree, history });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("Section workbench")).toBeVisible();
    expect(screen.getByText("Shell instance 1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open configuration" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/configuration"));
    expect(screen.getByText("Section configuration")).toBeVisible();
    expect(screen.getByText("Shell instance 1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open appearance" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/appearance"));
    expect(screen.getByText("Section appearance")).toBeVisible();
    expect(screen.getByText("Shell instance 1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(screen.getByText("Section workbench")).toBeVisible();
    expect(mountCount).toBe(1);
  });

  it("redirects the settings index to the first real section", async () => {
    mountCount = 0;
    const history = createMemoryHistory({ initialEntries: ["/settings"] });
    const router = createRouter({ routeTree, history });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/configuration"));
    expect(await screen.findByText("Section configuration")).toBeVisible();
  });
});
