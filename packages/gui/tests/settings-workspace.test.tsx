import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsWorkspace } from "../src/components/settings-workspace.js";

describe("SettingsWorkspace", () => {
  it("provides contextual settings navigation and a workbench return action", () => {
    const onSelectSection = vi.fn();
    const onBack = vi.fn();

    render(
      <SettingsWorkspace
        section="configuration"
        onSelectSection={onSelectSection}
        onBack={onBack}
        appearance={<div>Appearance controls</div>}
        configuration={<div>Configuration health</div>}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Configuration health")).toBeVisible();
    expect(screen.queryByText("Appearance controls")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(within(screen.getByRole("complementary", { name: "Settings sidebar" })).getByRole("button", { name: "Back to workbench" }));

    expect(onSelectSection).toHaveBeenCalledWith("appearance");
    expect(onBack).toHaveBeenCalledOnce();
  });
});
