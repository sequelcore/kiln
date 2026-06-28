import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  InspectorRail,
  MobileWorkbenchDrawer,
  WorkbenchBody,
  WorkbenchChrome,
  WorkbenchMain,
} from "../src/components/workbench-chrome.js";

describe("WorkbenchChrome", () => {
  it("composes the application chrome without forcing overlays into the flex body", () => {
    render(
      <WorkbenchChrome>
        <div role="status">Global overlay</div>
        <WorkbenchBody>
          <WorkbenchMain>Main workbench</WorkbenchMain>
          <InspectorRail>Inspector</InspectorRail>
        </WorkbenchBody>
      </WorkbenchChrome>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Global overlay");
    expect(screen.getByRole("main")).toHaveClass("min-w-0");
    expect(screen.getByText("Inspector").closest("aside")).toHaveClass("xl:flex");
  });

  it("renders the mobile drawer as an accessible Base UI dialog", async () => {
    const onOpenChange = vi.fn();
    render(
      <MobileWorkbenchDrawer
        open
        title="Sessions"
        description="Session history and continuation targets."
        ariaLabel="Sessions drawer"
        closeLabel="Close session drawer"
        onOpenChange={onOpenChange}
      >
        <div>Session list</div>
      </MobileWorkbenchDrawer>,
    );

    const drawer = screen.getByRole("dialog", { name: "Sessions drawer" });
    expect(drawer).toHaveTextContent("Session list");
    expect(drawer).toHaveTextContent("Session history and continuation targets.");

    fireEvent.click(screen.getByRole("button", { name: "Close session drawer" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalled();
    });
  });
});
