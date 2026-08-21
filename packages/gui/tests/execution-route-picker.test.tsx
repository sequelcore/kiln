import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExecutionRoutePicker } from "../src/components/execution-route-picker.js";

const catalog = {
  routes: [
    {
      routeId: "codex-auto-review", label: "Codex Auto Review", providerId: "codex-oauth", providerModelId: "gpt-5.6",
      accountOverrideIds: ["team-a"], accountSelection: { mode: "automatic" as const, eligibleAccountCount: 2, allowOperatorOverride: true as const }, availability: "available" as const, reasonCodes: [], repairActions: [],
    },
    {
      routeId: "luna", label: "Luna", providerId: "opencode-go", providerModelId: "luna", accountSelection: { mode: "exact" as const, eligibleAccountCount: 1, allowOperatorOverride: false as const }, availability: "available" as const, reasonCodes: [], repairActions: [],
    },
    {
      routeId: "offline", label: "Offline", providerId: "private-provider", providerModelId: "v1", accountSelection: { mode: "exact" as const, eligibleAccountCount: 1, allowOperatorOverride: false as const }, availability: "unresolved" as const, reasonCodes: ["missing-credentials" as const], repairActions: ["authenticate-provider" as const, "refresh-route-catalog" as const],
    },
  ],
};

describe("ExecutionRoutePicker", () => {
  it("uses the approved searchable command composition with official provider marks and brand/access filters", () => {
    render(<ExecutionRoutePicker catalog={catalog} onSelect={vi.fn()} onRepair={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Search execution targets" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Providers" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Route type" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Codex Auto Review, Automatic/ }).querySelector('[data-provider-brand="codex"]')).not.toBeNull();

    fireEvent.click(within(screen.getByRole("group", { name: "Providers" })).getByRole("button", { name: "OpenCode" }));
    expect(screen.queryByRole("option", { name: /Codex Auto Review/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Luna, Exact account/ })).toBeInTheDocument();
  });

  it("searches routes and submits automatic or exact account intent while marking the current exact intent", () => {
    const onSelect = vi.fn();
    render(<ExecutionRoutePicker catalog={catalog} activeRouteId="codex-auto-review" activeAccountOverrideId="team-a" onSelect={onSelect} onRepair={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Codex Auto Review, team-a, Current/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Codex Auto Review, team-a, Current/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Codex Auto Review account" }));
    fireEvent.click(screen.getByRole("option", { name: "team-a", exact: true }));
    expect(onSelect).toHaveBeenNthCalledWith(1, { routeId: "codex-auto-review" });
    expect(onSelect).toHaveBeenNthCalledWith(2, { routeId: "codex-auto-review", accountOverrideId: "team-a" });

    fireEvent.change(screen.getByRole("combobox", { name: "Search execution targets" }), { target: { value: "luna" } });
    expect(screen.getByRole("option", { name: /Luna, Exact account/ })).toBeInTheDocument();
  });

  it("keeps unavailable diagnostics visible and exposes supported repair actions", () => {
    const onRepair = vi.fn();
    render(<ExecutionRoutePicker catalog={catalog} onSelect={vi.fn()} onRepair={onRepair} />);
    const offline = screen.getByRole("option", { name: /Offline, Exact account, Unavailable/ });
    expect(offline).toHaveAttribute("aria-disabled", "true");
    expect(within(offline).getByText("Missing credentials")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Authenticate private-provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh execution targets" }));
    expect(onRepair).toHaveBeenNthCalledWith(1, { routeId: "offline", providerId: "private-provider", action: "authenticate-provider" });
    expect(onRepair).toHaveBeenNthCalledWith(2, { routeId: "offline", providerId: "private-provider", action: "refresh-route-catalog" });
  });

  it("keeps an unknown provider named all separate from the all-providers filter", () => {
    render(<ExecutionRoutePicker catalog={{ routes: [{
      routeId: "custom",
      label: "Custom",
      providerId: "all",
      providerModelId: "v1",
      accountSelection: { mode: "exact", eligibleAccountCount: 1, allowOperatorOverride: false },
      availability: "available",
      reasonCodes: [],
      repairActions: [],
    }] }} onSelect={vi.fn()} onRepair={vi.fn()} />);

    const rail = screen.getByRole("group", { name: "Providers" });
    expect(within(rail).getByRole("button", { name: "All providers", exact: true })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "all", exact: true })).toBeInTheDocument();
  });

  it("falls back to automatic when the active account override is no longer eligible", () => {
    render(
      <ExecutionRoutePicker
        catalog={catalog}
        activeRouteId="codex-auto-review"
        activeAccountOverrideId="removed-account"
        onSelect={vi.fn()}
        onRepair={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Codex Auto Review account" })).toHaveTextContent("Automatic");
    expect(screen.getByRole("option", { name: /Codex Auto Review, Automatic, Current/ })).toBeInTheDocument();
  });
});
