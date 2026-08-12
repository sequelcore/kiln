import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExecutionRoutePicker } from "../src/components/execution-route-picker.js";
describe("ExecutionRoutePicker", () => {
  it("renders unavailable diagnostics", () => {
    render(<ExecutionRoutePicker catalog={{ routes: [{ routeId: "terra", label: "Terra", providerId: "codex", providerModelId: "gpt", accountSelection: { mode: "automatic", eligibleAccountCount: 1, allowOperatorOverride: true }, availability: "unresolved", reasonCodes: ["missing-credentials"], repairActions: ["authenticate-provider"] }] }} onSelect={vi.fn()} onRepair={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Terra" })).toBeDisabled();
    expect(screen.getByText(/missing-credentials/)).toBeInTheDocument();
  });

  it("sends supported repair actions with the route's derived provider", () => {
    const onRepair = vi.fn();
    render(<ExecutionRoutePicker catalog={{ routes: [{ routeId: "terra", label: "Terra", providerId: "codex-oauth", providerModelId: "gpt", accountSelection: { mode: "automatic", eligibleAccountCount: 1, allowOperatorOverride: true }, availability: "unresolved", reasonCodes: ["missing-credentials"], repairActions: ["authenticate-provider", "refresh-route-catalog", "review-route-configuration"] }] }} onSelect={vi.fn()} onRepair={onRepair} />);

    fireEvent.click(screen.getByRole("button", { name: "Authenticate codex-oauth" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh execution routes" }));

    expect(onRepair).toHaveBeenNthCalledWith(1, { routeId: "terra", providerId: "codex-oauth", action: "authenticate-provider" });
    expect(onRepair).toHaveBeenNthCalledWith(2, { routeId: "terra", providerId: "codex-oauth", action: "refresh-route-catalog" });
    expect(screen.getByText("review-route-configuration")).toBeInTheDocument();
  });
});
