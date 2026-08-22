import type { ExecutionTargetWizardProposal, ExecutionTargetWizardResult } from "@kilnai/gateway-contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AvailableModelsPanel } from "../src/components/available-models-panel.js";

const revision = `sha256:${"a".repeat(64)}`;
const catalog = {
  observedAt: "2026-08-13T00:00:00.000Z",
  entries: [{ providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model", discoveryState: "observed", eligibilityState: "eligible", availabilityState: "available", configuredState: "unconfigured", configuredRouteRefs: [], reasonCodes: ["discovery-observed"] }],
} as const;

describe("AvailableModelsPanel", () => {
  it("sends only guided operator intent for preview and never renders raw material inputs", () => {
    const send = vi.fn();
    render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Add target for provider / model" }));
    expect(screen.getByLabelText("Target label (optional)")).toBeTruthy();
    expect(screen.getByLabelText("Maximum data classification")).toBeTruthy();
    expect(document.querySelector("textarea")).toBeNull();
    fireEvent.change(screen.getByLabelText("Target label (optional)"), { target: { value: "Primary model" } });
    fireEvent.click(screen.getByLabelText("I accept conservative data handling for public data: service operation, training may be permitted, and retention may be up to 3650 days"));
    fireEvent.submit(screen.getByRole("form", { name: "Execution target wizard" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: "execution_target_wizard", action: "preview", expectedRevision: revision, discoveryIdentity: { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model" }, label: "Primary model", dataClassification: "public", dataPolicyConfirmed: true });
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty("material");
  });

  it("shows the safe proposal and requires exact explicit approval before apply", () => {
    const send = vi.fn();
    const view = render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} />);
    openAndPreview(send);
    const requestId = send.mock.calls[0]?.[0].requestId as string;
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} wizardResult={previewed(requestId)} />);
    expect(screen.getByRole("heading", { name: "Review target" })).toBeTruthy();
    expect(screen.getByText("Expands write authority")).toBeTruthy();
    expect(screen.getByText("target-route")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Approve and create target" }));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ type: "execution_target_wizard", action: "apply", proposalId: "proposal-1", operatorApproved: true, requestId });
  });

  it("fails closed and focuses the conservative policy confirmation when it is missing", async () => {
    const send = vi.fn();
    render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Add target for provider / model" }));
    fireEvent.submit(screen.getByRole("form", { name: "Execution target wizard" }));
    const confirmation = screen.getByLabelText("I accept conservative data handling for public data: service operation, training may be permitted, and retention may be up to 3650 days");
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Accept the conservative data-handling posture");
    expect(send).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(confirmation));
  });

  it("fails closed for stale or ineligible evidence while warning on unavailable eligible models", () => {
    render(<AvailableModelsPanel catalog={{ ...catalog, entries: [
      { ...catalog.entries[0], providerModelId: "stale", discoveryState: "stale" },
      { ...catalog.entries[0], providerModelId: "ineligible", eligibilityState: "ineligible" },
      { ...catalog.entries[0], providerModelId: "unavailable", availabilityState: "unavailable" },
    ] }} catalogRevision={revision} send={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Add target for provider / stale" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add target for provider / ineligible" })).toBeNull();
    expect(screen.getByText("Stale discovery")).toBeTruthy();
    expect(screen.getAllByText("Ineligible")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add target for provider / unavailable" })).toBeTruthy();
    expect(screen.getByText("Unavailable. The target may not execute until provider health recovers.")).toBeTruthy();
  });

  it("keeps rejection actionable, ignores mismatched results, and focuses its repair action", async () => {
    const send = vi.fn(); const refresh = vi.fn();
    const view = render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} onRefresh={refresh} />);
    const origin = screen.getByRole("button", { name: "Add target for provider / model" });
    openAndPreview(send);
    const requestId = send.mock.calls[0]?.[0].requestId as string;
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} onRefresh={refresh} wizardResult={rejected("other-request")} />);
    expect(screen.getByText("Preparing target preview...")).toBeTruthy();
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} onRefresh={refresh} wizardResult={rejected(requestId)} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Current model evidence changed.")).toBeTruthy();
    const repair = within(alert).getByRole("button", { name: "Refresh models" });
    await waitFor(() => expect(document.activeElement).toBe(repair));
    fireEvent.click(repair);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Target label (optional)")).toHaveValue("Primary model");
    expect(document.activeElement).not.toBe(origin);
  });

  it("treats committed-refresh-failed as committed and never retries creation", async () => {
    const send = vi.fn(); const refresh = vi.fn();
    const view = render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} onRefresh={refresh} />);
    const origin = screen.getByRole("button", { name: "Add target for provider / model" });
    openAndPreview(send);
    const requestId = send.mock.calls[0]?.[0].requestId as string;
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} onRefresh={refresh} wizardResult={previewed(requestId)} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve and create target" }));
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} onRefresh={refresh} wizardResult={committedRefreshFailed(requestId)} />);
    expect(screen.getByText("Target created, but the model catalog could not be refreshed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create target/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("closes on success, announces it, and restores the invoking button", async () => {
    const send = vi.fn();
    const view = render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} />);
    const origin = screen.getByRole("button", { name: "Add target for provider / model" });
    openAndPreview(send);
    const requestId = send.mock.calls[0]?.[0].requestId as string;
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} wizardResult={previewed(requestId)} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve and create target" }));
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} wizardResult={created(requestId)} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Target created.");
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("restores focus to the section heading when refreshed evidence removes the invoking row", async () => {
    const send = vi.fn();
    const view = render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} />);
    openAndPreview(send);
    const requestId = send.mock.calls[0]?.[0].requestId as string;
    view.rerender(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} wizardResult={previewed(requestId)} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve and create target" }));
    view.rerender(<AvailableModelsPanel catalog={{ observedAt: catalog.observedAt, entries: [] }} catalogRevision={revision} send={send} wizardResult={created(requestId)} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Available models" })));
  });

  it("cancels without sending and restores focus", async () => {
    const send = vi.fn();
    render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} />);
    const origin = screen.getByRole("button", { name: "Add target for provider / model" });
    fireEvent.click(origin);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(send).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("prevents duplicate preview submissions and dismissal while pending", () => {
    const send = vi.fn();
    render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={send} />);
    openAndPreview(send);
    fireEvent.submit(screen.getByRole("form", { name: "Execution target wizard" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("shows and searches safe configured labels without exposing internal route identity", () => {
    render(<AvailableModelsPanel catalog={{ ...catalog, entries: [{ ...catalog.entries[0], configuredState: "configured", configuredRouteRefs: [{ routeId: "internal-route-id", label: "Daily coding" }] }] }} catalogRevision={revision} send={vi.fn()} />);
    expect(screen.getByText("Configured targets: Daily coding")).toBeTruthy();
    expect(screen.queryByText("provider:direct")).toBeNull();
    expect(screen.queryByText("internal-route-id")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search available models"), { target: { value: "provider:direct" } });
    expect(screen.getByText("No models match the current filters.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search available models"), { target: { value: "Daily coding" } });
    expect(screen.getByText("Configured targets: Daily coding")).toBeTruthy();
  });

  it("keeps filters, row actions, and the wizard usable in the narrow layout structure", () => {
    render(<AvailableModelsPanel catalog={catalog} catalogRevision={revision} send={vi.fn()} />);
    expect(screen.getByLabelText("Provider filter")).toBeTruthy();
    expect(screen.getByLabelText("Eligibility filter")).toBeTruthy();
    const action = screen.getByRole("button", { name: "Add target for provider / model" });
    expect(action.closest("article")).toHaveClass("flex-col", "sm:flex-row");
    fireEvent.click(action);
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[calc(100dvh-2rem)]", "sm:max-w-2xl");
    expect(screen.getByLabelText("Maximum data classification")).toBeTruthy();
  });
});

function openAndPreview(send: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole("button", { name: "Add target for provider / model" }));
  fireEvent.change(screen.getByLabelText("Target label (optional)"), { target: { value: "Primary model" } });
  fireEvent.click(screen.getByLabelText("I accept conservative data handling for public data: service operation, training may be permitted, and retention may be up to 3650 days"));
  fireEvent.submit(screen.getByRole("form", { name: "Execution target wizard" }));
  expect(send).toHaveBeenCalledTimes(1);
}

function proposal(): ExecutionTargetWizardProposal {
  return { proposalId: "proposal-1", operation: "target.create", scope: "global", status: "valid", baseRevision: revision, authorityImpact: "expands-write", approvalRequired: true, approvalStatus: "required", activation: "hot", owners: ["runtime"], reconciliationTargets: ["gui"], diagnostics: [], rollback: { restorable: true, summary: "Remove target-route." }, target: { routeId: "target-route", label: "Primary model", providerId: "provider", providerModelId: "model", accountSelectionMode: "automatic", dataClassification: "public", billingClass: "subscription", capabilityPosture: "kiln-executable", discoveryExpiresAt: "2026-09-01T00:00:00.000Z", evidenceExpiresAt: "2026-09-01T00:00:00.000Z" } };
}

function previewed(requestId: string): ExecutionTargetWizardResult { return { type: "execution_target_wizard_result", requestId, status: "previewed", code: "EXECUTION_TARGET_PREVIEWED", action: "approve-and-apply", message: "Preview ready.", proposal: proposal() }; }
function rejected(requestId: string): ExecutionTargetWizardResult { return { type: "execution_target_wizard_result", requestId, status: "rejected", code: "TARGET_DISCOVERY_STALE", action: "refresh-and-retry", message: "Current model evidence changed." }; }
function committedRefreshFailed(requestId: string): ExecutionTargetWizardResult { return { type: "execution_target_wizard_result", requestId, status: "committed-refresh-failed", code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED", action: "refresh-catalog", message: "Target created, but the model catalog could not be refreshed.", revision, proposal: proposal() }; }
function created(requestId: string): ExecutionTargetWizardResult { return { type: "execution_target_wizard_result", requestId, status: "created", code: "EXECUTION_TARGET_CREATED", action: "none", message: "Target created.", revision, proposal: proposal(), executionRouteCatalog: { revision, routes: [] }, availableModels: catalog }; }
