import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextMeter } from "../src/components/ai-elements/context.js";

describe("ContextMeter", () => {
  it("uses the owned button primitive and exposes provider evidence without color-only state", () => {
    render(<ContextMeter usage={{
      state: "authoritative",
      usedTokens: 2_400,
      contextWindowTokens: 8_000,
      remainingTokens: 5_600,
      usedPercentage: 30,
      providerId: "openai",
      modelId: "gpt-5",
      observedAt: "2026-08-10T00:00:00.000Z",
      measurement: "provider_reported",
      lifecycle: "completed",
      contextWindowAuthority: "provider_reported",
      freshness: "fresh",
    }} />);

    const trigger = screen.getByRole("button", { name: "Context 30%: 2.4k / 8k tokens" });
    fireEvent.click(trigger);
    expect(screen.getByRole("status", { name: "Context evidence" })).toHaveTextContent("Provider reported");
    expect(screen.getByRole("progressbar", { name: "Context window used" })).toHaveAttribute("aria-valuenow", "30");
  });

  it("does not fabricate a ratio for partial or unavailable evidence", () => {
    const { rerender } = render(<ContextMeter usage={{
      state: "partial",
      usedTokens: 2_400,
      providerId: "openai",
      modelId: "gpt-5",
      observedAt: "2026-08-10T00:00:00.000Z",
      measurement: "runtime_estimate",
      lifecycle: "restored",
      contextWindowAuthority: "unknown",
      freshness: "historical",
      reason: "No compatible context window was persisted.",
    }} />);

    fireEvent.click(screen.getByRole("button", { name: /Context partial.*historical measurement/ }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Historical")).toBeInTheDocument();
    expect(screen.getByText("No compatible context window was persisted.")).toBeInTheDocument();

    rerender(<ContextMeter usage={null} />);
    expect(screen.getByRole("button", { name: "Context usage unavailable" })).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });
});
