import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KilnSettingsEntry } from "@kilnai/gateway-contracts";
import { SettingsWorkspace } from "../src/components/settings-workspace.js";

function desktopMatchMedia(query: string): MediaQueryList {
  return {
    matches: query === "(min-width: 1024px)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

function narrowMatchMedia(query: string): MediaQueryList {
  return { ...desktopMatchMedia(query), matches: false };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsWorkspace", () => {
  it("renders semantic navigation, current page, Back, and one content outlet", () => {
    vi.stubGlobal("matchMedia", desktopMatchMedia);
    const onSelectSection = vi.fn();
    const onBack = vi.fn();

    render(
      <SettingsWorkspace section="permissions" onSelectSection={onSelectSection} onBack={onBack}>
        <div>Permission settings content</div>
      </SettingsWorkspace>,
    );

    const navigation = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(navigation).getByRole("button", { name: /Permissions/ })).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getAllByRole("button")).toHaveLength(10);
    expect(screen.getByText("Permission settings content")).toBeVisible();

    fireEvent.click(within(navigation).getByRole("button", { name: /Tools/ }));
    fireEvent.click(
      within(screen.getByRole("complementary", { name: "Settings sidebar" })).getByRole("button", {
        name: "Back to workbench",
      }),
    );

    expect(onSelectSection).toHaveBeenCalledWith("tools");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("focuses search with slash and selects keyboard results", () => {
    vi.stubGlobal("matchMedia", desktopMatchMedia);
    const onSelectSection = vi.fn();
    const onSearchResultSelect = vi.fn();

    render(
      <SettingsWorkspace
        section="general"
        onSelectSection={onSelectSection}
        onSearchResultSelect={onSearchResultSelect}
        onBack={vi.fn()}
      >
        <div>General settings content</div>
      </SettingsWorkspace>,
    );

    const search = screen.getByRole("combobox", { name: "Search settings" });
    fireEvent.keyDown(document, { key: "/" });
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: "model catalog" } });
    expect(screen.getByRole("listbox", { name: "Settings search results" })).toBeVisible();
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onSelectSection).toHaveBeenCalledWith("models");
    expect(onSearchResultSelect).toHaveBeenCalledWith({ section: "models" });
  });

  it("does not capture slash from editable or dialog focus and announces empty results", () => {
    vi.stubGlobal("matchMedia", desktopMatchMedia);

    render(
      <>
        <input aria-label="External editor" />
        <div role="dialog" aria-label="Open dialog">
          <button type="button">Dialog action</button>
        </div>
        <SettingsWorkspace section="general" onSelectSection={vi.fn()} onBack={vi.fn()}>
          <div>General settings content</div>
        </SettingsWorkspace>
      </>,
    );

    const search = screen.getByRole("combobox", { name: "Search settings" });
    const editor = screen.getByRole("textbox", { name: "External editor" });
    editor.focus();
    fireEvent.keyDown(document, { key: "/" });
    expect(editor).toHaveFocus();
    expect(search).not.toHaveFocus();

    const dialogAction = screen.getByRole("button", { name: "Dialog action" });
    dialogAction.focus();
    fireEvent.keyDown(document, { key: "/" });
    expect(dialogAction).toHaveFocus();

    fireEvent.change(search, { target: { value: "no-such-setting" } });
    expect(screen.getByRole("status")).toHaveTextContent("No settings sections found");
  });

  it("searches shared setting entries and returns an exact focus target", () => {
    vi.stubGlobal("matchMedia", desktopMatchMedia);
    const onSelectSection = vi.fn();
    const onSearchResultSelect = vi.fn();
    const entry = {
      key: "parallelWorkers",
      identity: "/parallelWorkers",
      section: "usage-and-limits",
      label: "Parallel workers",
      description: "Maximum concurrent managed workers.",
      searchTerms: ["concurrency"],
    } as KilnSettingsEntry;

    render(
      <SettingsWorkspace
        section="general"
        entries={[entry]}
        onSelectSection={onSelectSection}
        onSearchResultSelect={onSearchResultSelect}
        onBack={vi.fn()}
      >
        <div>General settings content</div>
      </SettingsWorkspace>,
    );

    const search = screen.getByRole("combobox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "parallelWorkers" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onSelectSection).toHaveBeenCalledWith("usage-and-limits");
    expect(onSearchResultSelect).toHaveBeenCalledWith({
      section: "usage-and-limits",
      targetId: "setting-parallelWorkers",
    });
  });

  it("keeps search visible and selects categories in the narrow layout", async () => {
    vi.stubGlobal("matchMedia", narrowMatchMedia);
    const onSelectSection = vi.fn();

    render(
      <SettingsWorkspace section="general" onSelectSection={onSelectSection} onBack={vi.fn()}>
        <div>General settings content</div>
      </SettingsWorkspace>,
    );

    expect(screen.getByRole("combobox", { name: "Search settings" })).toBeVisible();
    const category = screen.getByRole("combobox", { name: "Settings category" });
    fireEvent.click(category);
    const tools = await screen.findByRole("option", { name: "Tools" });
    fireEvent.mouseMove(tools);
    fireEvent.click(tools);

    expect(onSelectSection).toHaveBeenCalledWith("tools");
  });
});
