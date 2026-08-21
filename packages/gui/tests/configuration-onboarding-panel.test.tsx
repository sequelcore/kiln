import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KilnConfigurationOnboardingSnapshot } from "@kilnai/gateway-contracts";
import { ConfigurationOnboardingPanel } from "../src/components/configuration-onboarding-panel.js";

function snapshot(
  overrides: Partial<KilnConfigurationOnboardingSnapshot> = {},
): KilnConfigurationOnboardingSnapshot {
  return {
    schemaVersion: 1,
    status: "ready",
    scope: "project",
    posture: "read-only",
    targets: [
      {
        id: "codex-terra",
        label: "Codex Terra",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-terra",
        selected: true,
      },
      {
        id: "opencode-go",
        label: "OpenCode Go",
        providerId: "opencode-go",
        providerModelId: "qwen3.7",
        selected: false,
      },
    ],
    defaultTargetId: "codex-terra",
    blockers: [],
    nextAction: "Apply onboarding to this project.",
    ...overrides,
  };
}

describe("ConfigurationOnboardingPanel", () => {
  it("submits the canonical safe defaults without persisting wizard state", () => {
    const onApply = vi.fn();
    render(
      <ConfigurationOnboardingPanel
        snapshot={snapshot()}
        loading={false}
        applying={false}
        error={null}
        onRefresh={vi.fn()}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Adopt safe setup" }));

    expect(onApply).toHaveBeenCalledWith({
      schemaVersion: 1,
      scope: "project",
      posture: "read-only",
      targetId: "codex-terra",
    });
  });

  it("discards local choices on cancel and never invokes adoption", () => {
    const onApply = vi.fn();
    render(
      <ConfigurationOnboardingPanel
        snapshot={snapshot()}
        loading={false}
        applying={false}
        error={null}
        onRefresh={vi.fn()}
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByLabelText("Default execution target"), {
      target: { value: "opencode-go" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Default execution target")).toHaveValue("codex-terra");
    expect(screen.getByText("Read only")).toBeInTheDocument();
  });

  it("explains a missing admitted target instead of exposing an unusable form", () => {
    render(
      <ConfigurationOnboardingPanel
        snapshot={snapshot({
          status: "blocked",
          targets: [],
          defaultTargetId: null,
          blockers: [{
            code: "target-unavailable",
            message: "Connect and admit a direct target first.",
          }],
          nextAction: "Use Available Models after provider connection.",
        })}
        loading={false}
        applying={false}
        error={null}
        onRefresh={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Provider setup required" })).toBeInTheDocument();
    expect(screen.getByText("Connect and admit a direct target first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adopt safe setup" })).not.toBeInTheDocument();
  });

  it("shows canonical completion without another completion flag", () => {
    render(
      <ConfigurationOnboardingPanel
        snapshot={snapshot({ status: "complete", nextAction: "Start the first turn." })}
        loading={false}
        applying={false}
        error={null}
        onRefresh={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "First turn ready" })).toBeInTheDocument();
    expect(screen.getByText("Start the first turn.")).toBeInTheDocument();
  });
});
