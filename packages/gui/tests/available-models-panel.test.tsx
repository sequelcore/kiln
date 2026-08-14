import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AvailableModelsPanel } from "../src/components/available-models-panel.js";

const catalog = { observedAt: "2026-08-13T00:00:00.000Z", entries: [{ providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model", discoveryState: "observed", eligibilityState: "eligible", availabilityState: "available", configuredState: "unconfigured", configuredRouteRefs: [], reasonCodes: ["discovery-observed"] }] } as const;
describe("AvailableModelsPanel", () => {
  it("shows runtime evidence and keeps creation fail-closed until complete material validates", () => {
    const send = vi.fn(); render(<AvailableModelsPanel catalog={catalog} catalogRevision={`sha256:${"a".repeat(64)}`} send={send} />);
    expect(screen.getByText("provider / model")).toBeTruthy(); fireEvent.click(screen.getByText("Create route"));
    fireEvent.click(screen.getByText("Validate and preview")); expect(send).not.toHaveBeenCalled();
    expect(screen.getByText(/Route material is invalid/u)).toBeTruthy();
  });

  it("retains material on correlated rejection, announces feedback, and restores focus", async () => {
    const send = vi.fn();
    const view = render(<AvailableModelsPanel catalog={catalog} catalogRevision={`sha256:${"a".repeat(64)}`} send={send} />);
    const origin = screen.getByText("Create route"); fireEvent.click(origin);
    fireEvent.change(screen.getByLabelText("Complete route material"), { target: { value: JSON.stringify(material()) } });
    fireEvent.click(screen.getByText("Validate and preview"));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Create route now"));
    const requestId = send.mock.calls[0]?.[0].requestId as string;
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={`sha256:${"a".repeat(64)}`} send={send} creationResult={{ type: "execution_route_create_result", requestId, status: "rejected", code: "EXECUTION_ROUTE_CREATE_DENIED", message: "Current evidence changed." }} />);
    expect(screen.getByLabelText("Complete route material")).toBeTruthy();
    expect(screen.getByText("Current evidence changed.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("searches and filters long, unknown, and grouped catalog entries without changing selection", () => {
    const longModel = `model-${"x".repeat(120)}`;
    render(<AvailableModelsPanel catalog={{ observedAt: catalog.observedAt, entries: [...catalog.entries, { ...catalog.entries[0], providerId: "other", providerModelId: longModel, eligibilityState: "unknown", availabilityState: "unknown", configuredState: "configured" }] }} catalogRevision={`sha256:${"a".repeat(64)}`} send={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "provider" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "other" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search available models"), { target: { value: longModel } });
    expect(screen.queryByText("provider / model")).toBeNull();
    expect(screen.getByText(new RegExp(longModel))).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Eligibility filter"), { target: { value: "eligible" } });
    expect(screen.getByText("No models match the current filters.")).toBeTruthy();
  });

  it("supports keyboard preview before an explicit create action", () => {
    const send = vi.fn(); render(<AvailableModelsPanel catalog={catalog} catalogRevision={`sha256:${"a".repeat(64)}`} send={send} />);
    fireEvent.click(screen.getByText("Create route"));
    fireEvent.change(screen.getByLabelText("Complete route material"), { target: { value: JSON.stringify(material()) } });
    fireEvent.submit(screen.getByLabelText("Execution route creation form"));
    expect(screen.getByText(/Preview ready/u)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
});

function material() {
  const evidence = { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high", authority: "configured" };
  return { routeId: "route", label: "Route", accountSelection: { mode: "exact", accountId: "account" }, dataClassification: "public", dataPolicyEvidence: { providerId: "provider", providerModelId: "model", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "public", permittedClassifications: ["public"], sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, economics: { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "fixture", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled", overagePosture: "disabled", contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription", rateCardId: "fixture", rateCardRevision: "v1", evidence }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } };
}
