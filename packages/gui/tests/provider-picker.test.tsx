import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProviderPicker } from "../src/components/provider-picker.js";
import type { ProviderDescriptor } from "../src/lib/session-store.js";

const baseProviders: ProviderDescriptor[] = [
  {
    id: "claude",
    label: "Claude",
    group: "harness",
    free: false,
    available: true,
    models: ["claude-sonnet-4-6", "claude-opus-4-6"],
  },
  {
    id: "codex",
    label: "Codex",
    group: "harness",
    free: false,
    available: true,
    models: ["o3", "o4-mini"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    group: "harness",
    free: false,
    available: true,
    models: [],
  },
];

function renderPickerHarness(options?: {
  providers?: ProviderDescriptor[];
  activeProvider?: string | null;
  activeModel?: string | null;
}) {
  const onSwitchProvider = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <ProviderPicker
        open={open}
        providers={options?.providers ?? baseProviders}
        activeProvider={options?.activeProvider ?? "claude"}
        activeModel={options?.activeModel ?? "claude-sonnet-4-6"}
        onSwitchProvider={(provider, model) => onSwitchProvider(provider, model)}
        onOpenChange={setOpen}
      />
    );
  }

  render(<Harness />);
  return { onSwitchProvider };
}

describe("ProviderPicker", () => {
  it("renders 9 providers grouped into 3 categories with free badges", () => {
    renderPickerHarness();

    expect(screen.getByRole("group", { name: "Subscription" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Harness" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Direct API" })).toBeInTheDocument();

    const providerList = screen.getByRole("listbox", { name: "Providers" });
    expect(within(providerList).getAllByRole("option")).toHaveLength(9);
    expect(screen.getAllByText("Free").length).toBeGreaterThanOrEqual(3);
  });

  it("supports arrow navigation and Enter descends to model list", () => {
    renderPickerHarness();
    const dialog = screen.getByRole("dialog", { name: "Switch provider" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "o3" })).toBeInTheDocument();
  });

  it("empty model list commits provider without model and closes", () => {
    const { onSwitchProvider } = renderPickerHarness();
    const dialog = screen.getByRole("dialog", { name: "Switch provider" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // codex
    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // opencode
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onSwitchProvider).toHaveBeenCalledWith("opencode", undefined);
    expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
  });

  it("Esc returns from models to providers, then Esc closes", () => {
    renderPickerHarness();
    const dialog = screen.getByRole("dialog", { name: "Switch provider" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Escape" });
    expect(screen.getByRole("listbox", { name: "Providers" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
  });

  it("commits selected model and closes dialog", () => {
    const { onSwitchProvider } = renderPickerHarness();
    const dialog = screen.getByRole("dialog", { name: "Switch provider" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // codex
    fireEvent.keyDown(dialog, { key: "Enter" }); // models pane
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "ArrowDown" }); // o4-mini
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Enter" });

    expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o4-mini");
    expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
  });

  it("exposes grouped list semantics and aria-selected options", () => {
    renderPickerHarness();
    const groups = screen.getAllByRole("group");
    expect(groups.length).toBeGreaterThanOrEqual(3);

    const selectedOptions = screen.getAllByRole("option", { selected: true });
    expect(selectedOptions).toHaveLength(1);
  });
});
