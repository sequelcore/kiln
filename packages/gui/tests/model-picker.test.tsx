import type { ModelCatalog, ModelExecutionTarget } from "@kilnai/gateway-contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "../src/components/model-picker.js";

const catalog = {
  observedAt: "2026-08-26T16:00:00.000Z",
  models: [
    model("codex-oauth", "gpt-5.6", "GPT 5.6", [
      target("codex-auto", "Codex automatic", ["team-a", "team-b"]),
    ], {
      family: "gpt-5",
      releaseDate: "2026-08-01",
      contextWindow: 1_000_000,
    }),
    model("opencode-go", "luna", "Luna", [target("luna", "Luna")]),
    model("private-provider", "private-v1", "Private V1", [
      {
        ...target("private", "Private"),
        availability: "unresolved" as const,
        reasonCodes: ["missing-credentials" as const],
        repairActions: ["authenticate-provider" as const, "refresh-model-catalog" as const],
      },
    ]),
    model("unconfigured", "future", "Future", []),
  ],
} as const satisfies ModelCatalog;

describe("ModelPicker", () => {
  it("previews a model without selecting it, then submits its configured target explicitly", () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });

    fireEvent.click(screen.getByRole("option", { name: /Luna, opencode-go/u }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Luna details" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use Luna" }));
    expect(onSelect).toHaveBeenCalledWith({ targetId: "luna" });
  });

  it("searches model metadata and filters by provider without conflating the all control", () => {
    renderPicker();
    fireEvent.change(screen.getByRole("combobox", { name: "Search models" }), { target: { value: "gpt-5" } });
    expect(screen.getByRole("option", { name: /GPT 5.6/u })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Luna/u })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "Model providers" })).getByRole("button", { name: "unconfigured" }));
    expect(screen.getByRole("option", { name: /Future/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure this model" })).toBeInTheDocument();
  });

  it("keeps unavailable diagnostics concise with one contextual recovery action", () => {
    const onRepair = vi.fn();
    renderPicker({ onRepair });
    fireEvent.click(screen.getByRole("option", { name: /Private V1/u }));
    expect(screen.getByText("Missing credentials.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Authenticate private-provider" }));
    expect(onRepair).toHaveBeenCalledWith({
      targetId: "private",
      providerId: "private-provider",
      action: "authenticate-provider",
    });
    expect(screen.queryByRole("button", { name: "Refresh model catalog" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check account" })).not.toBeInTheDocument();
  });

  it("uses the checkmark for the active model, not the previewed row", () => {
    renderPicker({ activeTargetId: "codex-auto" });
    const active = screen.getByRole("option", { name: /GPT 5.6, codex-oauth, current/iu });
    const preview = screen.getByRole("option", { name: /Luna, opencode-go/u });

    fireEvent.click(preview);

    expect(active).toHaveAttribute("data-checked", "true");
    expect(preview).not.toHaveAttribute("data-checked");
  });

  it("marks the active target and reports authoritative progress and failure", () => {
    const { rerender } = renderPicker({ activeTargetId: "codex-auto", selectionStatus: { state: "selecting", targetId: "luna" } });
    expect(screen.getByRole("option", { name: /GPT 5.6, codex-oauth, current/iu })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Applying execution target");

    rerender(<ModelPicker catalog={catalog} selectionStatus={{ state: "failed", message: "Selected account is unavailable." }} onSelect={vi.fn()} onRepair={vi.fn()} onConfigure={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Selected account is unavailable.");
  });

  it("treats a different account preference as a new selection", () => {
    const onSelect = vi.fn();
    renderPicker({ activeTargetId: "codex-auto", activeAccountOverrideId: "team-a", onSelect });

    fireEvent.click(screen.getByRole("option", { name: /GPT 5.6/u }));
    fireEvent.click(screen.getByRole("combobox", { name: "Account preference" }));
    const teamB = screen.getByRole("option", { name: "team-b" });
    fireEvent.keyDown(teamB, { key: "Enter" });
    fireEvent.click(teamB);
    const apply = screen.getByRole("button", { name: "Use GPT 5.6" });
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    expect(onSelect).toHaveBeenCalledWith({ targetId: "codex-auto", accountOverrideId: "team-b" });
  });
});

function renderPicker(overrides: Partial<Parameters<typeof ModelPicker>[0]> = {}) {
  const props: Parameters<typeof ModelPicker>[0] = {
    catalog,
    onSelect: vi.fn(),
    onRepair: vi.fn(),
    onConfigure: vi.fn(),
    ...overrides,
  };
  return render(<ModelPicker {...props} />);
}

function model(
  providerId: string,
  providerModelId: string,
  displayName: string,
  targets: readonly ModelExecutionTarget[],
  metadata: { readonly family?: string; readonly releaseDate?: string; readonly contextWindow?: number } = {},
) {
  return {
    providerId,
    providerRouteId: `${providerId}:direct`,
    providerModelId,
    access: providerId === "codex-oauth" ? "subscription" as const : "api" as const,
    family: metadata.family ?? providerModelId,
    displayName,
    ...(metadata.releaseDate ? { releaseDate: metadata.releaseDate } : {}),
    discovery: "observed" as const,
    eligibility: "eligible" as const,
    availability: "available" as const,
    ...(metadata.contextWindow ? { capabilities: { inputModalities: ["text" as const], outputModalities: ["text" as const], tools: true, structuredOutput: true, reasoning: true, contextWindow: metadata.contextWindow } } : {}),
    provenance: [],
    targets,
  };
}

function target(targetId: string, label: string, accountOverrideIds: readonly string[] = []) {
  return {
    targetId,
    label,
    access: "api" as const,
    availability: "available" as const,
    reasonCodes: ["configured" as const],
    repairActions: [],
    eligibleAccountCount: 1,
    accountOverrideIds,
    cost: { kind: "unknown" as const },
  };
}
