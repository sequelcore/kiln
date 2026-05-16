import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBanner } from "../src/components/error-banner.js";

const unsupportedAudioRouteMessage =
  "Multimodal route failed closed: unsupported_modality for cli-subscription:codex-oauth/gpt-5.5; required=audio; diagnostics=native_route_missing_capability,delegation_route_disallowed,transform_disallowed";

describe("ErrorBanner", () => {
  it("summarizes unsupported audio route failures while preserving diagnostics", () => {
    render(<ErrorBanner message={unsupportedAudioRouteMessage} />);

    expect(screen.getByRole("alert")).toHaveAccessibleName("Audio is not available on this route");
    expect(screen.getByText("Audio is not available on this route")).toBeInTheDocument();
    expect(screen.getByText(/The selected provider and model cannot accept audio input/)).toBeInTheDocument();
    expect(screen.getByText(unsupportedAudioRouteMessage)).toBeInTheDocument();
  });

  it("keeps long unrecognized errors wrapped in a compact alert", () => {
    const message = "Gateway failed ".repeat(20).trim();

    render(<ErrorBanner message={message} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("rounded-lg");
    expect(alert).toHaveTextContent(message);
  });

  it("wires retry and dismiss actions", () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();

    render(<ErrorBanner message="Gateway disconnected." onRetry={onRetry} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
