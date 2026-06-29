import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AppGatewayTargetSelector,
  RuntimeBootstrapGate,
  ToolUsageBudgetControl,
  TURN_AUTHORITY_OPTIONS,
  TurnAuthorityControl,
} from "../src/components/app-shell-controls.js";

describe("App shell controls", () => {
  it("renders retryable bootstrap errors next to the runtime status", () => {
    const onRetry = vi.fn();

    render(
      <RuntimeBootstrapGate
        title="Starting Kiln runtime"
        detail="Connecting to the local gateway."
        error="Gateway refused the connection."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("status", { name: "Runtime bootstrap" })).toHaveTextContent("Gateway refused the connection.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the turn authority command order exported from the control module", () => {
    expect(TURN_AUTHORITY_OPTIONS).toEqual(["auto", "read_only", "audited", "destructive"]);
  });

  it("keeps admitted authority in details instead of mixing it into the selected mode", () => {
    render(
      <TurnAuthorityControl
        value="destructive"
        authorityStatus={{
          effective: "destructive",
          admittedAuthority: "audited",
          requestedAuthority: "destructive",
          executionMode: "execute",
          sandboxProjection: "workspace_write",
          reason: "Policy downgraded destructive access.",
          completeness: "authoritative",
        }}
        onChange={vi.fn()}
      />,
    );

    const control = screen.getByRole("combobox", { name: "Turn authority: Full access" });
    expect(control).toHaveTextContent("Full access");
    expect(control).not.toHaveTextContent("Audited");
    expect(control).toHaveAttribute("title", expect.stringContaining("Granted: Audited"));
  });

  it("presents fail-closed admission as hidden status detail without confusing the selected mode", () => {
    render(
      <TurnAuthorityControl
        value="auto"
        authorityStatus={{
          effective: "fail_closed",
          admittedAuthority: "fail_closed",
          requestedAuthority: "auto",
          executionMode: "execute",
          sandboxProjection: "read_only",
          reason: "No authority route was admitted.",
          completeness: "partial",
        }}
        onChange={vi.fn()}
      />,
    );

    const control = screen.getByRole("combobox", { name: "Turn authority: Ask every time" });
    expect(control).toHaveTextContent("Ask every time");
    expect(control).not.toHaveTextContent("Blocked");
    expect(control).not.toHaveTextContent("fail_closed");
    expect(control).not.toHaveAttribute("title", expect.stringContaining("fail_closed"));
    expect(control).toHaveAttribute("title", expect.stringContaining("Granted: Blocked"));
    expect(control).toHaveAttribute("title", expect.stringContaining("Completeness: Partial"));
  });

  it("renders authority options as understandable policy choices", async () => {
    render(
      <TurnAuthorityControl
        value="auto"
        authorityStatus={null}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Turn authority: Ask every time" }));

    expect(screen.getByRole("option", { name: /Ask every time/ })).toHaveTextContent("Prompt before tools need more authority.");
    expect(screen.getByRole("option", { name: /Approve for me/ })).toHaveTextContent("Proceed with audited low-risk actions.");
    expect(screen.getByRole("option", { name: /Full access/ })).toHaveTextContent("Allow unrestricted local execution.");
  });

  it("presents native web tool usage budget profiles", () => {
    const onChange = vi.fn();
    render(
      <ToolUsageBudgetControl
        value="research"
        onChange={onChange}
      />,
    );

    const control = screen.getByRole("combobox", { name: "Tool usage budget" });
    expect(control).toHaveTextContent("Research");

    fireEvent.click(control);
    expect(screen.getByRole("option", { name: /Strict web/ })).toHaveTextContent("Track compact web research usage.");
    expect(screen.getByRole("option", { name: /No budget/ })).toHaveTextContent("Do not attach tool usage budgets.");
  });

  it("renders only runtime-capable gateway targets", () => {
    render(
      <AppGatewayTargetSelector
        apps={[
          { name: "runtime-app", runtimeCapable: true },
          { name: "view-only", runtimeCapable: false },
        ] as never}
        targets={[
          {
            label: "Runtime target",
            instanceId: "instance-1",
            gatewayTarget: { targetId: "runtime-target", appId: "runtime-app" },
          },
          {
            label: "Hidden target",
            instanceId: "instance-2",
            gatewayTarget: { targetId: "hidden-target", appId: "view-only" },
          },
        ] as never}
        selectedGatewayTargetId={null}
        onSelectGatewayTarget={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Gateway target" })).toHaveTextContent("Runtime target");
    expect(screen.queryByText("Hidden target")).not.toBeInTheDocument();
  });
});
